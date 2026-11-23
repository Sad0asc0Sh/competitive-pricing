import { db } from "@/db";
import { products } from "@/db/schema";
import { requireAdminAuth } from "@/lib/auth";
import { parsePriceToToman, resolveSupplyCost } from "@/lib/pricing/sourcing";
import type { SupplierQuote } from "@/lib/pricing/types";
import { getProfileConfig, logActivity } from "@/lib/services/bootstrap";
import { runPricing } from "@/lib/services/runner";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export interface ColleagueBulkRow {
  sku: string;
  supplierName: string;
  supplierCity?: string | null;
  price: number | string;
  currency?: "toman" | "rial" | "auto";
  inStock?: boolean;
  priority?: number;
  shippingOverheadToman?: number;
  guarantee?: string | null;
}

export async function POST(req: Request) {
  const denied = await requireAdminAuth(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as {
    rows?: ColleagueBulkRow[];
    text?: string;
    defaultSupplierName?: string;
    defaultSupplierCity?: string;
    defaultCurrency?: "toman" | "rial" | "auto";
    replaceAllQuotesForProduct?: boolean;
    triggerRun?: boolean;
  } | null;

  if (!body) return NextResponse.json({ error: "بدنه درخواست نامعتبر است" }, { status: 400 });

  const defaultSupplier = body.defaultSupplierName?.trim() || "همکار اصلی";
  const defaultCity = body.defaultSupplierCity?.trim() || null;
  const defaultCurrency = body.defaultCurrency ?? "auto";
  const now = new Date();

  const incomingRows: ColleagueBulkRow[] = Array.isArray(body.rows) ? [...body.rows] : [];

  if (body.text && body.text.trim()) {
    const lines = body.text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));

    for (const line of lines) {
      const parts = line.split(/[,;\t|]+/).map((p) => p.trim());
      if (parts.length < 2) continue;
      if (/^(sku|کد کالا|کد محصول|شناسه)$/i.test(parts[0])) continue;

      if (parts.length === 2) {
        incomingRows.push({
          sku: parts[0],
          supplierName: defaultSupplier,
          supplierCity: defaultCity,
          price: parts[1],
          currency: defaultCurrency,
          inStock: true,
        });
      } else {
        const prio = parts[4] ? Number(parts[4]) : 5;
        const stockStr = (parts[5] ?? "in").toLowerCase();
        incomingRows.push({
          sku: parts[0],
          supplierName: parts[1] || defaultSupplier,
          price: parts[2],
          supplierCity: parts[3] || defaultCity,
          priority: Number.isFinite(prio) ? prio : 5,
          inStock: !["out", "0", "false", "ناموجود", "خیر"].includes(stockStr),
          currency: defaultCurrency,
        });
      }
    }
  }

  if (!incomingRows.length) {
    return NextResponse.json({ error: "هیچ ردیف معتبری از لیست همکاران یافت نشد" }, { status: 400 });
  }

  const allProducts = await db.select().from(products);
  const bySku = new Map(allProducts.map((p) => [p.sku.trim().toUpperCase(), p]));
  const { config } = await getProfileConfig();

  const updatedProductIds = new Set<number>();
  const notFoundSkus: string[] = [];

  const groupedByProduct = new Map<number, ColleagueBulkRow[]>();
  for (const r of incomingRows) {
    const p = bySku.get(String(r.sku || "").trim().toUpperCase());
    if (!p) {
      notFoundSkus.push(r.sku);
      continue;
    }
    const list = groupedByProduct.get(p.id) ?? [];
    list.push(r);
    groupedByProduct.set(p.id, list);
  }

  for (const [productId, rows] of groupedByProduct.entries()) {
    const product = allProducts.find((x) => x.id === productId)!;
    const existingQuotes: SupplierQuote[] = body.replaceAllQuotesForProduct
      ? []
      : Array.isArray(product.supplierQuotes)
        ? [...product.supplierQuotes]
        : [];

    for (const r of rows) {
      const buyPriceToman = parsePriceToToman(r.price, r.currency ?? defaultCurrency, product.costPrice || null);
      if (buyPriceToman <= 0) continue;

      const quote: SupplierQuote = {
        supplierName: r.supplierName.trim(),
        supplierCity: r.supplierCity ?? defaultCity,
        rawPrice: r.price,
        currency: r.currency ?? defaultCurrency,
        buyPriceToman,
        shippingOverheadToman: r.shippingOverheadToman,
        inStock: r.inStock !== false,
        priority: r.priority ?? 5,
        guarantee: r.guarantee ?? null,
        updatedAt: now.toISOString(),
      };

      const idx = existingQuotes.findIndex(
        (eqQuote) => eqQuote.supplierName.trim().toLowerCase() === quote.supplierName.toLowerCase(),
      );
      if (idx >= 0) existingQuotes[idx] = quote;
      else existingQuotes.push(quote);
    }

    const resolution = resolveSupplyCost({
      supplierQuotes: existingQuotes,
      manualCostPrice: product.costPrice,
      minMarginPctOverride: product.minMarginPct,
      minProfitAmountOverride: product.minProfitAmount,
      config,
      now,
    });

    await db
      .update(products)
      .set({
        supplierQuotes: existingQuotes,
        costPrice: resolution.effectiveCostPrice > 0 ? resolution.effectiveCostPrice : product.costPrice,
        ...(resolution.lowestQuoteCost && resolution.lowestQuoteCost > 0
          ? {
              replacementCost: Math.round(resolution.lowestQuoteCost),
              replacementCostAt: now,
            }
          : {}),
        selectedSupplierName: resolution.selectedQuote?.supplierName ?? null,
        currentHardFloorPrice: resolution.hardFloorPrice,
        updatedAt: now,
      })
      .where(eq(products.id, product.id));

    updatedProductIds.add(product.id);
  }

  await logActivity(
    "colleagues",
    `لیست قیمت همکاران برای ${updatedProductIds.size} محصول بروزرسانی شد`,
    { updatedCount: updatedProductIds.size, notFoundSkus },
  );

  let runSummary = null;
  if (body.triggerRun !== false && updatedProductIds.size > 0) {
    runSummary = await runPricing({
      trigger: "api",
      productIds: [...updatedProductIds],
    });
  }

  return NextResponse.json({
    ok: true,
    updatedProductsCount: updatedProductIds.size,
    updatedProductIds: [...updatedProductIds],
    notFoundSkus,
    runSummary,
  });
}
