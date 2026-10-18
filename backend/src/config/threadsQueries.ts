import { TAMA_CITIES } from './areas.js';
import { GENRES } from './genres.js';

/** Default Threads keyword-search terms. Query text lives only here (and in user overrides). */
export const THREADS_QUERY_DEFAULTS = {
  areas: TAMA_CITIES.map((c) => c.replace(/市$/, '')),
  words: GENRES.flatMap((g) => g.threadsWords),
  openWords: ['オープン', '新店'],
};

export const THREADS_RUNS_PER_DAY = 4;
/** Threads keyword search allows 2,200 queries per rolling 24h. */
export const THREADS_DAILY_QUOTA = 2200;
