import { describe, expect, it } from 'vitest';
import { placesClient } from '../../../src/sources/googleMaps/places.js';

const cell = { lat: 35.7, lng: 139.4, radiusM: 750 };
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('placesClient', () => {
  it('searchIds sends the v3 request shape and returns ids + token', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const http = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return json(200, { places: [{ id: 'a' }, { id: 'b' }], nextPageToken: 't2' });
    }) as unknown as typeof fetch;
    const r = await placesClient('KEY', http).searchIds('美容院', cell, 'tok');
    expect(r).toEqual({ ids: ['a', 'b'], nextPageToken: 't2' });
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body).toMatchObject({
      textQuery: '美容院', languageCode: 'ja', pageSize: 20,
      includeFutureOpeningBusinesses: true, rankPreference: 'DISTANCE', pageToken: 'tok',
    });
    expect(body.locationRestriction.rectangle.low.latitude).toBeLessThan(35.7);
    const h = calls[0]!.init.headers as Record<string, string>;
    expect(h['X-Goog-FieldMask']).toBe('places.id,nextPageToken');
    expect(h['X-Goog-Api-Key']).toBe('KEY');
  });

  it('retries 429 with backoff up to 3 times', async () => {
    let n = 0;
    const http = (async () => (++n <= 3 ? json(429, {}) : json(200, { places: [{ id: 'x' }] }))) as unknown as typeof fetch;
    const r = await placesClient('K', http, { backoffMs: 1 }).searchIds('q', cell);
    expect(r.ids).toEqual(['x']);
    expect(n).toBe(4);
    n = -10;
    await expect(placesClient('K', http, { backoffMs: 1 }).searchIds('q', cell)).rejects.toThrow(/429/);
  });

  it('details maps fields and falls back without openingDate on 400', async () => {
    const masks: string[] = [];
    const http = (async (_u: string, init: RequestInit) => {
      const mask = (init.headers as Record<string, string>)['X-Goog-FieldMask']!;
      masks.push(mask);
      if (mask.includes('openingDate')) return json(400, {});
      return json(200, {
        id: 'p', displayName: { text: 'Salon' }, formattedAddress: '東京都立川市1',
        googleMapsUri: 'https://maps/p', businessStatus: 'OPERATIONAL', types: ['hair_care'],
      });
    }) as unknown as typeof fetch;
    const d = await placesClient('K', http).details('p');
    expect(d).toEqual({
      id: 'p', name: 'Salon', address: '東京都立川市1', mapsUrl: 'https://maps/p',
      businessStatus: 'OPERATIONAL', openingDate: null, types: ['hair_care'],
    });
    expect(masks).toHaveLength(2);
  });

  it('details formats openingDate and returns null on failure', async () => {
    const ok = (async () =>
      json(200, { id: 'p', displayName: { text: 'S' }, openingDate: { year: 2026, month: 11, day: 3 } })) as unknown as typeof fetch;
    expect((await placesClient('K', ok).details('p'))?.openingDate).toBe('2026-11-03');
    const bad = (async () => json(404, {})) as unknown as typeof fetch;
    expect(await placesClient('K', bad).details('p')).toBeNull();
  });
});
