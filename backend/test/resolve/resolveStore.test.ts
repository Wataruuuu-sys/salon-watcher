import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getTestDb, resetDb } from '../helpers/db.js';
import { ingestRawItems } from '../../src/sources/ingest.js';
import { evidence, rawItems, stores } from '../../src/db/schema.js';
import { resolveStore, type ResolveInput } from '../../src/resolve/resolveStore.js';
import type { Classification } from '../../src/domain/types.js';

const db = await getTestDb();

function cls(over: Partial<Classification>): Classification {
  return {
    verdict: 'yes',
    storeName: null,
    genre: null,
    city: null,
    openingDate: null,
    reason: 'r',
    signals: [],
    ...over,
  };
}

let seq = 0;
async function input(over: Partial<ResolveInput> & { c?: Partial<Classification> }): Promise<ResolveInput> {
  const ext = `x${++seq}`;
  await ingestRawItems(db, [
    { source: over.source ?? 'threads', externalId: ext, url: `https://e/${ext}`, authorHandle: null, text: 't', postedAt: null, payload: {} },
  ]);
  const [raw] = await db.select().from(rawItems).where(eq(rawItems.externalId, ext));
  return {
    rawItemId: raw!.id,
    source: 'threads',
    url: `https://e/${ext}`,
    placeId: null,
    snsHandle: null,
    confidence: 'yes',
    ...over,
    classification: cls(over.c ?? {}),
  };
}

beforeEach(() => resetDb(db));

describe('resolveStore', () => {
  async function seedMap() {
    return resolveStore(
      db,
      await input({
        source: 'google_maps',
        placeId: 'P1',
        confidence: 'map',
        c: { storeName: 'ネイルサロン Lily', city: '立川市', reason: 'map reason' },
      }),
    );
  }

  it('merges a Threads post into the Map store', async () => {
    const first = await seedMap();
    expect(first.created).toBe(true);
    const second = await resolveStore(
      db,
      await input({
        snsHandle: 'threads:lily_nail',
        confidence: 'yes',
        c: { storeName: 'Nail Salon Lily 立川店', city: '立川市', genre: 'nail', reason: 'open soon' },
      }),
    );
    expect(second).toEqual({ storeId: first.storeId, created: false });
    const ev = await db.select().from(evidence);
    expect(ev).toHaveLength(2);
    expect(ev.map((e) => e.reason).sort()).toEqual(['map reason', 'open soon']);
    const [s] = await db.select().from(stores);
    expect(s!.confidence).toBe('yes');
    expect(s!.snsHandle).toBe('threads:lily_nail');
    expect(s!.placeId).toBe('P1');
    expect(s!.genre).toBe('nail');
  });

  it('does not downgrade confidence', async () => {
    await resolveStore(db, await input({ snsHandle: 'threads:a', confidence: 'yes', c: { storeName: 'Lily' } }));
    await resolveStore(db, await input({ snsHandle: 'threads:a', confidence: 'maybe', c: { storeName: 'Lily' } }));
    const [s] = await db.select().from(stores);
    expect(s!.confidence).toBe('yes');
  });

  it('keeps same-name stores in different cities separate', async () => {
    const first = await seedMap();
    const other = await resolveStore(
      db,
      await input({ confidence: 'yes', c: { storeName: 'Lily', city: '八王子市' } }),
    );
    expect(other.created).toBe(true);
    expect(other.storeId).not.toBe(first.storeId);
  });

  it('merges by same handle when the name is compatible or unknown', async () => {
    const a = await resolveStore(db, await input({ snsHandle: 'threads:h', c: { storeName: 'Alpha' } }));
    const b = await resolveStore(db, await input({ snsHandle: 'threads:h', c: { storeName: 'Alpha 立川店' } }));
    const c = await resolveStore(db, await input({ snsHandle: 'threads:h', c: { storeName: null } }));
    expect(b).toEqual({ storeId: a.storeId, created: false });
    expect(c).toEqual({ storeId: a.storeId, created: false });
  });

  it('merges a named post into a store created under the handle fallback name', async () => {
    const a = await resolveStore(db, await input({ snsHandle: 'threads:h3', c: { storeName: null } }));
    const b = await resolveStore(db, await input({ snsHandle: 'threads:h3', c: { storeName: 'Beta' } }));
    expect(b).toEqual({ storeId: a.storeId, created: false });
  });

  it('keeps two differently named stores announced by the same poster handle separate', async () => {
    const a = await resolveStore(db, await input({ snsHandle: 'threads:h', c: { storeName: 'Alpha' } }));
    const b = await resolveStore(db, await input({ snsHandle: 'threads:h', c: { storeName: 'Totally Different' } }));
    expect(b.created).toBe(true);
    expect(b.storeId).not.toBe(a.storeId);
    const rows = await db.select().from(stores).orderBy(stores.id);
    expect(rows.map((r) => r.snsHandle)).toEqual(['threads:h', null]);
  });

  it('keeps two Map places with different placeIds but the same name separate', async () => {
    const mk = async (placeId: string) =>
      resolveStore(
        db,
        await input({ source: 'google_maps', placeId, confidence: 'map', c: { storeName: 'Lily', city: '立川市' } }),
      );
    const a = await mk('PA');
    const b = await mk('PB');
    expect(b.created).toBe(true);
    expect(b.storeId).not.toBe(a.storeId);
    expect(await db.select().from(stores)).toHaveLength(2);
  });

  it('does not fuzzy-merge into a store owned by a different sns handle', async () => {
    const a = await resolveStore(
      db,
      await input({ snsHandle: 'threads:one', c: { storeName: 'Hair Make Lily', city: '立川市' } }),
    );
    const b = await resolveStore(
      db,
      await input({ snsHandle: 'threads:two', c: { storeName: 'Hair Make Lily', city: null } }),
    );
    expect(b.created).toBe(true);
    expect(b.storeId).not.toBe(a.storeId);
  });

  it('skips fuzzy matching for null names and falls back to handle / unknown', async () => {
    await resolveStore(db, await input({ snsHandle: 'threads:h2', c: { storeName: null } }));
    await resolveStore(db, await input({ c: { storeName: null } }));
    const rows = await db.select().from(stores);
    expect(rows.map((r) => r.name).sort()).toEqual(['threads:h2', '店名不明']);
  });
});
