import type { DiscountCampaign } from "@/db/schema";

export interface CampaignPick {
  type: string; // flash | featured | none
  campaignId: number | null;
  name: string;
  endsAt: Date | null;
  reason: string;
}

/**
 * انتخاب کمپین تخفیف برای یک تصمیم:
 *  - کمپین‌های فعال بر اساس اولویت مرتب می‌شوند (عدد بزرگتر = اولویت بالاتر)
 *  - شرایط: بازه تخفیف، ساعت/روز فعال، دسته‌بندی
 *  - «لحظه‌ای» (flash): تخفیف‌های عمیق‌تر و کوتاه‌مدت؛ «منتخب/شگفت‌انگیز» (featured): تخفیف‌های متوسط و پایدارتر
 *  - در زمان‌های مشترک، اولویت تعیین می‌کند کدام برچسب نمایش داده شود.
 */
export function pickCampaign(
  campaigns: DiscountCampaign[],
  input: { discountPct: number; category?: string | null; now?: Date },
): CampaignPick {
  const now = input.now ?? new Date();
  const hour = now.getHours();
  const day = now.getDay();

  const eligible = campaigns
    .filter((c) => c.active)
    .filter((c) => input.discountPct >= c.minDiscountPct && input.discountPct <= c.maxDiscountPct)
    .filter((c) => !c.activeHours.length || c.activeHours.includes(hour))
    .filter((c) => !c.activeDays.length || c.activeDays.includes(day))
    .filter((c) => !c.categories.length || (input.category ? c.categories.includes(input.category) : false))
    .sort((a, b) => b.priority - a.priority);

  if (!eligible.length) {
    return { type: "none", campaignId: null, name: "بدون کمپین", endsAt: null, reason: "هیچ کمپینی با شرایط تخفیف/زمان/دسته مطابقت ندارد" };
  }
  const c = eligible[0];
  return {
    type: c.type,
    campaignId: c.id,
    name: c.name,
    endsAt: new Date(now.getTime() + c.durationHours * 3600 * 1000),
    reason: `کمپین «${c.name}» (${c.type === "flash" ? "لحظه‌ای" : "منتخب"}) با تخفیف ${input.discountPct}% در بازه ${c.minDiscountPct}-${c.maxDiscountPct}% و اولویت ${c.priority}`,
  };
}
