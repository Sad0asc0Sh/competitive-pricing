import type { DiscountCampaign } from "@/db/schema";
import type { SgeoooleBadgeTheme, SgeoooleCampaignType } from "./types";

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
  /** شماره ردیف کارت در اجرای فعلی (۱-based) */
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
}

const TYPE_TITLE: Record<string, string> = {
  flash: "پیشنهاد لحظه‌ای (صفحه اصلی)",
  featured: "پیشنهاد شگفت‌انگیز (صفحه اصلی)",
  timed_sale: "فرصت زمان‌دار (بخش مالی و تخفیف)",
};

function getAllocatedCount(
  store: Map<number, number> | Record<number, number> | undefined,
  id: number,
): number {
  if (!store) return 0;
  if (store instanceof Map) return store.get(id) ?? 0;
  return store[id] ?? 0;
}

/**
 * انتخاب هوشمند بین ۳ سیستم تخفیف فروشگاه sgeooole:
 *  1. `flash`      -> پیشنهاد لحظه‌ای (ریل لحظه‌ای صفحه اصلی با تایمر معکوس)
 *  2. `featured`   -> پیشنهاد شگفت‌انگیز (ریل شگفت‌انگیز / منتخب‌های صفحه اصلی)
 *  3. `timed_sale` -> مدیریت فرصت‌های زمان‌دار در بخش مالی و تخفیف (مدل Sale با لیبل سفارشی، تم رنگی و قابلیت نمایش اختیاری در منتخب‌های صفحه اصلی)
 */
export function pickCampaign(
  campaigns: DiscountCampaign[],
  input: CampaignMatchInput,
): CampaignPick {
  const now = input.now ?? new Date();
  const hour = now.getHours();
  const day = now.getDay();
  const price = input.finalPrice ?? 0;
  const cardIdx = input.cardIndex ?? 1;

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

  const sortedCampaigns = [...campaigns]
    .filter((c) => c.active)
    .sort((a, b) => {
      if (input.preferredCampaignType && input.preferredCampaignType !== "auto") {
        const aPref = a.type === input.preferredCampaignType ? 1 : 0;
        const bPref = b.type === input.preferredCampaignType ? 1 : 0;
        if (aPref !== bPref) return bPref - aPref;
      }
      return b.priority - a.priority;
    });

  const eligible = sortedCampaigns.filter((c) => {
    const isExplicitlyTargeted =
      (Array.isArray(c.targetProductIds) &&
        input.productId != null &&
        c.targetProductIds.includes(input.productId)) ||
      (input.preferredCampaignType && input.preferredCampaignType === c.type);

    if (!isExplicitlyTargeted) {
      if (input.discountPct < c.minDiscountPct || input.discountPct > c.maxDiscountPct) {
        return false;
      }
    }

    if (Array.isArray(c.targetProductIds) && c.targetProductIds.length > 0) {
      if (input.productId == null || !c.targetProductIds.includes(input.productId)) {
        return false;
      }
    }

    const rangeFrom = c.cardRangeFrom ?? 1;
    const rangeTo = c.cardRangeTo ?? 0;
    if (rangeFrom > 1 && cardIdx < rangeFrom) return false;
    if (rangeTo > 0 && cardIdx > rangeTo) return false;

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
      reason: "هیچ کمپینی با شرایط تخفیف، رنج کارت یا بازه قیمت مطابقت ندارد",
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
      `با تخفیف ${input.discountPct}% روی سقف و ردیف کارت #${cardIdx}`,
  };
}
