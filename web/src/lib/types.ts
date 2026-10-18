export type SourceId = 'google_maps' | 'threads';
export type HpbStatus = 'unchecked' | 'listed' | 'not_listed' | 'unknown';

export interface Lead {
  id: number;
  name: string;
  genre: string | null;
  city: string | null;
  confidence: 'yes' | 'map' | 'maybe';
  sources: SourceId[];
  evidence: { source: SourceId; url: string; reason: string }[];
  openingDate: string | null;
  hpbStatus: HpbStatus;
  hpbUrl: string | null;
  firstSeenAt: string;
  futureOpening?: boolean;
}

export interface ThreadsQueriesView {
  queries: string[];
  source: 'default' | 'custom';
  perDay: number;
  quota: number;
}
