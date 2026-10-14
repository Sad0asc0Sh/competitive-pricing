import { db } from "@/db";
import { priceRuns } from "@/db/schema";
import type { RawOffer } from "@/lib/pricing/types";
import { runPricing } from "@/lib/services/runner";
import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  const rows = await db.select().from(priceRuns).orderBy(desc(priceRuns.startedAt)).limit(50);
  return NextResponse.json(rows);
}

/**
 * POST /api/runs
 * body: { productIds?: number[], category?: string, manualOffers?: RawOffer[] }
 * اجرای دستی موتور قیمت (همه محصولات فعال یا زیرمجموعه)
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    productIds?: number[];
    category?: string;
    manualOffers?: { shopName: string; price: number; lastChangedDaysAgo?: number; isAd?: boolean; inStock?: boolean }[];
  };
  const manualOffers: RawOffer[] | undefined = body.manualOffers?.map((o) => ({
    shopName: o.shopName,
    price: Number(o.price),
    lastChangedAt: o.lastChangedDaysAgo != null ? new Date(Date.now() - Number(o.lastChangedDaysAgo) * 86400000) : null,
    isAd: !!o.isAd,
    inStock: o.inStock !== false,
  }));
  const summary = await runPricing({
    trigger: "manual",
    productIds: body.productIds,
    category: body.category,
    manualOffers,
  });
  return NextResponse.json(summary);
}
