import type { Genre } from '../domain/types';

export const GENRES: { id: Genre; label: string; mapsQueries: string[]; threadsWords: string[] }[] = [
  { id: 'hair', label: 'ヘア', mapsQueries: ['美容院'], threadsWords: ['美容室'] },
  { id: 'nail', label: 'ネイル', mapsQueries: ['ネイルサロン'], threadsWords: ['ネイル'] },
  { id: 'eye', label: 'アイ', mapsQueries: ['マツエク', '眉毛サロン'], threadsWords: ['マツエク'] },
  { id: 'relax', label: 'リラクゼーション', mapsQueries: ['リラクゼーションサロン'], threadsWords: ['リラク'] },
  { id: 'esthe', label: 'エステ', mapsQueries: ['エステサロン'], threadsWords: ['エステ'] },
  { id: 'seitai', label: '整体', mapsQueries: ['整体'], threadsWords: ['整体'] },
];

/** Words used by the prefilter to detect opening announcements. */
export const OPEN_WORDS = [
  'オープン', 'OPEN', '新店', '開業', 'グランドオープン', 'プレオープン', 'NEW OPEN',
  '開店', '開院', '移転', 'リニューアル', 'オープン予定',
];
