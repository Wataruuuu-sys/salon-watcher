/** Generic words stripped from the start/end of a name. Longer words first so e.g. エステサロン wins over サロン. */
const GENERIC_WORDS = [
  'ネイルサロン',
  'エステサロン',
  'nailsalon',
  'hairsalon',
  'ヘアサロン',
  'アイラッシュ',
  'eyelash',
  '美容室',
  '美容院',
  'サロン',
  'salon',
].sort((a, b) => b.length - a.length);

/** Trailing branch suffix: 1-6 Han/Katakana/Hiragana chars (or the long-vowel mark) + 店. */
const BRANCH_SUFFIX = /[\p{Script=Han}\p{Script=Katakana}\p{Script=Hiragana}ー]{1,6}店$/u;

function stripGenericWords(value: string): string {
  let current = value;
  for (;;) {
    let next = current;
    for (const word of GENERIC_WORDS) {
      if (next.startsWith(word)) next = next.slice(word.length);
      else if (next.endsWith(word)) next = next.slice(0, -word.length);
      else continue;
      break;
    }
    // Never strip down to nothing: keep the previous value.
    if (next === current || next === '') return current;
    current = next;
  }
}

/** Normalize a store name for cross-source matching. */
export function normalizeName(name: string): string {
  const base = name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}\p{Z}\s]/gu, '');
  const stripped = stripGenericWords(base);
  const withoutBranch = stripped.replace(BRANCH_SUFFIX, '');
  return withoutBranch === '' ? stripped : withoutBranch;
}
