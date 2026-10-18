import { asc, eq } from 'drizzle-orm';
import { classifyItem, type LlmClassifier } from '../classify/classify.js';
import type { Db } from '../db/client.js';
import { rawItems } from '../db/schema.js';
import type { Classification, Confidence } from '../domain/types.js';
import { resolveStore } from '../resolve/resolveStore.js';
import { buildContext } from './context.js';

const MAX_ATTEMPTS = 3;

const FAILED_CLASSIFICATION: Classification = {
  verdict: 'maybe',
  storeName: null,
  genre: null,
  city: null,
  openingDate: null,
  reason: '判定失敗',
  signals: [],
};

/** Classify and resolve pending raw items one at a time (resolveStore is not race-safe). */
export async function processPending(
  db: Db,
  llm: LlmClassifier,
  limit = 500,
): Promise<{ resolved: number; rejected: number; retried: number }> {
  const pending = await db
    .select()
    .from(rawItems)
    .where(eq(rawItems.status, 'pending'))
    .orderBy(asc(rawItems.fetchedAt), asc(rawItems.id))
    .limit(limit);

  const out = { resolved: 0, rejected: 0, retried: 0 };
  for (const item of pending) {
    let classification: Classification;
    let confidence: Confidence;
    if (item.preclassified) {
      classification = item.preclassified as Classification;
      confidence = 'map';
    } else {
      try {
        classification = await classifyItem(
          { text: item.text, authorHandle: item.authorHandle, postedAt: item.postedAt },
          llm,
        );
        confidence = classification.verdict === 'yes' ? 'yes' : 'maybe';
      } catch {
        const attempts = item.attempts + 1;
        await db.update(rawItems).set({ attempts }).where(eq(rawItems.id, item.id));
        if (attempts < MAX_ATTEMPTS) {
          out.retried++;
          continue;
        }
        classification = FAILED_CLASSIFICATION;
        confidence = 'maybe';
      }
    }

    if (classification.verdict === 'no') {
      await db
        .update(rawItems)
        .set({ classification, status: 'rejected' })
        .where(eq(rawItems.id, item.id));
      out.rejected++;
      continue;
    }

    await resolveStore(db, {
      rawItemId: item.id,
      source: item.source as 'google_maps' | 'threads',
      url: item.url,
      placeId: item.placeId,
      snsHandle: item.authorHandle,
      classification,
      confidence,
    });
    await db.update(rawItems).set({ classification, status: 'resolved' }).where(eq(rawItems.id, item.id));
    out.resolved++;
  }
  return out;
}

export async function processHandler(): ReturnType<typeof processPending> {
  const ctx = await buildContext();
  const result = await processPending(ctx.db, ctx.llm);
  ctx.log.info('processed', result);
  return result;
}
