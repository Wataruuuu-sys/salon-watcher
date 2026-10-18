// Duplicated from backend config on purpose: web must not import backend code.
export const GENRE_OPTIONS: { id: string; label: string }[] = [
  { id: 'hair', label: 'ヘア' },
  { id: 'nail', label: 'ネイル' },
  { id: 'eye', label: 'アイ' },
  { id: 'relax', label: 'リラクゼーション' },
  { id: 'esthe', label: 'エステ' },
  { id: 'seitai', label: '整体' },
];

export const CITY_OPTIONS: string[] = [
  '八王子市', '立川市', '武蔵野市', '三鷹市', '青梅市', '府中市', '昭島市', '調布市', '町田市',
  '小金井市', '小平市', '日野市', '東村山市', '国分寺市', '国立市', '福生市', '狛江市',
  '東大和市', '清瀬市', '東久留米市', '武蔵村山市', '多摩市', '稲城市', '羽村市',
  'あきる野市', '西東京市',
];

export const SOURCE_LABELS: Record<string, string> = { threads: 'Threads', google_maps: 'Google Map' };

export const HPB_LABELS: Record<string, string> = {
  listed: '掲載あり',
  not_listed: '未掲載',
  unknown: '判定不能',
  unchecked: '未チェック',
};
