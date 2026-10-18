import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { stores } from '../db/schema.js';
import type { HpbStatus } from '../domain/types.js';
import { matchHit, parseSearchResults, unverifiableByArea } from './parse.js';

const HPB_ORIGIN = 'https://beauty.hotpepper.jp';

/** Hair-section free-word (salon name) search. GET ?freeword=<name>. */
export const HPB_SEARCH_URL = `${HPB_ORIGIN}/CSP/bt/salonSearch/search/`;
/**
 * Kirei-section free-word search. GET ?freeword=<name>&genreAlias=<alias>.
 * `nail` covers nail + eyelash; esthe and relax are separate listings.
 */
export const HPB_KIREI_SEARCH_URL = `${HPB_ORIGIN}/CSP/kr/salonSearch/search/`;
export const HPB_KIREI_GENRE_ALIASES = ['nail', 'esthe', 'relax'] as const;

const UNKNOWN_NAME = '店名不明';
const TIMEOUT_MS = 10_000;
const INTERVAL_MS = 2000;
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function searchUrls(name: string): string[] {
  const fw = encodeURIComponent(name.slice(0, 63));
  return [
    `${HPB_SEARCH_URL}?freeword=${fw}`,
    ...HPB_KIREI_GENRE_ALIASES.map((g) => `${HPB_KIREI_SEARCH_URL}?freeword=${fw}&genreAlias=${g}`),
  ];
}

/**
 * Queries every HPB endpoint serially (pause between requests). `listed` wins on the first match;
 * otherwise any failed/unparseable endpoint, or name matches with no access text to check the city,
 * makes the result `unknown`; else `not_listed`.
 */
export async function checkHpb(
  store: { name: string; city: string | null },
  http: typeof fetch,
  sleep: Sleep = realSleep,
): Promise<{ status: HpbStatus; url: string | null }> {
  if (store.name.trim() === UNKNOWN_NAME) return { status: 'unknown', url: null };

  let failed = false;
  const urls = searchUrls(store.name);
  for (const [i, url] of urls.entries()) {
    if (i > 0) await sleep(INTERVAL_MS);
    try {
      const res = await http(url, {
        headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'ja' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status !== 200) {
        failed = true;
        continue;
      }
      const hits = parseSearchResults(await res.text());
      if (hits === null) {
        failed = true;
        continue;
      }
      const hit = matchHit(store, hits);
      if (hit) return { status: 'listed', url: hit.url };
      if (unverifiableByArea(store, hits)) failed = true;
    } catch {
      failed = true;
    }
  }
  return { status: failed ? 'unknown' : 'not_listed', url: null };
}

export async function checkPendingStores(
  db: Db,
  http: typeof fetch,
  limit = 40,
  sleep: Sleep = realSleep,
): Promise<number> {
  const pending = await db.select().from(stores).where(eq(stores.hpbStatus, 'unchecked')).limit(limit);
  let first = true;
  for (const s of pending) {
    if (s.name.trim() !== UNKNOWN_NAME) {
      if (!first) await sleep(INTERVAL_MS);
      first = false;
    }
    const r = await checkHpb({ name: s.name, city: s.city }, http, sleep);
    await db
      .update(stores)
      .set({ hpbStatus: r.status, hpbUrl: r.url, hpbCheckedAt: new Date() })
      .where(eq(stores.id, s.id));
  }
  return pending.length;
}
