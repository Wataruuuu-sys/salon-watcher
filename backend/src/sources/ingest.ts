import type { Db } from '../db/client.js';
import { rawItems } from '../db/schema.js';
import type { RawItemInput } from '../domain/types.js';

/** Insert raw items, ignoring ones already stored for (source, external_id). */
export async function ingestRawItems(
  db: Db,
  items: RawItemInput[],
): Promise<{ inserted: number; skipped: number }> {
  if (items.length === 0) return { inserted: 0, skipped: 0 };
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
  return { inserted: rows.length, skipped: items.length - rows.length };
}
