import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

export const rawItems = pgTable(
  'raw_items',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    source: text('source').notNull(),
    externalId: text('external_id').notNull(),
    url: text('url').notNull(),
    authorHandle: text('author_handle'),
    text: text('text').notNull(),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    payload: jsonb('payload').notNull(),
    placeId: text('place_id'),
    preclassified: jsonb('preclassified'),
    classification: jsonb('classification'),
    status: text('status', { enum: ['pending', 'resolved', 'rejected'] })
      .notNull()
      .default('pending'),
    attempts: integer('attempts').notNull().default(0),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('raw_items_source_external_id_uq').on(t.source, t.externalId),
    index('raw_items_status_idx').on(t.status),
  ],
);

export const stores = pgTable(
  'stores',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    name: text('name').notNull(),
    nameNorm: text('name_norm').notNull(),
    genre: text('genre'),
    city: text('city'),
    placeId: text('place_id').unique(),
    /** Format: `threads:<username>` */
    snsHandle: text('sns_handle').unique(),
    confidence: text('confidence').notNull(),
    openingDate: text('opening_date'),
    hpbStatus: text('hpb_status').notNull().default('unchecked'),
    hpbUrl: text('hpb_url'),
    hpbCheckedAt: timestamp('hpb_checked_at', { withTimezone: true }),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
  },
  (t) => [index('stores_name_norm_trgm_idx').using('gin', sql`${t.nameNorm} gin_trgm_ops`)],
);

export const evidence = pgTable('evidence', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  storeId: bigint('store_id', { mode: 'number' })
    .notNull()
    .references(() => stores.id),
  rawItemId: bigint('raw_item_id', { mode: 'number' })
    .notNull()
    .unique()
    .references(() => rawItems.id),
  source: text('source').notNull(),
  url: text('url').notNull(),
  confidence: text('confidence').notNull(),
  reason: text('reason').notNull(),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
});

export const placesSeen = pgTable('places_seen', {
  placeId: text('place_id').primaryKey(),
  genre: text('genre').notNull(),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  detailsFetched: boolean('details_fetched').notNull().default(false),
  isLeadCandidate: boolean('is_lead_candidate').notNull().default(false),
});

export const mapCells = pgTable(
  'map_cells',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    genre: text('genre').notNull(),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    radiusM: integer('radius_m').notNull(),
    parentId: bigint('parent_id', { mode: 'number' }),
    seeded: boolean('seeded').notNull().default(false),
    active: boolean('active').notNull().default(true),
    lastCount: integer('last_count'),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  },
  (t) => [index('map_cells_genre_active_idx').on(t.genre, t.active)],
);

/** User-editable settings. Phase 1 uses only the key `threads.queries`. */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by'),
});
