import { db } from "@/db";
import { discountCampaigns, pricingProfiles, schedules, storeConnectors, activityLogs } from "@/db/schema";
import { DEFAULT_PROFILE_CONFIG, type PricingProfileConfig } from "@/lib/pricing/types";
import { eq } from "drizzle-orm";

let bootstrapped = false;

/** ایجاد داده‌های پیش‌فرض (پروفایل، کمپین‌ها، زمان‌بندی، کانکتور) — idempotent */
export async function ensureDefaults(): Promise<void> {
  if (bootstrapped) return;
  const profiles = await db.select().from(pricingProfiles).limit(1);
  if (!profiles.length) {
    await db.insert(pricingProfiles).values({ name: "پروفایل پیش‌فرض", isDefault: true, config: DEFAULT_PROFILE_CONFIG });
  }
  const camps = await db.select().from(discountCampaigns).limit(1);
  if (!camps.length) {
    await db.insert(discountCampaigns).values([
      {
        name: "تخفیف لحظه‌ای",
        type: "flash",
        active: true,
        priority: 10,
        minDiscountPct: 12,
        maxDiscountPct: 100,
        activeHours: [],
        activeDays: [],
        categories: [],
        durationHours: 12,
      },
      {
        name: "منتخب / شگفت‌انگیز",
        type: "featured",
        active: true,
        priority: 5,
        minDiscountPct: 3,
        maxDiscountPct: 100,
        activeHours: [],
        activeDays: [],
        categories: [],
        durationHours: 72,
      },
    ]);
  }
  const sch = await db.select().from(schedules).limit(1);
  if (!sch.length) {
    await db.insert(schedules).values({
      name: "استعلام خودکار هر ۶ ساعت",
      intervalMinutes: 360,
      active: true,
      filter: {},
      nextRunAt: new Date(Date.now() + 360 * 60000),
    });
  }
  const conn = await db.select().from(storeConnectors).limit(1);
  if (!conn.length) {
    await db.insert(storeConnectors).values([
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
  return {
    filters: { ...d.filters, ...(p.filters ?? {}) },
    outliers: { ...d.outliers, ...(p.outliers ?? {}) },
    aggregation: { ...d.aggregation, ...(p.aggregation ?? {}) },
    rank1: { ...d.rank1, ...(p.rank1 ?? {}) },
    margin: { ...d.margin, ...(p.margin ?? {}) },
    guards: { ...d.guards, ...(p.guards ?? {}) },
    discount: { ...d.discount, ...(p.discount ?? {}) },
    rounding: { ...d.rounding, ...(p.rounding ?? {}) },
    ai: { ...d.ai, ...(p.ai ?? {}) },
  };
}

export async function logActivity(scope: string, message: string, meta: Record<string, unknown> = {}, level: "info" | "warn" | "error" = "info") {
  try {
    await db.insert(activityLogs).values({ scope, message, meta, level });
  } catch {
    // لاگ نباید جریان اصلی را بشکند
  }
}
