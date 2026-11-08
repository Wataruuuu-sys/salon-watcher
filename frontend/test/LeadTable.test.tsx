import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LeadTable } from '../src/components/LeadTable';
import type { Lead } from '../src/lib/types';

const base: Lead = {
  id: 1,
  name: 'サロンA',
  genre: 'hair',
  city: '立川市',
  confidence: 'yes',
  sources: ['threads', 'google_maps'],
  evidence: [
    { source: 'threads', url: 'https://threads.net/@a/post/1', reason: 'オープン告知' },
    { source: 'google_maps', url: 'https://maps.google.com/?cid=1', reason: 'Google Mapに新規出現' },
  ],
  openingDate: '2026-11-01',
  hpbStatus: 'unknown',
  hpbUrl: null,
  firstSeenAt: '2026-10-17T00:00:00.000Z',
};

describe('LeadTable', () => {
  it('renders one external link per evidence with source label', () => {
    render(<LeadTable leads={[base]} />);
    const threads = screen.getByRole('link', { name: /Threads/ });
    const maps = screen.getByRole('link', { name: /Google Map/ });
    expect(threads).toHaveAttribute('href', 'https://threads.net/@a/post/1');
    expect(threads).toHaveAttribute('target', '_blank');
    expect(maps).toHaveAttribute('target', '_blank');
    expect(maps).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('shows 判定不能 badge for unknown hpb status', () => {
    render(<LeadTable leads={[base]} />);
    expect(screen.getByText('判定不能')).toBeInTheDocument();
  });

  it.each([
    ['listed', '掲載あり'],
    ['not_listed', '未掲載'],
    ['unchecked', '未チェック'],
  ] as const)('labels %s', (status, label) => {
    render(<LeadTable leads={[{ ...base, hpbStatus: status }]} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('shows FUTURE_OPENING badge and empty state', () => {
    const { rerender } = render(<LeadTable leads={[{ ...base, futureOpening: true }]} />);
    expect(screen.getByText('オープン予定')).toBeInTheDocument();
    rerender(<LeadTable leads={[]} />);
    expect(screen.getByText('該当する店舗はありません')).toBeInTheDocument();
    expect(within(document.body).queryByRole('table')).toBeNull();
  });
});
