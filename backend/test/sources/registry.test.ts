import { describe, expect, it } from 'vitest';
import { enabledSources } from '../../src/sources/registry.js';

describe('registry', () => {
  it('enables all sources by default', () => {
    expect(enabledSources({})).toEqual(['google_maps', 'threads']);
  });

  it('excludes sources listed in SOURCES_DISABLED', () => {
    expect(enabledSources({ SOURCES_DISABLED: 'threads' })).toEqual(['google_maps']);
    expect(enabledSources({ SOURCES_DISABLED: ' threads , google_maps ' })).toEqual([]);
  });
});
