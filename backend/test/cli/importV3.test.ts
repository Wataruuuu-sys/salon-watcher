import { beforeEach, describe, expect, it } from 'vitest';
import { getTestDb, resetDb } from '../helpers/db.js';
import { placesSeen } from '../../src/db/schema.js';
import { importKnownPlaces } from '../../src/cli/importV3.js';

describe('importKnownPlaces', () => {
  beforeEach(async () => {
    await resetDb(await getTestDb());
  });

  it('inserts new rows and skips existing ones, ignoring blank lines and the header', async () => {
    const db = await getTestDb();
    await db.insert(placesSeen).values({
      placeId: 'place_existing',
      genre: 'salon',
      isLeadCandidate: true,
    });

    const csv = [
      'place_id,first_seen',
      'place_new,2025-03-01T10:00:00Z',
      '',
      'place_existing,2024-01-01T00:00:00Z',
      '   ',
      '',
    ].join('\n');

    const result = await importKnownPlaces(db, csv);
    expect(result).toEqual({ inserted: 1 });

    const rows = await db.select().from(placesSeen);
    expect(rows).toHaveLength(2);

    const newRow = rows.find((r) => r.placeId === 'place_new');
    expect(newRow).toMatchObject({
      placeId: 'place_new',
      genre: 'unknown',
      detailsFetched: true,
      isLeadCandidate: false,
    });
    expect(newRow?.firstSeenAt.toISOString()).toBe('2025-03-01T10:00:00.000Z');

    // Existing row is untouched (ON CONFLICT DO NOTHING).
    const existingRow = rows.find((r) => r.placeId === 'place_existing');
    expect(existingRow).toMatchObject({ genre: 'salon', isLeadCandidate: true });
  });

  it('uses the current time when first_seen is missing or unparseable', async () => {
    const db = await getTestDb();
    const before = Date.now();

    const csv = ['place_id,first_seen', 'place_no_date', 'place_bad_date,not-a-date'].join('\n');
    const result = await importKnownPlaces(db, csv);
    expect(result).toEqual({ inserted: 2 });

    const rows = await db.select().from(placesSeen);
    for (const row of rows) {
      expect(row.firstSeenAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(row.firstSeenAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    }
  });

  it('inserts more than one chunk of rows', async () => {
    const db = await getTestDb();
    const lines = ['place_id,first_seen'];
    for (let i = 0; i < 2500; i++) {
      lines.push(`place_${i},2025-01-01T00:00:00Z`);
    }

    const result = await importKnownPlaces(db, lines.join('\n'));
    expect(result).toEqual({ inserted: 2500 });

    const rows = await db.select().from(placesSeen);
    expect(rows).toHaveLength(2500);
  });
});
