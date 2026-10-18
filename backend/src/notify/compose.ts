import type { Confidence } from '../domain/types.js';

export interface LeadForMail {
  name: string;
  genreLabel: string;
  city: string | null;
  confidence: Confidence;
  openingDate: string | null;
  evidenceUrls: string[];
  signals: string[];
}

/** Builds the daily digest; returns null when there is nothing to report. Contains no contact info. */
export function composeDigest(
  main: LeadForMail[],
  maybeCount: number,
  uiUrl: string,
): { subject: string; body: string } | null {
  if (main.length === 0 && maybeCount === 0) return null;
  const subject = `【新店検出】${main.length}件${maybeCount > 0 ? ` (要確認 ${maybeCount}件)` : ''}`;
  const blocks = main.map((l) => {
    const head = `・${l.name}【${l.genreLabel} / ${l.city ?? 'エリア不明'}】${l.signals.includes('FUTURE_OPENING') ? ' 🔜オープン予定' : ''}`;
    return [head, ...(l.openingDate ? [l.openingDate] : []), ...l.evidenceUrls].join('\n');
  });
  const lines = [...blocks];
  if (maybeCount > 0) lines.push(`要確認: ${maybeCount}件（詳細は管理画面で確認してください）`);
  lines.push(uiUrl);
  return { subject, body: lines.join('\n\n') + '\n' };
}
