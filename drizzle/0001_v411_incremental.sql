-- ============================================================================
-- 0001_v411_incremental.sql — ارتقای افزایشی و idempotent از ۳.۶ به ۴.۱.۱
-- ----------------------------------------------------------------------------
-- این فایل برخلاف 0000_pricing_v41_upgrade.sql (baseline کامل CREATE TABLE) روی
-- دیتابیس موجود قابل اجراست و چند بار هم که اجرا شود خطا نمی‌دهد.
-- تصمیم‌های قدیمی (پیش از افزودن ستون engine_version) با برچسب 3.6.0 ثبت می‌شوند
-- تا از تصمیم‌های ۴.۱.۱ قابل تفکیک باشند.
--
-- اجرا (ابتدا روی کپی دیتابیس):
--   psql "$DATABASE_URL" -f drizzle/0001_v411_incremental.sql
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------- products
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "replacement_cost" integer;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "replacement_cost_at" timestamp;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "current_campaign_ends_at" timestamp;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "locked_until" timestamp;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "needs_refresh" boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------- price_decisions
-- فقط اگر ستون تازه ساخته شود، ردیف‌های موجود (تصمیم‌های نسخه ۳.۶) برچسب 3.6.0 می‌گیرند.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'price_decisions'
      AND column_name = 'engine_version'
  ) THEN
    ALTER TABLE "price_decisions"
      ADD COLUMN "engine_version" varchar(20) NOT NULL DEFAULT '4.1.1';
    UPDATE "price_decisions" SET "engine_version" = '3.6.0';
  END IF;
END $$;

ALTER TABLE "price_decisions" ADD COLUMN IF NOT EXISTS "market_conflict" boolean NOT NULL DEFAULT false;
ALTER TABLE "price_decisions" ADD COLUMN IF NOT EXISTS "reference_kind" varchar(30);
ALTER TABLE "price_decisions" ADD COLUMN IF NOT EXISTS "floor_confirmed" boolean NOT NULL DEFAULT false;

-- پیش‌فرض نسخه برای تصمیم‌های جدید (حتی اگر ستون از baseline قدیمی با 4.1.0 ساخته شده باشد)
ALTER TABLE "price_decisions" ALTER COLUMN "engine_version" SET DEFAULT '4.1.1';

-- اگر ستون از قبل با پیش‌فرض 4.1.0 وجود داشته، تصمیم‌های pre-4.1.1 با برچسب 3.6.0 تفکیک می‌شوند.
-- (تصمیم‌های 4.1.1 دست‌نخورده می‌مانند؛ اجرای دوباره idempotent است.)
UPDATE "price_decisions" SET "engine_version" = '3.6.0' WHERE "engine_version" = '4.1.0';

-- ---------------------------------------------------------------- ایندکس‌های کمکی نسخه ۴.۱.۱
CREATE INDEX IF NOT EXISTS "decisions_push_recovery_idx"
  ON "price_decisions" ("status", "push_status", "created_at");

COMMIT;
