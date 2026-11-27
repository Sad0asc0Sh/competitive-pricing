import { db } from "@/db";
import { products } from "@/db/schema";
import { requireAdminAuth } from "@/lib/auth";
import { parsePositiveInt } from "@/lib/format";
import { parseColleaguePriceListText, resolveSupplyCost } from "@/lib/pricing/sourcing";
import type { SupplierQuote } from "@/lib/pricing/types";
import { getProfileConfig } from "@/lib/services/bootstrap";
import { isAllowedSourceType } from "@/lib/sources/registry";
import { extractPrk } from "@/lib/sources/torob";
import { syncAdminPrkLink } from "@/lib/sources/torob-index";
import { torobProductUrl } from "@/lib/sources/torob-payload";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const denied = await requireAdminAuth(req);
  if (denied) return denied;

  const { id } = await params;
  const productId = parsePositiveInt(id);
  if (productId == null) return NextResponse.json({ error: "شناسه محصول نامعتبر است" }, { status: 400 });
  const [row] = await db.select().from(products).where(eq(products.id, productId)).limit(1);
  if (!row) return NextResponse.json({ error: "یافت نشد" }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(req: Request, { params }: Ctx) {
  const denied = await requireAdminAuth(req);
  if (denied) return denied;

  const { id } = await params;
  const productId = parsePositiveInt(id);
  if (productId == null) return NextResponse.json({ error: "شناسه محصول نامعتبر است" }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const [existing] = await db.select().from(products).where(eq(products.id, productId)).limit(1);
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
    "showInFeatured",
    "profileId",
    "status",
  ] as const;

  if ("sourceType" in body && !isAllowedSourceType(String(body.sourceType))) {
    return NextResponse.json({ error: "منبع استعلام نامعتبر است؛ فقط «ترب» پشتیبانی می‌شود" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  for (const k of allowed) if (k in body) patch[k] = body[k];

  const editedUrl = typeof patch.torobUrl === "string" ? patch.torobUrl.trim() || null : patch.torobUrl;
  const editedPrk = typeof patch.torobPrk === "string" ? patch.torobPrk.trim() || null : patch.torobPrk;
  const linkChanged = ("torobUrl" in patch && editedUrl !== existing.torobUrl) ||
    ("torobPrk" in patch && editedPrk !== existing.torobPrk);
  if (linkChanged) {
    const urlId = typeof editedUrl === "string" ? extractPrk(editedUrl) : null;
    const directId = typeof editedPrk === "string" ? extractPrk(null, editedPrk) : null;
    if ((editedUrl != null && !urlId) || (editedPrk != null && !directId) || (urlId && directId && urlId !== directId)) {
      return NextResponse.json({ error: "لینک یا شناسهٔ کارت ترب نامعتبر است" }, { status: 400 });
    }
    const prk = urlId ?? directId;
    patch.torobUrl = prk ? torobProductUrl(prk) : null;
    patch.torobPrk = prk;
    patch.torobDetailsUrl = null;
    patch.torobLinkConfirmation = null;
  } else {
    delete patch.torobUrl;
    delete patch.torobPrk;
  }
  if (("name" in patch && patch.name !== existing.name) || ("sku" in patch && patch.sku !== existing.sku)) {
    patch.torobLinkConfirmation = null;
  }

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

  // نظارت انسانی قطعی: اعمال خودکار در سطح محصول همیشه خاموش می‌ماند
  patch.autoApply = false;
  patch.updatedAt = new Date();
  try {
    const [row] = await db.update(products).set(patch).where(eq(products.id, productId)).returning();
    if (linkChanged && typeof patch.torobPrk === "string" && patch.torobPrk) {
      await syncAdminPrkLink({
        productId,
        prk: patch.torobPrk,
        origin: "manual_edit",
        confirmed: false,
      });
    }
    return NextResponse.json(row);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "خطا" }, { status: 400 });
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const denied = await requireAdminAuth(req);
  if (denied) return denied;

  const { id } = await params;
  const productId = parsePositiveInt(id);
  if (productId == null) return NextResponse.json({ error: "شناسه محصول نامعتبر است" }, { status: 400 });
  await db.delete(products).where(eq(products.id, productId));
  return NextResponse.json({ ok: true });
}
