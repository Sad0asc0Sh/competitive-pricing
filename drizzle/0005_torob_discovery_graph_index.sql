-- ============================================================================
-- 0005_torob_discovery_graph_index.sql — گراف چندکارتهٔ ترب و ایندکس کشف ترکیبی (idempotent)
-- ============================================================================
BEGIN;

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

CREATE TABLE IF NOT EXISTS "torob_catalog_cards" (
  "prk" text PRIMARY KEY,
  "title_fa" text,
  "title_en" text,
  "normalized_title" text NOT NULL,
  "search_document" text NOT NULL,
  "brands" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "models" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "specs" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "canonical_attrs" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "category" text,
  "seller_names" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "seller_titles" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "last_price_toman" integer,
  "reported_seller_count" integer,
  "last_seen_at" timestamp NOT NULL DEFAULT now(),
  "last_verified_at" timestamp,
  "source_provenance" varchar(40) NOT NULL DEFAULT 'torob_mcp'
);

CREATE INDEX IF NOT EXISTS "torob_catalog_cards_norm_idx"
  ON "torob_catalog_cards" ("normalized_title");

CREATE INDEX IF NOT EXISTS "torob_catalog_cards_seen_idx"
  ON "torob_catalog_cards" ("last_seen_at");

CREATE INDEX IF NOT EXISTS "torob_catalog_cards_fts_idx"
  ON "torob_catalog_cards" USING gin (to_tsvector('simple', COALESCE("search_document", '')));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS "torob_catalog_cards_trgm_idx"
      ON "torob_catalog_cards" USING gin ("normalized_title" gin_trgm_ops);
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

CREATE TABLE IF NOT EXISTS "product_torob_links" (
  "id" serial PRIMARY KEY,
  "product_id" integer NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "prk" text NOT NULL,
  "relation_status" varchar(30) NOT NULL DEFAULT 'review_required',
  "identity_score" real,
  "confidence" real,
  "origin" varchar(40) NOT NULL DEFAULT 'auto_discovery',
  "is_primary" boolean NOT NULL DEFAULT false,
  "own_store_present" boolean NOT NULL DEFAULT false,
  "external_competitor_count" integer NOT NULL DEFAULT 0,
  "reported_seller_count" integer,
  "discovering_queries" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "last_reason" text,
  "last_verified_at" timestamp NOT NULL DEFAULT now(),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "product_torob_links_prod_prk_uq"
  ON "product_torob_links" ("product_id", "prk");

CREATE INDEX IF NOT EXISTS "product_torob_links_prod_idx"
  ON "product_torob_links" ("product_id", "is_primary", "external_competitor_count");

COMMIT;
