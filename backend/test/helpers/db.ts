import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb, type Db } from '../../src/db/client.js';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/salon_test';

let dbPromise: Promise<Db> | undefined;

/** Fresh schema (dropped and migrated once per process); connection is reused. */
export function getTestDb(): Promise<Db> {
  dbPromise ??= (async () => {
    const db = createDb(url);
    await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
    await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
    await db.execute(sql`CREATE SCHEMA public`);
    await migrate(db, { migrationsFolder: new URL('../../drizzle', import.meta.url).pathname });
    return db;
  })();
  return dbPromise;
}

export async function resetDb(db: Db): Promise<void> {
  await db.execute(
    sql`TRUNCATE raw_items, stores, evidence, places_seen, map_cells, settings RESTART IDENTITY CASCADE`,
  );
}
