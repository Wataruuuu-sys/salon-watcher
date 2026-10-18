import type { RawItemInput } from '../../domain/types.js';
import type { Source, SourceContext } from '../types.js';
import { ThreadsAuthError, threadsClient, type ThreadsClient, type ThreadsPost } from './client.js';
import { loadThreadsQueries } from './queries.js';

const CONCURRENCY = 4;

type MakeClient = (token: string, http: typeof fetch) => ThreadsClient;

function toRawItem(p: ThreadsPost): RawItemInput {
  const postedAt = new Date(p.timestamp);
  return {
    source: 'threads',
    externalId: p.id,
    url: p.permalink,
    authorHandle: `threads:${p.username}`,
    text: p.text,
    postedAt: Number.isNaN(postedAt.getTime()) ? null : postedAt,
    payload: p,
  };
}

export function createThreadsSource(makeClient: MakeClient = threadsClient): Source {
  return {
    id: 'threads',
    async listShards() {
      return ['all'];
    },
    async collect(_shard: string, ctx: SourceContext): Promise<RawItemInput[]> {
      const client = makeClient(await ctx.secrets.get('THREADS_ACCESS_TOKEN'), ctx.http);
      const { queries } = await loadThreadsQueries(ctx.db);
      const byId = new Map<string, ThreadsPost>();
      let authError: ThreadsAuthError | undefined;
      let next = 0;
      let failures = 0;

      async function worker(): Promise<void> {
        while (authError === undefined) {
          const q = queries[next++];
          if (q === undefined) return;
          try {
            for (const p of await client.keywordSearch(q)) if (!byId.has(p.id)) byId.set(p.id, p);
          } catch (err) {
            if (err instanceof ThreadsAuthError) authError ??= err;
            else {
              failures++;
              ctx.log.warn('threads query failed', { query: q, error: String(err) });
            }
          }
        }
      }

      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queries.length) }, worker));
      if (authError) throw authError;
      // Total outage must fail the shard (and raise the alarm) rather than look like a quiet day.
      if (queries.length > 0 && failures === queries.length) {
        throw new Error(`all ${queries.length} threads queries failed`);
      }
      ctx.log.info('threads collect done', { queries: queries.length, posts: byId.size });
      return [...byId.values()].map(toRawItem);
    },
  };
}

export const threadsSource: Source = createThreadsSource();
