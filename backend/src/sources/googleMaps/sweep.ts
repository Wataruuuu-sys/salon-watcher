import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { mapCells, placesSeen } from '../../db/schema.js';
import type { Genre } from '../../domain/types.js';
import { GENRES } from '../../config/genres.js';
import { subdivide, type Cell } from './grid.js';
import type { Logger } from '../../lib/log.js';
import type { PlacesClient } from './places.js';

const BASE_RADIUS_M = 750;
const MAX_PAGES = 3;
const PAGE_SIZE = 20;

export interface SweepResult {
  queried: number;
  newIds: number;
  subdivided: number;
}

interface CellRow extends Cell {
  id: number;
  seeded: boolean;
}

/** Runs tasks with at most `limit` in flight. */
export async function runPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]!);
  };
  // Wait for every worker even if one fails, then surface the first error.
  const settled = await Promise.allSettled(Array.from({ length: Math.min(limit, items.length) }, worker));
  const failed = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed) throw failed.reason;
}

/** Subdivision depth implied by the radius (each level halves 750 m). */
function depthOf(radiusM: number): number {
  return Math.max(0, Math.round(Math.log2(BASE_RADIUS_M / radiusM)));
}

/**
 * Sweeps every active cell of a genre with each of its queries.
 * A (cell, query) that hits the 60-result cap splits the cell into four children, searched in the same run.
 * Ids first seen in a cell that was not yet seeded are recorded as non-candidates (the initial backlog).
 */
export async function sweepGenre(
  db: Db,
  client: PlacesClient,
  genre: Genre,
  opts: { maxSubdivideDepth?: number; concurrency?: number; log?: Logger } = {},
): Promise<SweepResult> {
  const maxDepth = opts.maxSubdivideDepth ?? 3;
  const queries = GENRES.find((g) => g.id === genre)?.mapsQueries ?? [];
  const result: SweepResult = { queried: 0, newIds: 0, subdivided: 0 };
  const searched = new Map<number, { seeded: boolean; count: number }>();
  let attempts = 0;
  let failures = 0;

  /** All pages for one query. `saturated` = the 60-result cap was reached. */
  async function searchAll(query: string, cell: Cell): Promise<{ ids: string[]; saturated: boolean }> {
    const ids: string[] = [];
    let token: string | undefined;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const r = await client.searchIds(query, cell, token);
      result.queried++;
      ids.push(...r.ids);
      token = r.nextPageToken;
      if (!token) return { ids, saturated: page === MAX_PAGES && r.ids.length >= PAGE_SIZE };
    }
    return { ids, saturated: true }; // token still present after the last page
  }

  async function recordIds(ids: string[], seeded: boolean): Promise<void> {
    if (ids.length === 0) return;
    const inserted = await db
      .insert(placesSeen)
      .values(ids.map((placeId) => ({ placeId, genre, isLeadCandidate: seeded })))
      .onConflictDoNothing()
      .returning({ placeId: placesSeen.placeId });
    result.newIds += inserted.length;
  }

  async function sweepCell(cell: CellRow): Promise<void> {
    const found = new Set<string>();
    let saturated = false;
    let failed = false;
    for (const q of queries) {
      attempts++;
      try {
        const r = await searchAll(q, cell);
        r.ids.forEach((id) => found.add(id));
        saturated ||= r.saturated;
      } catch (err) {
        failed = true;
        failures++;
        opts.log?.warn('maps search failed', { genre, cellId: cell.id, query: q, error: String(err) });
      }
    }
    if (failed) {
      // Partial data: keep what was found, but do not mark seeded or subdivide.
      await recordIds([...found], cell.seeded);
      return;
    }
    searched.set(cell.id, { seeded: cell.seeded, count: found.size });
    await recordIds([...found], cell.seeded);

    if (saturated && depthOf(cell.radiusM) < maxDepth) {
      result.subdivided++;
      await db.update(mapCells).set({ active: false }).where(eq(mapCells.id, cell.id));
      const kids = await db
        .insert(mapCells)
        .values(subdivide(cell).map((k) => ({ genre, ...k, parentId: cell.id, seeded: false })))
        .returning();
      for (const k of kids) await sweepCell({ id: k.id, lat: k.lat, lng: k.lng, radiusM: k.radiusM, seeded: false });
    }
  }

  const active = await db
    .select()
    .from(mapCells)
    .where(and(eq(mapCells.genre, genre), eq(mapCells.active, true)))
    .orderBy(asc(mapCells.id));
  await runPool(active, opts.concurrency ?? 10, (c) =>
    sweepCell({ id: c.id, lat: c.lat, lng: c.lng, radiusM: c.radiusM, seeded: c.seeded }),
  );

  if (attempts > 0 && failures === attempts) {
    // Total outage (bad key, quota): fail the shard so the alarm fires.
    throw new Error(`every maps search failed for ${genre} (${attempts} searches)`);
  }

  const now = new Date();
  for (const [id, s] of searched) {
    await db.update(mapCells).set({ seeded: true, lastCount: s.count, lastRunAt: now }).where(eq(mapCells.id, id));
  }
  return result;
}
