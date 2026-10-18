import { beforeEach, describe, expect, it } from 'vitest';
import { THREADS_DAILY_QUOTA, THREADS_RUNS_PER_DAY } from '../../../src/config/threadsQueries.js';
import {
  defaultThreadsQueries, loadThreadsQueries, resetThreadsQueries, saveThreadsQueries, validateThreadsQueries,
} from '../../../src/sources/threads/queries.js';
import { getTestDb, resetDb } from '../../helpers/db.js';
import type { Db } from '../../../src/db/client.js';

describe('threads queries', () => {
  let db: Db;
  beforeEach(async () => {
    db = await getTestDb();
    await resetDb(db);
  });

  it('expands defaults within the daily quota', () => {
    const q = defaultThreadsQueries();
    expect(q).toHaveLength(312);
    expect(q).toContain('立川 ネイル オープン');
    expect(q.length * THREADS_RUNS_PER_DAY).toBeLessThanOrEqual(THREADS_DAILY_QUOTA);
  });

  it('uses defaults when no override exists', async () => {
    const r = await loadThreadsQueries(db);
    expect(r.source).toBe('default');
    expect(r.queries).toHaveLength(312);
  });

  it('normalizes and stores a custom list', async () => {
    const res = await saveThreadsQueries(db, [' 立川 新規オープン ', '', '立川 新規オープン'], 'u');
    expect(res).toEqual({ ok: true, queries: ['立川 新規オープン'] });
    expect(await loadThreadsQueries(db)).toEqual({ queries: ['立川 新規オープン'], source: 'custom' });
  });

  it('rejects over-quota input without touching the existing override', async () => {
    await saveThreadsQueries(db, ['a b'], 'u');
    const many = Array.from({ length: 551 }, (_, i) => `q${i}`);
    const res = await saveThreadsQueries(db, many, 'u');
    expect(res.ok).toBe(false);
    expect((await loadThreadsQueries(db)).queries).toEqual(['a b']);
  });

  it('accepts exactly 550 and rejects empty and over-long queries', () => {
    expect(validateThreadsQueries(Array.from({ length: 550 }, (_, i) => `q${i}`)).ok).toBe(true);
    expect(validateThreadsQueries(['  ', '']).ok).toBe(false);
    expect(validateThreadsQueries(['あ'.repeat(101)]).ok).toBe(false);
    expect(validateThreadsQueries(['あ'.repeat(100)]).ok).toBe(true);
  });

  it('reset returns to defaults', async () => {
    await saveThreadsQueries(db, ['x y'], 'u');
    await resetThreadsQueries(db);
    expect((await loadThreadsQueries(db)).source).toBe('default');
  });
});
