import Link from 'next/link';
import type { ReactNode } from 'react';

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="wrap">
      <header>
        <div>
          <div className="eyebrow">SALON WATCHER</div>
          <h1>新店サロン情報</h1>
        </div>
        <nav>
          <Link href="/">一覧</Link>
          <Link href="/settings/">設定</Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
