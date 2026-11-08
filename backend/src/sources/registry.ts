import type { SourceId } from '../domain/types.js';
import type { Source } from './types.js';

const ALL_SOURCES: SourceId[] = ['google_maps', 'threads'];

/** All sources minus those listed (comma-separated) in SOURCES_DISABLED. */
export function enabledSources(env: Record<string, string | undefined>): SourceId[] {
  const disabled = new Set(
    (env.SOURCES_DISABLED ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  return ALL_SOURCES.filter((id) => !disabled.has(id));
}

/** Lookup over the given sources (real or fake). */
export function buildRegistry(list: Source[]): { getSource(id: SourceId): Source } {
  const byId = new Map<SourceId, Source>(list.map((s) => [s.id, s]));
  return {
    getSource(id) {
      const source = byId.get(id);
      if (!source) throw new Error(`unknown source: ${id}`);
      return source;
    },
  };
}
