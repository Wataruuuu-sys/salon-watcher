import type { SourceId } from '../domain/types.js';
import type { Source } from './types.js';
import { googleMapsSource } from './googleMaps/source.js';

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

export const ENABLED_SOURCES: SourceId[] = enabledSources(process.env);

const sources = new Map<SourceId, Source>();

export function registerSource(source: Source): void {
  sources.set(source.id, source);
}

export function getSource(id: SourceId): Source {
  const source = sources.get(id);
  if (!source) throw new Error(`unknown source: ${id}`);
  return source;
}

registerSource(googleMapsSource);
