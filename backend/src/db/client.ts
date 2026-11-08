import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export type Db = ReturnType<typeof createDb>;

export function createDb(url: string) {
  const client = postgres(url, { onnotice: () => {} });
  return drizzle(client, { schema });
}

/** Closes the connection pool; in-flight queries get a few seconds before being cut. */
export async function closeDb(db: Db): Promise<void> {
  await db.$client.end({ timeout: 5 });
}
