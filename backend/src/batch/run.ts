import { count, eq } from 'drizzle-orm';
import { rawItems } from '../db/schema.js';
import type { SourceId } from '../domain/types.js';
import { runCollect } from '../pipeline/collect.js';
import { HPB_LIMIT, runHpb } from '../pipeline/hpb.js';
import { processPending } from '../pipeline/process.js';
import { enabledSources } from '../sources/registry.js';
import type { BatchContext } from './context.js';

export interface RunResult {
  collected: { source: SourceId; shard: string; ok: boolean; error?: string }[];
  processed: number;
  hpbChecked: number;
  ok: boolean;
}

export interface RunOptions {
  hpbLimit?: number;
  shardConcurrency?: number;
  /** Pause between HPB requests (tests skip it). */
  hpbSleep?: (ms: number) => Promise<void>;
  /** Injectable for tests. */
  process?: typeof processPending;
}

const PROCESS_BATCH = 500;
/** Stand-in shard name for a failed listShards. */
const LIST_SHARDS = '(listShards)';

/** Runs `fn` over `items` with at most `limit` in flight. */
async function eachLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
}

/**
 * Collect every shard of the requested (enabled) sources in parallel, then classify until nothing is
 * pending, then check HPB. A failed step is recorded and the later steps still run; `ok` reports it.
 */
export async function runPipeline(ctx: BatchContext, sources: SourceId[], opts: RunOptions = {}): Promise<RunResult> {
  const enabled = new Set(enabledSources(ctx.env));
  const collected: RunResult['collected'] = [];
  let ok = true;

  const tasks: { source: SourceId; shard: string }[] = [];
  for (const source of sources) {
    if (!enabled.has(source)) {
      ctx.log.info('source skipped (SOURCES_DISABLED)', { source });
      continue;
    }
    try {
      for (const shard of await ctx.getSource(source).listShards(ctx)) tasks.push({ source, shard });
    } catch (err) {
      ctx.log.error('list shards failed', { source, error: String(err) });
      collected.push({ source, shard: LIST_SHARDS, ok: false, error: String(err) });
    }
  }
  await eachLimited(tasks, opts.shardConcurrency ?? 7, async ({ source, shard }) => {
    try {
      await runCollect(ctx, source, shard);
      collected.push({ source, shard, ok: true });
    } catch (err) {
      ctx.log.error('collect failed', { source, shard, error: String(err) });
      collected.push({ source, shard, ok: false, error: String(err) });
    }
  });
  if (collected.some((c) => !c.ok)) ok = false;

  // Repeat until a round comes back short (nothing left) or makes no progress (only retries left).
  const processRound = opts.process ?? processPending;
  let processed = 0;
  try {
    for (;;) {
      const r = await processRound(ctx.db, ctx.llm, PROCESS_BATCH, { log: ctx.log });
      ctx.log.info('processed', r);
      processed += r.resolved + r.rejected;
      if (r.failed > 0) ok = false; // items given up after repeated resolve failures
      const progress = r.resolved + r.rejected + r.failed;
      if (r.resolved + r.rejected + r.retried + r.failed < PROCESS_BATCH) break;
      if (progress === 0) {
        const [row] = await ctx.db.select({ n: count() }).from(rawItems).where(eq(rawItems.status, 'pending'));
        ctx.log.warn('process made no progress; leaving items pending', { pending: row?.n ?? 0 });
        ok = false;
        break;
      }
    }
  } catch (err) {
    ctx.log.error('process failed', { error: String(err) });
    ok = false;
  }

  let hpbChecked = 0;
  try {
    hpbChecked = await runHpb(ctx, opts.hpbLimit ?? HPB_LIMIT, opts.hpbSleep);
  } catch (err) {
    ctx.log.error('hpb check failed', { error: String(err) });
    ok = false;
  }

  return { collected, processed, hpbChecked, ok };
}
