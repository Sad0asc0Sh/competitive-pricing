import { db } from "@/db";
import { discountCampaigns, pricingProfiles, schedules, storeConnectors, activityLogs } from "@/db/schema";
import { DEFAULT_PROFILE_CONFIG, type PricingProfileConfig } from "@/lib/pricing/types";
import { eq } from "drizzle-orm";

let bootstrapped = false;

/** ایجاد داده‌های پیش‌فرض (پروفایل، ۳ سیستم کمپین، زمان‌بندی، کانکتور sgeooole) — idempotent */
export async function ensureDefaults(): Promise<void> {
  if (bootstrapped) return;
  const profiles = await db.select().from(pricingProfiles).limit(1);
  if (!profiles.length) {
    await db.insert(pricingProfiles).values({
      name: "پروفایل پیش‌فرض (سود کم، فروش زیاد — ترب و مشهد)",
      isDefault: true,
      config: DEFAULT_PROFILE_CONFIG,
    });
  }
  const camps = await db.select().from(discountCampaigns).limit(1);
  if (!camps.length) {
    await db.insert(discountCampaigns).values([
      {
        name: "پیشنهاد لحظه‌ای (صفحه اصلی)",
        type: "flash",
        active: true,
        priority: 15,
        minDiscountPct: 12,
        maxDiscountPct: 45,
        activeHours: [],
        activeDays: [],
        categories: [],
        durationHours: 12,
        badgeTheme: "gold-red",
        showInFeatured: false,
        cardRangeFrom: 1,
        cardRangeTo: 8,
        maxCards: 8,
        minPriceToman: 0,
        maxPriceToman: 0,
        onlyTopRanked: true,
        targetProductIds: [],
      },
      {
        name: "پیشنهاد شگفت‌انگیز (صفحه اصلی)",
        type: "featured",
        active: true,
        priority: 10,
        minDiscountPct: 6,
        maxDiscountPct: 45,
        activeHours: [],
        activeDays: [],
        categories: [],
        durationHours: 48,
        badgeTheme: "red-purple",
        showInFeatured: true,
        cardRangeFrom: 1,
        cardRangeTo: 20,
        maxCards: 16,
        minPriceToman: 0,
        maxPriceToman: 0,
        onlyTopRanked: false,
        targetProductIds: [],
      },
      {
        name: "فروش ویژه زمان‌دار (مالی و تخفیف + منتخب‌ها)",
        type: "timed_sale",
        // پیش‌فرض غیرفعال تا هیچ کارتی با تخفیف ۵٪ به صورت ناخواسته وارد بخش «مالی و تخفیف» نشود؛
        // مدیر می‌تواند در صفحه کمپین‌ها رنج کارت و نام دلخواه را تنظیم و فعال کند.
        active: false,
        priority: 8,
        minDiscountPct: 10,
        maxDiscountPct: 45,
        activeHours: [],
        activeDays: [],
        categories: [],
        durationHours: 72,
        badgeTheme: "green-orange",
        showInFeatured: true,
        cardRangeFrom: 21,
        cardRangeTo: 50,
        maxCards: 0,
        minPriceToman: 0,
        maxPriceToman: 0,
        onlyTopRanked: false,
        targetProductIds: [],
      },
    ]);
  }
  const sch = await db.select().from(schedules).limit(1);
  if (!sch.length) {
    await db.insert(schedules).values({
      name: "استعلام خودکار هر ۳ ساعت (ترب و مشهد)",
      intervalMinutes: 180,
      active: true,
      filter: {},
      nextRunAt: new Date(Date.now() + 180 * 60000),
    });
  }
  const conn = await db.select().from(storeConnectors).limit(1);
  if (!conn.length) {
    await db.insert(storeConnectors).values([
      {
        name: "فروشگاه sgeooole (ekgkala-backend)",
        type: "sgeooole",
        active: false,
        config: { baseUrl: "http://localhost:5000", apiKey: "", adminToken: "" },
      },
      { name: "ووکامرس", type: "woocommerce", active: false, config: { baseUrl: "", consumerKey: "", consumerSecret: "" } },
      { name: "وب‌هوک عمومی", type: "webhook", active: false, config: { url: "", secret: "" } },
    ]);
  }
  bootstrapped = true;
}

export async function getProfileConfig(profileId?: number | null): Promise<{ id: number; config: PricingProfileConfig }> {
  await ensureDefaults();
  if (profileId) {
    const r = await db.select().from(pricingProfiles).where(eq(pricingProfiles.id, profileId)).limit(1);
    if (r[0]) return { id: r[0].id, config: mergeConfig(r[0].config) };
  }
  const d = await db.select().from(pricingProfiles).where(eq(pricingProfiles.isDefault, true)).limit(1);
  if (d[0]) return { id: d[0].id, config: mergeConfig(d[0].config) };
  const any = await db.select().from(pricingProfiles).limit(1);
  return { id: any[0].id, config: mergeConfig(any[0].config) };
}

/** ادغام با پیش‌فرض‌ها تا اگر فیلد جدیدی اضافه شد، پروفایل‌های قدیمی نشکنند */
export function mergeConfig(partial: Partial<PricingProfileConfig> | null | undefined): PricingProfileConfig {
  const d = DEFAULT_PROFILE_CONFIG;
  const p = partial ?? {};
  const pSup = p.supervisor ?? ({} as Partial<PricingProfileConfig["supervisor"]>);
  const pGates = pSup.gates ?? ({} as Partial<PricingProfileConfig["supervisor"]["gates"]>);

  // سازگاری پروفایل‌های قدیمی (۴.۱.۱):
  //  - اگر costPolicy ذخیره نشده ولی neverBelowManualCost هست، همان معنای قدیمی حفظ می‌شود
  //    (true → max_inventory_replacement، false → replacement_floor). وگرنه پیش‌فرض جدید.
  //  - اگر پله‌های undercut ذخیره نشده‌اند و پروفایل قدیمی undercutAmount/undercutPct غیرپیش‌فرض
  //    داشته، پله‌ها را خالی می‌گذاریم تا مقادیر صریح قدیمی نادیده گرفته نشوند.
  const pSourcing = { ...(p.sourcing ?? {}) };
  if (
    pSourcing.costPolicy == null &&
    p.sourcing &&
    typeof p.sourcing.neverBelowManualCost === "boolean"
  ) {
    pSourcing.costPolicy = p.sourcing.neverBelowManualCost
      ? "max_inventory_replacement"
      : "replacement_floor";
  }

  const pRank1 = { ...(p.rank1 ?? {}) };
  if (
    p.rank1 &&
    p.rank1.undercutTiers === undefined &&
    (p.rank1.undercutAmount !== undefined || p.rank1.undercutPct !== undefined)
  ) {
    // پروفایل قدیمی (قبل از پله‌های ۴.۱): مقادیر صریح undercutAmount/undercutPct حفظ می‌شوند.
    pRank1.undercutTiers = [];
  }

  return {
    sourcing: { ...d.sourcing, ...pSourcing },
    filters: { ...d.filters, ...(p.filters ?? {}) },
    outliers: { ...d.outliers, ...(p.outliers ?? {}) },
    aggregation: { ...d.aggregation, ...(p.aggregation ?? {}) },
    rank1: { ...d.rank1, ...pRank1 },
    margin: { ...d.margin, ...(p.margin ?? {}) },
    guards: { ...d.guards, ...(p.guards ?? {}) },
    discount: { ...d.discount, ...(p.discount ?? {}) },
    rounding: { ...d.rounding, ...(p.rounding ?? {}) },
    supervisor: {
      ...d.supervisor,
      ...pSup,
      gates: {
        identity_match: { ...d.supervisor.gates.identity_match, ...(pGates.identity_match ?? {}) },
        market_data_integrity: { ...d.supervisor.gates.market_data_integrity, ...(pGates.market_data_integrity ?? {}) },
        profit_and_rank_safety: { ...d.supervisor.gates.profit_and_rank_safety, ...(pGates.profit_and_rank_safety ?? {}) },
        ceiling_discount_validity: { ...d.supervisor.gates.ceiling_discount_validity, ...(pGates.ceiling_discount_validity ?? {}) },
      },
    },
    ai: { ...d.ai, ...(p.ai ?? {}) },
    costless: { ...d.costless, ...(p.costless ?? {}) },
    // نسخه‌ی موتور از کد جاری می‌آید، نه از پروفایل قدیمی؛ وگرنه تصمیم‌های ۴.۱.۱
    // با برچسب پروفایل ذخیره‌شده (مثلاً 4.1.0) ثبت می‌شوند.
    engine: { ...d.engine, ...(p.engine ?? {}), version: d.engine.version },
  };
}

export async function logActivity(scope: string, message: string, meta: Record<string, unknown> = {}, level: "info" | "warn" | "error" = "info") {
  try {
    await db.insert(activityLogs).values({ scope, message, meta, level });
  } catch {
    // لاگ نباید جریان اصلی را بشکند
  }
}
