import { describe, expect, it } from 'vitest';
import { normalizeName } from '../../src/resolve/normalize.js';

describe('normalizeName', () => {
  it('matches across width, case, generic words and branch suffix', () => {
    expect(normalizeName('Nail Salon Lily 立川店')).toBe('lily');
    expect(normalizeName('ネイルサロン　ｌｉｌｙ')).toBe('lily');
    expect(normalizeName('Nail Salon Lily 立川店')).toBe(normalizeName('ネイルサロン　ｌｉｌｙ'));
  });
  it('removes symbols and whitespace', () => {
    expect(normalizeName('ｈａｉｒ　ｍａｋｅ　ＲＩＮ')).toBe('hairmakerin');
    expect(normalizeName('Lily & Co.')).toBe('lilyco');
  });
  it('strips generic words only at the ends', () => {
    expect(normalizeName('Lily美容室')).toBe('lily');
    expect(normalizeName('Aサロンb')).toBe('aサロンb');
  });
  it('never strips to empty', () => {
    expect(normalizeName('ネイルサロン')).toBe('ネイルサロン');
    expect(normalizeName('立川店')).toBe('立川店');
  });
  it('strips at most 6 branch chars and only after CJK chars', () => {
    expect(normalizeName('lily立川駅南口西側店')).toBe('lily立');
    expect(normalizeName('lilyabc店')).toBe('lilyabc店');
  });
});
