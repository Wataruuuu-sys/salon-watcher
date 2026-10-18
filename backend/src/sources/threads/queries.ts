import { eq } from 'drizzle-orm';
import { THREADS_DAILY_QUOTA, THREADS_QUERY_DEFAULTS, THREADS_RUNS_PER_DAY } from '../../config/threadsQueries.js';
import type { Db } from '../../db/client.js';
import { settings } from '../../db/schema.js';

const SETTINGS_KEY = 'threads.queries';
const MAX_QUERY_LENGTH = 100;

export function defaultThreadsQueries(): string[] {
  const { areas, words, openWords } = THREADS_QUERY_DEFAULTS;
  return areas.flatMap((a) => words.flatMap((w) => openWords.map((o) => `${a} ${w} ${o}`)));
}

export type ThreadsQueriesValidation = { ok: true; queries: string[] } | { ok: false; error: string };

export function validateThreadsQueries(input: string[]): ThreadsQueriesValidation {
  const queries = [...new Set(input.map((q) => q.trim()).filter((q) => q !== ''))];
  if (queries.length === 0) return { ok: false, error: '検索語が1件もありません' };
  const tooLong = queries.find((q) => [...q].length > MAX_QUERY_LENGTH);
  if (tooLong !== undefined) return { ok: false, error: `検索語は${MAX_QUERY_LENGTH}文字以内にしてください: ${tooLong.slice(0, 20)}…` };
  if (queries.length * THREADS_RUNS_PER_DAY > THREADS_DAILY_QUOTA) {
    const max = Math.floor(THREADS_DAILY_QUOTA / THREADS_RUNS_PER_DAY);
    return { ok: false, error: `検索語は最大${max}件までです（現在${queries.length}件）` };
  }
  return { ok: true, queries };
}

export async function loadThreadsQueries(db: Db): Promise<{ queries: string[]; source: 'default' | 'custom' }> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, SETTINGS_KEY));
  if (row && Array.isArray(row.value) && row.value.every((v) => typeof v === 'string') && row.value.length > 0) {
    return { queries: row.value as string[], source: 'custom' };
  }
  return { queries: defaultThreadsQueries(), source: 'default' };
}

export async function saveThreadsQueries(
  db: Db,
  input: string[],
  updatedBy: string,
): Promise<ThreadsQueriesValidation> {
  const result = validateThreadsQueries(input);
  if (!result.ok) return result;
  const now = new Date();
  await db
    .insert(settings)
    .values({ key: SETTINGS_KEY, value: result.queries, updatedAt: now, updatedBy })
    .onConflictDoUpdate({ target: settings.key, set: { value: result.queries, updatedAt: now, updatedBy } });
  return result;
}

export async function resetThreadsQueries(db: Db): Promise<void> {
  await db.delete(settings).where(eq(settings.key, SETTINGS_KEY));
}
