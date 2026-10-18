import type { Db } from '../db/client.js';
import { rawItems } from '../db/schema.js';
import type { RawItemInput } from '../domain/types.js';

/** Rows per INSERT, keeping 9 bind params per row far below Postgres' 65535 limit. */
const CHUNK_ROWS = 1000;

/** Insert raw items, ignoring ones already stored for (source, external_id). */
export async function ingestRawItems(
  db: Db,
  items: RawItemInput[],
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  for (let i = 0; i < items.length; i += CHUNK_ROWS) {
    inserted += await insertChunk(db, items.slice(i, i + CHUNK_ROWS));
  }
  return { inserted, skipped: items.length - inserted };
}

async function insertChunk(db: Db, items: RawItemInput[]): Promise<number> {
  const rows = await db
    .insert(rawItems)
    .values(
      items.map((i) => ({
        source: i.source,
        externalId: i.externalId,
        url: i.url,
        authorHandle: i.authorHandle,
        text: i.text,
        postedAt: i.postedAt,
        payload: i.payload,
        placeId: i.placeId ?? null,
        preclassified: i.preclassified ?? null,
      })),
    )
    .onConflictDoNothing({ target: [rawItems.source, rawItems.externalId] })
    .returning({ id: rawItems.id });
  return rows.length;
}
