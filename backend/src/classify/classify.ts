import type { Classification } from '../domain/types';
import { TAMA_CITIES } from '../config/areas';
import { passesPrefilter } from './prefilter';
import type { ClassifyInput, LlmClassifier } from './llm';

export type { ClassifyInput, LlmClassifier } from './llm';

/** Maps LLM city spellings like '東京都立川市' or '立川' to the canonical Tama city name. */
export function normalizeCity(city: string | null): string | null {
  if (city === null) return null;
  const v = city.trim().replace(/^東京都\s*/, '').trim();
  if (v === '') return null;
  if (TAMA_CITIES.includes(v)) return v;
  const withSuffix = `${v}市`;
  return TAMA_CITIES.includes(withSuffix) ? withSuffix : v;
}

/** Rule-based corrections applied after the LLM verdict. Only the LLM itself decides 'no'. */
export function postProcess(raw: Classification): Classification {
  let c: Classification = { ...raw, city: normalizeCity(raw.city) };
  if (c.city !== null && !TAMA_CITIES.includes(c.city)) {
    // Unrecognised city: keep the lead for a human to check rather than dropping it.
    c = {
      ...c,
      city: null,
      verdict: c.verdict === 'yes' ? 'maybe' : c.verdict,
      reason: `${c.reason}（市名を確認: ${c.city}）`,
    };
  }
  if (c.verdict === 'yes' && c.city === null && c.genre === null) {
    return { ...c, verdict: 'maybe' };
  }
  return c;
}

export async function classifyItem(item: ClassifyInput, llm: LlmClassifier): Promise<Classification> {
  if (!passesPrefilter(item.text)) {
    return { verdict: 'no', storeName: null, genre: null, city: null, openingDate: null, reason: 'prefilter', signals: [] };
  }
  return postProcess(await llm.classify(item));
}
