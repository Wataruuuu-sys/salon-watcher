import { beforeEach, describe, expect, it } from 'vitest';
import { getTestDb, resetDb } from '../helpers/db.js';
import { rawItems, stores } from '../../src/db/schema.js';
import { runPipeline } from '../../src/batch/run.js';
import type { BatchContext } from '../../src/batch/context.js';
import { processPending } from '../../src/pipeline/process.js';
import { buildRegistry } from '../../src/sources/registry.js';
import { ingestRawItems } from '../../src/sources/ingest.js';
import type { Source } from '../../src/sources/types.js';
import type { RawItemInput } from '../../src/domain/types.js';
import { fakeLlmClassifier } from '../../src/fakes/llm.js';
import { fakeHpbHttp } from '../../src/fakes/hpbHttp.js';

const db = await getTestDb();
const quiet = { info() {}, warn() {}, error() {} };

const post = (id: string, text: string): RawItemInput => ({
  source: 'threads',
  externalId: id,
  url: `https://threads/${id}`,
  authorHandle: `threads:${id}`,
  text,
  postedAt: null,
  payload: {},
});

function ctxWith(sources: Source[], env: Record<string, string | undefined> = {}): BatchContext {
  return {
    db,
    http: fetch,
    secrets: { get: async () => 'KEY', put: async () => {} },
    now: new Date(),
    log: quiet,
    llm: fakeLlmClassifier(),
    getSource: buildRegistry(sources).getSource,
    hpbHttp: fakeHpbHttp,
    mail: async () => {},
    env,
    close: async () => {},
  };
}

const noSleep = async () => {};

beforeEach(() => resetDb(db));

describe('runPipeline', () => {
  it('keeps going past a failed shard: other shards, process and hpb still run; ok is false', async () => {
    const source: Source = {
      id: 'threads',
      listShards: async () => ['good', 'bad'],
      async collect(shard) {
        if (shard === 'bad') throw new Error('api down');
        return [post('p1', '11/1 立川駅北口に Nail Salon Lily 立川店 OPEN')];
      },
    };
    const r = await runPipeline(ctxWith([source]), ['threads'], { hpbSleep: noSleep });

    expect(r.ok).toBe(false);
    expect(r.collected).toContainEqual({ source: 'threads', shard: 'good', ok: true });
    expect(r.collected).toContainEqual(
      expect.objectContaining({ source: 'threads', shard: 'bad', ok: false, error: expect.stringContaining('api down') }),
    );
    const [raw] = await db.select().from(rawItems);
    expect(raw!.status).toBe('resolved');
    expect(r.processed).toBe(1);
    const [s] = await db.select().from(stores);
    expect(s!.hpbStatus).not.toBe('unchecked');
    expect(r.hpbChecked).toBe(1);
  });

  it('is ok when every shard succeeds', async () => {
    const source: Source = { id: 'threads', listShards: async () => ['all'], collect: async () => [] };
    const r = await runPipeline(ctxWith([source]), ['threads'], { hpbSleep: noSleep });
    expect(r).toEqual({ collected: [{ source: 'threads', shard: 'all', ok: true }], processed: 0, hpbChecked: 0, ok: true });
  });

  it('skips sources disabled via SOURCES_DISABLED', async () => {
    let listed = 0;
    const source: Source = { id: 'threads', listShards: async () => (listed++, ['all']), collect: async () => [] };
    const r = await runPipeline(ctxWith([source], { SOURCES_DISABLED: 'threads' }), ['threads'], { hpbSleep: noSleep });
    expect(listed).toBe(0);
    expect(r.collected).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('records a listShards failure and still processes', async () => {
    const source: Source = {
      id: 'threads',
      listShards: async () => {
        throw new Error('no shards');
      },
      collect: async () => [],
    };
    await ingestRawItems(db, [post('p1', '今日はいい天気です')]);
    const r = await runPipeline(ctxWith([source]), ['threads'], { hpbSleep: noSleep });
    expect(r.ok).toBe(false);
    expect(r.collected).toEqual([expect.objectContaining({ source: 'threads', ok: false })]);
    expect(r.processed).toBe(1);
  });

  it('collects shards in parallel up to shardConcurrency', async () => {
    let running = 0;
    let peak = 0;
    const source: Source = {
      id: 'google_maps',
      listShards: async () => ['a', 'b', 'c', 'd', 'e'],
      async collect() {
        running++;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 20));
        running--;
        return [];
      },
    };
    const r = await runPipeline(ctxWith([source]), ['google_maps'], { shardConcurrency: 2, hpbSleep: noSleep });
    expect(peak).toBe(2);
    expect(r.collected).toHaveLength(5);
  });

  it('repeats processing until nothing is pending (500 per round)', async () => {
    await ingestRawItems(
      db,
      Array.from({ length: 1200 }, (_, i) => post(`p${i}`, '今日はいい天気です')),
    );
    const source: Source = { id: 'threads', listShards: async () => [], collect: async () => [] };
    let calls = 0;
    const counting: typeof processPending = (...args) => {
      calls++;
      return processPending(...args);
    };
    const r = await runPipeline(ctxWith([source]), ['threads'], { hpbSleep: noSleep, process: counting });
    expect(calls).toBe(3);
    expect(r.processed).toBe(1200);
    const rows = await db.select().from(rawItems);
    expect(rows.filter((x) => x.status === 'pending')).toHaveLength(0);
  });

  it('stops repeating when a round makes no progress, warns and fails the run while items remain pending', async () => {
    await ingestRawItems(db, [post('p1', '本日オープン')]);
    const source: Source = { id: 'threads', listShards: async () => [], collect: async () => [] };
    let calls = 0;
    const stuck: typeof processPending = async () => {
      calls++;
      return { resolved: 0, rejected: 0, retried: 500, failed: 0 };
    };
    const warnings: Record<string, unknown>[] = [];
    const ctx = { ...ctxWith([source]), log: { ...quiet, warn: (_m: string, d?: Record<string, unknown>) => void warnings.push(d ?? {}) } };
    const r = await runPipeline(ctx, ['threads'], { hpbSleep: noSleep, process: stuck });
    expect(calls).toBe(1);
    expect(r.ok).toBe(false);
    expect(warnings).toContainEqual(expect.objectContaining({ pending: 1 }));
  });

  it('fails the run when an item is given up after repeated resolve failures', async () => {
    const source: Source = { id: 'threads', listShards: async () => [], collect: async () => [] };
    const giveUp: typeof processPending = async () => ({ resolved: 0, rejected: 0, retried: 0, failed: 1 });
    const r = await runPipeline(ctxWith([source]), ['threads'], { hpbSleep: noSleep, process: giveUp });
    expect(r.ok).toBe(false);
  });

  it('marks the run failed when processing throws, but still checks HPB', async () => {
    await db.insert(stores).values({ name: 'Hair Salon Sakura', nameNorm: 'sakura', city: '八王子市', confidence: 'map' });
    const source: Source = { id: 'threads', listShards: async () => [], collect: async () => [] };
    const r = await runPipeline(ctxWith([source]), ['threads'], {
      hpbSleep: noSleep,
      process: async () => {
        throw new Error('db hiccup');
      },
    });
    expect(r.ok).toBe(false);
    expect(r.hpbChecked).toBe(1);
    const [s] = await db.select().from(stores);
    expect(s!.hpbStatus).toBe('listed');
  });
});
