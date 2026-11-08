import { describe, expect, it, vi } from 'vitest';
import { main } from '../../src/batch/main.js';
import type { BatchContext } from '../../src/batch/context.js';
import { buildRegistry } from '../../src/sources/registry.js';
import type { Source } from '../../src/sources/types.js';
import { fakeLlmClassifier } from '../../src/fakes/llm.js';
import { fakeHpbHttp } from '../../src/fakes/hpbHttp.js';
import { getTestDb } from '../helpers/db.js';

const db = await getTestDb();

function fakeBuild(source: Source, hooks: { closed?: () => void } = {}) {
  const errors: string[] = [];
  const build = async (): Promise<BatchContext> => ({
    db,
    http: fetch,
    secrets: { get: async () => 'KEY', put: async () => {} },
    now: new Date(),
    log: { info() {}, warn() {}, error: (m: string) => void errors.push(m) },
    llm: fakeLlmClassifier(),
    getSource: buildRegistry([source]).getSource,
    hpbHttp: fakeHpbHttp,
    mail: async () => {},
    env: {},
    close: async () => hooks.closed?.(),
  });
  return { build, errors };
}

const okSource: Source = { id: 'google_maps', listShards: async () => ['nail'], collect: async () => [] };
const badSource: Source = {
  id: 'google_maps',
  listShards: async () => ['nail'],
  collect: async () => {
    throw new Error('boom');
  },
};
const quietLog = { info() {}, warn() {}, error() {} };

describe('batch main', () => {
  it('returns 0 for a successful run and closes the context', async () => {
    let closed = 0;
    const { build } = fakeBuild(okSource, { closed: () => closed++ });
    expect(await main(['run', '--sources', 'google_maps'], {}, { build })).toBe(0);
    expect(closed).toBe(1);
  });

  it('returns 1 when a shard fails', async () => {
    let closed = 0;
    const { build } = fakeBuild(badSource, { closed: () => closed++ });
    expect(await main(['run', '--sources', 'google_maps'], {}, { build })).toBe(1);
    expect(closed).toBe(1);
  });

  it('returns 2 with usage for unknown commands or arguments, without building a context', async () => {
    let built = 0;
    const build = async (): Promise<BatchContext> => {
      built++;
      throw new Error('should not build');
    };
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    for (const argv of [
      ['bogus'],
      [],
      ['run'],
      ['run', '--sources'],
      ['run', '--sources', 'facebook'],
      ['run', '--sources', 'google_maps', 'extra'],
      ['notify', 'extra'],
    ]) {
      expect(await main(argv, {}, { build, log: quietLog })).toBe(2);
    }
    expect(built).toBe(0);
    expect(String(stderr.mock.calls[0]?.[0])).toContain('usage:');
    stderr.mockRestore();
  });

  it('accepts several comma-separated sources', async () => {
    const { build } = fakeBuild(okSource);
    // threads is not in the fake registry, so its listShards fails → 1 (but the arguments are valid).
    expect(await main(['run', '--sources', 'google_maps,threads'], {}, { build })).toBe(1);
    expect(await main(['run', '--sources', 'google_maps'], { SOURCES_DISABLED: 'threads' }, { build })).toBe(0);
  });

  it('gives up after timeoutMs and returns 1', async () => {
    const errors: string[] = [];
    const log = { info() {}, warn() {}, error: (m: string) => void errors.push(m) };
    const never = () => new Promise<BatchContext>(() => {});
    const started = Date.now();
    expect(await main(['run', '--sources', 'google_maps'], {}, { build: never, timeoutMs: 50, log })).toBe(1);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(errors.some((m) => /timeout|timed out/i.test(m))).toBe(true);
  });

  it('closes the context when a running command times out', async () => {
    let closed = 0;
    const hanging: Source = { id: 'google_maps', listShards: async () => ['nail'], collect: () => new Promise(() => {}) };
    const { build } = fakeBuild(hanging, { closed: () => closed++ });
    expect(await main(['run', '--sources', 'google_maps'], {}, { build, timeoutMs: 50 })).toBe(1);
    expect(closed).toBe(1);
  });

  it('returns 1 when building the context fails', async () => {
    const build = async (): Promise<BatchContext> => {
      throw new Error('DATABASE_URL missing');
    };
    expect(await main(['notify'], {}, { build, log: quietLog })).toBe(1);
  });
});
