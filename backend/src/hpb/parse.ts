import * as cheerio from 'cheerio';
import { normalizeName } from '../resolve/normalize.js';

export interface HpbHit {
  name: string;
  /** HPB result lists expose no postal address; this is the "access" text (station / area). */
  address: string;
  url: string;
}

/**
 * Parses an HPB free-word search result page. Two layouts exist:
 *  - hair section (`/CSP/bt/salonSearch/search/`): `h3.slnName > a`, `dd.access`
 *  - kirei section (`/CSP/kr/salonSearch/search/`): `h3.slcHead > a`, `.slcDetailAccess dd`
 * Returns [] for the explicit zero-result page, null when neither layout is found.
 */
export function parseSearchResults(html: string): HpbHit[] | null {
  const $ = cheerio.load(html);
  const hits: HpbHit[] = [];

  $('ul.slnCassetteList > li').each((_, li) => {
    const a = $(li).find('h3.slnName a').first();
    const url = cleanUrl(a.attr('href'));
    if (url) hits.push({ name: a.text().trim(), address: $(li).find('dd.access').first().text().trim(), url });
  });
  $('li.searchListCassette').each((_, li) => {
    const a = $(li).find('h3.slcHead a').first();
    const url = cleanUrl(a.attr('href'));
    if (url) hits.push({ name: a.text().trim(), address: $(li).find('.slcDetailAccess dd').first().text().trim(), url });
  });

  if (hits.length > 0) return hits;
  if ($('.searchResultZeroText').length > 0) return [];
  return null;
}

function cleanUrl(href: string | undefined): string | null {
  if (!href) return null;
  try {
    const u = new URL(href, 'https://beauty.hotpepper.jp');
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

const MIN_CONTAINMENT_CHARS = 4;

/**
 * Whether a hit's name refers to the store. Without a city only exact normalized equality counts
 * (a bare name is too weak to call a store listed); with a city, containment also counts when the
 * shorter normalized name has at least 4 chars.
 */
export function nameMatches(store: { name: string; city: string | null }, hit: HpbHit): boolean {
  const n = normalizeName(store.name);
  const h = normalizeName(hit.name);
  if (n.length < 2 || h.length < 2) return false;
  if (h === n) return true;
  if (!store.city) return false;
  if (Math.min(h.length, n.length) < MIN_CONTAINMENT_CHARS) return false;
  return h.includes(n) || n.includes(h);
}

/** A name match whose access text contains the city base name (trailing 市 removed) when the city is known. */
export function matchHit(store: { name: string; city: string | null }, hits: HpbHit[]): HpbHit | null {
  for (const hit of hits) {
    if (!nameMatches(store, hit)) continue;
    if (store.city && !hit.address.includes(store.city.replace(/市$/, ''))) continue;
    return hit;
  }
  return null;
}

/** City known, some hits match by name, but none has access text to confirm the area: cannot decide. */
export function unverifiableByArea(store: { name: string; city: string | null }, hits: HpbHit[]): boolean {
  if (!store.city) return false;
  const named = hits.filter((h) => nameMatches(store, h));
  return named.length > 0 && named.every((h) => h.address.trim() === '');
}
