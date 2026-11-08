import type { SourceId } from '../domain/types.js';
import { ingestRawItems } from '../sources/ingest.js';
import type { Source, SourceContext } from '../sources/types.js';

export type CollectContext = SourceContext & { getSource(id: SourceId): Source };

export async function runCollect(
  ctx: CollectContext,
  source: SourceId,
  shard: string,
): Promise<{ inserted: number; skipped: number }> {
  const items = await ctx.getSource(source).collect(shard, ctx);
  const result = await ingestRawItems(ctx.db, items);
  ctx.log.info('collected', { source, shard, fetched: items.length, ...result });
  return result;
}
