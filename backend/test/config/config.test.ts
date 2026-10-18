import { describe, it, expect } from 'vitest';
import { TAMA_CITIES, cityFromAddress } from '../../src/config/areas';
import { GENRES } from '../../src/config/genres';

describe('config', () => {
  it('lists 26 Tama cities', () => {
    expect(TAMA_CITIES).toHaveLength(26);
    expect(TAMA_CITIES).toContain('西東京市');
    expect(TAMA_CITIES).not.toContain('瑞穂町');
  });

  it('lists genres in order', () => {
    expect(GENRES.map((g) => g.id)).toEqual(['hair', 'nail', 'eye', 'relax', 'esthe', 'seitai']);
  });

  it('extracts city from address', () => {
    expect(cityFromAddress('日本、〒190-0012 東京都立川市曙町2丁目')).toBe('立川市');
    expect(cityFromAddress('広島県府中市府川町')).toBeNull();
    expect(cityFromAddress('東京都西東京市田無町')).toBe('西東京市');
    expect(cityFromAddress('東京都東大和市桜が丘')).toBe('東大和市');
  });
});
