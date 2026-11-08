import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, like } from 'drizzle-orm';
import { evidence, stores } from '../../src/db/schema.js';
import { main } from '../../src/batch/main.js';
import { getTestDb, resetDb, testDbUrl } from '../helpers/db.js';

const db = await getTestDb();
const env = () => ({ APP_ENV: 'local', FAKE_EXTERNAL: '1', DATABASE_URL: testDbUrl });
// Skip the pause between HPB requests; everything else is the real batch wiring.
const deps = { runOptions: { hpbSleep: async () => {} } };

beforeAll(() => resetDb(db));
afterEach(() => vi.restoreAllMocks());

/** Captures the JSON-lines log written to stdout while `fn` runs. */
async function captureStdout(fn: () => Promise<number>): Promise<{ code: number; out: string }> {
  const chunks: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    chunks.push(String(chunk));
    return true;
  });
  const code = await fn();
  vi.restoreAllMocks();
  return { code, out: chunks.join('') };
}

describe('batch end to end on fakes (APP_ENV=local FAKE_EXTERNAL=1)', () => {
  it('collects, merges, checks HPB and notifies', { timeout: 60_000 }, async () => {
    // First sweep seeds the map cells; the fake places surface only on the second.
    expect((await captureStdout(() => main(['run', '--sources', 'google_maps'], env(), deps))).code).toBe(0);
    expect(await db.select().from(stores)).toHaveLength(0);
    expect((await captureStdout(() => main(['run', '--sources', 'google_maps'], env(), deps))).code).toBe(0);
    expect((await captureStdout(() => main(['run', '--sources', 'threads'], env(), deps))).code).toBe(0);

    const lily = await db.select().from(stores).where(like(stores.name, '%Lily%'));
    expect(lily).toHaveLength(1);
    const ev = await db.select().from(evidence).where(eq(evidence.storeId, lily[0]!.id));
    expect(ev.map((e) => e.source).sort()).toEqual(['google_maps', 'threads']);

    const maybe = await db.select().from(stores).where(eq(stores.confidence, 'maybe'));
    expect(maybe).toHaveLength(1);

    const [sakura] = await db.select().from(stores).where(like(stores.name, '%Sakura%'));
    expect(sakura!.hpbStatus).toBe('listed');

    const { code, out } = await captureStdout(() => main(['notify'], env(), deps));
    expect(code).toBe(0);
    expect(out).toContain('mail (mock)');
    expect(out).toContain('Lily');
  });
});
