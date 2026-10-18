import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { getTestDb, resetDb } from '../helpers/db.js';
import { rawItems } from '../../src/db/schema.js';

describe('db schema', () => {
  beforeEach(async () => {
    await resetDb(await getTestDb());
  });

  it('has pg_trgm installed', async () => {
    const db = await getTestDb();
    const rows = await db.execute(sql`select extname from pg_extension`);
    expect(rows.map((r) => r.extname)).toContain('pg_trgm');
  });

  it('rejects duplicate (source, external_id) in raw_items', async () => {
    const db = await getTestDb();
    const row = {
      source: 'threads',
      externalId: 'abc',
      url: 'https://example.com/1',
      text: 'hello',
      payload: {},
    };
    await db.insert(rawItems).values(row);
    await expect(db.insert(rawItems).values(row)).rejects.toThrow();
  });
});
