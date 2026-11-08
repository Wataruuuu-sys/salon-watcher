'use client';
import { useEffect, useState } from 'react';
import { authBypassed, getUserManager } from '../../lib/auth';

export default function CallbackPage() {
  const [error, setError] = useState('');
  useEffect(() => {
    if (authBypassed()) {
      window.location.replace('/');
      return;
    }
    getUserManager()
      .signinRedirectCallback()
      .then(() => window.location.replace('/'))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  return <p className="empty">{error ? `ログインに失敗しました: ${error}` : 'ログイン処理中…'}</p>;
}
