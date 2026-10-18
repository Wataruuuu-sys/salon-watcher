'use client';
import { useEffect, useState } from 'react';
import { Shell } from '../../components/Shell';
import { fetchThreadsQueries, resetThreadsQueries, saveThreadsQueries } from '../../lib/api';
import type { ThreadsQueriesView } from '../../lib/types';

export default function SettingsPage() {
  const [view, setView] = useState<ThreadsQueriesView | null>(null);
  const [text, setText] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const apply = (v: ThreadsQueriesView) => {
    setView(v);
    setText(v.queries.join('\n'));
  };

  useEffect(() => {
    fetchThreadsQueries()
      .then(apply)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const run = async (op: () => Promise<ThreadsQueriesView>, done: string) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      apply(await op());
      setMessage(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const perDay = view ? Math.round((view.perDay / Math.max(view.queries.length, 1)) * lines.length) : 0;

  return (
    <Shell>
      <h2>Threads 検索ワード</h2>
      <p className="muted">1行に1ワード。{view ? (view.source === 'custom' ? 'カスタム設定を使用中' : '既定値を使用中') : ''}</p>
      <textarea rows={16} value={text} onChange={(e) => setText(e.target.value)} aria-label="検索ワード" />
      {view && (
        <p>
          1日あたり {perDay.toLocaleString('ja-JP')} / {view.quota.toLocaleString('en-US')} クエリ
        </p>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {message && <p className="ok">{message}</p>}
      <div className="actions">
        <button disabled={busy} onClick={() => run(() => saveThreadsQueries(lines), '保存しました')}>
          保存
        </button>
        <button className="secondary" disabled={busy} onClick={() => run(resetThreadsQueries, '既定に戻しました')}>
          既定に戻す
        </button>
      </div>
    </Shell>
  );
}
