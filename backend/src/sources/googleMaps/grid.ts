import { eq } from 'drizzle-orm';
import { TAMA_BBOX } from '../../config/areas.js';
import type { Db } from '../../db/client.js';
import { mapCells } from '../../db/schema.js';
import type { Genre } from '../../domain/types.js';

export interface Cell {
  lat: number;
  lng: number;
  radiusM: number;
}

const M_PER_DEG_LAT = 111320;

/** Search rectangle of a cell (same calculation as v3 cellBounds_). */
export function cellBounds(c: Cell): { low: { lat: number; lng: number }; high: { lat: number; lng: number } } {
  const dLat = c.radiusM / M_PER_DEG_LAT;
  const dLng = c.radiusM / (M_PER_DEG_LAT * Math.cos((c.lat * Math.PI) / 180));
  return {
    low: { lat: c.lat - dLat, lng: c.lng - dLng },
    high: { lat: c.lat + dLat, lng: c.lng + dLng },
  };
}

/** Square lattice of radius-`radiusM` cells (1.5 km pitch for 750) with every center inside the bbox. */
export function baseGrid(bbox = TAMA_BBOX, radiusM = 750): Cell[] {
  const rows = Math.max(1, Math.ceil(((bbox.north - bbox.south) * M_PER_DEG_LAT) / (2 * radiusM)));
  const latStep = (bbox.north - bbox.south) / rows;
  const cells: Cell[] = [];
  for (let i = 0; i < rows; i++) {
    const lat = bbox.south + (i + 0.5) * latStep;
    const mPerDegLng = M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
    const cols = Math.max(1, Math.ceil(((bbox.east - bbox.west) * mPerDegLng) / (2 * radiusM)));
    const lngStep = (bbox.east - bbox.west) / cols;
    for (let j = 0; j < cols; j++) cells.push({ lat, lng: bbox.west + (j + 0.5) * lngStep, radiusM });
  }
  return cells;
}

/**
 * Four quadrant children with half the radius. The radius is rounded up to an integer
 * (map_cells.radius_m is an integer column), which only adds a little overlap.
 */
export function subdivide(c: Cell): [Cell, Cell, Cell, Cell] {
  const radiusM = Math.ceil(c.radiusM / 2);
  const dLat = c.radiusM / 2 / M_PER_DEG_LAT;
  const make = (sLat: number, sLng: number): Cell => {
    const lat = c.lat + sLat * dLat;
    const dLng = c.radiusM / 2 / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
    return { lat, lng: c.lng + sLng * dLng, radiusM };
  };
  return [make(-1, -1), make(-1, 1), make(1, -1), make(1, 1)];
}

/** Inserts the base grid (unseeded) for a genre that has no cells yet. */
export async function ensureCells(db: Db, genre: Genre): Promise<void> {
  const existing = await db.select({ id: mapCells.id }).from(mapCells).where(eq(mapCells.genre, genre)).limit(1);
  if (existing.length > 0) return;
  const grid = baseGrid();
  for (let i = 0; i < grid.length; i += 500) {
    await db.insert(mapCells).values(grid.slice(i, i + 500).map((c) => ({ genre, ...c, seeded: false })));
  }
}
