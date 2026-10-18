import { OPEN_WORDS } from '../config/genres';

const WORDS = OPEN_WORDS.map((w) => w.normalize('NFKC').toLowerCase());

/** True when the text (NFKC, case-insensitive) contains any opening-announcement word. */
export function passesPrefilter(text: string): boolean {
  const t = text.normalize('NFKC').toLowerCase();
  return WORDS.some((w) => t.includes(w));
}
