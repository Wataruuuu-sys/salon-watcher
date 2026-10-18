import { beforeEach, describe, expect, it } from 'vitest';
import { getTestDb, resetDb } from '../helpers/db.js';
import { ingestRawItems } from '../../src/sources/ingest.js';
import { rawItems } from '../../src/db/schema.js';
import type { RawItemInput } from '../../src/domain/types.js';

const items: RawItemInput[] = [
  {
    source: 'threads',
    externalId: 'a1',
    url: 'https://example.com/a1',
    authorHandle: 'salon_a',
    text: 'open soon',
    postedAt: new Date('2026-10-01T00:00:00Z'),
    payload: { raw: 1 },
  },
  {
    source: 'google_maps',
    externalId: 'p1',
    url: 'https://maps.example.com/p1',
    authorHandle: null,
    text: 'Salon P',
    postedAt: null,
    payload: { raw: 2 },
    placeId: 'p1',
    preclassified: {
      verdict: 'maybe',
      storeName: 'Salon P',
      genre: 'hair',
      city: null,
      openingDate: null,
      reason: 'map',
      signals: ['new'],
    },
  },
];

describe('ingestRawItems', () => {
  beforeEach(async () => resetDb(await getTestDb()));

  it('inserts once and skips duplicates on re-ingest', async () => {
    const db = await getTestDb();
    expect(await ingestRawItems(db, items)).toEqual({ inserted: 2, skipped: 0 });
    expect(await ingestRawItems(db, items)).toEqual({ inserted: 0, skipped: 2 });
    const rows = await db.select().from(rawItems);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === 'pending')).toBe(true);
    const map = rows.find((r) => r.source === 'google_maps')!;
    expect((map.preclassified as { verdict: string }).verdict).toBe('maybe');
    expect(map.placeId).toBe('p1');
  });

  it('handles an empty batch', async () => {
    const db = await getTestDb();
    expect(await ingestRawItems(db, [])).toEqual({ inserted: 0, skipped: 0 });
  });

  it('inserts batches beyond the 65535 bind-parameter limit in chunks', async () => {
    const db = await getTestDb();
    // 7500 rows x 9 columns = 67500 params: one statement would be rejected by Postgres.
    const many: RawItemInput[] = Array.from({ length: 7500 }, (_, i) => ({
      source: 'threads',
      externalId: `bulk${i}`,
      url: `https://threads.net/p/bulk${i}`,
      authorHandle: null,
      text: 't',
      postedAt: null,
      payload: {},
    }));
    await ingestRawItems(db, many.slice(0, 1200));
    expect(await ingestRawItems(db, many)).toEqual({ inserted: 6300, skipped: 1200 });
    expect(await db.$count(rawItems)).toBe(7500);
  });
});
