export const TAMA_CITIES: readonly string[] = [
  '八王子市', '立川市', '武蔵野市', '三鷹市', '青梅市', '府中市', '昭島市', '調布市', '町田市',
  '小金井市', '小平市', '日野市', '東村山市', '国分寺市', '国立市', '福生市', '狛江市',
  '東大和市', '清瀬市', '東久留米市', '武蔵村山市', '多摩市', '稲城市', '羽村市',
  'あきる野市', '西東京市',
];

export const TAMA_BBOX = { south: 35.57, north: 35.84, west: 139.02, east: 139.60 };

const CITIES_LONGEST_FIRST = [...TAMA_CITIES].sort((a, b) => b.length - a.length);

/** Returns the Tama city in a Tokyo address, or null (other prefectures' same-named cities are rejected). */
export function cityFromAddress(address: string): string | null {
  const idx = address.indexOf('東京都');
  if (idx < 0) return null;
  const rest = address.slice(idx + '東京都'.length);
  return CITIES_LONGEST_FIRST.find((c) => rest.includes(c)) ?? null;
}
