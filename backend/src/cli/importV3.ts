import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createDb, type Db } from '../db/client.js';
import { placesSeen } from '../db/schema.js';

const CHUNK_SIZE = 1000;

type PlaceRow = typeof placesSeen.$inferInsert;

/**
 * Imports the v3 `known_places` sheet (CSV with header `place_id,first_seen`)
 * into `places_seen`. Rows already present are left untouched.
 */
export async function importKnownPlaces(db: Db, csv: string): Promise<{ inserted: number }> {
  const rows = parseKnownPlacesCsv(csv);

  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const result = await db
      .insert(placesSeen)
      .values(chunk)
      .onConflictDoNothing()
      .returning({ placeId: placesSeen.placeId });
    inserted += result.length;
  }
  return { inserted };
}

function parseKnownPlacesCsv(csv: string): PlaceRow[] {
  const now = new Date();
  const rowsById = new Map<string, PlaceRow>();

  for (const rawLine of csv.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '') continue;

    const [rawPlaceId = '', rawFirstSeen = ''] = line.split(',');
    const placeId = rawPlaceId.trim();
    if (placeId === '' || placeId === 'place_id') continue;

    // Duplicate ids within one INSERT would make Postgres fail; keep the first occurrence.
    if (rowsById.has(placeId)) continue;

    const parsed = new Date(rawFirstSeen.trim());
    rowsById.set(placeId, {
      placeId,
      genre: 'unknown',
      firstSeenAt: Number.isNaN(parsed.getTime()) ? now : parsed,
      detailsFetched: true,
      isLeadCandidate: false,
    });
  }

  return [...rowsById.values()];
}

async function main(): Promise<void> {
  const csvPath = process.argv[2];
  const databaseUrl = process.env.DATABASE_URL;
  if (!csvPath) {
    console.error('usage: npm -w backend run import-v3 -- <known_places.csv>');
    process.exit(1);
  }
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  const csv = await readFile(csvPath, 'utf8');
  const db = createDb(databaseUrl);
  const { inserted } = await importKnownPlaces(db, csv);
  console.log(JSON.stringify({ inserted }));
  // createDb does not expose a close handle, so exit explicitly.
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
