"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activityLogs = exports.storeConnectors = exports.schedules = exports.discountCampaigns = exports.competitorOffers = exports.priceDecisions = exports.priceRuns = exports.products = exports.pricingProfiles = exports.settings = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
/** تنظیمات عمومی سیستم (key/value) */
exports.settings = (0, pg_core_1.pgTable)("settings", {
    key: (0, pg_core_1.varchar)("key", { length: 100 }).primaryKey(),
    value: (0, pg_core_1.jsonb)("value").notNull(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at").defaultNow().notNull(),
});
/** پروفایل قیمت‌گذاری: تمام پارامترهای موتور قیمت در یک JSON قابل تنظیم */
exports.pricingProfiles = (0, pg_core_1.pgTable)("pricing_profiles", {
    id: (0, pg_core_1.serial)("id").primaryKey(),
    name: (0, pg_core_1.text)("name").notNull(),
    isDefault: (0, pg_core_1.boolean)("is_default").default(false).notNull(),
    config: (0, pg_core_1.jsonb)("config").$type().notNull(),
    createdAt: (0, pg_core_1.timestamp)("created_at").defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at").defaultNow().notNull(),
});
/** محصولات فروشگاه */
exports.products = (0, pg_core_1.pgTable)("products", {
    id: (0, pg_core_1.serial)("id").primaryKey(),
    sku: (0, pg_core_1.varchar)("sku", { length: 100 }).notNull().unique(),
    name: (0, pg_core_1.text)("name").notNull(),
    category: (0, pg_core_1.text)("category"),
    /** شناسه محصول در فروشگاه (مثلاً _id یا productCode در sgeooole یا ID ووکامرس) */
    storeExternalId: (0, pg_core_1.text)("store_external_id"),
    /** منبع استعلام: torob (تنها منبع واقعی) | manual (ورود دستی هنگام اجرا) */
    sourceType: (0, pg_core_1.varchar)("source_type", { length: 30 }).default("torob").notNull(),
    torobUrl: (0, pg_core_1.text)("torob_url"),
    torobPrk: (0, pg_core_1.text)("torob_prk"),
    torobDetailsUrl: (0, pg_core_1.text)("torob_details_url"),
    /** قیمت تمام‌شده پایه/دستی (تومان) */
    costPrice: (0, pg_core_1.integer)("cost_price").default(0).notNull(),
    /**
     * آخرین قیمت خرید جایگزینِ تاییدشده از لیست همکار (M2 — قیمت باز خرید در تاریخ …).
     * فقط گزارشی است و موتور هیچ‌جا آن را به‌عنوان مبنای قیمت نمی‌خواند (منبع زنده،
     * supplierQuotes است)؛ در UI به‌عنوان «قیمت جایگزینی قطعی» نمایش داده نشود.
     */
    replacementCost: (0, pg_core_1.integer)("replacement_cost"),
    replacementCostAt: (0, pg_core_1.timestamp)("replacement_cost_at"),
    /** پایان کمپین مجاز تخفیف site (برای پیوستگی تایمر) */
    currentCampaignEndsAt: (0, pg_core_1.timestamp)("current_campaign_ends_at"),
    /** قفل نرم اجرای هم‌زمان (UTC) — اگر در آینده باشد، محصول در این اجرا skip می‌شود */
    lockedUntil: (0, pg_core_1.timestamp)("locked_until"),
    /** سیگنال مغز خارجی: نیاز به استعلام/پوش مجدد از فروشگاه (کف منقضی یا فروش زیر هزینه انبار) */
    needsRefresh: (0, pg_core_1.boolean)("needs_refresh").default(false).notNull(),
    /** لیست پیشنهادهای قیمت همکاران / تامین‌کنندگان برای این محصول */
    supplierQuotes: (0, pg_core_1.jsonb)("supplier_quotes").$type().default([]).notNull(),
    /** نام همکار منتخب فعلی */
    selectedSupplierName: (0, pg_core_1.text)("selected_supplier_name"),
    /** خط قرمز فعلی فروش (تمام‌شده همکار + حداقل سود) */
    currentHardFloorPrice: (0, pg_core_1.integer)("current_hard_floor_price"),
    /** حداقل حاشیه سود درصدی (override پروفایل) */
    minMarginPct: (0, pg_core_1.real)("min_margin_pct"),
    /** حداقل سود خالص تومانی در هر فروش (override پروفایل) */
    minProfitAmount: (0, pg_core_1.integer)("min_profit_amount"),
    /**
     * اولویت/نوع کمپین اختصاصی برای این کارت محصول (اختیاری):
     * auto (انتخاب خودکار بر اساس قوانین کمپین‌ها و رنج کارت‌ها) | flash | featured | timed_sale | none
     */
    preferredCampaignType: (0, pg_core_1.varchar)("preferred_campaign_type", { length: 30 }).default("auto").notNull(),
    /** آیا در صورت قرارگیری در تخفیف زمان‌دار (timed_sale)، در بخش منتخب‌های صفحه اصلی نمایش داده شود؟ */
    showInFeatured: (0, pg_core_1.boolean)("show_in_featured").default(true).notNull(),
    profileId: (0, pg_core_1.integer)("profile_id").references(() => exports.pricingProfiles.id, { onDelete: "set null" }),
    /** اگر false باشد، هر تصمیم نیاز به تأیید انسانی دارد */
    autoApply: (0, pg_core_1.boolean)("auto_apply").default(true).notNull(),
    status: (0, pg_core_1.varchar)("status", { length: 30 }).default("active").notNull(), // active | paused | needs_review
    currentBasePrice: (0, pg_core_1.integer)("current_base_price"),
    currentFinalPrice: (0, pg_core_1.integer)("current_final_price"),
    currentDiscountPct: (0, pg_core_1.real)("current_discount_pct"),
    currentCampaign: (0, pg_core_1.varchar)("current_campaign", { length: 30 }),
    currentCampaignName: (0, pg_core_1.text)("current_campaign_name"),
    currentBadgeTheme: (0, pg_core_1.varchar)("current_badge_theme", { length: 30 }).default("green-orange"),
    currentShowInFeatured: (0, pg_core_1.boolean)("current_show_in_featured").default(false),
    lastDecisionId: (0, pg_core_1.integer)("last_decision_id"),
    lastCheckedAt: (0, pg_core_1.timestamp)("last_checked_at"),
    createdAt: (0, pg_core_1.timestamp)("created_at").defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at").defaultNow().notNull(),
}, (t) => [(0, pg_core_1.index)("products_status_idx").on(t.status)]);
/** هر بار اجرای موتور قیمت (دستی/زمان‌بندی/API) */
exports.priceRuns = (0, pg_core_1.pgTable)("price_runs", {
    id: (0, pg_core_1.serial)("id").primaryKey(),
    trigger: (0, pg_core_1.varchar)("trigger", { length: 30 }).notNull(), // manual | schedule | api
    status: (0, pg_core_1.varchar)("status", { length: 30 }).default("running").notNull(), // running | done | failed
    scheduleId: (0, pg_core_1.integer)("schedule_id"),
    totalProducts: (0, pg_core_1.integer)("total_products").default(0).notNull(),
    applied: (0, pg_core_1.integer)("applied").default(0).notNull(),
    pendingReview: (0, pg_core_1.integer)("pending_review").default(0).notNull(),
    failed: (0, pg_core_1.integer)("failed").default(0).notNull(),
    error: (0, pg_core_1.text)("error"),
    startedAt: (0, pg_core_1.timestamp)("started_at").defaultNow().notNull(),
    finishedAt: (0, pg_core_1.timestamp)("finished_at"),
});
/** تصمیم قیمت برای یک محصول در یک اجرا (با توضیح کامل مراحل، کف و سقف بازار و کمپین سهگانه) */
exports.priceDecisions = (0, pg_core_1.pgTable)("price_decisions", {
    id: (0, pg_core_1.serial)("id").primaryKey(),
    runId: (0, pg_core_1.integer)("run_id").references(() => exports.priceRuns.id, { onDelete: "set null" }),
    productId: (0, pg_core_1.integer)("product_id")
        .references(() => exports.products.id, { onDelete: "cascade" })
        .notNull(),
    source: (0, pg_core_1.varchar)("source", { length: 30 }).notNull(),
    offersTotal: (0, pg_core_1.integer)("offers_total").default(0).notNull(),
    offersUsed: (0, pg_core_1.integer)("offers_used").default(0).notNull(),
    effectiveCostPrice: (0, pg_core_1.integer)("effective_cost_price"),
    hardFloorPrice: (0, pg_core_1.integer)("hard_floor_price"),
    lowestRaw: (0, pg_core_1.integer)("lowest_raw"),
    lowestValid: (0, pg_core_1.integer)("lowest_valid"),
    /** سقف واقعی بازار تحت رصد (پس از حذف قیمت‌های پرت ترب) */
    monitoredMarketCeiling: (0, pg_core_1.integer)("monitored_market_ceiling"),
    localLowestValid: (0, pg_core_1.integer)("local_lowest_valid"),
    marketMedian: (0, pg_core_1.integer)("market_median"),
    marketMean: (0, pg_core_1.integer)("market_mean"),
    referencePrice: (0, pg_core_1.integer)("reference_price"),
    /** قیمت سقف کالیبره‌شده (معیار تخفیف) */
    basePrice: (0, pg_core_1.integer)("base_price"),
    /** قیمت کف نهایی (پس از اعمال درصد تخفیف روی سقف) */
    finalPrice: (0, pg_core_1.integer)("final_price"),
    discountPct: (0, pg_core_1.real)("discount_pct"),
    /** نوع کمپین در sgeooole: flash | featured | timed_sale | none */
    campaignType: (0, pg_core_1.varchar)("campaign_type", { length: 30 }),
    /** نام کمپین (به‌ویژه برای تخفیف‌های زمان‌دار بخش مالی Sale) */
    campaignName: (0, pg_core_1.text)("campaign_name"),
    /** تم رنگی برچسب در sgeooole: green-orange | gold-red | red-purple */
    badgeTheme: (0, pg_core_1.varchar)("badge_theme", { length: 30 }),
    /** آیا در بخش منتخب‌های صفحه اصلی نمایش داده شود؟ */
    showInFeatured: (0, pg_core_1.boolean)("show_in_featured").default(true).notNull(),
    strategy: (0, pg_core_1.varchar)("strategy", { length: 40 }),
    competitionTier: (0, pg_core_1.varchar)("competition_tier", { length: 40 }),
    projectedNationalRank: (0, pg_core_1.integer)("projected_national_rank"),
    projectedLocalRank: (0, pg_core_1.integer)("projected_local_rank"),
    /** رتبه با احتساب فروشنده‌های مشکوک/کهنه (برای نمایش کنار رتبه‌ی رسمی در صف بازبینی) */
    rankIncludingSuspect: (0, pg_core_1.integer)("rank_including_suspect"),
    totalSellersIncludingSuspect: (0, pg_core_1.integer)("total_sellers_including_suspect").default(0).notNull(),
    netProfitToman: (0, pg_core_1.integer)("net_profit_toman"),
    netMarginPct: (0, pg_core_1.real)("net_margin_pct"),
    confidence: (0, pg_core_1.real)("confidence").default(0).notNull(),
    status: (0, pg_core_1.varchar)("status", { length: 30 }).notNull(), // applied | pending_review | rejected | failed | skipped
    steps: (0, pg_core_1.jsonb)("steps").$type().default([]).notNull(),
    /** نسخه‌ی موتور ۴.۱.۱ که این تصمیم را ساخته (قابل‌ردیابی) */
    engineVersion: (0, pg_core_1.varchar)("engine_version", { length: 20 }).default("4.1.1").notNull(),
    /** فروشنده suspect_low زیر قیمت پیشنهادی ما (market_conflict → review) */
    marketConflict: (0, pg_core_1.boolean)("market_conflict").default(false).notNull(),
    /** مرجع مقایسه تخفیف: none | own_price_7d | market_p75 */
    referenceKind: (0, pg_core_1.varchar)("reference_kind", { length: 30 }),
    /** کف نهایی متناسب با مرجع/کف بازار و از روی کف دقیق اعمال شد (true) یا به‌قدر لازم کالیبره نشده (false) */
    floorConfirmed: (0, pg_core_1.boolean)("floor_confirmed").default(false).notNull(),
    pushStatus: (0, pg_core_1.varchar)("push_status", { length: 30 }), // pushed | failed | skipped
    pushError: (0, pg_core_1.text)("push_error"),
    pushedAt: (0, pg_core_1.timestamp)("pushed_at"),
    createdAt: (0, pg_core_1.timestamp)("created_at").defaultNow().notNull(),
}, (t) => [
    (0, pg_core_1.index)("decisions_product_idx").on(t.productId),
    (0, pg_core_1.index)("decisions_run_idx").on(t.runId),
    // هم‌نام با ایندکس SQL مهاجرت؛ بدون این تعریف drizzle-kit push آن را drift می‌دید (N3).
    (0, pg_core_1.index)("decisions_push_recovery_idx").on(t.status, t.pushStatus, t.createdAt),
]);
/** پیشنهادهای رقبا (اسنپ‌شات ترب شامل شهر فروشنده و نوع آنلاین/حضوری) برای هر تصمیم */
exports.competitorOffers = (0, pg_core_1.pgTable)("competitor_offers", {
    id: (0, pg_core_1.serial)("id").primaryKey(),
    decisionId: (0, pg_core_1.integer)("decision_id")
        .references(() => exports.priceDecisions.id, { onDelete: "cascade" })
        .notNull(),
    productId: (0, pg_core_1.integer)("product_id").notNull(),
    shopName: (0, pg_core_1.text)("shop_name").notNull(),
    shopId: (0, pg_core_1.text)("shop_id"),
    shopCity: (0, pg_core_1.text)("shop_city"),
    sellerType: (0, pg_core_1.varchar)("seller_type", { length: 20 }).default("online").notNull(),
    shopScore: (0, pg_core_1.real)("shop_score"),
    isLocalCity: (0, pg_core_1.boolean)("is_local_city").default(false).notNull(),
    priceUnreliable: (0, pg_core_1.boolean)("price_unreliable").default(false).notNull(),
    price: (0, pg_core_1.integer)("price").notNull(),
    lastChangedAt: (0, pg_core_1.timestamp)("last_changed_at"),
    isAd: (0, pg_core_1.boolean)("is_ad").default(false).notNull(),
    inStock: (0, pg_core_1.boolean)("in_stock").default(true).notNull(),
    url: (0, pg_core_1.text)("url"),
    included: (0, pg_core_1.boolean)("included").default(true).notNull(),
    excludeReason: (0, pg_core_1.text)("exclude_reason"),
    weight: (0, pg_core_1.real)("weight").default(1).notNull(),
}, (t) => [(0, pg_core_1.index)("offers_decision_idx").on(t.decisionId)]);
/**
 * کمپین‌های تخفیف سهگانه منطبق با معماری sgeooole + فیلتر رنج کارت‌ها:
 *  1) flash      -> پیشنهاد لحظه‌ای در صفحه اصلی (Product.isFlashDeal)
 *  2) featured   -> پیشنهاد شگفت‌انگیز در صفحه اصلی (Product.isSpecialOffer)
 *  3) timed_sale -> مدیریت فرصت‌های زمان‌دار در بخش مالی و تخفیف (مدل Sale در sgeooole با قابلیت نمایش در منتخب‌های صفحه اصلی)
 */
exports.discountCampaigns = (0, pg_core_1.pgTable)("discount_campaigns", {
    id: (0, pg_core_1.serial)("id").primaryKey(),
    name: (0, pg_core_1.text)("name").notNull(),
    /** نوع کمپین: flash | featured | timed_sale */
    type: (0, pg_core_1.varchar)("type", { length: 30 }).notNull(),
    active: (0, pg_core_1.boolean)("active").default(true).notNull(),
    priority: (0, pg_core_1.integer)("priority").default(0).notNull(),
    minDiscountPct: (0, pg_core_1.real)("min_discount_pct").default(0).notNull(),
    maxDiscountPct: (0, pg_core_1.real)("max_discount_pct").default(100).notNull(),
    /** تم برچسب در sgeooole: green-orange | gold-red | red-purple */
    badgeTheme: (0, pg_core_1.varchar)("badge_theme", { length: 30 }).default("green-orange").notNull(),
    /** آیا کارت‌های این کمپین در بخش «منتخب‌ها»ی صفحه اصلی نمایش داده شوند؟ (مخصوص timed_sale و featured) */
    showInFeatured: (0, pg_core_1.boolean)("show_in_featured").default(true).notNull(),
    /** رنج شماره کارت‌ها: شروع از کارت شماره (۱-based؛ ۱ = از اولین کارت) */
    cardRangeFrom: (0, pg_core_1.integer)("card_range_from").default(1).notNull(),
    /** رنج شماره کارت‌ها: تا کارت شماره (۰ = بدون محدودیت پایان) */
    cardRangeTo: (0, pg_core_1.integer)("card_range_to").default(0).notNull(),
    /** حداکثر تعداد کارت مجاز برای قرارگیری در این کمپین در هر اجرا (۰ = نامحدود) */
    maxCards: (0, pg_core_1.integer)("max_cards").default(0).notNull(),
    /** حداقل قیمت کف محصول (تومان) برای ورود به این رنج کارت‌ها (۰ = بدون کف) */
    minPriceToman: (0, pg_core_1.integer)("min_price_toman").default(0).notNull(),
    /** حداکثر قیمت کف محصول (تومان) برای ورود به این رنج کارت‌ها (۰ = نامحدود) */
    maxPriceToman: (0, pg_core_1.integer)("max_price_toman").default(0).notNull(),
    /** فقط کارت‌هایی که در مشهد یا کل ترب رتبه ۱ تا ۳ دارند وارد این کمپین شوند */
    onlyTopRanked: (0, pg_core_1.boolean)("only_top_ranked").default(false).notNull(),
    /** شناسه‌های محصولات خاص انتخاب‌شده برای این کمپین (خالی = همه محصولات مطابق با فیلتر رنج) */
    targetProductIds: (0, pg_core_1.jsonb)("target_product_ids").$type().default([]).notNull(),
    /** ساعات فعال (0-23)؛ خالی = همه ساعات */
    activeHours: (0, pg_core_1.jsonb)("active_hours").$type().default([]).notNull(),
    /** روزهای هفته فعال (0=یکشنبه ... 6=شنبه)؛ خالی = همه روزها */
    activeDays: (0, pg_core_1.jsonb)("active_days").$type().default([]).notNull(),
    /** دسته‌بندی‌های مجاز؛ خالی = همه */
    categories: (0, pg_core_1.jsonb)("categories").$type().default([]).notNull(),
    /** مدت اعتبار تخفیف بعد از اعمال (ساعت) */
    durationHours: (0, pg_core_1.integer)("duration_hours").default(24).notNull(),
    createdAt: (0, pg_core_1.timestamp)("created_at").defaultNow().notNull(),
});
/** زمان‌بندی اجرای خودکار */
exports.schedules = (0, pg_core_1.pgTable)("schedules", {
    id: (0, pg_core_1.serial)("id").primaryKey(),
    name: (0, pg_core_1.text)("name").notNull(),
    intervalMinutes: (0, pg_core_1.integer)("interval_minutes").default(360).notNull(),
    active: (0, pg_core_1.boolean)("active").default(true).notNull(),
    filter: (0, pg_core_1.jsonb)("filter").$type().default({}).notNull(),
    lastRunAt: (0, pg_core_1.timestamp)("last_run_at"),
    nextRunAt: (0, pg_core_1.timestamp)("next_run_at"),
    createdAt: (0, pg_core_1.timestamp)("created_at").defaultNow().notNull(),
});
/** کانکتور فروشگاه (sgeooole / ووکامرس / وب‌هوک عمومی) */
exports.storeConnectors = (0, pg_core_1.pgTable)("store_connectors", {
    id: (0, pg_core_1.serial)("id").primaryKey(),
    name: (0, pg_core_1.text)("name").notNull(),
    type: (0, pg_core_1.varchar)("type", { length: 30 }).notNull(),
    active: (0, pg_core_1.boolean)("active").default(false).notNull(),
    config: (0, pg_core_1.jsonb)("config").$type().default({}).notNull(),
    lastPushAt: (0, pg_core_1.timestamp)("last_push_at"),
    lastError: (0, pg_core_1.text)("last_error"),
    createdAt: (0, pg_core_1.timestamp)("created_at").defaultNow().notNull(),
});
/** لاگ فعالیت */
exports.activityLogs = (0, pg_core_1.pgTable)("activity_logs", {
    id: (0, pg_core_1.serial)("id").primaryKey(),
    level: (0, pg_core_1.varchar)("level", { length: 10 }).default("info").notNull(),
    scope: (0, pg_core_1.varchar)("scope", { length: 50 }).notNull(),
    message: (0, pg_core_1.text)("message").notNull(),
    meta: (0, pg_core_1.jsonb)("meta").default({}).notNull(),
    createdAt: (0, pg_core_1.timestamp)("created_at").defaultNow().notNull(),
});
