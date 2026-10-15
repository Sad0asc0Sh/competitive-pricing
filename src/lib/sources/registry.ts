import type { RawOffer, SourceResult } from "@/lib/pricing/types";
import { torobAdapter } from "./torob";
import type { PriceSourceAdapter, SourceProduct } from "./types";

/** منبع دستی: پیشنهادها را از ورودی کاربر (import) می‌گیرد */
export function manualSource(offers: RawOffer[], totalSellerCount?: number): SourceResult {
  return {
    source: "manual",
    offers,
    totalSellerCount: totalSellerCount ?? offers.length,
    fetchedAt: new Date(),
    ok: offers.length > 0,
    error: offers.length ? undefined : "هیچ پیشنهادی وارد نشده",
  };
}

/**
 * تنها منبع واقعی مجاز در محیط تولید: ترب.
 * منبع شبیه‌سازی (mock) به‌طور کامل حذف شده است تا هیچ تصمیم قیمتی
 * بر اساس داده ساختگی گرفته یا به فروشگاه ارسال نشود.
 */
export const ALLOWED_SOURCE_TYPES = ["torob"] as const;

export function isAllowedSourceType(sourceType: string): boolean {
  return (ALLOWED_SOURCE_TYPES as readonly string[]).includes(sourceType);
}

const adapters: Record<string, PriceSourceAdapter> = {
  torob: torobAdapter,
};

export function getAdapter(sourceType: string): PriceSourceAdapter | null {
  return adapters[sourceType] ?? null;
}

export function listAdapters(): { id: string; label: string }[] {
  return [
    ...Object.values(adapters).map((a) => ({ id: a.id, label: a.label })),
    { id: "manual", label: "ورود دستی" },
  ];
}

export async function fetchFromSource(product: SourceProduct, manualOffers?: RawOffer[]): Promise<SourceResult> {
  if (manualOffers && manualOffers.length) return manualSource(manualOffers);
  const adapter = getAdapter(product.sourceType);
  if (!adapter) {
    return { source: product.sourceType, offers: [], totalSellerCount: 0, fetchedAt: new Date(), ok: false, error: "منبع ناشناخته یا غیرمجاز (فقط ترب پشتیبانی می‌شود)" };
  }
  try {
    return await adapter.fetchOffers(product);
  } catch (e) {
    return { source: adapter.id, offers: [], totalSellerCount: 0, fetchedAt: new Date(), ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
