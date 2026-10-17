import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  real,
  varchar,
  index,
} from "drizzle-orm/pg-core";
import type { PricingProfileConfig, SupplierQuote } from "@/lib/pricing/types";

/** تنظیمات عمومی سیستم (key/value) */
export const settings = pgTable("settings", {
  key: varchar("key", { length: 100 }).primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** پروفایل قیمت‌گذاری: تمام پارامترهای موتور قیمت در یک JSON قابل تنظیم */
export const pricingProfiles = pgTable("pricing_profiles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  isDefault: boolean("is_default").default(false).notNull(),
  config: jsonb("config").$type<PricingProfileConfig>().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** محصولات فروشگاه */
export const products = pgTable(
  "products",
  {
    id: serial("id").primaryKey(),
    sku: varchar("sku", { length: 100 }).notNull().unique(),
    name: text("name").notNull(),
    category: text("category"),
    /** شناسه محصول در فروشگاه (مثلاً _id یا productCode در sgeooole یا ID ووکامرس) */
    storeExternalId: text("store_external_id"),
    /** منبع استعلام: torob (تنها منبع واقعی) | manual (ورود دستی هنگام اجرا) */
    sourceType: varchar("source_type", { length: 30 }).default("torob").notNull(),
    torobUrl: text("torob_url"),
    torobPrk: text("torob_prk"),
    torobDetailsUrl: text("torob_details_url"),
    /** قیمت تمام‌شده پایه/دستی (تومان) */
    costPrice: integer("cost_price").default(0).notNull(),
    /** آخرین قیمت خرید جایگزینِ تاییدشده از لیست همکار (M2 — قیمت باز خرید در تاریخ …) */
    replacementCost: integer("replacement_cost"),
    replacementCostAt: timestamp("replacement_cost_at"),
    /** پایان کمپین مجاز تخفیف site (برای پیوستگی تایمر) */
    currentCampaignEndsAt: timestamp("current_campaign_ends_at"),
    /** قفل نرم اجرای هم‌زمان (UTC) — اگر در آینده باشد، محصول در این اجرا skip می‌شود */
    lockedUntil: timestamp("locked_until"),
    /** سیگنال مغز خارجی: نیاز به استعلام/پوش مجدد از فروشگاه (کف منقضی یا فروش زیر هزینه انبار) */
    needsRefresh: boolean("needs_refresh").default(false).notNull(),
    /** لیست پیشنهادهای قیمت همکاران / تامین‌کنندگان برای این محصول */
    supplierQuotes: jsonb("supplier_quotes").$type<SupplierQuote[]>().default([]).notNull(),
    /** نام همکار منتخب فعلی */
    selectedSupplierName: text("selected_supplier_name"),
    /** خط قرمز فعلی فروش (تمام‌شده همکار + حداقل سود) */
    currentHardFloorPrice: integer("current_hard_floor_price"),
    /** حداقل حاشیه سود درصدی (override پروفایل) */
    minMarginPct: real("min_margin_pct"),
    /** حداقل سود خالص تومانی در هر فروش (override پروفایل) */
    minProfitAmount: integer("min_profit_amount"),
    /**
     * اولویت/نوع کمپین اختصاصی برای این کارت محصول (اختیاری):
     * auto (انتخاب خودکار بر اساس قوانین کمپین‌ها و رنج کارت‌ها) | flash | featured | timed_sale | none
     */
    preferredCampaignType: varchar("preferred_campaign_type", { length: 30 }).default("auto").notNull(),
    /** آیا در صورت قرارگیری در تخفیف زمان‌دار (timed_sale)، در بخش منتخب‌های صفحه اصلی نمایش داده شود؟ */
    showInFeatured: boolean("show_in_featured").default(true).notNull(),
    profileId: integer("profile_id").references(() => pricingProfiles.id, { onDelete: "set null" }),
    /** اگر false باشد، هر تصمیم نیاز به تأیید انسانی دارد */
    autoApply: boolean("auto_apply").default(true).notNull(),
    status: varchar("status", { length: 30 }).default("active").notNull(), // active | paused | needs_review
    currentBasePrice: integer("current_base_price"),
    currentFinalPrice: integer("current_final_price"),
    currentDiscountPct: real("current_discount_pct"),
    currentCampaign: varchar("current_campaign", { length: 30 }),
    currentCampaignName: text("current_campaign_name"),
    currentBadgeTheme: varchar("current_badge_theme", { length: 30 }).default("green-orange"),
    currentShowInFeatured: boolean("current_show_in_featured").default(false),
    lastDecisionId: integer("last_decision_id"),
    lastCheckedAt: timestamp("last_checked_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("products_status_idx").on(t.status)],
);

/** هر بار اجرای موتور قیمت (دستی/زمان‌بندی/API) */
export const priceRuns = pgTable("price_runs", {
  id: serial("id").primaryKey(),
  trigger: varchar("trigger", { length: 30 }).notNull(), // manual | schedule | api
  status: varchar("status", { length: 30 }).default("running").notNull(), // running | done | failed
  scheduleId: integer("schedule_id"),
  totalProducts: integer("total_products").default(0).notNull(),
  applied: integer("applied").default(0).notNull(),
  pendingReview: integer("pending_review").default(0).notNull(),
  failed: integer("failed").default(0).notNull(),
  error: text("error"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
});

/** تصمیم قیمت برای یک محصول در یک اجرا (با توضیح کامل مراحل، کف و سقف بازار و کمپین سهگانه) */
export const priceDecisions = pgTable(
  "price_decisions",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id").references(() => priceRuns.id, { onDelete: "set null" }),
    productId: integer("product_id")
      .references(() => products.id, { onDelete: "cascade" })
      .notNull(),
    source: varchar("source", { length: 30 }).notNull(),
    offersTotal: integer("offers_total").default(0).notNull(),
    offersUsed: integer("offers_used").default(0).notNull(),
    effectiveCostPrice: integer("effective_cost_price"),
    hardFloorPrice: integer("hard_floor_price"),
    lowestRaw: integer("lowest_raw"),
    lowestValid: integer("lowest_valid"),
    /** سقف واقعی بازار تحت رصد (پس از حذف قیمت‌های پرت ترب) */
    monitoredMarketCeiling: integer("monitored_market_ceiling"),
    localLowestValid: integer("local_lowest_valid"),
    marketMedian: integer("market_median"),
    marketMean: integer("market_mean"),
    referencePrice: integer("reference_price"),
    /** قیمت سقف کالیبره‌شده (معیار تخفیف) */
    basePrice: integer("base_price"),
    /** قیمت کف نهایی (پس از اعمال درصد تخفیف روی سقف) */
    finalPrice: integer("final_price"),
    discountPct: real("discount_pct"),
    /** نوع کمپین در sgeooole: flash | featured | timed_sale | none */
    campaignType: varchar("campaign_type", { length: 30 }),
    /** نام کمپین (به‌ویژه برای تخفیف‌های زمان‌دار بخش مالی Sale) */
    campaignName: text("campaign_name"),
    /** تم رنگی برچسب در sgeooole: green-orange | gold-red | red-purple */
    badgeTheme: varchar("badge_theme", { length: 30 }),
    /** آیا در بخش منتخب‌های صفحه اصلی نمایش داده شود؟ */
    showInFeatured: boolean("show_in_featured").default(true).notNull(),
    strategy: varchar("strategy", { length: 40 }),
    competitionTier: varchar("competition_tier", { length: 40 }),
    projectedNationalRank: integer("projected_national_rank"),
    projectedLocalRank: integer("projected_local_rank"),
    netProfitToman: integer("net_profit_toman"),
    netMarginPct: real("net_margin_pct"),
    confidence: real("confidence").default(0).notNull(),
    status: varchar("status", { length: 30 }).notNull(), // applied | pending_review | rejected | failed | skipped
    steps: jsonb("steps").$type<DecisionStep[]>().default([]).notNull(),
    /** نسخه‌ی موتور ۴.۱ که این تصمیم را ساخته (قابل‌ردیابی) */
    engineVersion: varchar("engine_version", { length: 20 }).default("4.1.0").notNull(),
    /** فروشنده suspect_low زیر قیمت پیشنهادی ما (market_conflict → review) */
    marketConflict: boolean("market_conflict").default(false).notNull(),
    /** مرجع مقایسه تخفیف: none | own_price_7d | market_p75 */
    referenceKind: varchar("reference_kind", { length: 30 }),
    /** کف نهایی متناسب با مرجع/کف بازار و از روی کف دقیق اعمال شد (true) یا به‌قدر لازم کالیبره نشده (false) */
    floorConfirmed: boolean("floor_confirmed").default(false).notNull(),
    pushStatus: varchar("push_status", { length: 30 }), // pushed | failed | skipped
    pushError: text("push_error"),
    pushedAt: timestamp("pushed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("decisions_product_idx").on(t.productId), index("decisions_run_idx").on(t.runId)],
);

/** پیشنهادهای رقبا (اسنپ‌شات ترب شامل شهر فروشنده و نوع آنلاین/حضوری) برای هر تصمیم */
export const competitorOffers = pgTable(
  "competitor_offers",
  {
    id: serial("id").primaryKey(),
    decisionId: integer("decision_id")
      .references(() => priceDecisions.id, { onDelete: "cascade" })
      .notNull(),
    productId: integer("product_id").notNull(),
    shopName: text("shop_name").notNull(),
    shopId: text("shop_id"),
    shopCity: text("shop_city"),
    sellerType: varchar("seller_type", { length: 20 }).default("online").notNull(),
    shopScore: real("shop_score"),
    isLocalCity: boolean("is_local_city").default(false).notNull(),
    priceUnreliable: boolean("price_unreliable").default(false).notNull(),
    price: integer("price").notNull(),
    lastChangedAt: timestamp("last_changed_at"),
    isAd: boolean("is_ad").default(false).notNull(),
    inStock: boolean("in_stock").default(true).notNull(),
    url: text("url"),
    included: boolean("included").default(true).notNull(),
    excludeReason: text("exclude_reason"),
    weight: real("weight").default(1).notNull(),
  },
  (t) => [index("offers_decision_idx").on(t.decisionId)],
);

/**
 * کمپین‌های تخفیف سهگانه منطبق با معماری sgeooole + فیلتر رنج کارت‌ها:
 *  1) flash      -> پیشنهاد لحظه‌ای در صفحه اصلی (Product.isFlashDeal)
 *  2) featured   -> پیشنهاد شگفت‌انگیز در صفحه اصلی (Product.isSpecialOffer)
 *  3) timed_sale -> مدیریت فرصت‌های زمان‌دار در بخش مالی و تخفیف (مدل Sale در sgeooole با قابلیت نمایش در منتخب‌های صفحه اصلی)
 */
export const discountCampaigns = pgTable("discount_campaigns", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  /** نوع کمپین: flash | featured | timed_sale */
  type: varchar("type", { length: 30 }).notNull(),
  active: boolean("active").default(true).notNull(),
  priority: integer("priority").default(0).notNull(),
  minDiscountPct: real("min_discount_pct").default(0).notNull(),
  maxDiscountPct: real("max_discount_pct").default(100).notNull(),
  /** تم برچسب در sgeooole: green-orange | gold-red | red-purple */
  badgeTheme: varchar("badge_theme", { length: 30 }).default("green-orange").notNull(),
  /** آیا کارت‌های این کمپین در بخش «منتخب‌ها»ی صفحه اصلی نمایش داده شوند؟ (مخصوص timed_sale و featured) */
  showInFeatured: boolean("show_in_featured").default(true).notNull(),
  /** رنج شماره کارت‌ها: شروع از کارت شماره (۱-based؛ ۱ = از اولین کارت) */
  cardRangeFrom: integer("card_range_from").default(1).notNull(),
  /** رنج شماره کارت‌ها: تا کارت شماره (۰ = بدون محدودیت پایان) */
  cardRangeTo: integer("card_range_to").default(0).notNull(),
  /** حداکثر تعداد کارت مجاز برای قرارگیری در این کمپین در هر اجرا (۰ = نامحدود) */
  maxCards: integer("max_cards").default(0).notNull(),
  /** حداقل قیمت کف محصول (تومان) برای ورود به این رنج کارت‌ها (۰ = بدون کف) */
  minPriceToman: integer("min_price_toman").default(0).notNull(),
  /** حداکثر قیمت کف محصول (تومان) برای ورود به این رنج کارت‌ها (۰ = نامحدود) */
  maxPriceToman: integer("max_price_toman").default(0).notNull(),
  /** فقط کارت‌هایی که در مشهد یا کل ترب رتبه ۱ تا ۳ دارند وارد این کمپین شوند */
  onlyTopRanked: boolean("only_top_ranked").default(false).notNull(),
  /** شناسه‌های محصولات خاص انتخاب‌شده برای این کمپین (خالی = همه محصولات مطابق با فیلتر رنج) */
  targetProductIds: jsonb("target_product_ids").$type<number[]>().default([]).notNull(),
  /** ساعات فعال (0-23)؛ خالی = همه ساعات */
  activeHours: jsonb("active_hours").$type<number[]>().default([]).notNull(),
  /** روزهای هفته فعال (0=یکشنبه ... 6=شنبه)؛ خالی = همه روزها */
  activeDays: jsonb("active_days").$type<number[]>().default([]).notNull(),
  /** دسته‌بندی‌های مجاز؛ خالی = همه */
  categories: jsonb("categories").$type<string[]>().default([]).notNull(),
  /** مدت اعتبار تخفیف بعد از اعمال (ساعت) */
  durationHours: integer("duration_hours").default(24).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** زمان‌بندی اجرای خودکار */
export const schedules = pgTable("schedules", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  intervalMinutes: integer("interval_minutes").default(360).notNull(),
  active: boolean("active").default(true).notNull(),
  filter: jsonb("filter").$type<{ category?: string; productIds?: number[] }>().default({}).notNull(),
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** کانکتور فروشگاه (sgeooole / ووکامرس / وب‌هوک عمومی) */
export const storeConnectors = pgTable("store_connectors", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: varchar("type", { length: 30 }).notNull(),
  active: boolean("active").default(false).notNull(),
  config: jsonb("config").$type<Record<string, string>>().default({}).notNull(),
  lastPushAt: timestamp("last_push_at"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** لاگ فعالیت */
export const activityLogs = pgTable("activity_logs", {
  id: serial("id").primaryKey(),
  level: varchar("level", { length: 10 }).default("info").notNull(),
  scope: varchar("scope", { length: 50 }).notNull(),
  message: text("message").notNull(),
  meta: jsonb("meta").default({}).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type DecisionStep = {
  step: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  level?: "info" | "warn" | "error";
};

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type PriceDecision = typeof priceDecisions.$inferSelect;
export type CompetitorOffer = typeof competitorOffers.$inferSelect;
export type DiscountCampaign = typeof discountCampaigns.$inferSelect;
export type PricingProfile = typeof pricingProfiles.$inferSelect;
export type Schedule = typeof schedules.$inferSelect;
export type StoreConnector = typeof storeConnectors.$inferSelect;
export type PriceRun = typeof priceRuns.$inferSelect;
