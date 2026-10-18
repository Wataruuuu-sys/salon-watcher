import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { sweepGenre } from '../../../src/sources/googleMaps/sweep.js';
import type { Cell } from '../../../src/sources/googleMaps/grid.js';
import type { PlacesClient } from '../../../src/sources/googleMaps/places.js';
import { mapCells, placesSeen } from '../../../src/db/schema.js';
import type { Db } from '../../../src/db/client.js';
import type { Genre } from '../../../src/domain/types.js';
import { getTestDb, resetDb } from '../../helpers/db.js';

/** Fake client: respond(query, cell) -> ids; paginates 20 per page like the real API (max 60). */
function fakeClient(respond: (query: string, cell: Cell) => string[]): PlacesClient & { calls: number } {
  const c = {
    calls: 0,
    async searchIds(query: string, cell: Cell, pageToken?: string) {
      c.calls++;
      const all = respond(query, cell).slice(0, 60);
      const off = pageToken ? Number(pageToken) : 0;
      const ids = all.slice(off, off + 20);
      return { ids, nextPageToken: off + 20 < all.length ? String(off + 20) : undefined };
    },
    async details() {
      return null;
    },
  };
  return c;
}

const A: Cell = { lat: 35.7, lng: 139.4, radiusM: 750 };
const B: Cell = { lat: 35.7, lng: 139.5, radiusM: 750 };

async function addCells(db: Db, genre: Genre, cells: Cell[]) {
  await db.insert(mapCells).values(cells.map((c) => ({ genre, ...c })));
}
const seen = async (db: Db) =>
  Object.fromEntries((await db.select().from(placesSeen)).map((r) => [r.placeId, r]));
const range = (p: string, n: number) => Array.from({ length: n }, (_, i) => `${p}${i}`);
const isA = (c: Cell) => c.lat === A.lat && c.lng === A.lng;

describe('sweepGenre', () => {
  let db: Db;
  beforeEach(async () => {
    db = await getTestDb();
    await resetDb(db);
  });

  it('first run marks everything non-candidate and seeds cells; second run flags only new ids', async () => {
    await addCells(db, 'hair', [A, B]);
    let extra: string[] = [];
    const client = fakeClient((_q, c) => (isA(c) ? ['a1', 'a2', ...extra] : ['b1']));
    const r1 = await sweepGenre(db, client, 'hair');
    expect(r1.newIds).toBe(3);
    let s = await seen(db);
    expect(Object.values(s).every((r) => !r.isLeadCandidate)).toBe(true);
    expect((await db.select().from(mapCells)).every((c) => c.seeded && c.lastRunAt && c.lastCount !== null)).toBe(true);

    extra = ['NEW1'];
    const r2 = await sweepGenre(db, client, 'hair');
    expect(r2.newIds).toBe(1);
    s = await seen(db);
    expect(s.NEW1!.isLeadCandidate).toBe(true);
    expect(s.a1!.isLeadCandidate).toBe(false);
  });

  it('subdivides a saturated cell; ids first seen in child cells are not lead candidates', async () => {
    await addCells(db, 'hair', [A]);
    const client = fakeClient((_q, c) => {
      if (isA(c) && c.radiusM === 750) return range('a', 60);
      if (c.radiusM === 375) return c.lat > A.lat && c.lng > A.lng ? ['a1', 'HIDDEN1'] : ['a2'];
      return [];
    });
    const r = await sweepGenre(db, client, 'hair');
    expect(r.subdivided).toBe(1);
    const cells = await db.select().from(mapCells);
    expect(cells).toHaveLength(5);
    const parent = cells.find((c) => c.radiusM === 750)!;
    expect(parent.active).toBe(false);
    const kids = cells.filter((c) => c.radiusM === 375);
    expect(kids).toHaveLength(4);
    expect(kids.every((k) => k.parentId === parent.id && k.active && k.seeded)).toBe(true);
    const s = await seen(db);
    expect(s.HIDDEN1!.isLeadCandidate).toBe(false);
    expect(Object.keys(s)).toHaveLength(61);
  });

  it('subdivides when any one query of the genre saturates; stops at max depth', async () => {
    await addCells(db, 'eye', [A]);
    const client = fakeClient((q, c) => (q === '眉毛サロン' ? range('m', 60) : ['x']));
    const r = await sweepGenre(db, client, 'eye', { maxSubdivideDepth: 1 });
    expect(r.subdivided).toBe(1);
    // children also saturate on the eyebrow query but depth cap (1) prevents further splitting
    const cells = await db.select().from(mapCells);
    expect(cells.filter((c) => c.active)).toHaveLength(4);
    expect(cells).toHaveLength(5);
  });

  it('a place found by two genres is stored once, under the first genre', async () => {
    await addCells(db, 'hair', [A]);
    await addCells(db, 'nail', [A]);
    const client = fakeClient(() => ['shared']);
    await sweepGenre(db, client, 'hair');
    await sweepGenre(db, client, 'nail');
    const rows = await db.select().from(placesSeen).where(eq(placesSeen.placeId, 'shared'));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.genre).toBe('hair');
  });

  it('only sweeps active cells of the requested genre', async () => {
    await addCells(db, 'hair', [A]);
    await addCells(db, 'nail', [B]);
    const client = fakeClient(() => ['z']);
    await sweepGenre(db, client, 'hair');
    expect(client.calls).toBe(1);
  });

  it('survives a failing search: other cells proceed, the failed unseeded cell stays unseeded', async () => {
    await addCells(db, 'hair', [A, B]);
    const client = fakeClient((_q, c) => (isA(c) ? ['a1'] : ['b1']));
    const base = client.searchIds.bind(client);
    client.searchIds = async (q, c, t) => {
      if (isA(c)) throw new Error('boom');
      return base(q, c, t);
    };
    const r = await sweepGenre(db, client, 'hair');
    expect(r.newIds).toBe(1);
    const cells = await db.select().from(mapCells);
    expect(cells.find((c) => c.lng === A.lng)!.seeded).toBe(false);
    expect(cells.find((c) => c.lng === B.lng)!.seeded).toBe(true);
  });

  it('throws when every (cell, query) search fails', async () => {
    await addCells(db, 'hair', [A, B]);
    const client = fakeClient(() => []);
    client.searchIds = async () => {
      throw new Error('quota');
    };
    await expect(sweepGenre(db, client, 'hair')).rejects.toThrow(/every maps search failed/);
  });
});
