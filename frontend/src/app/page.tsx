'use client';
import { useEffect, useState } from 'react';
import { LeadTable } from '../components/LeadTable';
import { Shell } from '../components/Shell';
import { fetchLeads, type LeadFilters } from '../lib/api';
import { CITY_OPTIONS, GENRE_OPTIONS, SOURCE_LABELS } from '../lib/options';
import type { Lead } from '../lib/types';

const INITIAL: LeadFilters = { tab: 'main', genre: '', city: '', source: '', hpb: '', days: '7' };

export default function HomePage() {
  const [filters, setFilters] = useState<LeadFilters>(INITIAL);
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLeads(null);
    setError('');
    fetchLeads(filters)
      .then((r) => !cancelled && setLeads(r))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [filters]);

  const set = (k: keyof LeadFilters) => (e: { target: { value: string } }) => setFilters({ ...filters, [k]: e.target.value });

  return (
    <Shell>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={filters.tab === 'main'} onClick={() => setFilters({ ...filters, tab: 'main' })}>
          新店
        </button>
        <button role="tab" aria-selected={filters.tab === 'maybe'} onClick={() => setFilters({ ...filters, tab: 'maybe' })}>
          要確認
        </button>
      </div>
      <div className="filters">
        <label>
          ジャンル
          <select value={filters.genre} onChange={set('genre')}>
            <option value="">すべて</option>
            {GENRE_OPTIONS.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          市
          <select value={filters.city} onChange={set('city')}>
            <option value="">すべて</option>
            {CITY_OPTIONS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          媒体
          <select value={filters.source} onChange={set('source')}>
            <option value="">すべて</option>
            {Object.entries(SOURCE_LABELS).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          HPB
          <select value={filters.hpb} onChange={set('hpb')}>
            <option value="">掲載ありを除く</option>
            <option value="all">すべて</option>
            <option value="not_listed">未掲載</option>
            <option value="unknown">判定不能</option>
            <option value="unchecked">未チェック</option>
          </select>
        </label>
        <label>
          期間
          <select value={filters.days} onChange={set('days')}>
            <option value="1">1日</option>
            <option value="7">7日</option>
            <option value="30">30日</option>
            <option value="90">90日</option>
          </select>
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      {!error && leads === null && <p className="empty">読み込み中…</p>}
      {leads && <LeadTable leads={leads} />}
    </Shell>
  );
}
