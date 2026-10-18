import type { Classification } from '../domain/types';
import { TAMA_CITIES } from '../config/areas';
import { passesPrefilter } from './prefilter';
import type { ClassifyInput, LlmClassifier } from './llm';

export type { ClassifyInput, LlmClassifier } from './llm';

/** Rule-based corrections applied after the LLM verdict. */
export function postProcess(c: Classification): Classification {
  if (c.city !== null && !TAMA_CITIES.includes(c.city)) {
    return { ...c, verdict: 'no', reason: `${c.reason}（エリア外）` };
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
