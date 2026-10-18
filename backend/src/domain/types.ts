export type Genre = 'hair' | 'nail' | 'eye' | 'relax' | 'esthe' | 'seitai';
export type SourceId = 'google_maps' | 'threads';
export type Verdict = 'yes' | 'maybe' | 'no';
/** Strongest first: yes > map > maybe. */
export type Confidence = 'yes' | 'map' | 'maybe';
export type HpbStatus = 'unchecked' | 'listed' | 'not_listed' | 'unknown';

export interface Classification {
  verdict: Verdict;
  storeName: string | null;
  genre: Genre | null;
  city: string | null;
  openingDate: string | null;
  reason: string;
  signals: string[];
}

export interface RawItemInput {
  source: SourceId;
  externalId: string;
  url: string;
  authorHandle: string | null;
  text: string;
  postedAt: Date | null;
  payload: unknown;
  placeId?: string;
  /** Map-derived items skip the LLM. */
  preclassified?: Classification;
}
