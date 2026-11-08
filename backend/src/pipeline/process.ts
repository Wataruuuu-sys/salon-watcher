import { asc, eq } from 'drizzle-orm';
import { classifyItem, type LlmClassifier } from '../classify/classify.js';
import type { Db } from '../db/client.js';
import { rawItems } from '../db/schema.js';
import type { Classification, Confidence } from '../domain/types.js';
import { resolveStore } from '../resolve/resolveStore.js';
import { createLogger, type Logger } from '../lib/log.js';

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

/**
 * Classify and resolve pending raw items one at a time (resolveStore is not race-safe).
 * Classify and resolve failures share `attempts`; at MAX_ATTEMPTS a failed resolve takes the item out
 * of the queue (status rejected, counted as `failed`) so stuck items cannot block newer ones.
 */
export async function processPending(
  db: Db,
  llm: LlmClassifier,
  limit = 500,
  deps: { log?: Logger; resolve?: typeof resolveStore } = {},
): Promise<{ resolved: number; rejected: number; retried: number; failed: number }> {
  const pending = await db
    .select()
    .from(rawItems)
    .where(eq(rawItems.status, 'pending'))
    .orderBy(asc(rawItems.fetchedAt), asc(rawItems.id))
    .limit(limit);

  const log = deps.log ?? createLogger();
  const resolve = deps.resolve ?? resolveStore;
  const out = { resolved: 0, rejected: 0, retried: 0, failed: 0 };
  for (const item of pending) {
    let classification: Classification;
    let confidence: Confidence;
    if (item.preclassified) {
      classification = item.preclassified as Classification;
      confidence = 'map';
    } else if (item.classification) {
      // Classified on an earlier run whose resolve failed: do not ask the LLM again.
      classification = item.classification as Classification;
      confidence = classification.verdict === 'yes' ? 'yes' : 'maybe';
    } else {
      try {
        classification = await classifyItem(
          { text: item.text, authorHandle: item.authorHandle, postedAt: item.postedAt, now: new Date() },
          llm,
        );
        confidence = classification.verdict === 'yes' ? 'yes' : 'maybe';
      } catch (err) {
        const attempts = item.attempts + 1;
        // Logged so a misconfigured classifier (e.g. Bedrock access) shows up instead of silent maybe leads.
        log.error('classify failed', { rawItemId: item.id, attempts, error: String(err) });
        await db.update(rawItems).set({ attempts }).where(eq(rawItems.id, item.id));
        if (attempts < MAX_ATTEMPTS) {
          out.retried++;
          continue;
        }
        classification = FAILED_CLASSIFICATION;
        confidence = 'maybe';
      }
    }

    try {
      if (classification.verdict === 'no') {
        await db.update(rawItems).set({ classification, status: 'rejected' }).where(eq(rawItems.id, item.id));
        out.rejected++;
        continue;
      }

      await resolve(db, {
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
    } catch (err) {
      // Keep the classification for the retry (resolve is idempotent per raw item) and keep going.
      const attempts = item.attempts + 1;
      if (attempts < MAX_ATTEMPTS) {
        log.error('resolve failed', { rawItemId: item.id, attempts, error: String(err) });
        await db.update(rawItems).set({ classification, attempts }).where(eq(rawItems.id, item.id));
        out.retried++;
      } else {
        log.error('resolve failed; giving up', { rawItemId: item.id, attempts, error: String(err) });
        await db.update(rawItems).set({ classification, attempts, status: 'rejected' }).where(eq(rawItems.id, item.id));
        out.failed++;
      }
    }
  }
  return out;
}
