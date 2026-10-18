# ممیزی نهایی ۴.۱.۲ — بستن N1 تا N5 با تنظیمات قابل تطبیق

> **مبنا:** کد موجود در `D:\project\ai-driven-competitive-pricing-system` و `D:\project\sgeooole\ekgkala-backend` (نسخه‌ی ۴.۱.۱ + اصلاحات این دور).
> **روش:** بازبینی کد، اجرای typecheck، اجرای کامل تست‌ها، شبیه‌سازی مستقیم توابع، و ساخت تست‌های رگرسیون برای هر ایراد.
> **برچسب‌ها:** ✅ اصلاح و تست‌شده، ⚙️ قابل تنظیم، ⚠️ نیازمند تصمیم/داده‌ی واقعی، ❌ باقی‌مانده.

---

## ۰) جمع‌بندی

ایراد اصلی ممیزی قبلی (N1) بسته شد: **قیمت ماندگار دیتابیس** هنگام انقضای پروموشن مستقیم به `exactFloorPrice` برمی‌گردد و مسیرهای خام (علاقه‌مندی‌ها و چت‌بات) هم همان لایه‌ی نمایش صفحه‌ی محصول را اعمال می‌کنند. نتیجه: صفحه‌ی محصول، سبد، پرداخت، فید ترب، لیست، علاقه‌مندی‌ها و چت‌بات برای محصول منقضی یک عدد می‌دهند.

| معیار | نتیجه‌ی این دور |
|---|---|
| تایپ‌چک موتور | ✅ بدون خطا (`tsc --noEmit`، کد خروج ۰) |
| تست موتور | ✅ **۳۵ از ۳۵** (۳۴ تست قبلی + تست گیت حاشیه‌ی سود) |
| تست‌های ایمنی اسکریپت/مهاجرت | ✅ **۹ از ۹** (۵ تست N2 + ۴ تست N3) |
| تست فروشگاه (`npm test`) | ✅ همه‌ی فایل‌ها پاس، کد خروج ۰ |
| تست‌های جدید فروشگاه | ✅ ۱۰ تست چرخه‌ی عمر + ۶ تست پاریتی قیمت (در مجموع ۲۴ تست در بلوک `node --test`) |
| قیمت چت‌بات پس از انقضا | ✅ **۸۳۲٬۰۰۰** (قبلاً ۹۹۰٬۴۷۶) |
| قیمت علاقه‌مندی‌ها پس از انقضا | ✅ همان ۸۳۲٬۰۰۰ (overlay سمت سرور) |
| قیمت ماندگار DB پس از کران‌جاب | ✅ ۸۳۲٬۰۰۰ + `pricingMeta.needsRefresh=true` |
| `fix-wrong-timed-sale.cjs --apply` | ✅ دامنه‌ی SELECT/UPDATE یکی شد، تراکنشی، بدون بازنویسی status |
| مهاجرت | ✅ فایل ۰۰۰۲ + اجراکننده‌ی ردیابی‌شده؛ ⚠️ روی Postgres زنده اجرا نشد |

> شبیه‌سازی‌های ۲٬۰۰۰ بازاری و نرخ‌های ۷۲٫۵٪/۱٫۴٪ در این محیط قابل بازتولید نبودند (نه Postgres، نه MongoDB، نه ترب زنده). تغییرات این دور رفتار کد را تست‌پذیر کرده‌اند، نه نرخ واقعی بازار را.

---

## ۱) صحت‌سنجی ادعاهای ممیزی ۴.۱.۱

| ادعا | وضعیت در کد | شاهد |
|---|---|---|
| ۳۴/۳۴ تست موتور | ✅ تأیید شد | `node --test tests/pricing-engine.test.cjs` |
| `pricingMeta` در `CART_PRODUCT_FIELDS` | ✅ موجود | `controllers/cartController.js` |
| گارد کف ۱۴ روزه در سرویس و pipeline | ✅ موجود | `pricingService.managedExactFloorPrice`، `productListingService.pricingFloor` |
| N1: کران‌جاب قیمت DB را کف نمی‌کرد | ✅ تأیید شد | `buildDeactivationUpdate` قبلاً فقط فلگ/تخفیف می‌نوشت |
| N1: چت قیمت خام می‌خواند | ✅ تأیید شد | `chatRetrieval.finalPriceOf` قبلاً `p.price` را با discount خام حساب می‌کرد |
| N1: wishlist قیمت خام برمی‌گرداند | ✅ تأیید شد | `routes/wishlist.js` بدون overlay |
| N2: دامنه‌ی UPDATE گشادتر از SELECT | ✅ تأیید شد | شرط `cost_price <= 0` در UPDATE |
| N2: بازنویسی status تصمیم applied | ✅ تأیید شد | `status = CASE WHEN status='applied' THEN 'rejected'` |
| N3: relabel خودکار ۴.۱.۰ → ۳.۶.۰ | ✅ تأیید شد | `UPDATE ... WHERE engine_version='4.1.0'` |
| N4: تعارض پیش‌فرض costPolicy | ✅ تأیید شد | `replacement_floor` + `neverBelowManualCost:true` |
| N5: رتبه‌ی «با مشکوک» در UI | ❌ نبود | صفحه‌ی review فقط رتبه‌ی رسمی را نشان می‌داد |

---

## ۲) اصلاحات این دور

### N1 — قیمت ماندگار و مسیرهای خام (✅)

**فروشگاه:**

1. `services/promotionLifecycleService.js`
   - `buildManagedRestore()` جدید: اگر `pricingMeta.exactFloorPrice` معتبر و تازه باشد و `price > exactFloorPrice`، قیمت را کف می‌کند، `compareAtPrice` را حذف و `pricingMeta.needsRefresh/campaignType/priceRestoredAt/restoredFromPrice` را می‌نویسد.
   - `buildDeactivationUpdate()` و `applyOwnPromotionRules()` از همین تابع استفاده می‌کنند؛ پس هم cron، هم دکمه‌ی غیرفعال‌سازی گروهی، هم ویرایش ادمین، قیمت DB را اصلاح می‌کنند.
   - `staleCandidatesFilter` شاخه‌ی «عقب‌مانده» گرفت: محصولاتی که cron قبلی تخفیفشان را صفر کرده ولی price روی سقف مانده است (بدون ردّ پروموشن).
   - `CLEANUP_FIELDS` شامل `productType` و `pricingMeta` شد.

2. محافظت‌های عمدی:
   - **timed_sale**: قیمت ریشه دست‌نخورده می‌ماند (Sale روی price سقف تخفیف می‌دهد؛ کف‌کردن price باعث تخفیف دوبل می‌شد).
   - **variable**: قیمت ریشه بازنویسی نمی‌شود؛ حتی سندهای قدیمی بدون `productType` که `variants` دارند.
   - **کف کهنه/نامعتبر** (> `MANAGED_EXACT_FLOOR_MAX_AGE_DAYS` یا timestamp خراب): دست‌نخورده، fail-closed.
   - **بدون `pricingMeta`**: هیچ‌گاه مدیریت نشده؛ دست‌نخورده.
   - **قیمت دستی ادمین**: اگر `updates.price` صریح باشد، هرگز با کف قدیمی بازنویسی نمی‌شود.

3. `services/pricingService.js`
   - `resolveProductDisplay()`: یک کپی از محصول را از همان `applyPromotionOverlay` عبور می‌دهد (تایمر زنده، Sale فعال، کف قطعی) و قیمت نمایشی متغیر/ساده را برمی‌گرداند.
   - `findActiveSaleForProduct()`: Sale فعال را از context لیست برای هر محصول پیدا می‌کند.
   - `MANAGED_EXACT_FLOOR_WARN_AGE_DAYS` (پیش‌فرض ۷) و `managedExactFloorAgeDays()` برای هشدار پیش از مرز ۱۴ روز.

4. `utils/chatRetrieval.js`
   - `finalPriceOf` / `oldPriceOf` / `toCardPayload` / `formatProductContext` از `resolveProductDisplay` استفاده می‌کنند؛ دیگر discount خام روی price خام اعمال نمی‌شود.
   - `searchProducts` Sale فعال را (به‌صورت غیرقابل‌شمارش) به کارت وصل می‌کند تا چت با Sale هم همان قیمت صفحه را بدهد.
   - `pricingMeta` و `campaignLabel` به `selectFields` اضافه شدند.

5. `routes/wishlist.js`
   - `pricingMeta` انتخاب می‌شود و هر آیتم از `resolveProductDisplay` با Sale فعال عبور می‌کند؛ خروجی سازگار است: `price` نهایی، `compareAtPrice` فقط با تخفیف واقعی، `discount` صفر پس از انقضا.

6. `controllers/chatController.js`
   - کارت‌های پک قطعی (`engineToChatPackage`) هم Sale فعال و فیلدهای لازم را می‌گیرند.

**تست‌ها:**

- `tests/managed-floor-lifecycle.test.cjs` — ۱۰ تست: انقضا، عقب‌مانده، timed_sale، variable، کف کهنه، timestamp خراب، بدون meta، فیلتر، ویرایش ادمین، قیمت دستی.
- `tests/pricing-display-parity.test.cjs` — ۶ تست: چت = سبد = صفحه، Sale فعال در wishlist/chat، بدون meta، variable.

### N2 — اسکریپت پاک‌سازی (✅)

`scripts/fix-wrong-timed-sale.cjs` بازنویسی شد:

- پیش‌فرض dry-run؛ `--apply` صریح.
- SQLها به `scripts/lib/timed-sale-cleanup.cjs` منتقل شدند تا تست‌پذیر باشند.
- دامنه‌ی هر UPDATE دقیقاً همان SELECT است:
  - `current_campaign='timed_sale'` فقط برای پاک‌سازی کمپین؛
  - `cost_price = 0 AND torob_prk IS NOT NULL` فقط برای پاک‌سازی لینک/PRK ترب.
- `status` تصمیم‌ها هرگز بازنویسی نمی‌شود؛ تصمیم‌های `applied` دست‌نخورده می‌مانند.
- همه‌ی نوشتن‌های PostgreSQL در یک تراکنش.
- MongoDB: `--mongo-mode=delete|deactivate|skip` (پیش‌فرض delete، فقط Saleهای `autoManaged` با نام‌های مشخص).
- کش: `--no-cache` برای رد کردن پاک‌سازی کش torob-mcp.
- مسیرها با `PRICING_APP_DIR` و `EKGKALA_BACKEND_DIR` قابل تطبیق‌اند؛ mongoose از `node_modules` فروشگاه resolve می‌شود (در ریپوی موتور نصب نیست).
- `tests/cleanup-script-safety.test.cjs` — ۵ تست گارد رگرسیون.

### N3 — مهاجرت (✅ کد، ⚠️ اجرا نشده)

- `drizzle/0001_v411_incremental.sql`: relabel «۴.۱.۰ → ۳.۶.۰» پشت `current_setting('pricing.relabel_410', true) = 'on'` رفت؛ دیگر خودکار نیست.
- `drizzle/0002_v412_audit_fixes.sql`:
  - `rank_including_suspect` و `total_sellers_including_suspect` (برای N5)؛
  - `decisions_push_recovery_idx` با `IF NOT EXISTS`؛
  - همان relabel اختیاری.
- `src/db/schema.ts`: ایندکس `decisions_push_recovery_idx` و دو ستون رتبه تعریف شدند تا `drizzle-kit push` drift نبیند.
- `scripts/migrate.cjs`: اجراکننده‌ی قابل تطبیق با `schema_migrations`، checksum، advisory lock، `--dry-run`، `--file`، `--to`، `--baseline` و هشدار drift.
- `tests/migration-safety.test.cjs` — ۴ تست.

> **پیش از اجرا:** روی کپی دیتابیس. اگر ۰۰۰۱ را قبلاً دستی اجرا کرده‌اید و جدول `schema_migrations` ندارید، اول `node scripts/migrate.cjs --baseline` بزنید تا وضعیت فعلی ثبت شود؛ بعد ۰۰۰۲ را اجرا کنید. اگر ۴.۱.۰ هرگز در تولید اجرا نشده، relabel را فعال نکنید.

### N4 — سیاست هزینه (✅ با پیش‌فرض محافظه‌کارانه + قابل تغییر)

- `DEFAULT_PROFILE_CONFIG.sourcing.costPolicy` از `replacement_floor` به **`max_inventory_replacement`** تغییر کرد تا با `neverBelowManualCost: true` متناقض نباشد. یعنی پیش‌فرض جدید: کف از بیشینه‌ی هزینه‌ی انبار و قیمت ریپلیس.
- اگر رقابت با ریپلیس ارزان‌تر را می‌خواهید، در تنظیمات همان پروفایل `costPolicy=replacement_floor` بگذارید؛ اسکریپت `scripts/fix-cost-policy.cjs` هم با `--policy=replacement_floor` این کار را می‌کند و `neverBelowManualCost` را false می‌کند.
- `bootstrap.findConfigConflicts()` تعارض `replacement_floor + neverBelowManualCost=true` را تشخیص می‌دهد و یک‌بار در لاگ/Activity ثبت می‌کند (بدون تغییر خودکار).
- `scripts/fix-cost-policy.cjs`: گزارش dry-run، اصلاح تعارض‌ها با `--apply`، انتخاب سیاست با `--policy`، `--all` برای بازنویسی همه.
- تصمیم #۲ ممیزی: `guards.profitApproveMarginPct` اضافه شد (پیش‌فرض ۰ = رفتار ۴.۱.۱). با عدد مثبت، قیمت‌های بالای کف سود ولی با حاشیه‌ی کمتر از آن، به‌جای applied به `pending_review` می‌روند. منطق در `src/lib/pricing/approval.ts` و تست ۳۵.

### N5 — رتبه و هشدار کهنگی (✅)

- `rank_including_suspect` و `total_sellers_including_suspect` در تصمیم ذخیره می‌شوند (`runner.ts`).
- صفحه‌ی `review` هر دو رتبه را نشان می‌دهد: «رتبه ملی / با مشکوک» + هشدار `marketConflict`.
- برای تصمیم‌های قدیمی، مقدار از `steps` (گام `position`) خوانده می‌شود.
- `jobs/promotionExpiryJob.js`: یک‌بار در ساعت تعداد کف‌های «در آستانه‌ی کهنگی» و «گذشته از مرز» را لاگ می‌کند.
- `scripts/report-stale-floors.cjs`: گزارش JSON/متنی، `--fix` برای اجرای `runPromotionCleanup`، `--fail-on-expired` برای CI.

---

## ۳) تنظیمات قابل تطبیق (بدون تغییر کد)

| تنظیم | محل | پیش‌فرض | اثر |
|---|---|---|---|
| `MANAGED_EXACT_FLOOR_MAX_AGE_DAYS` | `.env` فروشگاه | ۱۴ | بعد از این مدت بدون sync، گارد کف خاموش (fail-closed) |
| `MANAGED_EXACT_FLOOR_WARN_AGE_DAYS` | `.env` فروشگاه | ۷ | از این مدت، job هشدار می‌دهد |
| `sourcing.costPolicy` | پروفایل (UI/DB) | `max_inventory_replacement` | کف از بیشینه انبار/ریپلیس یا ریپلیس |
| `sourcing.neverBelowManualCost` | پروفایل | `true` | فقط با `legacy_never_below_manual` مؤثر؛ با `replacement_floor` باید false باشد |
| `guards.profitApproveMarginPct` | پروفایل | ۰ | حداقل حاشیه برای اعمال خودکار |
| `rank1.leaderPremiumMode` | پروفایل | `false` | رتبه ۱ زیر رهبر (پیش‌فرض) یا بالای رهبر (حالت قدیمی) |
| `PRICING_APP_DIR` / `EKGKALA_BACKEND_DIR` | env | مسیرهای نسبی/سرور | مسیر ریپوها برای اسکریپت‌ها |
| `--mongo-mode` / `--no-cache` | آرگومان اسکریپت | delete / cache on | کنترل پاک‌سازی MongoDB و کش |

---

## ۴) دستورات استقرار (قابل تطبیق)

> همه‌ی دستورات از ریشه‌ی ریپوی مربوطه اجرا می‌شوند. مسیرها و URLها از env خوانده می‌شوند.

### ۰) بکاپ

```bash
export BACKUP_DIR="${BACKUP_DIR:-$HOME/backups}"
mkdir -p "$BACKUP_DIR"
pg_dump "$DATABASE_URL" -Fc -f "$BACKUP_DIR/pricing_$(date +%F_%H%M).dump"
mongodump --uri "$MONGODB_URI" --out "$BACKUP_DIR/store_$(date +%F_%H%M)"
```

در ویندوز همین دو ابزار را با `%DATABASE_URL%` و `%MONGODB_URI%` و مسیر بکاپ دلخواه اجرا کنید.

### ۱) اعمال تغییرات فروشگاه

روش A — پچ (فایل در `ekgkala-backend/v4.1.2-store-lifecycle.patch` است):

```bash
# از ریشه‌ی ریپوی فروشگاه؛ مسیرهای پچ نسبی به بک‌اند هستند و --directory آن‌ها را به ریشه می‌چسباند:
cd <store-repo>
git apply --check --directory=ekgkala-backend ekgkala-backend/v4.1.2-store-lifecycle.patch
git apply --directory=ekgkala-backend ekgkala-backend/v4.1.2-store-lifecycle.patch

# یا با patch استاندارد، از داخل بک‌اند (مسیرها با -p1 حذف می‌شوند):
cd <store-repo>/ekgkala-backend
patch -p1 --dry-run < v4.1.2-store-lifecycle.patch
patch -p1 < v4.1.2-store-lifecycle.patch
```

روش B — بدون پچ: فایل‌های `services/promotionLifecycleService.js`، `services/pricingService.js`، `utils/chatRetrieval.js`، `routes/wishlist.js`، `controllers/chatController.js`، `jobs/promotionExpiryJob.js`، `scripts/report-stale-floors.cjs` و دو تست جدید را کپی کنید.

```bash
node --test tests/managed-floor-checkout.test.cjs tests/managed-floor-lifecycle.test.cjs tests/pricing-display-parity.test.cjs
npm test
```

### ۲) بررسی موتور

```bash
cd <pricing-repo>
# روش A: پچ کامل موتور (مسیرها نسبی به ریشه‌ی همین ریپو هستند)
git apply --check v4.1.2-pricing.patch
git apply v4.1.2-pricing.patch

# روش B: کپی فایل‌های تغییرکرده (حداقل موارد جدید بخش ۲)

npm ci
node node_modules/typescript/bin/tsc --noEmit
npm test
node scripts/verify-release.cjs          # شامل تست فروشگاه اگر پیدا شود
```

### ۳) مهاجرت

```bash
cd <pricing-repo>
node scripts/migrate.cjs --dry-run
node scripts/migrate.cjs                 # ابتدا روی کپی دیتابیس
# اگر قبلاً ۰۰۰۱ را دستی اجرا کرده‌اید (و مطمئنید ۰۰۰۲ اجرا نشده):
node scripts/migrate.cjs --baseline --to=0001
node scripts/migrate.cjs --file=0002_v412_audit_fixes.sql
```

`psql` همچنان گزینه‌ی جایگزین است:

```bash
psql "$DATABASE_URL" -f drizzle/0002_v412_audit_fixes.sql
```

### ۴) سیاست هزینه

```bash
cd <pricing-repo>
node scripts/fix-cost-policy.cjs
node scripts/fix-cost-policy.cjs --apply                  # اصلاح تعارض‌ها
node scripts/fix-cost-policy.cjs --apply --policy=replacement_floor
```

بررسی دستی:

```bash
psql "$DATABASE_URL" -c "SELECT id, config->'sourcing'->>'costPolicy' AS cost_policy, config->'sourcing'->>'neverBelowManualCost' AS never_below FROM pricing_profiles;"
```

### ۵) پاک‌سازی کارت اشتباه timed_sale (در صورت نیاز)

```bash
cd <pricing-repo>
node scripts/fix-wrong-timed-sale.cjs                    # گزارش
node scripts/fix-wrong-timed-sale.cjs --apply            # پس از بکاپ
node scripts/fix-wrong-timed-sale.cjs --apply --mongo-mode=deactivate --no-cache
```

### ۶) وضعیت کف‌های کهنه

```bash
cd <store-repo>/ekgkala-backend
node scripts/report-stale-floors.cjs
node scripts/report-stale-floors.cjs --fix
node scripts/report-stale-floors.cjs --fail-on-expired   # برای CI/کران
```

### ۷) حالت سایه و کانری

۷ تا ۱۴ روز در حالت سایه (بدون push/apply) اجرا کنید؛ نسبت `marketConflict`، `deep_floor`، `pending_review` و `applied` را بسنجید. سپس ۱۰٪ محصولات را کانری کنید و بعد از هر کران‌جاب، پنج مسیر زیر را با هم مقایسه کنید:

1. صفحه‌ی محصول
2. سبد خرید
3. علاقه‌مندی‌ها
4. چت‌بات
5. فید ترب

همه باید یک عدد بدهند. برای محصول timed_sale، قیمت Sale فعال باید با کف کالیبره‌شده یکی باشد.

---

## ۵) اعتبارسنجی انجام‌شده در این محیط

| بررسی | فرمان | نتیجه |
|---|---|---|
| تایپ‌چک موتور | `node node_modules/typescript/bin/tsc --noEmit` | ✅ exit 0 |
| تست موتور | `npm test` (pricing) | ✅ ۳۵/۳۵ |
| ایمنی اسکریپت پاک‌سازی | `node --test tests/cleanup-script-safety.test.cjs` | ✅ ۵/۵ |
| ایمنی مهاجرت | `node --test tests/migration-safety.test.cjs` | ✅ ۴/۴ |
| تست فروشگاه | `npm test` (store) | ✅ exit 0 |
| چرخه‌ی عمر کف | `node --test tests/managed-floor-lifecycle.test.cjs` | ✅ ۱۰/۱۰ |
| پاریتی قیمت | `node --test tests/pricing-display-parity.test.cjs` | ✅ ۶/۶ |
| verifier یکپارچه | `node scripts/verify-release.cjs` | ✅ ۳ بررسی سبز |

---

## ۶) تصمیم‌هایی که با شماست (پیش‌فرض‌ها امن انتخاب شده‌اند)

1. **سیاست هزینه:** پیش‌فرض `max_inventory_replacement` (محافظه‌کارانه). اگر رقابت با ریپلیس ارزان‌تر را ترجیح می‌دهید، `replacement_floor` را صریح انتخاب کنید (`fix-cost-policy.cjs --policy=replacement_floor`).
2. **حداقل حاشیه برای اعمال خودکار:** `profitApproveMarginPct` پیش‌فرض ۰ (سازگار). برای محافظه‌کاری بیشتر ۳ تا ۵ بگذارید.
3. **آستانه‌ی ۱۴ روز و هشدار ۷ روز:** با env قابل تغییر است.
4. **رهبر منفرد:** پیش‌فرض `leaderPremiumMode=false` (زیر رهبر). اگر سیاست قدیمی را می‌خواهید، true کنید.

---

## ۷) محدودیت‌های این اعتبارسنجی

- Postgres و MongoDB زنده در دسترس نبودند: مهاجرت ۰۰۰۲، `runPromotionCleanup` روی داده‌ی واقعی، ایندکس `decisions_push_recovery_idx`، و کوئری `$expr` عقب‌مانده **اجرا نشده‌اند**؛ فقط منطق خالص و SQL با تست/بازبینی پوشش داده شده‌اند.
- ترب زنده در دسترس نبود؛ اعداد شبیه‌سازی بازار بازتولید نشدند.
- UI فقط typecheck شد، نه بازبینی بصری.
- `fix-wrong-timed-sale.cjs --apply` روی دیتابیس واقعی اجرا نشد (فقط منطق و SQL تست شد).
- `bestsellers-score-engine.test.cjs` مستقل از قیمت‌گذاری است و همان‌طور که ممیزی ۴.۱.۱ گفته بود، ۱ تست آن (recency/decayed score) رد می‌شود؛ در `npm test` فروشگاه اجرا نمی‌شود و در این دور تغییر نکرد.
- کامل بودن لیست فروشندگان ترب (`offersTotal` در برابر `totalSellerCount`) و قاعده‌ی تساوی رتبه هنوز با داده‌ی واقعی ترب تأیید نشده است.

---

## ۸) نقشه‌ی بستن ایرادها

| # | ایراد | وضعیت | فایل‌های کلیدی |
|---|---|---|---|
| N1 | قیمت DB بعد از انقضا | ✅ | `promotionLifecycleService.js`، `pricingService.js`، `chatRetrieval.js`، `wishlist.js` |
| N2 | اسکریپت مخرب `--apply` | ✅ | `fix-wrong-timed-sale.cjs`، `scripts/lib/timed-sale-cleanup.cjs` |
| N3 | relabel و ایندکس مهاجرت | ✅ کد / ⚠️ اجرا | `0001`، `0002`، `schema.ts`، `migrate.cjs` |
| N4 | تعارض سیاست هزینه | ✅ | `types.ts`، `bootstrap.ts`، `fix-cost-policy.cjs` |
| N5 | رتبه‌ی مشکوک و هشدار کهنگی | ✅ | `schema.ts`، `runner.ts`، `review/page.tsx`، `promotionExpiryJob.js` |
| — | حداقل حاشیه‌ی اعمال خودکار | ✅ | `approval.ts`، `runner.ts`، `types.ts` |
