import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { matchHit, parseSearchResults } from '../../src/hpb/parse.js';

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');

describe('parseSearchResults', () => {
  it('parses the hair-section result list', () => {
    const hits = parseSearchResults(fx('hair-listed.html'));
    expect(hits).not.toBeNull();
    expect(hits!.length).toBe(3);
    expect(hits![0]!.name).toContain('Re:chill');
    expect(hits![0]!.url).toBe('https://beauty.hotpepper.jp/slnH000762323/');
    expect(hits![0]!.address).toContain('北山駅');
  });

  it('parses the kirei (nail/eye/esthe/relax) result list', () => {
    const hits = parseSearchResults(fx('kirei-listed.html'));
    expect(hits!.length).toBe(3);
    expect(hits![0]!.name).toContain('Happinail');
    expect(hits![0]!.url).toBe('https://beauty.hotpepper.jp/kr/slnH000696034/');
    expect(hits![0]!.address).toContain('祇園四条駅');
  });

  it('returns [] for the explicit zero-result pages', () => {
    expect(parseSearchResults(fx('hair-empty.html'))).toEqual([]);
    expect(parseSearchResults(fx('kirei-empty.html'))).toEqual([]);
  });

  it('returns null when the structure is unrecognisable', () => {
    expect(parseSearchResults('<html><body>maintenance</body></html>')).toBeNull();
  });
});

describe('matchHit', () => {
  const hit = { name: 'Nail Salon Lily 立川店', address: '立川市曙町', url: 'https://x/' };
  it('matches by normalized name containment plus city', () => {
    expect(matchHit({ name: 'ネイルサロン Lily', city: '立川市' }, [hit])).toBe(hit);
  });
  it('rejects when the city is absent from the address', () => {
    expect(matchHit({ name: 'ネイルサロン Lily', city: '八王子市' }, [hit])).toBeNull();
  });
  it('rejects unrelated names', () => {
    expect(matchHit({ name: 'Rose', city: null }, [hit])).toBeNull();
  });
});
