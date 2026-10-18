import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTestDb, resetDb } from '../helpers/db.js';
import { stores } from '../../src/db/schema.js';
import { checkHpb, checkPendingStores } from '../../src/hpb/check.js';

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const html = (body: string, status = 200) => new Response(body, { status });
const noSleep = async () => {};
const db = await getTestDb();

function lilyPage(): string {
  return `<ul class="slnCassetteList"><li><div class="slnCassetteHeader"><h3 class="slnName"><a href="https://beauty.hotpepper.jp/slnH000000001/?cstt=1">Nail Salon Lily 立川店</a></h3></div><div class="slnCassetteBody"><div class="slnInfo"><dl class="slnDetail"><dt class="access">アクセス</dt><dd class="access">立川市曙町 立川駅徒歩3分</dd></dl></div></div></li></ul>`;
}

describe('checkHpb', () => {
  const store = { name: 'ネイルサロン Lily', city: '立川市' };

  it('500 -> unknown', async () => {
    const http = vi.fn(async () => html('err', 500)) as unknown as typeof fetch;
    expect((await checkHpb(store, http, noSleep)).status).toBe('unknown');
  });

  it('AbortError -> unknown', async () => {
    const http = vi.fn(async () => {
      throw new DOMException('aborted', 'AbortError');
    }) as unknown as typeof fetch;
    expect((await checkHpb(store, http, noSleep)).status).toBe('unknown');
  });

  it('structure change -> unknown (not not_listed)', async () => {
    const http = vi.fn(async () => html('<html><body>maintenance</body></html>')) as unknown as typeof fetch;
    expect((await checkHpb(store, http, noSleep)).status).toBe('unknown');
  });

  it('name variation + city match -> listed with url', async () => {
    const http = vi.fn(async () => html(lilyPage())) as unknown as typeof fetch;
    expect(await checkHpb(store, http, noSleep)).toEqual({
      status: 'listed',
      url: 'https://beauty.hotpepper.jp/slnH000000001/',
    });
  });

  it('zero results on every endpoint -> not_listed; queries all endpoints with a pause between', async () => {
    const pages = [fx('hair-empty.html'), fx('kirei-empty.html')];
    let i = 0;
    const http = vi.fn(async () => html(pages[i++ < 1 ? 0 : 1])) as unknown as typeof fetch;
    const sleep = vi.fn(async () => {});
    expect(await checkHpb(store, http, sleep)).toEqual({ status: 'not_listed', url: null });
    const urls = vi.mocked(http).mock.calls.map((c) => String(c[0]));
    expect(urls.length).toBeGreaterThanOrEqual(2);
    expect(urls[0]).toContain('/CSP/bt/salonSearch/search/');
    expect(urls[1]).toContain('/CSP/kr/salonSearch/search/');
    expect(urls[0]).toContain('freeword=');
    expect(sleep).toHaveBeenCalledTimes(urls.length - 1);
  });

  it('listed on a later endpoint wins over an earlier failure', async () => {
    let n = 0;
    const http = vi.fn(async () => (n++ === 0 ? html('x', 503) : html(lilyPage()))) as unknown as typeof fetch;
    expect((await checkHpb(store, http, noSleep)).status).toBe('listed');
  });

  it('店名不明 -> unknown without fetching', async () => {
    const http = vi.fn() as unknown as typeof fetch;
    expect(await checkHpb({ name: '店名不明', city: null }, http, noSleep)).toEqual({ status: 'unknown', url: null });
    expect(http).not.toHaveBeenCalled();
  });
});

describe('checkPendingStores', () => {
  beforeEach(() => resetDb(db));

  it('updates unchecked stores only, up to limit', async () => {
    await db.insert(stores).values([
      { name: 'ネイルサロン Lily', nameNorm: 'lily', city: '立川市', confidence: 'high' },
      { name: 'Zzz', nameNorm: 'zzz', confidence: 'high' },
      { name: 'Done', nameNorm: 'done', confidence: 'high', hpbStatus: 'not_listed' },
    ]);
    const http = vi.fn(async (u: unknown) => html(String(u).includes('freeword=Zzz') ? fx('hair-empty.html') : lilyPage())) as unknown as typeof fetch;
    const n = await checkPendingStores(db, http, 100, noSleep);
    expect(n).toBe(2);
    const rows = await db.select().from(stores);
    const by = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(by['ネイルサロン Lily'].hpbStatus).toBe('listed');
    expect(by['ネイルサロン Lily'].hpbUrl).toBe('https://beauty.hotpepper.jp/slnH000000001/');
    expect(by['ネイルサロン Lily'].hpbCheckedAt).toBeInstanceOf(Date);
    expect(by['Zzz'].hpbStatus).toBe('not_listed');
    expect(by['Zzz'].hpbCheckedAt).toBeInstanceOf(Date);
    expect(by['Done'].hpbCheckedAt).toBeNull();
  });
});
