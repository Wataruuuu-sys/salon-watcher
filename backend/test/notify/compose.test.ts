import { describe, expect, it } from 'vitest';
import { composeDigest, type LeadForMail } from '../../src/notify/compose.js';

const lead = (over: Partial<LeadForMail>): LeadForMail => ({
  name: 'サロンA',
  genreLabel: 'ヘア',
  city: '渋谷区',
  confidence: 'yes',
  openingDate: null,
  evidenceUrls: ['https://example.com/a'],
  signals: [],
  ...over,
});

describe('composeDigest', () => {
  it('returns null when there is nothing to report', () => {
    expect(composeDigest([], 0, 'https://ui.example')).toBeNull();
  });

  it('builds subject, evidence URLs and omits maybe names', () => {
    const r = composeDigest(
      [
        lead({ evidenceUrls: ['https://e.com/1', 'https://e.com/2'], openingDate: '2026-11-01', signals: ['FUTURE_OPENING'] }),
        lead({ name: 'サロンB', city: null }),
      ],
      3,
      'https://ui.example',
    )!;
    expect(r.subject).toBe('【新店検出】2件 (要確認 3件)');
    expect(r.body).toContain('・サロンA【ヘア / 渋谷区】 🔜オープン予定');
    expect(r.body).toContain('・サロンB【ヘア / エリア不明】');
    expect(r.body).toContain('2026-11-01');
    expect(r.body).toContain('https://e.com/1');
    expect(r.body).toContain('https://e.com/2');
    expect(r.body.trimEnd().endsWith('https://ui.example')).toBe(true);
  });

  it('omits the maybe suffix when there are no maybe leads', () => {
    expect(composeDigest([lead({})], 0, 'u')!.subject).toBe('【新店検出】1件');
  });

  it('handles maybe-only digests', () => {
    expect(composeDigest([], 2, 'u')!.subject).toBe('【新店検出】0件 (要確認 2件)');
  });
});
