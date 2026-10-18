CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"store_id" bigint NOT NULL,
	"raw_item_id" bigint NOT NULL,
	"source" text NOT NULL,
	"url" text NOT NULL,
	"confidence" text NOT NULL,
	"reason" text NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_raw_item_id_unique" UNIQUE("raw_item_id")
);
--> statement-breakpoint
CREATE TABLE "map_cells" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"genre" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"radius_m" integer NOT NULL,
	"parent_id" bigint,
	"seeded" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_count" integer,
	"last_run_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "places_seen" (
	"place_id" text PRIMARY KEY NOT NULL,
	"genre" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"details_fetched" boolean DEFAULT false NOT NULL,
	"is_lead_candidate" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"url" text NOT NULL,
	"author_handle" text,
	"text" text NOT NULL,
	"posted_at" timestamp with time zone,
	"payload" jsonb NOT NULL,
	"place_id" text,
	"preclassified" jsonb,
	"classification" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "raw_items_source_external_id_uq" UNIQUE("source","external_id")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_norm" text NOT NULL,
	"genre" text,
	"city" text,
	"place_id" text,
	"sns_handle" text,
	"confidence" text NOT NULL,
	"opening_date" text,
	"hpb_status" text DEFAULT 'unchecked' NOT NULL,
	"hpb_url" text,
	"hpb_checked_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone,
	CONSTRAINT "stores_place_id_unique" UNIQUE("place_id"),
	CONSTRAINT "stores_sns_handle_unique" UNIQUE("sns_handle")
);
--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_raw_item_id_raw_items_id_fk" FOREIGN KEY ("raw_item_id") REFERENCES "public"."raw_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "map_cells_genre_active_idx" ON "map_cells" USING btree ("genre","active");--> statement-breakpoint
CREATE INDEX "raw_items_status_idx" ON "raw_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "stores_name_norm_trgm_idx" ON "stores" USING gin ("name_norm" gin_trgm_ops);