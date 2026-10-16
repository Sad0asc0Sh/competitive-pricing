"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.storeConnectors = exports.settings = exports.schedules = exports.products = exports.pricingProfiles = exports.priceRuns = exports.priceDecisions = exports.discountCampaigns = exports.competitorOffers = exports.activityLogs = void 0;
var _pgCore = require("drizzle-orm/pg-core");
/** تنظیمات عمومی سیستم (key/value) */
const settings = (0, _pgCore.pgTable)("settings", {
  key: (0, _pgCore.varchar)("key", {
    length: 100
  }).primaryKey(),
  value: (0, _pgCore.jsonb)("value").notNull(),
  updatedAt: (0, _pgCore.timestamp)("updated_at").defaultNow().notNull()
});

/** پروفایل قیمت‌گذاری: تمام پارامترهای موتور قیمت در یک JSON قابل تنظیم */
exports.settings = settings;
const pricingProfiles = (0, _pgCore.pgTable)("pricing_profiles", {
  id: (0, _pgCore.serial)("id").primaryKey(),
  name: (0, _pgCore.text)("name").notNull(),
  isDefault: (0, _pgCore.boolean)("is_default").default(false).notNull(),
  config: (0, _pgCore.jsonb)("config").$type().notNull(),
  createdAt: (0, _pgCore.timestamp)("created_at").defaultNow().notNull(),
  updatedAt: (0, _pgCore.timestamp)("updated_at").defaultNow().notNull()
});

/** محصولات فروشگاه */
exports.pricingProfiles = pricingProfiles;
const products = (0, _pgCore.pgTable)("products", {
  id: (0, _pgCore.serial)("id").primaryKey(),
  sku: (0, _pgCore.varchar)("sku", {
    length: 100
  }).notNull().unique(),
  name: (0, _pgCore.text)("name").notNull(),
  category: (0, _pgCore.text)("category"),
  /** شناسه محصول در فروشگاه (مثلاً _id یا productCode در sgeooole یا ID ووکامرس) */
  storeExternalId: (0, _pgCore.text)("store_external_id"),
  /** منبع استعلام: torob (تنها منبع واقعی) | manual (ورود دستی هنگام اجرا) */
  sourceType: (0, _pgCore.varchar)("source_type", {
    length: 30
  }).default("torob").notNull(),
  torobUrl: (0, _pgCore.text)("torob_url"),
  torobPrk: (0, _pgCore.text)("torob_prk"),
  torobDetailsUrl: (0, _pgCore.text)("torob_details_url"),
  /** قیمت تمام‌شده پایه/دستی (تومان) */
  costPrice: (0, _pgCore.integer)("cost_price").default(0).notNull(),
  /** لیست پیشنهادهای قیمت همکاران / تامین‌کنندگان برای این محصول */
  supplierQuotes: (0, _pgCore.jsonb)("supplier_quotes").$type().default([]).notNull(),
  /** نام همکار منتخب فعلی */
  selectedSupplierName: (0, _pgCore.text)("selected_supplier_name"),
  /** خط قرمز فعلی فروش (تمام‌شده همکار + حداقل سود) */
  currentHardFloorPrice: (0, _pgCore.integer)("current_hard_floor_price"),
  /** حداقل حاشیه سود درصدی (override پروفایل) */
  minMarginPct: (0, _pgCore.real)("min_margin_pct"),
  /** حداقل سود خالص تومانی در هر فروش (override پروفایل) */
  minProfitAmount: (0, _pgCore.integer)("min_profit_amount"),
  /**
   * اولویت/نوع کمپین اختصاصی برای این کارت محصول (اختیاری):
   * auto (انتخاب خودکار بر اساس قوانین کمپین‌ها و رنج کارت‌ها) | flash | featured | timed_sale | none
   */
  preferredCampaignType: (0, _pgCore.varchar)("preferred_campaign_type", {
    length: 30
  }).default("auto").notNull(),
  /** آیا در صورت قرارگیری در تخفیف زمان‌دار (timed_sale)، در بخش منتخب‌های صفحه اصلی نمایش داده شود؟ */
  showInFeatured: (0, _pgCore.boolean)("show_in_featured").default(true).notNull(),
  profileId: (0, _pgCore.integer)("profile_id").references(() => pricingProfiles.id, {
    onDelete: "set null"
  }),
  /** اگر false باشد، هر تصمیم نیاز به تأیید انسانی دارد */
  autoApply: (0, _pgCore.boolean)("auto_apply").default(true).notNull(),
  status: (0, _pgCore.varchar)("status", {
    length: 30
  }).default("active").notNull(),
  // active | paused | needs_review
  currentBasePrice: (0, _pgCore.integer)("current_base_price"),
  currentFinalPrice: (0, _pgCore.integer)("current_final_price"),
  currentDiscountPct: (0, _pgCore.real)("current_discount_pct"),
  currentCampaign: (0, _pgCore.varchar)("current_campaign", {
    length: 30
  }),
  currentCampaignName: (0, _pgCore.text)("current_campaign_name"),
  currentBadgeTheme: (0, _pgCore.varchar)("current_badge_theme", {
    length: 30
  }).default("green-orange"),
  currentShowInFeatured: (0, _pgCore.boolean)("current_show_in_featured").default(false),
  lastDecisionId: (0, _pgCore.integer)("last_decision_id"),
  lastCheckedAt: (0, _pgCore.timestamp)("last_checked_at"),
  createdAt: (0, _pgCore.timestamp)("created_at").defaultNow().notNull(),
  updatedAt: (0, _pgCore.timestamp)("updated_at").defaultNow().notNull()
}, t => [(0, _pgCore.index)("products_status_idx").on(t.status)]);

/** هر بار اجرای موتور قیمت (دستی/زمان‌بندی/API) */
exports.products = products;
const priceRuns = (0, _pgCore.pgTable)("price_runs", {
  id: (0, _pgCore.serial)("id").primaryKey(),
  trigger: (0, _pgCore.varchar)("trigger", {
    length: 30
  }).notNull(),
  // manual | schedule | api
  status: (0, _pgCore.varchar)("status", {
    length: 30
  }).default("running").notNull(),
  // running | done | failed
  scheduleId: (0, _pgCore.integer)("schedule_id"),
  totalProducts: (0, _pgCore.integer)("total_products").default(0).notNull(),
  applied: (0, _pgCore.integer)("applied").default(0).notNull(),
  pendingReview: (0, _pgCore.integer)("pending_review").default(0).notNull(),
  failed: (0, _pgCore.integer)("failed").default(0).notNull(),
  error: (0, _pgCore.text)("error"),
  startedAt: (0, _pgCore.timestamp)("started_at").defaultNow().notNull(),
  finishedAt: (0, _pgCore.timestamp)("finished_at")
});

/** تصمیم قیمت برای یک محصول در یک اجرا (با توضیح کامل مراحل، کف و سقف بازار و کمپین سهگانه) */
exports.priceRuns = priceRuns;
const priceDecisions = (0, _pgCore.pgTable)("price_decisions", {
  id: (0, _pgCore.serial)("id").primaryKey(),
  runId: (0, _pgCore.integer)("run_id").references(() => priceRuns.id, {
    onDelete: "set null"
  }),
  productId: (0, _pgCore.integer)("product_id").references(() => products.id, {
    onDelete: "cascade"
  }).notNull(),
  source: (0, _pgCore.varchar)("source", {
    length: 30
  }).notNull(),
  offersTotal: (0, _pgCore.integer)("offers_total").default(0).notNull(),
  offersUsed: (0, _pgCore.integer)("offers_used").default(0).notNull(),
  effectiveCostPrice: (0, _pgCore.integer)("effective_cost_price"),
  hardFloorPrice: (0, _pgCore.integer)("hard_floor_price"),
  lowestRaw: (0, _pgCore.integer)("lowest_raw"),
  lowestValid: (0, _pgCore.integer)("lowest_valid"),
  /** سقف واقعی بازار تحت رصد (پس از حذف قیمت‌های پرت ترب) */
  monitoredMarketCeiling: (0, _pgCore.integer)("monitored_market_ceiling"),
  localLowestValid: (0, _pgCore.integer)("local_lowest_valid"),
  marketMedian: (0, _pgCore.integer)("market_median"),
  marketMean: (0, _pgCore.integer)("market_mean"),
  referencePrice: (0, _pgCore.integer)("reference_price"),
  /** قیمت سقف کالیبره‌شده (معیار تخفیف) */
  basePrice: (0, _pgCore.integer)("base_price"),
  /** قیمت کف نهایی (پس از اعمال درصد تخفیف روی سقف) */
  finalPrice: (0, _pgCore.integer)("final_price"),
  discountPct: (0, _pgCore.real)("discount_pct"),
  /** نوع کمپین در sgeooole: flash | featured | timed_sale | none */
  campaignType: (0, _pgCore.varchar)("campaign_type", {
    length: 30
  }),
  /** نام کمپین (به‌ویژه برای تخفیف‌های زمان‌دار بخش مالی Sale) */
  campaignName: (0, _pgCore.text)("campaign_name"),
  /** تم رنگی برچسب در sgeooole: green-orange | gold-red | red-purple */
  badgeTheme: (0, _pgCore.varchar)("badge_theme", {
    length: 30
  }),
  /** آیا در بخش منتخب‌های صفحه اصلی نمایش داده شود؟ */
  showInFeatured: (0, _pgCore.boolean)("show_in_featured").default(true).notNull(),
  strategy: (0, _pgCore.varchar)("strategy", {
    length: 40
  }),
  competitionTier: (0, _pgCore.varchar)("competition_tier", {
    length: 40
  }),
  projectedNationalRank: (0, _pgCore.integer)("projected_national_rank"),
  projectedLocalRank: (0, _pgCore.integer)("projected_local_rank"),
  netProfitToman: (0, _pgCore.integer)("net_profit_toman"),
  netMarginPct: (0, _pgCore.real)("net_margin_pct"),
  confidence: (0, _pgCore.real)("confidence").default(0).notNull(),
  status: (0, _pgCore.varchar)("status", {
    length: 30
  }).notNull(),
  // applied | pending_review | rejected | failed | skipped
  steps: (0, _pgCore.jsonb)("steps").$type().default([]).notNull(),
  pushStatus: (0, _pgCore.varchar)("push_status", {
    length: 30
  }),
  // pushed | failed | skipped
  pushError: (0, _pgCore.text)("push_error"),
  pushedAt: (0, _pgCore.timestamp)("pushed_at"),
  createdAt: (0, _pgCore.timestamp)("created_at").defaultNow().notNull()
}, t => [(0, _pgCore.index)("decisions_product_idx").on(t.productId), (0, _pgCore.index)("decisions_run_idx").on(t.runId)]);

/** پیشنهادهای رقبا (اسنپ‌شات ترب شامل شهر فروشنده و نوع آنلاین/حضوری) برای هر تصمیم */
exports.priceDecisions = priceDecisions;
const competitorOffers = (0, _pgCore.pgTable)("competitor_offers", {
  id: (0, _pgCore.serial)("id").primaryKey(),
  decisionId: (0, _pgCore.integer)("decision_id").references(() => priceDecisions.id, {
    onDelete: "cascade"
  }).notNull(),
  productId: (0, _pgCore.integer)("product_id").notNull(),
  shopName: (0, _pgCore.text)("shop_name").notNull(),
  shopId: (0, _pgCore.text)("shop_id"),
  shopCity: (0, _pgCore.text)("shop_city"),
  sellerType: (0, _pgCore.varchar)("seller_type", {
    length: 20
  }).default("online").notNull(),
  shopScore: (0, _pgCore.real)("shop_score"),
  isLocalCity: (0, _pgCore.boolean)("is_local_city").default(false).notNull(),
  priceUnreliable: (0, _pgCore.boolean)("price_unreliable").default(false).notNull(),
  price: (0, _pgCore.integer)("price").notNull(),
  lastChangedAt: (0, _pgCore.timestamp)("last_changed_at"),
  isAd: (0, _pgCore.boolean)("is_ad").default(false).notNull(),
  inStock: (0, _pgCore.boolean)("in_stock").default(true).notNull(),
  url: (0, _pgCore.text)("url"),
  included: (0, _pgCore.boolean)("included").default(true).notNull(),
  excludeReason: (0, _pgCore.text)("exclude_reason"),
  weight: (0, _pgCore.real)("weight").default(1).notNull()
}, t => [(0, _pgCore.index)("offers_decision_idx").on(t.decisionId)]);

/**
 * کمپین‌های تخفیف سهگانه منطبق با معماری sgeooole + فیلتر رنج کارت‌ها:
 *  1) flash      -> پیشنهاد لحظه‌ای در صفحه اصلی (Product.isFlashDeal)
 *  2) featured   -> پیشنهاد شگفت‌انگیز در صفحه اصلی (Product.isSpecialOffer)
 *  3) timed_sale -> مدیریت فرصت‌های زمان‌دار در بخش مالی و تخفیف (مدل Sale در sgeooole با قابلیت نمایش در منتخب‌های صفحه اصلی)
 */
exports.competitorOffers = competitorOffers;
const discountCampaigns = (0, _pgCore.pgTable)("discount_campaigns", {
  id: (0, _pgCore.serial)("id").primaryKey(),
  name: (0, _pgCore.text)("name").notNull(),
  /** نوع کمپین: flash | featured | timed_sale */
  type: (0, _pgCore.varchar)("type", {
    length: 30
  }).notNull(),
  active: (0, _pgCore.boolean)("active").default(true).notNull(),
  priority: (0, _pgCore.integer)("priority").default(0).notNull(),
  minDiscountPct: (0, _pgCore.real)("min_discount_pct").default(0).notNull(),
  maxDiscountPct: (0, _pgCore.real)("max_discount_pct").default(100).notNull(),
  /** تم برچسب در sgeooole: green-orange | gold-red | red-purple */
  badgeTheme: (0, _pgCore.varchar)("badge_theme", {
    length: 30
  }).default("green-orange").notNull(),
  /** آیا کارت‌های این کمپین در بخش «منتخب‌ها»ی صفحه اصلی نمایش داده شوند؟ (مخصوص timed_sale و featured) */
  showInFeatured: (0, _pgCore.boolean)("show_in_featured").default(true).notNull(),
  /** رنج شماره کارت‌ها: شروع از کارت شماره (۱-based؛ ۱ = از اولین کارت) */
  cardRangeFrom: (0, _pgCore.integer)("card_range_from").default(1).notNull(),
  /** رنج شماره کارت‌ها: تا کارت شماره (۰ = بدون محدودیت پایان) */
  cardRangeTo: (0, _pgCore.integer)("card_range_to").default(0).notNull(),
  /** حداکثر تعداد کارت مجاز برای قرارگیری در این کمپین در هر اجرا (۰ = نامحدود) */
  maxCards: (0, _pgCore.integer)("max_cards").default(0).notNull(),
  /** حداقل قیمت کف محصول (تومان) برای ورود به این رنج کارت‌ها (۰ = بدون کف) */
  minPriceToman: (0, _pgCore.integer)("min_price_toman").default(0).notNull(),
  /** حداکثر قیمت کف محصول (تومان) برای ورود به این رنج کارت‌ها (۰ = نامحدود) */
  maxPriceToman: (0, _pgCore.integer)("max_price_toman").default(0).notNull(),
  /** فقط کارت‌هایی که در مشهد یا کل ترب رتبه ۱ تا ۳ دارند وارد این کمپین شوند */
  onlyTopRanked: (0, _pgCore.boolean)("only_top_ranked").default(false).notNull(),
  /** شناسه‌های محصولات خاص انتخاب‌شده برای این کمپین (خالی = همه محصولات مطابق با فیلتر رنج) */
  targetProductIds: (0, _pgCore.jsonb)("target_product_ids").$type().default([]).notNull(),
  /** ساعات فعال (0-23)؛ خالی = همه ساعات */
  activeHours: (0, _pgCore.jsonb)("active_hours").$type().default([]).notNull(),
  /** روزهای هفته فعال (0=یکشنبه ... 6=شنبه)؛ خالی = همه روزها */
  activeDays: (0, _pgCore.jsonb)("active_days").$type().default([]).notNull(),
  /** دسته‌بندی‌های مجاز؛ خالی = همه */
  categories: (0, _pgCore.jsonb)("categories").$type().default([]).notNull(),
  /** مدت اعتبار تخفیف بعد از اعمال (ساعت) */
  durationHours: (0, _pgCore.integer)("duration_hours").default(24).notNull(),
  createdAt: (0, _pgCore.timestamp)("created_at").defaultNow().notNull()
});

/** زمان‌بندی اجرای خودکار */
exports.discountCampaigns = discountCampaigns;
const schedules = (0, _pgCore.pgTable)("schedules", {
  id: (0, _pgCore.serial)("id").primaryKey(),
  name: (0, _pgCore.text)("name").notNull(),
  intervalMinutes: (0, _pgCore.integer)("interval_minutes").default(360).notNull(),
  active: (0, _pgCore.boolean)("active").default(true).notNull(),
  filter: (0, _pgCore.jsonb)("filter").$type().default({}).notNull(),
  lastRunAt: (0, _pgCore.timestamp)("last_run_at"),
  nextRunAt: (0, _pgCore.timestamp)("next_run_at"),
  createdAt: (0, _pgCore.timestamp)("created_at").defaultNow().notNull()
});

/** کانکتور فروشگاه (sgeooole / ووکامرس / وب‌هوک عمومی) */
exports.schedules = schedules;
const storeConnectors = (0, _pgCore.pgTable)("store_connectors", {
  id: (0, _pgCore.serial)("id").primaryKey(),
  name: (0, _pgCore.text)("name").notNull(),
  type: (0, _pgCore.varchar)("type", {
    length: 30
  }).notNull(),
  active: (0, _pgCore.boolean)("active").default(false).notNull(),
  config: (0, _pgCore.jsonb)("config").$type().default({}).notNull(),
  lastPushAt: (0, _pgCore.timestamp)("last_push_at"),
  lastError: (0, _pgCore.text)("last_error"),
  createdAt: (0, _pgCore.timestamp)("created_at").defaultNow().notNull()
});

/** لاگ فعالیت */
exports.storeConnectors = storeConnectors;
const activityLogs = (0, _pgCore.pgTable)("activity_logs", {
  id: (0, _pgCore.serial)("id").primaryKey(),
  level: (0, _pgCore.varchar)("level", {
    length: 10
  }).default("info").notNull(),
  scope: (0, _pgCore.varchar)("scope", {
    length: 50
  }).notNull(),
  message: (0, _pgCore.text)("message").notNull(),
  meta: (0, _pgCore.jsonb)("meta").default({}).notNull(),
  createdAt: (0, _pgCore.timestamp)("created_at").defaultNow().notNull()
});
exports.activityLogs = activityLogs;