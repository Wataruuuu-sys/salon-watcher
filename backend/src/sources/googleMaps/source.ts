import { and, asc, eq } from 'drizzle-orm';
import { cityFromAddress } from '../../config/areas.js';
import { GENRES } from '../../config/genres.js';
import { placesSeen } from '../../db/schema.js';
import type { Genre, RawItemInput } from '../../domain/types.js';
import type { Source, SourceContext } from '../types.js';
import { ensureCells } from './grid.js';
import { placesClient, type PlacesClient } from './places.js';
import { sweepGenre } from './sweep.js';

const DEFAULT_DETAILS_PER_RUN = 25;

function detailsPerRun(): number {
  const n = Number(process.env.MAPS_DETAILS_PER_RUN);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_DETAILS_PER_RUN;
}

type MakeClient = (apiKey: string, http: typeof fetch) => PlacesClient;

export function createGoogleMapsSource(makeClient: MakeClient = placesClient): Source {
  return {
    id: 'google_maps',
    async listShards() {
      return GENRES.map((g) => g.id);
    },
    async collect(shard: string, ctx: SourceContext): Promise<RawItemInput[]> {
      const genre = shard as Genre;
      const client = makeClient(await ctx.secrets.get('PLACES_API_KEY'), ctx.http);

      await ensureCells(ctx.db, genre);
      const sweep = await sweepGenre(ctx.db, client, genre);
      ctx.log.info('maps sweep done', { genre, ...sweep });

      const pending = await ctx.db
        .select({ placeId: placesSeen.placeId })
        .from(placesSeen)
        .where(and(eq(placesSeen.genre, genre), eq(placesSeen.isLeadCandidate, true), eq(placesSeen.detailsFetched, false)))
        .orderBy(asc(placesSeen.firstSeenAt), asc(placesSeen.placeId))
        .limit(detailsPerRun());

      const items: RawItemInput[] = [];
      for (const { placeId } of pending) {
        const d = await client.details(placeId);
        if (!d) continue; // retried next run
        await ctx.db.update(placesSeen).set({ detailsFetched: true }).where(eq(placesSeen.placeId, placeId));
        const city = cityFromAddress(d.address);
        if (d.businessStatus === 'CLOSED_PERMANENTLY' || city === null) continue;
        items.push({
          source: 'google_maps',
          externalId: placeId,
          url: d.mapsUrl,
          authorHandle: null,
          text: `${d.name} ${d.address}`,
          postedAt: null,
          payload: d,
          placeId,
          preclassified: {
            verdict: 'yes',
            storeName: d.name,
            genre,
            city,
            openingDate: d.openingDate,
            reason: 'Google Mapに新規出現',
            signals: d.businessStatus === 'FUTURE_OPENING' ? ['FUTURE_OPENING'] : [],
          },
        });
      }
      return items;
    },
  };
}

export const googleMapsSource: Source = createGoogleMapsSource();
