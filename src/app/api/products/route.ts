import { db } from "@/db";
import { products } from "@/db/schema";
import { parseColleaguePriceListText, resolveSupplyCost } from "@/lib/pricing/sourcing";
import type { SupplierQuote } from "@/lib/pricing/types";
import { getProfileConfig } from "@/lib/services/bootstrap";
import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await db.select().from(products).orderBy(desc(products.updatedAt));
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body?.sku || !body?.name) return NextResponse.json({ error: "sku و name الزامی است" }, { status: 400 });
  try {
    const { config } = await getProfileConfig(body.profileId ? Number(body.profileId) : null);
    const supplierQuotes: SupplierQuote[] = Array.isArray(body.supplierQuotes)
      ? body.supplierQuotes
      : typeof body.colleagueListText === "string" && body.colleagueListText.trim()
        ? parseColleaguePriceListText(body.colleagueListText, "auto")
        : [];

    const manualCost = Number(body.costPrice ?? 0) || 0;
    const minMarginPct =
      body.minMarginPct != null && body.minMarginPct !== "" ? Number(body.minMarginPct) : null;
    const minProfitAmount =
      body.minProfitAmount != null && body.minProfitAmount !== "" ? Number(body.minProfitAmount) : null;

    const supply = resolveSupplyCost({
      supplierQuotes,
      manualCostPrice: manualCost,
      minMarginPctOverride: minMarginPct,
      minProfitAmountOverride: minProfitAmount,
      config,
    });

    const [row] = await db
      .insert(products)
      .values({
        sku: String(body.sku).trim(),
        name: String(body.name).trim(),
        category: body.category ? String(body.category).trim() : null,
        storeExternalId: body.storeExternalId ? String(body.storeExternalId) : null,
        sourceType: body.sourceType ?? "torob",
        torobUrl: body.torobUrl || null,
        torobPrk: body.torobPrk || null,
        torobDetailsUrl: body.torobDetailsUrl || null,
        costPrice: supply.effectiveCostPrice > 0 ? supply.effectiveCostPrice : manualCost,
        supplierQuotes,
        selectedSupplierName: supply.selectedQuote?.supplierName ?? null,
        currentHardFloorPrice: supply.hardFloorPrice > 0 ? supply.hardFloorPrice : null,
        minMarginPct,
        minProfitAmount,
        preferredCampaignType: body.preferredCampaignType ? String(body.preferredCampaignType) : "auto",
        autoApply: body.autoApply !== false,
        profileId: body.profileId ? Number(body.profileId) : null,
      })
      .returning();
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "خطا" }, { status: 400 });
  }
}
