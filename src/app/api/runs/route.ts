import { db } from "@/db";
import { priceRuns } from "@/db/schema";
import { requireAdminAuth } from "@/lib/auth";
import type { RawOffer } from "@/lib/pricing/types";
import { runPricing, type RunOptions } from "@/lib/services/runner";
import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const denied = await requireAdminAuth(req);
  if (denied) return denied;

  try {
    const rows = await db.select().from(priceRuns).orderBy(desc(priceRuns.startedAt)).limit(50);
    return NextResponse.json(rows);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "خطا در خواندن تاریخچه اجراها" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/runs
 * body: { productIds?: number[], category?: string, cardRangeFrom?: number, cardRangeTo?: number, manualOffers?: RawOffer[], runMode?: "live" | "shadow" | "simulate" }
 * اجرای دستی موتور قیمت (همه محصولات فعال، رنج مشخصی از کارت‌ها یا زیرمجموعه انتخابی)
 */
export async function POST(req: Request) {
  const denied = await requireAdminAuth(req);
  if (denied) return denied;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      productIds?: number[];
      category?: string;
      cardRangeFrom?: number;
      cardRangeTo?: number;
      runMode?: "live" | "shadow" | "simulate";
      isSimulated?: boolean;
      manualOffers?: { shopName: string; price: number; lastChangedDaysAgo?: number; isAd?: boolean; inStock?: boolean }[];
    };
    const manualOffers: RawOffer[] | undefined = body.manualOffers?.map((o) => ({
      shopName: o.shopName,
      price: Number(o.price),
      lastChangedAt: o.lastChangedDaysAgo != null ? new Date(Date.now() - Number(o.lastChangedDaysAgo) * 86400000) : null,
      isAd: !!o.isAd,
      inStock: o.inStock !== false,
    }));
    const runOpts: RunOptions & { runMode?: "live" | "shadow" | "simulate"; isSimulated?: boolean } = {
      trigger: "manual",
      productIds: body.productIds,
      category: body.category,
      cardRangeFrom: body.cardRangeFrom ? Number(body.cardRangeFrom) : undefined,
      cardRangeTo: body.cardRangeTo ? Number(body.cardRangeTo) : undefined,
      manualOffers,
      ...(body.runMode ? { runMode: body.runMode } : {}),
      ...(typeof body.isSimulated === "boolean" ? { isSimulated: body.isSimulated } : {}),
    };
    const summary = await runPricing(runOpts);
    return NextResponse.json(summary);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "خطا در اجرای استعلام قیمت‌گذاری" },
      { status: 500 },
    );
  }
}
