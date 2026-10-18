import type { SourceId } from '../domain/types.js';
import { ingestRawItems } from '../sources/ingest.js';
import { enabledSources, getSource } from '../sources/registry.js';
import type { SourceContext } from '../sources/types.js';
import { buildContext, lightContext } from './context.js';

export async function runCollect(
  ctx: SourceContext,
  source: SourceId,
  shard: string,
): Promise<{ inserted: number; skipped: number }> {
  const items = await getSource(source).collect(shard, ctx);
  const result = await ingestRawItems(ctx.db, items);
  ctx.log.info('collected', { source, shard, fetched: items.length, ...result });
  return result;
}

export async function listShardsHandler(e: {
  sources: SourceId[];
}): Promise<{ tasks: { source: SourceId; shard: string }[] }> {
  const enabled = new Set(enabledSources(process.env));
  const ctx = lightContext();
  const tasks: { source: SourceId; shard: string }[] = [];
  for (const id of e.sources.filter((s) => enabled.has(s))) {
    for (const shard of await getSource(id).listShards(ctx)) tasks.push({ source: id, shard });
  }
  return { tasks };
}

export async function collectHandler(e: {
  source: SourceId;
  shard: string;
}): Promise<{ inserted: number; skipped: number }> {
  return runCollect(await buildContext(), e.source, e.shard);
}
