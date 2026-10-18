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

  it('merges by same handle even with a different name', async () => {
    const a = await resolveStore(db, await input({ snsHandle: 'threads:h', c: { storeName: 'Alpha' } }));
    const b = await resolveStore(db, await input({ snsHandle: 'threads:h', c: { storeName: 'Totally Different' } }));
    expect(b).toEqual({ storeId: a.storeId, created: false });
  });

  it('skips fuzzy matching for null names and falls back to handle / unknown', async () => {
    await resolveStore(db, await input({ snsHandle: 'threads:h2', c: { storeName: null } }));
    await resolveStore(db, await input({ c: { storeName: null } }));
    const rows = await db.select().from(stores);
    expect(rows.map((r) => r.name).sort()).toEqual(['threads:h2', '店名不明']);
  });
});
