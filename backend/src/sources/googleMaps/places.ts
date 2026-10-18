import { cellBounds, type Cell } from './grid.js';

export interface PlaceDetails {
  id: string;
  name: string;
  address: string;
  mapsUrl: string;
  businessStatus: string;
  openingDate: string | null;
  types: string[];
}

export interface PlacesClient {
  searchIds(query: string, cell: Cell, pageToken?: string): Promise<{ ids: string[]; nextPageToken?: string }>;
  details(placeId: string): Promise<PlaceDetails | null>;
}

const BASE = 'https://places.googleapis.com/v1';
const DETAIL_FIELDS = 'id,displayName,formattedAddress,googleMapsUri,businessStatus,types';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ApiPlace {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  googleMapsUri?: string;
  businessStatus?: string;
  openingDate?: { year?: number; month?: number; day?: number };
  types?: string[];
}

function formatOpeningDate(d: ApiPlace['openingDate']): string | null {
  if (!d?.year) return null;
  const mm = String(d.month || 1).padStart(2, '0');
  const dd = String(d.day || 1).padStart(2, '0');
  return `${d.year}-${mm}-${dd}`;
}

export function placesClient(apiKey: string, http: typeof fetch, opts: { backoffMs?: number } = {}): PlacesClient {
  const backoffMs = opts.backoffMs ?? 500;

  /** fetch with exponential backoff on HTTP 429 (3 retries). */
  async function call(url: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const res = await http(url, init);
      if (res.status !== 429 || attempt >= 3) return res;
      await sleep(backoffMs * 2 ** attempt);
    }
  }

  return {
    async searchIds(query, cell, pageToken) {
      const b = cellBounds(cell);
      const body: Record<string, unknown> = {
        textQuery: query,
        languageCode: 'ja',
        pageSize: 20,
        includeFutureOpeningBusinesses: true,
        rankPreference: 'DISTANCE',
        locationRestriction: {
          rectangle: {
            low: { latitude: b.low.lat, longitude: b.low.lng },
            high: { latitude: b.high.lat, longitude: b.high.lng },
          },
        },
      };
      if (pageToken) body.pageToken = pageToken;
      const res = await call(`${BASE}/places:searchText`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          // IDs-only SKU: do not add fields here.
          'X-Goog-FieldMask': 'places.id,nextPageToken',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`places search failed: HTTP ${res.status}`);
      const data = (await res.json()) as { places?: { id: string }[]; nextPageToken?: string };
      return { ids: (data.places ?? []).map((p) => p.id), nextPageToken: data.nextPageToken || undefined };
    },

    async details(placeId) {
      // openingDate may be rejected with 400 on some setups: retry without it.
      for (const mask of [`${DETAIL_FIELDS},openingDate`, DETAIL_FIELDS]) {
        const res = await call(`${BASE}/places/${encodeURIComponent(placeId)}?languageCode=ja`, {
          headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': mask },
        });
        if (res.ok) {
          const p = (await res.json()) as ApiPlace;
          const id = p.id ?? placeId;
          return {
            id,
            name: p.displayName?.text ?? '',
            address: p.formattedAddress ?? '',
            mapsUrl: p.googleMapsUri || `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(id)}`,
            businessStatus: p.businessStatus ?? '',
            openingDate: formatOpeningDate(p.openingDate),
            types: p.types ?? [],
          };
        }
        if (res.status !== 400) return null;
      }
      return null;
    },
  };
}
