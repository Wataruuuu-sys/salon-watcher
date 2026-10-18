import { beforeEach, describe, expect, it } from 'vitest';
import { createThreadsSource } from '../../../src/sources/threads/source.js';
import { ThreadsAuthError, threadsClient, type ThreadsPost } from '../../../src/sources/threads/client.js';
import { saveThreadsQueries } from '../../../src/sources/threads/queries.js';
import { getSource } from '../../../src/sources/registry.js';
import type { SourceContext } from '../../../src/sources/types.js';
import { getTestDb, resetDb } from '../../helpers/db.js';
import type { Db } from '../../../src/db/client.js';

const post = (id: string, over: Partial<ThreadsPost> = {}): ThreadsPost => ({
  id, text: `text ${id}`, permalink: `https://threads.net/p/${id}`, username: 'lily_nail',
  timestamp: '2026-10-17T10:00:00+0000', ...over,
});

let warned: string[] = [];
function ctxFor(db: Db): SourceContext {
  return {
    db, http: fetch, now: new Date('2026-10-18T00:00:00Z'),
    secrets: { get: async () => 'TOKEN', put: async () => {} },
    log: { info() {}, warn: (m) => { warned.push(m); }, error() {} },
  };
}

describe('threads source', () => {
  let db: Db;
  beforeEach(async () => {
    db = await getTestDb();
    await resetDb(db);
    warned = [];
  });

  it('is registered with a single shard', async () => {
    const s = getSource('threads');
    expect(await s.listShards(ctxFor(db))).toEqual(['all']);
  });

  it('dedupes posts across queries and maps fields', async () => {
    await saveThreadsQueries(db, ['a', 'b'], 'u');
    const src = createThreadsSource(() => ({ keywordSearch: async () => [post('1')] }));
    const items = await src.collect('all', ctxFor(db));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      source: 'threads', externalId: '1', url: 'https://threads.net/p/1',
      authorHandle: 'threads:lily_nail', text: 'text 1',
    });
    expect(items[0]!.postedAt).toEqual(new Date('2026-10-17T10:00:00Z'));
  });

  it('continues past a non-auth failure on one query', async () => {
    await saveThreadsQueries(db, ['bad', 'good1', 'good2'], 'u');
    const src = createThreadsSource(() => ({
      keywordSearch: async (q) => {
        if (q === 'bad') throw new Error('boom');
        return [post(q)];
      },
    }));
    const items = await src.collect('all', ctxFor(db));
    expect(items.map((i) => i.externalId).sort()).toEqual(['good1', 'good2']);
    expect(warned).toHaveLength(1);
  });

  it('rethrows ThreadsAuthError', async () => {
    await saveThreadsQueries(db, ['a', 'b'], 'u');
    const src = createThreadsSource(() => ({
      keywordSearch: async (q) => {
        if (q === 'a') throw new ThreadsAuthError('expired');
        return [post('2')];
      },
    }));
    await expect(src.collect('all', ctxFor(db))).rejects.toBeInstanceOf(ThreadsAuthError);
  });
});

describe('threadsClient', () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  it('builds the keyword_search request and returns data', async () => {
    let url = '';
    const http = (async (u: string) => { url = u; return json({ data: [post('1')] }); }) as unknown as typeof fetch;
    const res = await threadsClient('TOK', http).keywordSearch('立川 ネイル');
    expect(res).toHaveLength(1);
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://graph.threads.net/v1.0/keyword_search');
    expect(u.searchParams.get('q')).toBe('立川 ネイル');
    expect(u.searchParams.get('search_type')).toBe('RECENT');
    expect(u.searchParams.get('fields')).toBe('id,text,permalink,username,timestamp');
    expect(u.searchParams.get('access_token')).toBe('TOK');
  });

  it('maps 401 and error code 190 to ThreadsAuthError, other errors to Error', async () => {
    const c401 = threadsClient('T', (async () => json({}, 401)) as unknown as typeof fetch);
    await expect(c401.keywordSearch('q')).rejects.toBeInstanceOf(ThreadsAuthError);
    const c190 = threadsClient('T', (async () => json({ error: { code: 190 } }, 400)) as unknown as typeof fetch);
    await expect(c190.keywordSearch('q')).rejects.toBeInstanceOf(ThreadsAuthError);
    const c500 = threadsClient('T', (async () => json({}, 500)) as unknown as typeof fetch);
    const err = await c500.keywordSearch('q').catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ThreadsAuthError);
  });

  it('tolerates posts without text and missing data', async () => {
    const c = threadsClient('T', (async () => json({ data: [{ id: '9', permalink: 'p', username: 'u', timestamp: 't' }] })) as unknown as typeof fetch);
    expect((await c.keywordSearch('q'))[0]!.text).toBe('');
    const empty = threadsClient('T', (async () => json({})) as unknown as typeof fetch);
    expect(await empty.keywordSearch('q')).toEqual([]);
  });
});
