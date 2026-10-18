import { asc, eq } from 'drizzle-orm';
import { classifyItem, type LlmClassifier } from '../classify/classify.js';
import type { Db } from '../db/client.js';
import { rawItems } from '../db/schema.js';
import type { Classification, Confidence } from '../domain/types.js';
import { resolveStore } from '../resolve/resolveStore.js';
import { createLogger, type Logger } from '../lib/log.js';
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
  deps: { log?: Logger; resolve?: typeof resolveStore; /** Epoch ms after which no new item is started. */ deadline?: number } = {},
): Promise<{ resolved: number; rejected: number; retried: number }> {
  const pending = await db
    .select()
    .from(rawItems)
    .where(eq(rawItems.status, 'pending'))
    .orderBy(asc(rawItems.fetchedAt), asc(rawItems.id))
    .limit(limit);

  const log = deps.log ?? createLogger();
  const resolve = deps.resolve ?? resolveStore;
  const out = { resolved: 0, rejected: 0, retried: 0 };
  for (const item of pending) {
    if (deps.deadline !== undefined && Date.now() > deps.deadline) {
      log.warn('process deadline reached; leaving the rest pending', { remaining: pending.length - pending.indexOf(item) });
      break;
    }
    let classification: Classification;
    let confidence: Confidence;
    if (item.preclassified) {
      classification = item.preclassified as Classification;
      confidence = 'map';
    } else {
      try {
        classification = await classifyItem(
          { text: item.text, authorHandle: item.authorHandle, postedAt: item.postedAt, now: new Date() },
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
      // Leave the item pending (resolve is idempotent per raw item) and keep going.
      log.error('resolve failed', { rawItemId: item.id, error: String(err) });
      out.retried++;
    }
  }
  return out;
}

/** Stop starting new items well before the 15-minute Lambda timeout. */
const PROCESS_BUDGET_MS = 12 * 60 * 1000;

export async function processHandler(): ReturnType<typeof processPending> {
  const deadline = Date.now() + PROCESS_BUDGET_MS;
  const ctx = await buildContext();
  const result = await processPending(ctx.db, ctx.llm, 500, { log: ctx.log, deadline });
  ctx.log.info('processed', result);
  return result;
}
