import type { DiscountCampaign } from "@/db/schema";
import type { DiscountDecisionKind, SgeoooleBadgeTheme, SgeoooleCampaignType } from "./types";

export interface CampaignPick {
  type: SgeoooleCampaignType; // flash | featured | timed_sale | none
  campaignId: number | null;
  name: string;
  campaignName: string | null;
  badgeTheme: SgeoooleBadgeTheme;
  showInFeatured: boolean;
  endsAt: Date | null;
  reason: string;
}

export interface CampaignMatchInput {
  discountPct: number;
  finalPrice?: number | null;
  productId?: number;
  category?: string | null;
  /** شماره ردیف کارت در اجرای فعلی (۱-based) — فقط برای انتخاب صریح با targetProductIds کار می‌کند */
  cardIndex?: number;
  /** رتبه پیش‌بینی‌شده در شهر مشهد یا کل ترب */
  projectedLocalRank?: number | null;
  projectedNationalRank?: number | null;
  /** اگر روی خود کارت محصول نوع کمپین خاصی قفل شده باشد */
  preferredCampaignType?: string | null;
  preferredShowInFeatured?: boolean | null;
  /** شمارنده تعداد کارت‌های تخصیص‌یافته به هر کمپین در اجرای فعلی (برای رعایت سقف maxCards) */
  allocatedCounts?: Map<number, number> | Record<number, number>;
  now?: Date;
  /** مرجع تخفیف تصمیم: کمپین flash فقط با مرجع own_price_7d معتبر است */
  discountKind?: DiscountDecisionKind | null;
  /** میانگین قیمت خودی ۷ روزی (برای گیت واقعی افت ≥ ۸٪ در flash) */
  ownAvg7d?: number | null;
  nowClock?: { hour: number; day: number };
}

const TYPE_TITLE: Record<string, string> = {
  flash: "پیشنهاد لحظه‌ای (صفحه اصلی)",
  featured: "پیشنهاد شگفت‌انگیز (صفحه اصلی)",
  timed_sale: "فرصت زمان‌دار (بخش مالی و تخفیف)",
};

/** ساعت و روز هفته (۰=یکشنبه) در منطقه زمانی تهران — برای پنجره ساعت/روز کمپین‌ها */
export function tehranClock(now: Date): { hour: number; day: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Tehran",
      hour: "numeric",
      hour12: false,
      weekday: "short",
    }).formatToParts(now);
    const hourPart = parts.find((p) => p.type === "hour")?.value ?? "0";
    const dayPart = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
    const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return { hour: Number(hourPart) % 24, day: dayMap[dayPart] ?? now.getDay() };
  } catch {
    return { hour: now.getHours(), day: now.getDay() };
  }
}

function getAllocatedCount(
  store: Map<number, number> | Record<number, number> | undefined,
  id: number,
): number {
  if (!store) return 0;
  if (store instanceof Map) return store.get(id) ?? 0;
  return store[id] ?? 0;
}

/**
 * انتخاب هوشمند بین ۳ سیستم تخفیف فروشگاه sgeooole (نسخه ۴.۱):
 *  1. `flash`      -> پیشنهاد لحظه‌ای (فقط با مرجع own_price_7d و افت واقعی ≥ ۸٪ نسبت به میانگین ۷ روزه خودی)
 *  2. `featured`   -> پیشنهاد شگفت‌انگیز با آستانه نمایش (minDiscountPct)
 *  3. `timed_sale` -> فقط دستی (targetProductIds یا preferredCampaignType)
 * رنج کارت (cardRangeFrom/To) دیگر انتخاب خودکار را کنترل نمی‌کند؛ مگر برای تخصیص صریح.
 */
export function pickCampaign(
  campaigns: DiscountCampaign[],
  input: CampaignMatchInput,
): CampaignPick {
  const now = input.now ?? new Date();
  const { hour, day } = input.nowClock ?? tehranClock(now);
  const price = input.finalPrice ?? 0;

  if (input.preferredCampaignType === "none") {
    return {
      type: "none",
      campaignId: null,
      name: "بدون کمپین",
      campaignName: null,
      badgeTheme: "green-orange",
      showInFeatured: false,
      endsAt: null,
      reason: "کمپین تخفیف برای این کارت به صورت دستی غیرفعال شده است",
    };
  }

  // گیت واقعی بودنِ افت قیمت برای flash: مرجع own_price_7d + افت ≥ ۸٪ نسبت به میانگین ۷ روزه خودی
  const ownAvg = Math.round(Number(input.ownAvg7d ?? 0));
  const realDropPct = ownAvg > 0 && price > 0 ? ((ownAvg - price) / ownAvg) * 100 : null;
  const flashGatingOk =
    input.discountKind === "own_price_7d" && realDropPct != null && realDropPct >= 8;

  // اولویت‌بندی: کمپین‌های صریحاً برای این کارت هدف‌گذاری شده (استثنا بر قانون فرصت زمان‌دار) ثم اولویت بالاتر
  const explicitlyFor = (c: DiscountCampaign): number =>
    (input.productId != null &&
      Array.isArray(c.targetProductIds) &&
      c.targetProductIds.includes(input.productId)) ||
    (input.preferredCampaignType && input.preferredCampaignType !== "auto" && c.type === input.preferredCampaignType)
      ? 1
      : 0;

  const sortedCampaigns = [...campaigns]
    .filter((c) => c.active)
    .sort((a, b) => explicitlyFor(b) - explicitlyFor(a) || b.priority - a.priority);

  const eligible = sortedCampaigns.filter((c) => {
    const isExplicitlyTargeted =
      (Array.isArray(c.targetProductIds) &&
        input.productId != null &&
        c.targetProductIds.includes(input.productId)) ||
      (input.preferredCampaignType && input.preferredCampaignType === c.type);

    // P2-6: timed_sale هرگز انتخاب خودکار نمی‌شود؛ فقط تخصیص صریح
    if (c.type === "timed_sale" && !isExplicitlyTargeted) return false;

    // P2-6: flash فقط با افت واقعی ≥ ۸٪ نسبت به میانگین ۷ روزه خودی
    if (c.type === "flash" && !isExplicitlyTargeted && !flashGatingOk) return false;

    if (!isExplicitlyTargeted) {
      if (input.discountPct < c.minDiscountPct || input.discountPct > c.maxDiscountPct) {
        return false;
      }
    } else if (input.discountPct > c.maxDiscountPct) {
      return false;
    }

    if (Array.isArray(c.targetProductIds) && c.targetProductIds.length > 0) {
      if (input.productId == null || !c.targetProductIds.includes(input.productId)) {
        return false;
      }
    }

    // رنج کارت (cardRangeFrom/To) فقط برای تخصیص صریح معنای دارد؛ انتخاب خودکار خاموش است (P2-6/M8)
    const cardIdx = input.cardIndex ?? 1;
    if (isExplicitlyTargeted) {
      const rangeFrom = c.cardRangeFrom ?? 1;
      const rangeTo = c.cardRangeTo ?? 0;
      if (rangeFrom > 1 && cardIdx < rangeFrom) return false;
      if (rangeTo > 0 && cardIdx > rangeTo) return false;
    }

    const maxCards = c.maxCards ?? 0;
    if (maxCards > 0 && input.allocatedCounts) {
      const usedCount = getAllocatedCount(input.allocatedCounts, c.id);
      if (usedCount >= maxCards) return false;
    }

    const minP = c.minPriceToman ?? 0;
    const maxP = c.maxPriceToman ?? 0;
    if (price > 0) {
      if (minP > 0 && price < minP) return false;
      if (maxP > 0 && price > maxP) return false;
    }

    if (c.onlyTopRanked) {
      const localTop = input.projectedLocalRank != null && input.projectedLocalRank <= 3;
      const natTop = input.projectedNationalRank != null && input.projectedNationalRank <= 3;
      if (!localTop && !natTop) return false;
    }

    if (c.activeHours.length && !c.activeHours.includes(hour)) return false;
    if (c.activeDays.length && !c.activeDays.includes(day)) return false;
    if (c.categories.length && (!input.category || !c.categories.includes(input.category))) {
      return false;
    }

    return true;
  });

  const cardIdxLabel = input.cardIndex ?? 1;

  if (!eligible.length) {
    if (
      input.preferredCampaignType &&
      ["flash", "featured", "timed_sale"].includes(input.preferredCampaignType) &&
      input.discountPct > 0
    ) {
      const pType = input.preferredCampaignType as SgeoooleCampaignType;
      const fallbackName =
        pType === "flash"
          ? "پیشنهاد لحظه‌ای"
          : pType === "featured"
            ? "پیشنهاد شگفت‌انگیز"
            : "فروش ویژه زمان‌دار";
      return {
        type: pType,
        campaignId: null,
        name: fallbackName,
        campaignName: fallbackName,
        badgeTheme: pType === "flash" ? "gold-red" : pType === "featured" ? "red-purple" : "green-orange",
        showInFeatured: input.preferredShowInFeatured ?? true,
        endsAt: new Date(now.getTime() + (pType === "flash" ? 12 : 48) * 3600 * 1000),
        reason: `تخصیص مستقیم بر اساس تنظیم اختصاصی کارت محصول (${TYPE_TITLE[pType]})`,
      };
    }

    return {
      type: "none",
      campaignId: null,
      name: "بدون کمپین",
      campaignName: null,
      badgeTheme: "green-orange",
      showInFeatured: false,
      endsAt: null,
      reason:
        input.discountKind === "own_price_7d" || input.discountKind === "market_p75"
          ? "هیچ کمپینی با شرایط تخفیف/بازه قیمت/رتبه یا گیت واقعی‌بودن افت مطابقت ندارد"
          : "مرجع تخفیف معتبر (own_price_7d / market_p75) وجود ندارد — بدون کمپین",
    };
  }

  const c = eligible[0];
  const cType = (["flash", "featured", "timed_sale"].includes(c.type) ? c.type : "featured") as SgeoooleCampaignType;
  const badgeTheme = (
    ["green-orange", "gold-red", "red-purple"].includes(c.badgeTheme)
      ? c.badgeTheme
      : cType === "flash"
        ? "gold-red"
        : cType === "featured"
          ? "red-purple"
          : "green-orange"
  ) as SgeoooleBadgeTheme;
  const showInFeatured = input.preferredShowInFeatured ?? c.showInFeatured ?? true;

  return {
    type: cType,
    campaignId: c.id,
    name: c.name,
    campaignName: c.name,
    badgeTheme,
    showInFeatured,
    endsAt: new Date(now.getTime() + c.durationHours * 3600 * 1000),
    reason:
      `کمپین «${c.name}» (${TYPE_TITLE[cType] ?? cType}` +
      `${cType === "timed_sale" ? ` · ${showInFeatured ? "نمایش در منتخب‌های صفحه اصلی" : "فقط تخفیف بدون شلوغی صفحه اصلی"}` : ""}) ` +
      `با تخفیف ${input.discountPct}% روی سقف و ردیف کارت #${cardIdxLabel}` +
      (cType === "flash" && realDropPct != null ? ` · افت واقعی ${realDropPct.toFixed(1)}% نسبت به میانگین ۷ روزه خودی` : ""),
  };
}
