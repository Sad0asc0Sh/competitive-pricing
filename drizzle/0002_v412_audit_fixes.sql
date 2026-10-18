-- ============================================================================
-- 0002_v412_audit_fixes.sql — اصلاحات ممیزی ۴.۱.۲ (idempotent)
-- ----------------------------------------------------------------------------
-- ۱) رتبه‌ی گزارش‌شده با احتساب فروشنده‌های مشکوک/کهنه را به ستون تبدیل می‌کند تا
--    رابط بازبینی هر دو رتبه را نشان دهد (N5). تصمیم‌های قدیمی از steps خوانده می‌شوند.
-- ۲) ایندکس بازیابی push را در دیتابیس تضمین می‌کند؛ همین ایندکس در schema.ts هم
--    تعریف شده تا drizzle-kit push آن را drift گزارش نکند (N3).
-- ۳) برچسب‌گذاری 4.1.0 → 3.6.0 فقط با اجازه‌ی صریح اپراتور انجام می‌شود (N3):
--      SET pricing.relabel_410 = 'on';
--      \i drizzle/0002_v412_audit_fixes.sql
--    اگر 4.1.0 هرگز در تولید اجرا نشده، نیازی به این کار نیست.
--
-- اجرا (ابتدا روی کپی دیتابیس):
--   psql "$DATABASE_URL" -f drizzle/0002_v412_audit_fixes.sql
-- یا با اجراکننده‌ی قابل‌تطبیق:
--   node scripts/migrate.cjs --file 0002_v412_audit_fixes.sql
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------- رتبه‌ها (N5)
ALTER TABLE "price_decisions"
  ADD COLUMN IF NOT EXISTS "rank_including_suspect" integer;
ALTER TABLE "price_decisions"
  ADD COLUMN IF NOT EXISTS "total_sellers_including_suspect" integer NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------- ایندکس (N3)
CREATE INDEX IF NOT EXISTS "decisions_push_recovery_idx"
  ON "price_decisions" ("status", "push_status", "created_at");

-- ---------------------------------------------------------------- relabel opt-in (N3)
DO $$
BEGIN
  IF current_setting('pricing.relabel_410', true) = 'on' THEN
    UPDATE "price_decisions" SET "engine_version" = '3.6.0' WHERE "engine_version" = '4.1.0';
  END IF;
END $$;

COMMIT;
