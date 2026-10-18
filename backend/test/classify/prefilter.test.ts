import { describe, it, expect } from 'vitest';
import { passesPrefilter } from '../../src/classify/prefilter';

describe('passesPrefilter', () => {
  it('passes opening announcements', () => {
    expect(passesPrefilter('11/1 立川にネイルサロンOPEN')).toBe(true);
  });
  it('rejects unrelated posts', () => {
    expect(passesPrefilter('今日のネイルデザイン')).toBe(false);
  });
  it('normalizes full-width and case', () => {
    expect(passesPrefilter('ｏｐｅｎしました')).toBe(true);
  });
});
