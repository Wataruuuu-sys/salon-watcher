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
  it.each(['立川に整体院を開院しました', '来月開店します', '八王子へ移転しました', '店内リニューアル', '12月オープン予定'])(
    'passes %s',
    (text) => {
      expect(passesPrefilter(text)).toBe(true);
    },
  );
});
