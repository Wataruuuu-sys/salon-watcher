import { afterEach, describe, expect, it } from 'vitest';
import { listShardsHandler } from '../../src/handlers/collect.js';

afterEach(() => {
  delete process.env.SOURCES_DISABLED;
});

describe('listShardsHandler', () => {
  it('returns shards for all requested enabled sources', async () => {
    const { tasks } = await listShardsHandler({ sources: ['google_maps', 'threads'] });
    expect(tasks.filter((t) => t.source === 'google_maps')).toHaveLength(6);
    expect(tasks).toContainEqual({ source: 'threads', shard: 'all' });
  });

  it('excludes sources disabled via SOURCES_DISABLED', async () => {
    process.env.SOURCES_DISABLED = 'threads';
    const { tasks } = await listShardsHandler({ sources: ['google_maps', 'threads'] });
    expect(tasks).toHaveLength(6);
    expect(tasks.every((t) => t.source === 'google_maps')).toBe(true);
  });
});
