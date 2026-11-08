import { GENRE_OPTIONS, HPB_LABELS, SOURCE_LABELS } from '../lib/options';
import type { Lead } from '../lib/types';

const genreLabel = (id: string | null) => GENRE_OPTIONS.find((g) => g.id === id)?.label ?? '—';
const day = (iso: string) => new Date(iso).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' });

export function LeadTable({ leads }: { leads: Lead[] }) {
  if (leads.length === 0) return <p className="empty">該当する店舗はありません</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>店名</th>
            <th>ジャンル / 市</th>
            <th>開業日</th>
            <th>HPB</th>
            <th>根拠</th>
            <th>検知日</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((l) => (
            <tr key={l.id}>
              <td>
                <strong>{l.name}</strong>
                {l.futureOpening && <span className="badge badge-future">オープン予定</span>}
              </td>
              <td>
                {genreLabel(l.genre)} / {l.city ?? 'エリア不明'}
              </td>
              <td>{l.openingDate ?? '—'}</td>
              <td>
                <span className={`badge badge-${l.hpbStatus}`}>{HPB_LABELS[l.hpbStatus] ?? l.hpbStatus}</span>
              </td>
              <td>
                <ul className="evidence">
                  {l.evidence.map((e, i) => (
                    <li key={i}>
                      <a href={e.url} target="_blank" rel="noopener noreferrer" title={e.reason}>
                        {SOURCE_LABELS[e.source] ?? e.source}
                      </a>
                    </li>
                  ))}
                </ul>
              </td>
              <td>{day(l.firstSeenAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
