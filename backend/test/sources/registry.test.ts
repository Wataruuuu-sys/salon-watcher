import { describe, expect, it } from 'vitest';
import { enabledSources, getSource, registerSource } from '../../src/sources/registry.js';
import type { SourceId } from '../../src/domain/types.js';
import type { Source } from '../../src/sources/types.js';

describe('registry', () => {
  it('enables all sources by default', () => {
    expect(enabledSources({})).toEqual(['google_maps', 'threads']);
  });

  it('excludes sources listed in SOURCES_DISABLED', () => {
    expect(enabledSources({ SOURCES_DISABLED: 'threads' })).toEqual(['google_maps']);
    expect(enabledSources({ SOURCES_DISABLED: ' threads , google_maps ' })).toEqual([]);
  });

  it('throws for an unregistered source and returns a registered one', () => {
    expect(() => getSource('nope' as SourceId)).toThrow(/nope/);
    const stub: Source = {
      id: 'threads',
      listShards: async () => ['s'],
      collect: async () => [],
    };
    registerSource(stub);
    expect(getSource('threads')).toBe(stub);
  });
});
