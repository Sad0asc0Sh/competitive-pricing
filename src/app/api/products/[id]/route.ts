import { db } from "@/db";
import { products } from "@/db/schema";
import { requireAdminAuth } from "@/lib/auth";
import { parseColleaguePriceListText, resolveSupplyCost } from "@/lib/pricing/sourcing";
import type { SupplierQuote } from "@/lib/pricing/types";
import { getProfileConfig } from "@/lib/services/bootstrap";
import { isAllowedSourceType } from "@/lib/sources/registry";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const denied = await requireAdminAuth(req);
  if (denied) return denied;

  const { id } = await params;
  const [row] = await db.select().from(products).where(eq(products.id, Number(id))).limit(1);
  if (!row) return NextResponse.json({ error: "یافت نشد" }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(req: Request, { params }: Ctx) {
  const denied = await requireAdminAuth(req);
  if (denied) return denied;

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const [existing] = await db.select().from(products).where(eq(products.id, Number(id))).limit(1);
  if (!existing) return NextResponse.json({ error: "یافت نشد" }, { status: 404 });

  const allowed = [
    "sku",
    "name",
    "category",
    "storeExternalId",
    "sourceType",
    "torobUrl",
    "torobPrk",
    "torobDetailsUrl",
    "costPrice",
    "supplierQuotes",
    "minMarginPct",
    "minProfitAmount",
    "preferredCampaignType",
    "autoApply",
    "showInFeatured",
    "profileId",
    "status",
  ] as const;

  if ("sourceType" in body && !isAllowedSourceType(String(body.sourceType))) {
    return NextResponse.json({ error: "منبع استعلام نامعتبر است؛ فقط «ترب» پشتیبانی می‌شود" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  for (const k of allowed) if (k in body) patch[k] = body[k];

  if (typeof body.colleagueListText === "string") {
    patch.supplierQuotes = parseColleaguePriceListText(body.colleagueListText, "auto");
  }

  if ("costPrice" in patch) patch.costPrice = Number(patch.costPrice) || 0;
  if ("minMarginPct" in patch) {
    patch.minMarginPct =
      patch.minMarginPct === "" || patch.minMarginPct == null ? null : Number(patch.minMarginPct);
  }
  if ("minProfitAmount" in patch) {
    patch.minProfitAmount =
      patch.minProfitAmount === "" || patch.minProfitAmount == null ? null : Number(patch.minProfitAmount);
  }
  if ("profileId" in patch) patch.profileId = patch.profileId ? Number(patch.profileId) : null;
  if ("showInFeatured" in patch) patch.showInFeatured = Boolean(patch.showInFeatured);

  const { config } = await getProfileConfig((patch.profileId as number | null) ?? existing.profileId);
  const supplierQuotes = (patch.supplierQuotes as SupplierQuote[] | undefined) ?? existing.supplierQuotes ?? [];
  const manualCost = (patch.costPrice as number | undefined) ?? existing.costPrice;
  const minMarginPct = (patch.minMarginPct as number | null | undefined) ?? existing.minMarginPct;
  const minProfitAmount = (patch.minProfitAmount as number | null | undefined) ?? existing.minProfitAmount;

  const supply = resolveSupplyCost({
    supplierQuotes,
    manualCostPrice: manualCost,
    minMarginPctOverride: minMarginPct,
    minProfitAmountOverride: minProfitAmount,
    config,
  });

  if (supply.lowestQuoteCost != null && supply.lowestQuoteCost > 0) {
    patch.replacementCost = Math.round(supply.lowestQuoteCost);
    patch.replacementCostAt = new Date();
  }
  if (supply.effectiveCostPrice > 0) {
    // costPrice (هزینه موجودی انبار) نباید با سربار ۰.۵٪ بازنویسی و در هر ذخیره باد شود؛ فقط همکار منتخب و کف سود آپدیت می‌شوند
    patch.selectedSupplierName = supply.selectedQuote?.supplierName ?? null;
    patch.currentHardFloorPrice = supply.hardFloorPrice;
  } else if ("costPrice" in patch) {
    patch.selectedSupplierName = null;
    patch.currentHardFloorPrice = null;
  }

  patch.updatedAt = new Date();
  try {
    const [row] = await db.update(products).set(patch).where(eq(products.id, Number(id))).returning();
    return NextResponse.json(row);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "خطا" }, { status: 400 });
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const denied = await requireAdminAuth(req);
  if (denied) return denied;

  const { id } = await params;
  await db.delete(products).where(eq(products.id, Number(id)));
  return NextResponse.json({ ok: true });
}
