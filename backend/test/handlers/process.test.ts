import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getTestDb, resetDb } from '../helpers/db.js';
import { ingestRawItems } from '../../src/sources/ingest.js';
import { evidence, rawItems, stores } from '../../src/db/schema.js';
import { resolveStore } from '../../src/resolve/resolveStore.js';
import { processPending } from '../../src/handlers/process.js';
import type { Classification, RawItemInput } from '../../src/domain/types.js';
import type { LlmClassifier } from '../../src/classify/classify.js';

const db = await getTestDb();

const cls = (over: Partial<Classification>): Classification => ({
  verdict: 'yes',
  storeName: null,
  genre: null,
  city: null,
  openingDate: null,
  reason: 'r',
  signals: [],
  ...over,
});

const threadsItem = (over: Partial<RawItemInput> = {}): RawItemInput => ({
  source: 'threads',
  externalId: 't1',
  url: 'https://threads/t1',
  authorHandle: 'threads:lily_nail',
  text: 'ネイルサロン Lily 本日グランドオープンしました',
  postedAt: null,
  payload: {},
  ...over,
});

function fakeLlm(fn: () => Classification | Error) {
  const calls: number[] = [];
  const llm: LlmClassifier = {
    async classify() {
      calls.push(1);
      const r = fn();
      if (r instanceof Error) throw r;
      return r;
    },
  };
  return { llm, calls };
}

beforeEach(() => resetDb(db));

describe('processPending', () => {
  it('resolves a Map item with confidence map without calling the LLM', async () => {
    await ingestRawItems(db, [
      {
        source: 'google_maps',
        externalId: 'm1',
        url: 'https://maps/m1',
        authorHandle: null,
        text: 'ネイルサロン Lily',
        postedAt: null,
        payload: {},
        placeId: 'P1',
        preclassified: cls({ storeName: 'ネイルサロン Lily', genre: 'nail', city: '立川市', reason: 'map' }),
      },
    ]);
    const { llm, calls } = fakeLlm(() => new Error('should not be called'));
    expect(await processPending(db, llm)).toEqual({ resolved: 1, rejected: 0, retried: 0 });
    expect(calls).toHaveLength(0);
    const [s] = await db.select().from(stores);
    expect(s!.confidence).toBe('map');
    expect(s!.placeId).toBe('P1');
    const [raw] = await db.select().from(rawItems);
    expect(raw!.status).toBe('resolved');
  });

  it('rejects a no verdict, keeping the raw item', async () => {
    await ingestRawItems(db, [threadsItem()]);
    const { llm } = fakeLlm(() => cls({ verdict: 'no', reason: 'ng' }));
    expect(await processPending(db, llm)).toEqual({ resolved: 0, rejected: 1, retried: 0 });
    expect(await db.select().from(stores)).toHaveLength(0);
    const [raw] = await db.select().from(rawItems);
    expect(raw!.status).toBe('rejected');
    expect((raw!.classification as Classification).verdict).toBe('no');
  });

  it('rejects prefilter misses without calling the LLM', async () => {
    await ingestRawItems(db, [threadsItem({ text: '今日はいい天気です' })]);
    const { llm, calls } = fakeLlm(() => cls({}));
    expect(await processPending(db, llm)).toEqual({ resolved: 0, rejected: 1, retried: 0 });
    expect(calls).toHaveLength(0);
  });

  it('retries LLM failures and falls back to maybe on the third', async () => {
    await ingestRawItems(db, [threadsItem()]);
    const { llm } = fakeLlm(() => new Error('boom'));
    expect(await processPending(db, llm)).toEqual({ resolved: 0, rejected: 0, retried: 1 });
    expect(await processPending(db, llm)).toEqual({ resolved: 0, rejected: 0, retried: 1 });
    const [mid] = await db.select().from(rawItems);
    expect(mid!.status).toBe('pending');
    expect(mid!.attempts).toBe(2);
    expect(await processPending(db, llm)).toEqual({ resolved: 1, rejected: 0, retried: 0 });
    const [s] = await db.select().from(stores);
    expect(s!.confidence).toBe('maybe');
    expect(s!.snsHandle).toBe('threads:lily_nail');
    const [ev] = await db.select().from(evidence);
    expect(ev!.reason).toBe('判定失敗');
    const [raw] = await db.select().from(rawItems).where(eq(rawItems.id, mid!.id));
    expect(raw!.status).toBe('resolved');
  });

  it('merges a Map store and a Threads post of the same shop', async () => {
    await ingestRawItems(db, [
      {
        source: 'google_maps',
        externalId: 'm1',
        url: 'https://maps/m1',
        authorHandle: null,
        text: 'ネイルサロン Lily',
        postedAt: null,
        payload: {},
        placeId: 'P1',
        preclassified: cls({ storeName: 'ネイルサロン Lily', genre: 'nail', city: '立川市', reason: 'map' }),
      },
      threadsItem(),
    ]);
    const { llm } = fakeLlm(() => cls({ storeName: 'ネイルサロン Lily', city: '立川市', reason: 'open' }));
    expect(await processPending(db, llm)).toEqual({ resolved: 2, rejected: 0, retried: 0 });
    expect(await db.select().from(stores)).toHaveLength(1);
    expect(await db.select().from(evidence)).toHaveLength(2);
  });

  it('continues past an item whose resolve fails, leaving it pending', async () => {
    await ingestRawItems(db, [
      threadsItem({ externalId: 'a', url: 'https://threads/a', authorHandle: 'threads:a' }),
      threadsItem({ externalId: 'b', url: 'https://threads/b', authorHandle: 'threads:b' }),
    ]);
    const { llm } = fakeLlm(() => cls({ storeName: 'Alpha', reason: 'r' }));
    const errors: string[] = [];
    const log = { info() {}, warn() {}, error: (m: string) => void errors.push(m) };
    const resolve: typeof resolveStore = async (d, input) => {
      if (input.url.endsWith('/a')) throw new Error('db down');
      return resolveStore(d, input);
    };
    expect(await processPending(db, llm, 500, { log, resolve })).toEqual({ resolved: 1, rejected: 0, retried: 1 });
    expect(errors).toHaveLength(1);
    const rows = await db.select().from(rawItems).orderBy(rawItems.id);
    expect(rows.map((r) => r.status)).toEqual(['pending', 'resolved']);
  });
});
