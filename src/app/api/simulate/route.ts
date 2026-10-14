import { runPricingPipeline } from "@/lib/pricing/engine";
import type { RawOffer } from "@/lib/pricing/types";
import { getProfileConfig, mergeConfig } from "@/lib/services/bootstrap";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/simulate — اجرای خشک (dry-run) موتور قیمت بدون ذخیره.
 * body: { costPrice, currentFinalPrice?, minMarginPct?, totalSellerCount?, config?, offers: [{shopName, price, lastChangedDaysAgo?, isAd?, inStock?}] }
 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as {
    costPrice?: number;
    currentFinalPrice?: number | null;
    minMarginPct?: number | null;
    totalSellerCount?: number;
    config?: unknown;
    offers?: { shopName?: string; price: number; lastChangedDaysAgo?: number; isAd?: boolean; inStock?: boolean }[];
  } | null;
  if (!b?.offers) return NextResponse.json({ error: "offers لازم است" }, { status: 400 });
  const cfg = b.config ? mergeConfig(b.config as never) : (await getProfileConfig()).config;
  const now = Date.now();
  const offers: RawOffer[] = b.offers.map((o, i) => ({
    shopName: o.shopName ?? `فروشگاه ${i + 1}`,
    price: Number(o.price),
    lastChangedAt: o.lastChangedDaysAgo != null ? new Date(now - Number(o.lastChangedDaysAgo) * 86400000) : null,
    isAd: !!o.isAd,
    inStock: o.inStock !== false,
  }));
  const result = runPricingPipeline(
    { source: "simulate", offers, totalSellerCount: b.totalSellerCount ?? offers.length, fetchedAt: new Date(), ok: true },
    {
      productId: 0,
      productName: "شبیه‌سازی",
      costPrice: Number(b.costPrice ?? 0) || 0,
      minMarginPctOverride: b.minMarginPct ?? null,
      currentFinalPrice: b.currentFinalPrice ?? null,
      config: cfg,
    },
  );
  return NextResponse.json(result);
}
