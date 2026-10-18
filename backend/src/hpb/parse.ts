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

/** Name match (normalized equality or containment, min 2 chars) and, when city is known, its base name (trailing 市 removed) in the access text. */
export function matchHit(store: { name: string; city: string | null }, hits: HpbHit[]): HpbHit | null {
  const n = normalizeName(store.name);
  if (n.length < 2) return null;
  for (const hit of hits) {
    const h = normalizeName(hit.name);
    if (h.length < 2) continue;
    if (!(h === n || h.includes(n) || n.includes(h))) continue;
    if (store.city && !hit.address.includes(store.city.replace(/市$/, ''))) continue;
    return hit;
  }
  return null;
}
