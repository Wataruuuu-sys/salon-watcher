import { beforeEach, describe, expect, it } from 'vitest';
import { getTestDb, resetDb } from '../helpers/db.js';
import { evidence, rawItems, stores } from '../../src/db/schema.js';
import { runNotify } from '../../src/handlers/notify.js';

const db = await getTestDb();
const now = new Date('2026-10-18T00:00:00Z');
const opts = { uiUrl: 'https://ui.example', now };

async function addStore(
  name: string,
  over: Partial<typeof stores.$inferInsert>,
  url: string,
  signals: string[] = [],
) {
  const [s] = await db
    .insert(stores)
    .values({ name, nameNorm: name, confidence: 'yes', ...over })
    .returning();
  const [r] = await db
    .insert(rawItems)
    .values({
      source: 'threads',
      externalId: `${name}-x`,
      url,
      text: 't',
      payload: {},
      classification: { signals },
    })
    .returning();
  await db.insert(evidence).values({ storeId: s!.id, rawItemId: r!.id, source: 'threads', url, confidence: 'yes', reason: 'r' });
  return s!;
}

beforeEach(() => resetDb(db));

describe('runNotify', () => {
  it('sends main + maybe, skips listed, marks all notified, and is idempotent', async () => {
    await addStore('新店B', { firstSeenAt: new Date('2026-10-02') }, 'https://e.com/b', ['FUTURE_OPENING']);
    await addStore('新店A', { firstSeenAt: new Date('2026-10-01'), genre: 'hair', city: '渋谷区' }, 'https://e.com/a');
    await addStore('疑いC', { confidence: 'maybe' }, 'https://e.com/c');
    const listed = await addStore('掲載済D', { hpbStatus: 'listed' }, 'https://e.com/d');
    const sent: { subject: string; body: string }[] = [];
    const send = async (subject: string, body: string) => void sent.push({ subject, body });

    const r = await runNotify(db, send, opts);
    expect(r).toEqual({ sent: true, main: 2, maybe: 1 });
    expect(sent).toHaveLength(1);
    const { subject, body } = sent[0]!;
    expect(subject).toBe('【新店検出】2件 (要確認 1件)');
    expect(body.indexOf('新店A')).toBeGreaterThan(-1);
    expect(body.indexOf('新店A')).toBeLessThan(body.indexOf('新店B'));
    expect(body).toContain('ヘア / 渋谷区');
    expect(body).toContain('ジャンル不明');
    expect(body).toContain('🔜オープン予定');
    expect(body).not.toContain('掲載済D');
    expect(body).not.toContain('疑いC');

    const rows = await db.select().from(stores);
    expect(rows.every((s) => s.notifiedAt !== null)).toBe(true);
    expect(rows.find((s) => s.id === listed.id)!.notifiedAt).not.toBeNull();

    expect(await runNotify(db, send, opts)).toEqual({ sent: false, main: 0, maybe: 0 });
    expect(sent).toHaveLength(1);
  });

  it('does not mark notified when sending fails', async () => {
    await addStore('新店A', {}, 'https://e.com/a');
    await expect(runNotify(db, async () => { throw new Error('ses down'); }, opts)).rejects.toThrow('ses down');
    const [s] = await db.select().from(stores);
    expect(s!.notifiedAt).toBeNull();
  });

  it('marks listed stores notified even when nothing is sent', async () => {
    await addStore('掲載済D', { hpbStatus: 'listed' }, 'https://e.com/d');
    const r = await runNotify(db, async () => { throw new Error('should not send'); }, opts);
    expect(r).toEqual({ sent: false, main: 0, maybe: 0 });
    const [s] = await db.select().from(stores);
    expect(s!.notifiedAt).not.toBeNull();
  });
});
