import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createGoogleMapsSource } from '../../../src/sources/googleMaps/source.js';
import type { PlaceDetails, PlacesClient } from '../../../src/sources/googleMaps/places.js';
import { getSource } from '../../../src/sources/registry.js';
import type { SourceContext } from '../../../src/sources/types.js';
import { mapCells, placesSeen } from '../../../src/db/schema.js';
import { getTestDb, resetDb } from '../../helpers/db.js';
import type { Db } from '../../../src/db/client.js';

const detail = (id: string, over: Partial<PlaceDetails> = {}): PlaceDetails => ({
  id, name: `Salon ${id}`, address: '日本、〒190-0022 東京都立川市錦町1-1', mapsUrl: `https://maps/${id}`,
  businessStatus: 'OPERATIONAL', openingDate: null, types: [], ...over,
});

function ctxFor(db: Db): SourceContext {
  return {
    db, http: fetch, now: new Date('2026-10-18T00:00:00Z'),
    secrets: { get: async () => 'KEY', put: async () => {} },
    log: { info() {}, warn() {}, error() {} },
  };
}

async function candidates(db: Db, ids: string[], genre = 'hair') {
  let t = 0;
  for (const id of ids) {
    await db.insert(placesSeen).values({
      placeId: id, genre, isLeadCandidate: true, firstSeenAt: new Date(Date.UTC(2026, 0, 1, 0, 0, t++)),
    });
  }
}

describe('googleMapsSource', () => {
  let db: Db;
  const fetched: string[] = [];
  const table: Record<string, PlaceDetails | null> = {};
  const client: PlacesClient = {
    searchIds: async () => ({ ids: [] }),
    details: async (id) => {
      fetched.push(id);
      return id in table ? table[id]! : detail(id);
    },
  };
  const source = createGoogleMapsSource(() => client);

  beforeEach(async () => {
    db = await getTestDb();
    await resetDb(db);
    fetched.length = 0;
    for (const k of Object.keys(table)) delete table[k];
    delete process.env.MAPS_DETAILS_PER_RUN;
  });

  it('is registered and lists genre shards', async () => {
    expect(getSource('google_maps').id).toBe('google_maps');
    expect(await source.listShards(ctxFor(db))).toEqual(['hair', 'nail', 'eye', 'relax', 'esthe', 'seitai']);
  });

  it('emits preclassified items, filtering closed and out-of-area places', async () => {
    await candidates(db, ['ok', 'closed', 'sagami', 'future']);
    table.closed = detail('closed', { businessStatus: 'CLOSED_PERMANENTLY' });
    table.sagami = detail('sagami', { address: '神奈川県相模原市中央区1' });
    table.future = detail('future', { businessStatus: 'FUTURE_OPENING', openingDate: '2026-12-01' });
    const items = await source.collect('hair', ctxFor(db));
    expect(items.map((i) => i.externalId).sort()).toEqual(['future', 'ok']);
    const ok = items.find((i) => i.externalId === 'ok')!;
    expect(ok).toMatchObject({
      source: 'google_maps', url: 'https://maps/ok', placeId: 'ok', authorHandle: null, postedAt: null,
      preclassified: {
        verdict: 'yes', storeName: 'Salon ok', genre: 'hair', city: '立川市', openingDate: null,
        reason: 'Google Mapに新規出現', signals: [],
      },
    });
    expect(ok.text).toContain('Salon ok');
    expect(ok.text).toContain('立川市');
    expect(items.find((i) => i.externalId === 'future')!.preclassified!.signals).toEqual(['FUTURE_OPENING']);
    expect(items.find((i) => i.externalId === 'future')!.preclassified!.openingDate).toBe('2026-12-01');
    const rows = await db.select().from(placesSeen);
    expect(rows.every((r) => r.detailsFetched)).toBe(true);
  });

  it('fetches at most 25 details per run (oldest first), leaving the rest for next time', async () => {
    const ids = Array.from({ length: 30 }, (_, i) => `p${String(i).padStart(2, '0')}`);
    await candidates(db, ids);
    await source.collect('hair', ctxFor(db));
    expect(fetched).toHaveLength(25);
    expect(fetched.sort()).toEqual(ids.slice(0, 25));
    const left = await db.select().from(placesSeen).where(eq(placesSeen.detailsFetched, false));
    expect(left.map((r) => r.placeId).sort()).toEqual(ids.slice(25));
  });

  it('honours MAPS_DETAILS_PER_RUN and leaves failed lookups unfetched', async () => {
    process.env.MAPS_DETAILS_PER_RUN = '2';
    await candidates(db, ['a', 'b', 'c']);
    table.a = null;
    const items = await source.collect('hair', ctxFor(db));
    expect(fetched).toEqual(['a', 'b']);
    expect(items.map((i) => i.externalId)).toEqual(['b']);
    const a = await db.select().from(placesSeen).where(eq(placesSeen.placeId, 'a'));
    expect(a[0]!.detailsFetched).toBe(false);
  });

  it('seeds the grid for the genre on collect', async () => {
    await source.collect('nail', ctxFor(db));
    const rows = await db.select().from(mapCells).where(eq(mapCells.genre, 'nail'));
    expect(rows.length).toBeGreaterThan(100);
    expect(rows.every((r) => r.seeded)).toBe(true);
  });
});
