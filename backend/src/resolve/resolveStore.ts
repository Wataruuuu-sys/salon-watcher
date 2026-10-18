import { and, eq, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { evidence, stores } from '../db/schema.js';
import type { Classification, Confidence, SourceId } from '../domain/types.js';
import { normalizeName } from './normalize.js';

export interface ResolveInput {
  rawItemId: number;
  source: SourceId;
  url: string;
  placeId: string | null;
  snsHandle: string | null;
  classification: Classification;
  confidence: Confidence;
}

const STRENGTH: Record<Confidence, number> = { yes: 3, map: 2, maybe: 1 };
const UNKNOWN_NAME = '店名不明';
const SIMILARITY_THRESHOLD = 0.6;

function stronger(a: string, b: Confidence): Confidence {
  return (STRENGTH[a as Confidence] ?? 0) >= STRENGTH[b] ? (a as Confidence) : b;
}

/**
 * Find the store this observation belongs to (placeId, then snsHandle, then fuzzy name + city),
 * creating it when none matches, and attach the observation as evidence.
 */
export async function resolveStore(
  db: Db,
  input: ResolveInput,
): Promise<{ storeId: number; created: boolean }> {
  const { classification: c } = input;
  const name = c.storeName?.trim() ? c.storeName.trim() : null;
  const nameNorm = name ? normalizeName(name) : null;

  return db.transaction(async (tx) => {
    let existing: typeof stores.$inferSelect | undefined;

    if (input.placeId) {
      [existing] = await tx.select().from(stores).where(eq(stores.placeId, input.placeId));
    }
    if (!existing && input.snsHandle) {
      [existing] = await tx.select().from(stores).where(eq(stores.snsHandle, input.snsHandle));
    }
    if (!existing && nameNorm) {
      const cityCond = c.city
        ? sql`AND (city IS NULL OR city = ${c.city})`
        : sql``;
      const rows = await tx.execute<{ id: number }>(sql`
        SELECT id FROM stores
        WHERE similarity(name_norm, ${nameNorm}) >= ${SIMILARITY_THRESHOLD} ${cityCond}
        ORDER BY similarity(name_norm, ${nameNorm}) DESC, id
        LIMIT 1`);
      const hit = rows[0];
      if (hit) {
        [existing] = await tx.select().from(stores).where(eq(stores.id, Number(hit.id)));
      }
    }

    let storeId: number;
    let created = false;

    if (existing) {
      storeId = existing.id;
      const patch: Partial<typeof stores.$inferInsert> = {};
      const confidence = stronger(existing.confidence, input.confidence);
      if (confidence !== existing.confidence) patch.confidence = confidence;
      if (!existing.placeId && input.placeId) {
        const [clash] = await tx
          .select({ id: stores.id })
          .from(stores)
          .where(and(eq(stores.placeId, input.placeId), ne(stores.id, storeId)));
        if (!clash) patch.placeId = input.placeId;
      }
      if (!existing.snsHandle && input.snsHandle) {
        const [clash] = await tx
          .select({ id: stores.id })
          .from(stores)
          .where(and(eq(stores.snsHandle, input.snsHandle), ne(stores.id, storeId)));
        if (!clash) patch.snsHandle = input.snsHandle;
      }
      if (!existing.genre && c.genre) patch.genre = c.genre;
      if (!existing.city && c.city) patch.city = c.city;
      if (!existing.openingDate && c.openingDate) patch.openingDate = c.openingDate;
      if (Object.keys(patch).length > 0) {
        await tx.update(stores).set(patch).where(eq(stores.id, storeId));
      }
    } else {
      const displayName = name ?? input.snsHandle ?? UNKNOWN_NAME;
      const [row] = await tx
        .insert(stores)
        .values({
          name: displayName,
          nameNorm: nameNorm ?? normalizeName(displayName),
          genre: c.genre,
          city: c.city,
          placeId: input.placeId,
          snsHandle: input.snsHandle,
          confidence: input.confidence,
          openingDate: c.openingDate,
        })
        .returning({ id: stores.id });
      storeId = row!.id;
      created = true;
    }

    await tx
      .insert(evidence)
      .values({
        storeId,
        rawItemId: input.rawItemId,
        source: input.source,
        url: input.url,
        confidence: input.confidence,
        reason: c.reason,
      })
      .onConflictDoNothing({ target: evidence.rawItemId });

    return { storeId, created };
  });
}
