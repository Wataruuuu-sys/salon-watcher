import { OPEN_WORDS } from '../config/genres.js';
import type { LlmClassifier } from '../classify/llm.js';

export function fakeLlmClassifier(): LlmClassifier {
  return {
    kind: 'fake',
    async classify({ text }) {
      if (text.includes('立川')) {
        return {
          verdict: 'yes',
          storeName: 'Nail Salon Lily 立川店',
          genre: 'nail',
          city: '立川市',
          openingDate: null,
          reason: 'フェイク判定: 立川の開業告知',
          signals: [],
        };
      }
      if (OPEN_WORDS.some((w) => text.includes(w))) {
        return {
          verdict: 'maybe',
          storeName: null,
          genre: null,
          city: null,
          openingDate: null,
          reason: 'フェイク判定: エリア不明の開業告知',
          signals: [],
        };
      }
      return { verdict: 'no', storeName: null, genre: null, city: null, openingDate: null, reason: 'フェイク判定: 対象外', signals: [] };
    },
  };
}
