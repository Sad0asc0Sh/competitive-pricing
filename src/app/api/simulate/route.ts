import { runPricingPipeline } from "@/lib/pricing/engine";
import { parseColleaguePriceListText } from "@/lib/pricing/sourcing";
import { enrichSupervisorWithSubqApi } from "@/lib/pricing/systemone-supervisor";
import type { RawOffer, SupplierQuote } from "@/lib/pricing/types";
import { getProfileConfig, mergeConfig } from "@/lib/services/bootstrap";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as {
    productName?: string;
    torobTitle?: string;
    costPrice?: number;
    colleagueListText?: string;
    supplierQuotes?: SupplierQuote[];
    currentFinalPrice?: number | null;
    minMarginPct?: number | null;
    minProfitAmount?: number | null;
    totalSellerCount?: number;
    config?: unknown;
    offers?: {
      shopName?: string;
      shopCity?: string | null;
      sellerType?: "online" | "in_person";
      shopScore?: number | null;
      price: number;
      lastChangedDaysAgo?: number;
      lastChangedText?: string;
      priceUnreliable?: boolean;
      isAd?: boolean;
      inStock?: boolean;
    }[];
  } | null;

  // سیستم واقعی بدون داده ساختگی: نام محصول و حداقل ۲ پیشنهاد معتبر الزامی است؛
  // هیچ مقدار پیش‌فرض نمونه‌ای (مثل دوربین داهوا) برنمی‌گردانیم.
  if (!b?.productName?.trim()) return NextResponse.json({ error: "نام محصول (productName) الزامی است" }, { status: 400 });
  if (!Array.isArray(b?.offers) || b.offers.length < 2)
    return NextResponse.json({ error: "حداقل ۲ پیشنهاد رقیب (offers) برای شبیه‌سازی واقعی لازم است" }, { status: 400 });

  let baseCfg;
  try {
    baseCfg = b.config ? mergeConfig(b.config as never) : (await getProfileConfig()).config;
  } catch {
    baseCfg = mergeConfig(b.config as never);
  }

  const now = new Date();
  const supplierQuotes: SupplierQuote[] =
    b.supplierQuotes && b.supplierQuotes.length > 0
      ? b.supplierQuotes
      : b.colleagueListText
        ? parseColleaguePriceListText(b.colleagueListText, "auto", now)
        : [];

  const offers: RawOffer[] = b
    .offers!.filter((o) => o && Number(o.price) > 0)
    .map((o, i) => ({
      shopName: o.shopName?.trim() || `فروشگاه ${i + 1}`,
      shopCity: o.shopCity ?? null,
      sellerType: o.sellerType ?? "online",
      shopScore: o.shopScore ?? null,
      price: Math.round(Number(o.price)),
      lastChangedAt:
        o.lastChangedDaysAgo != null
          ? new Date(now.getTime() - Number(o.lastChangedDaysAgo) * 86400000)
          : null,
      lastChangedText: o.lastChangedText ?? null,
      priceUnreliable: !!o.priceUnreliable,
      isAd: !!o.isAd,
      inStock: o.inStock !== false,
    }));
  if (offers.length < 2)
    return NextResponse.json({ error: "حداقل ۲ پیشنهاد با قیمت معتبر لازم است" }, { status: 400 });

  const simProductName = b.productName!.trim();
  const simTorobTitle = b.torobTitle?.trim() || simProductName;

  const result = runPricingPipeline(
    {
      source: "manual",
      productTitle: simTorobTitle,
      offers,
      totalSellerCount: b.totalSellerCount && b.totalSellerCount >= offers.length ? b.totalSellerCount : offers.length,
      fetchedAt: now,
      ok: true,
    },
    {
      productId: 0,
      productName: simProductName,
      costPrice: Number(b.costPrice ?? 0) || 0,
      supplierQuotes,
      minMarginPctOverride: b.minMarginPct ?? null,
      minProfitAmountOverride: b.minProfitAmount ?? null,
      currentFinalPrice: b.currentFinalPrice ?? null,
      config: baseCfg,
      now,
    },
  );

  if (baseCfg.supervisor?.enabled) {
    result.supervisor = await enrichSupervisorWithSubqApi(result.supervisor, baseCfg.supervisor);
  }

  return NextResponse.json(result);
}
