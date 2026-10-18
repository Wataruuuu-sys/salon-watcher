import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { TAMA_BBOX } from '../../../src/config/areas.js';
import { baseGrid, cellBounds, ensureCells, subdivide } from '../../../src/sources/googleMaps/grid.js';
import { mapCells } from '../../../src/db/schema.js';
import { getTestDb, resetDb } from '../../helpers/db.js';

describe('grid', () => {
  it('subdivide halves the radius and the children tile the parent bounds', () => {
    const parent = { lat: 35.7, lng: 139.4, radiusM: 600 };
    const kids = subdivide(parent);
    expect(kids).toHaveLength(4);
    kids.forEach((k) => expect(k.radiusM).toBe(300));
    const pb = cellBounds(parent);
    const bs = kids.map(cellBounds);
    const tol = 1e-4;
    expect(Math.min(...bs.map((b) => b.low.lat))).toBeCloseTo(pb.low.lat, 4);
    expect(Math.max(...bs.map((b) => b.high.lat))).toBeCloseTo(pb.high.lat, 4);
    expect(Math.abs(Math.min(...bs.map((b) => b.low.lng)) - pb.low.lng)).toBeLessThan(tol);
    expect(Math.abs(Math.max(...bs.map((b) => b.high.lng)) - pb.high.lng)).toBeLessThan(tol);
  });

  it('cellBounds matches the v3 formula', () => {
    const b = cellBounds({ lat: 35.7, lng: 139.4, radiusM: 1113.2 });
    expect(b.high.lat - 35.7).toBeCloseTo(0.01, 6);
    expect(b.low.lat).toBeCloseTo(35.69, 6);
  });

  it('baseGrid centers are all inside TAMA_BBOX', () => {
    const cells = baseGrid();
    expect(cells.length).toBeGreaterThan(100);
    for (const c of cells) {
      expect(c.radiusM).toBe(750);
      expect(c.lat).toBeGreaterThanOrEqual(TAMA_BBOX.south);
      expect(c.lat).toBeLessThanOrEqual(TAMA_BBOX.north);
      expect(c.lng).toBeGreaterThanOrEqual(TAMA_BBOX.west);
      expect(c.lng).toBeLessThanOrEqual(TAMA_BBOX.east);
    }
  });

  it('TAMA_BBOX covers 町田 south and 青梅 north edges', () => {
    expect(TAMA_BBOX).toEqual({ south: 35.49, north: 35.87, west: 139.02, east: 139.62 });
  });

  it.each([
    ['町田駅', 35.5424, 139.4466],
    ['青梅駅', 35.7907, 139.2583],
  ])('%s is inside some baseGrid cell bounds', (_name, lat, lng) => {
    const inside = baseGrid().some((c) => {
      const b = cellBounds(c);
      return lat >= b.low.lat && lat <= b.high.lat && lng >= b.low.lng && lng <= b.high.lng;
    });
    expect(inside).toBe(true);
  });

  describe('ensureCells', () => {
    beforeEach(async () => resetDb(await getTestDb()));

    it('seeds the base grid once per genre, unseeded', async () => {
      const db = await getTestDb();
      await ensureCells(db, 'hair');
      await ensureCells(db, 'hair');
      const rows = await db.select().from(mapCells).where(eq(mapCells.genre, 'hair'));
      expect(rows).toHaveLength(baseGrid().length);
      expect(rows.every((r) => !r.seeded && r.active)).toBe(true);
      await ensureCells(db, 'nail');
      expect(await db.select().from(mapCells).where(eq(mapCells.genre, 'nail'))).toHaveLength(rows.length);
    });
  });
});
