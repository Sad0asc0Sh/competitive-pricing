BEGIN;

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "torob_link_confirmation" jsonb;

ALTER TABLE "competitor_offers"
  ADD COLUMN IF NOT EXISTS "torob_evidence" jsonb;

COMMIT;
