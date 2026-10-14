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
import type { PricingProfileConfig } from "@/lib/pricing/types";

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
    /** شناسه محصول در فروشگاه (مثلاً ID ووکامرس) */
    storeExternalId: text("store_external_id"),
    /** منبع استعلام: torob | mock | manual */
    sourceType: varchar("source_type", { length: 30 }).default("torob").notNull(),
    torobUrl: text("torob_url"),
    torobPrk: text("torob_prk"),
    /** قیمت تمام‌شده (تومان) */
    costPrice: integer("cost_price").default(0).notNull(),
    /** حداقل حاشیه سود درصدی (override پروفایل) */
    minMarginPct: real("min_margin_pct"),
    profileId: integer("profile_id").references(() => pricingProfiles.id, { onDelete: "set null" }),
    /** اگر false باشد، هر تصمیم نیاز به تأیید انسانی دارد */
    autoApply: boolean("auto_apply").default(true).notNull(),
    status: varchar("status", { length: 30 }).default("active").notNull(), // active | paused | needs_review
    currentBasePrice: integer("current_base_price"),
    currentFinalPrice: integer("current_final_price"),
    currentDiscountPct: real("current_discount_pct"),
    currentCampaign: varchar("current_campaign", { length: 30 }),
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

/** تصمیم قیمت برای یک محصول در یک اجرا (با توضیح کامل مراحل) */
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
    lowestRaw: integer("lowest_raw"),
    lowestValid: integer("lowest_valid"),
    marketMedian: integer("market_median"),
    marketMean: integer("market_mean"),
    referencePrice: integer("reference_price"),
    basePrice: integer("base_price"),
    finalPrice: integer("final_price"),
    discountPct: real("discount_pct"),
    campaignType: varchar("campaign_type", { length: 30 }),
    strategy: varchar("strategy", { length: 40 }),
    confidence: real("confidence").default(0).notNull(),
    status: varchar("status", { length: 30 }).notNull(), // applied | pending_review | rejected | failed | skipped
    steps: jsonb("steps").$type<DecisionStep[]>().default([]).notNull(),
    pushStatus: varchar("push_status", { length: 30 }), // pushed | failed | skipped
    pushError: text("push_error"),
    pushedAt: timestamp("pushed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("decisions_product_idx").on(t.productId), index("decisions_run_idx").on(t.runId)],
);

/** پیشنهادهای رقبا (اسنپ‌شات ترب) برای هر تصمیم */
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

/** کمپین‌های تخفیف: لحظه‌ای (flash) و منتخب/شگفت‌انگیز (featured) */
export const discountCampaigns = pgTable("discount_campaigns", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: varchar("type", { length: 30 }).notNull(), // flash | featured
  active: boolean("active").default(true).notNull(),
  priority: integer("priority").default(0).notNull(),
  minDiscountPct: real("min_discount_pct").default(0).notNull(),
  maxDiscountPct: real("max_discount_pct").default(100).notNull(),
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
  /** فیلتر محصولات: {category?: string, productIds?: number[]} */
  filter: jsonb("filter").$type<{ category?: string; productIds?: number[] }>().default({}).notNull(),
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** کانکتور فروشگاه (ووکامرس / وب‌هوک عمومی) */
export const storeConnectors = pgTable("store_connectors", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: varchar("type", { length: 30 }).notNull(), // woocommerce | webhook | none
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
