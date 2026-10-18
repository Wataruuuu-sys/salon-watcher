import { describe, it, expect } from 'vitest';
import { classifyItem, postProcess, type LlmClassifier } from '../../src/classify/classify';
import type { Classification } from '../../src/domain/types';

const base: Classification = {
  verdict: 'yes', storeName: 'Salon A', genre: 'nail', city: '立川市',
  openingDate: null, reason: 'open', signals: [],
};

function fake(result: Classification): LlmClassifier & { calls: number } {
  const f = {
    calls: 0,
    async classify() { f.calls++; return result; },
  };
  return f;
}
const item = { text: '立川にネイルサロンOPEN', authorHandle: null, postedAt: null };

describe('postProcess', () => {
  it('nulls a non-Tama city and downgrades yes to maybe (never forces no)', () => {
    const r = postProcess({ ...base, city: '横浜市' });
    expect(r.verdict).toBe('maybe');
    expect(r.city).toBeNull();
  });
  it('keeps the LLM\'s own no for a non-Tama city', () => {
    expect(postProcess({ ...base, verdict: 'no', city: '横浜市' }).verdict).toBe('no');
  });
  it.each([
    ['立川', '立川市'],
    ['東京都立川市', '立川市'],
    ['東京都 町田', '町田市'],
  ])('normalizes city %s to %s', (input, expected) => {
    const r = postProcess({ ...base, city: input });
    expect(r.city).toBe(expected);
    expect(r.verdict).toBe('yes');
  });
  it('downgrades yes to maybe when city and genre are both null', () => {
    expect(postProcess({ ...base, city: null, genre: null }).verdict).toBe('maybe');
  });
  it('keeps a valid yes', () => {
    expect(postProcess(base)).toEqual(base);
  });
});

describe('classifyItem', () => {
  it('applies post-processing to the LLM result', async () => {
    const llm = fake({ ...base, city: '横浜市' });
    expect(await classifyItem(item, llm)).toMatchObject({ verdict: 'maybe', city: null });
    expect(llm.calls).toBe(1);
  });
  it('downgrades city/genre-less yes to maybe', async () => {
    const llm = fake({ ...base, city: null, genre: null });
    expect((await classifyItem(item, llm)).verdict).toBe('maybe');
  });
  it('does not call the LLM when prefilter fails', async () => {
    const llm = fake(base);
    const r = await classifyItem({ ...item, text: '今日のネイルデザイン' }, llm);
    expect(llm.calls).toBe(0);
    expect(r).toMatchObject({ verdict: 'no', reason: 'prefilter', storeName: null, genre: null, city: null });
  });
});
