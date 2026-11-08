import { beforeEach, describe, expect, it } from 'vitest';
import { bedrockSettingsFor, externalDepsFor } from '../../src/runtime/external.js';
import { buildRegistry } from '../../src/sources/registry.js';
import { checkHpb } from '../../src/hpb/check.js';
import type { SourceContext } from '../../src/sources/types.js';
import type { Db } from '../../src/db/client.js';
import { getTestDb, resetDb } from '../helpers/db.js';

const LOCAL_FAKE = { APP_ENV: 'local', FAKE_EXTERNAL: '1' };

function ctxFor(db: Db): SourceContext {
  return {
    db, http: fetch, now: new Date('2026-10-18T00:00:00Z'),
    secrets: { get: async () => 'KEY', put: async () => {} },
    log: { info() {}, warn() {}, error() {} },
  };
}

describe('externalDepsFor', () => {
  it('ignores FAKE_EXTERNAL outside local mode', () => {
    expect(externalDepsFor({ FAKE_EXTERNAL: '1', AWS_REGION: 'ap-northeast-1' }).llm().kind).toBe('bedrock');
  });

  it('reads the Bedrock model ID and region from the env', () => {
    expect(bedrockSettingsFor({ AWS_REGION: 'ap-northeast-1' })).toEqual({
      modelId: 'anthropic.claude-haiku-5-5',
      region: 'ap-northeast-1',
    });
    expect(
      bedrockSettingsFor({ AWS_REGION: 'ap-northeast-1', BEDROCK_REGION: 'us-east-1', CLASSIFY_MODEL_ID: 'jp.anthropic.claude-haiku-5-5' }),
    ).toEqual({ modelId: 'jp.anthropic.claude-haiku-5-5', region: 'us-east-1' });
    expect(bedrockSettingsFor({ BEDROCK_REGION: '', CLASSIFY_MODEL_ID: '' })).toEqual({
      modelId: 'anthropic.claude-haiku-5-5',
      region: undefined,
    });
  });

  it('uses fakes in local mode with FAKE_EXTERNAL=1', async () => {
    const deps = externalDepsFor(LOCAL_FAKE);
    const llm = deps.llm();
    expect(llm.kind).toBe('fake');
    const base = { authorHandle: null, postedAt: null };
    expect((await llm.classify({ ...base, text: '立川駅北口にOPEN' })).verdict).toBe('yes');
    expect((await llm.classify({ ...base, text: '来月新店オープンします！' })).verdict).toBe('maybe');
    expect((await llm.classify({ ...base, text: 'こんにちは' })).verdict).toBe('no');
  });

  it('fake HPB http lists Sakura in 八王子市 only', async () => {
    const { hpbHttp } = externalDepsFor(LOCAL_FAKE);
    expect((await checkHpb({ name: 'Hair Salon Sakura', city: '八王子市' }, hpbHttp, async () => {})).status).toBe('listed');
    expect((await checkHpb({ name: 'ネイルサロン Lily', city: '立川市' }, hpbHttp, async () => {})).status).toBe('not_listed');
  });

  it('fake threads source returns the two fixed posts', async () => {
    const db = await getTestDb();
    await resetDb(db);
    const { sources } = externalDepsFor(LOCAL_FAKE);
    const items = await buildRegistry(sources).getSource('threads').collect('all', ctxFor(db));
    expect(items.map((i) => i.authorHandle).sort()).toEqual(['threads:lily_nail', 'threads:unknown_shop']);
  });
});

describe('fake google_maps source', () => {
  let db: Db;
  beforeEach(async () => {
    db = await getTestDb();
    await resetDb(db);
  });

  it('seeds on the first sweep and yields Lily from the second', async () => {
    const { sources } = externalDepsFor(LOCAL_FAKE);
    const source = buildRegistry(sources).getSource('google_maps');
    expect(await source.collect('nail', ctxFor(db))).toEqual([]);
    const items = await source.collect('nail', ctxFor(db));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ externalId: 'fake-place-lily', preclassified: { storeName: 'ネイルサロン Lily', city: '立川市' } });
  });
});

describe('buildRegistry', () => {
  it('throws for unknown ids', () => {
    expect(() => buildRegistry([]).getSource('threads')).toThrow(/threads/);
  });
});
