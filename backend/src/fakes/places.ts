import { and, eq } from 'drizzle-orm';
import { mapCells } from '../db/schema.js';
import type { Genre } from '../domain/types.js';
import { createGoogleMapsSource } from '../sources/googleMaps/source.js';
import type { PlaceDetails, PlacesClient } from '../sources/googleMaps/places.js';
import type { Source } from '../sources/types.js';

export const FAKE_PLACES: Record<string, PlaceDetails> = {
  'fake-place-lily': {
    id: 'fake-place-lily',
    name: 'ネイルサロン Lily',
    address: '東京都立川市曙町2丁目',
    mapsUrl: 'https://www.google.com/maps/place/?q=place_id:fake-place-lily',
    businessStatus: 'FUTURE_OPENING',
    openingDate: null,
    types: ['beauty_salon'],
  },
  'fake-place-hpb': {
    id: 'fake-place-hpb',
    name: 'Hair Salon Sakura',
    address: '東京都八王子市旭町',
    mapsUrl: 'https://www.google.com/maps/place/?q=place_id:fake-place-hpb',
    businessStatus: 'FUTURE_OPENING',
    openingDate: null,
    types: ['hair_care'],
  },
};

const ID_BY_GENRE: Partial<Record<Genre, string>> = { nail: 'fake-place-lily', hair: 'fake-place-hpb' };

/**
 * `surface` = a sweep of this genre already finished, so new ids count as lead candidates.
 * Only the first search call of a client returns an id (one cell), keeping the sweep over all cells cheap.
 */
export function fakePlacesClient(genre: Genre, surface: boolean): PlacesClient {
  let served = false;
  return {
    async searchIds() {
      const id = ID_BY_GENRE[genre];
      if (!surface || served || !id) return { ids: [] };
      served = true;
      return { ids: [id] };
    },
    async details(placeId) {
      return FAKE_PLACES[placeId] ?? null;
    },
  };
}

/**
 * google_maps source on fake Places. The first sweep seeds the (empty) backlog; the fake ids appear only
 * once a cell of the genre is marked seeded, so they become real leads on a later sweep, even across processes.
 */
export function createFakeGoogleMapsSource(): Source {
  return {
    id: 'google_maps',
    listShards: (ctx) => createGoogleMapsSource().listShards(ctx),
    async collect(shard, ctx) {
      const genre = shard as Genre;
      const seeded = await ctx.db
        .select({ id: mapCells.id })
        .from(mapCells)
        .where(and(eq(mapCells.genre, genre), eq(mapCells.seeded, true)))
        .limit(1);
      return createGoogleMapsSource(() => fakePlacesClient(genre, seeded.length > 0)).collect(shard, ctx);
    },
  };
}
