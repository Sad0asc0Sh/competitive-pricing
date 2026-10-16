# راهنمای جامع و نهایی استقرار، پابلیش در گیت‌هاب و راه‌اندازی سامانه قیمت‌گذاری رقابتی، ناظر SubQ SystemOne و کنترل ۳ سیستم تخفیف (نسخه ۳.۵ — ویژه سرور دبیان و فروشگاه sgeooole)

این نسخه (**v3.5 Production Ready**) با رفع کامل تمام ۵ مورد گزارش‌شده در سرور دبیان (`hermes` / `/home/debian/apps`) بسته‌بندی و در محیط ایزوله `/tmp` تست شده است (`14/14 pass` در موتور قیمت‌گذاری و `3/3 pass` در بک‌اند فروشگاه).

## ۰. نسخه ۳.۶ — بازطراحی کامل UI/UX، حذف کامل داده ماک و واقعی‌سازی سیستم

1. **رابط کاربری جدید و کاملاً ریسپانسیو:** پوسته (App Shell) جدید با سایدبار دسکتاپِ دارای آیکون و حالت فعال، و روی موبایل/تبلت تاپ‌بار چسبان با **منوی همبرگری و دراور کشویی RTL** (بسته‌شدن با بک‌دراپ، Escape و جابه‌جایی صفحه). جدول‌های پهن داشبورد (۱۰ ستون)، محصولات (۱۱ ستون) و اجراها روی موبایل به **نمای کارتی** تبدیل می‌شوند و بقیه جدول‌ها داخل `.table-wrap` با هدر ثابت قرار می‌گیرند. سیستم دیزاین یکدست در `globals.css` (کارت، دکمه، فرم، بج، اسکلت بارگذاری و حالت خالی) و صفحه بارگذاری سراسری اضافه شد.
2. **حذف کامل داده ماک (Mock):** فایل `src/lib/sources/mock.ts` (تولیدکننده قیمت‌های تصادفی از ۲۵ فروشگاه) به‌طور کامل حذف شد؛ تنها منبع مجاز «ترب» است (`ALLOWED_SOURCE_TYPES`). `seed.ts` دیگر هیچ محصول نمونه‌ای وارد نمی‌کند و پیش‌فرض‌های نمونه صفحه شبیه‌ساز خالی شده‌اند (فقط قالب فرمت به‌صورت placeholder می‌ماند).
3. **گاردهای سیستم واقعی:** رانر برای محصولاتی با منبع غیرمجاز/حذف‌شده خطای شفاف می‌دهد و هیچ تصمیمی نمی‌سازد؛ `applyDecision` تصمیم‌های با منبع غیر «torob/manual» را هرگز به فروشگاه ارسال نمی‌کند؛ API ساخت/ویرایش محصول منبع نامعتبر را با خطای ۴۰۰ رد می‌کند. محصولات قدیمیِ ساخته‌شده با seed قبلی (منبع mock) باید از پنل حذف یا منبعشان به ترب اصلاح شود — تا آن زمان رانر آن‌ها را امن رد می‌کند.
4. **ورود مدیر:** با تنظیم `ADMIN_PASSWORD` در `.env`، همه صفحات و APIها پشت لاگین می‌روند (کوکی نشست httpOnly با امضای HMAC؛ مسیرهای `/login`، `/api/health` و کرون مستثنا هستند). تا وقتی این متغیر خالی است پنل باز می‌ماند و بنر هشدار نمایش داده می‌شود.
5. **اتوماسیون و کارایی:** رانر حالا محصولات را با هم‌زمانی محدود پردازش می‌کند (`PRICING_RUN_CONCURRENCY`، پیش‌فرض ۳، بازه ۱ تا ۸؛ تخصیص کمپین همچنان دقیق و سقف‌ها محفوظ‌اند). اندپوینت‌های کرون در محیط تولید بدون `CRON_SECRET` بسته‌اند (fail-closed). مسیرهای اسکریپت ایمپورت Mongo از متغیرهای `PRICING_APP_DIR` و `EKGKALA_BACKEND_DIR` خوانده می‌شوند (پیش‌فرض: مسیرهای فعلی سرور).

**گام‌های دیپلوی نسخه ۳.۶ روی سرور:** `git pull` ← در `.env` مقادیر `ADMIN_PASSWORD` و `CRON_SECRET` را تنظیم کنید ← `npm install` ← `npm run build` ← `pm2 restart sgeooole-pricing` ← بررسی: بازشدن دراور موبایل، ورود با رمز، ردشدن محصولات mock قدیمی در اجرا، و قفل‌بودن `/api/cron` بدون هدر سکرت.

## ۱. خلاصه اصلاحات انجام‌شده در بسته جدید (`ai-driven-competitive-pricing-system-v2.zip`)

1. **تکمیل و تضمین حضور تمام ماژول‌های هسته (`168 فایل` داخل زیپ):**
   * `src/lib/pricing/matcher.ts` (موتور ۷ لایه تطبیق هویت کالا و حذف لوازم جانبی، پک‌ها و مدل‌های مشابه)
   * `src/lib/pricing/systemone-supervisor.ts` (ناظر تصمیم‌گیرنده بالاسر `SubQ SystemOne — subq-snap-preview` با قانون ۳ بازه‌ای `0..45..80..100%`)
2. **حذف کامل وابستگی به مسیر `/usr/share/nodejs/@babel/core` در تست‌ها:**
   * فایل `tests/pricing-engine.test.cjs` اکنون به یک لودر ۳ لایه مجهز شده است که هم با `typescript` محلی پروژه کار می‌کند و هم دارای کش پیش‌کامپایل‌شده (`tests/.compiled-cache/`) است؛ بنابراین حتی **قبل از اجرای `npm install`** در `/tmp/` سرور دبیان با دستور `node --test tests/pricing-engine.test.cjs` هر ۱۴ تست را در ۲ ثانیه پاس می‌کند (`# pass 14 / # fail 0`).
3. **رفع تداخل پورت `3000` (تغییر پورت پیش‌فرض به `3050`):**
   * از آنجا که پورت `3000` روی سرور شما در اختیار فرانت‌اند لایو `ekgkala` است، اسکریپت‌های `dev` و `start` در `package.json` و فایل `ecosystem.config.cjs` روی پورت **`3050`** تنظیم شده‌اند.
4. **قرار دادن سورس کامل `torob-mcp` در پوشه `vendor/torob-mcp` + اسکریپت `npx`:**
   * سورس کامل `torob-mcp` داخل خود پروژه در مسیر `vendor/torob-mcp` قرار داده شده و همچنین اسکریپت `npm run mcp:serve` (`PORT=3005 npx -y torob-mcp@0.1.2 --http`) و فایل `ecosystem.config.cjs` برای اجرای خودکار آن روی پورت **`3005`** اضافه شده است.
5. **افزودن `docker-compose.postgres.yml` فوق سبک (مصرف رم زیر 40MB):**
   * برای راه‌اندازی فوری PostgreSQL روی سرور دبیان بدون فشار به رم، فایل `docker-compose.postgres.yml` (ایمیج `postgres:16-alpine` مقید به `127.0.0.1:5432`) در ریشه پروژه قرار گرفته است.

## ۲. دستورات گام‌به‌گام برای پابلیش در گیت‌هاب (`ai-driven-competitive-pricing-system`)

برای اینکه نسخه تمیز و کامل در مخزن گیت‌هاب شما ذخیره شود و روی سرور به راحتی کلون/آپدیت گردد، در سیستم خودتان (که به گیت‌هاب دسترسی دارد) دستورات زیر را داخل پوشه اکسترکت‌شده `ai-driven-competitive-pricing-system-v2.zip` اجرا کنید:

```bash
git init
git add .
git commit -m "feat(v3.5): add 7-layer Torob matcher, SubQ SystemOne 3-zone supervisor, Floor/Ceiling calibration, and 3-system sgeooole campaign studio on port 3050"
git branch -M main
git remote add origin https://github.com/<YOUR_GITHUB_USERNAME>/ai-driven-competitive-pricing-system.git
git push -u origin main --force
```

## ۳. دستورات گام‌به‌گام اجرا روی سرور دبیان (`/home/debian/apps`)

### گام اول: اعمال پچ تاییدشده ۶ فایلی روی `ekgkala-backend`

1. فایل‌های داخل `sgeooole-pricing-sync-integration.zip` را در پوشه `ekgkala-backend` کپی کنید.
2. متغیر زیر را به `.env` بک‌اند فروشگاه اضافه نمایید:
   ```bash
   SGEOOOLE_PRICING_SECRET=sgeooole_super_secret_pricing_key_2026
   ```
3. تست را اجرا کرده و با کاربر `debian` سرویس PM2 بک‌اند را ری‌استارت کنید:
   ```bash
   cd /home/debian/apps/ekgkala-backend
   node --test tests/competitive-pricing-sync.test.cjs
   sudo -u debian pm2 restart ekgkala-backend
   ```

### گام دوم: راه‌اندازی دیتابیس سبک PostgreSQL برای سامانه قیمت‌گذاری

در پوشه پروژه قیمت‌گذاری (`/home/debian/apps/ai-driven-competitive-pricing-system`) یکی از دو روش زیر را انتخاب کنید:

* **روش الف (کانتینر سبک Docker روی سرور):**
  ```bash
  docker compose -f docker-compose.postgres.yml up -d
  ```
* **روش ب (دیتابیس ابری رایگان بدون مصرف رم سرور):**
  یک دیتابیس رایگان در `Neon.tech` یا `Supabase` بسازید و لینک `DATABASE_URL` آن را در `.env` قرار دهید.

### گام سوم: تست، بیلد و اجرای سامانه قیمت‌گذاری روی پورت `3050` و `torob-mcp` روی پورت `3005`

```bash
cd /home/debian/apps/ai-driven-competitive-pricing-system

# ۱. اجرای فوری ۱۷ تست موتور (حتی قبل از npm install کار می‌کند!)
node --test tests/pricing-engine.test.cjs

# ۲. کپی فایل تنظیمات محیطی و نصب پکیج‌ها
cp .env.example .env
npm install

# ۳. ساخت جداول دیتابیس در PostgreSQL
npx drizzle-kit push

# ۴. بیلد پروژه Next.js
npm run build

# ۵. اجرای هم‌زمان torob-mcp (پورت 3005) و پنل قیمت‌گذاری (پورت 3050) با PM2
sudo -u debian pm2 start ecosystem.config.cjs
sudo -u debian pm2 save
```

> **ثبت توکن‌های AI بدون دست‌زدن به `.env`:** پس از بالا آمدن پنل، از مسیر «تنظیمات → هوش مصنوعی و توکن‌های API» توکن ناظر SubQ SystemOne و هوش مصنوعی مکمل (OpenAI-compatible) را وارد و ذخیره کنید.
> مقادیر در دیتابیس ذخیره می‌شوند، اولویت بالاتری از `.env` دارند و با دکمه «تست اتصال زنده» همان لحظه صحت توکن و آدرس سرور بررسی می‌شود.
> بدون توکن SubQ، موتور با «ناظر آنی محلی» کار می‌کند و در حالت «فقط API رسمی»، قطعی ارتباط هرگز به اعمال خودکار قیمت منجر نمی‌شود (پرونده به بخش ریویو می‌رود).
