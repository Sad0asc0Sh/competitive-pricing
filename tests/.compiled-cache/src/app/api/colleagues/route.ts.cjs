"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.POST = POST;
const index_ts_1 = require("../../../db/index.ts");
const schema_1 = require("../../../db/schema");
const auth_1 = require("../../../lib/auth");
const sourcing_1 = require("../../../lib/pricing/sourcing");
const bootstrap_1 = require("../../../lib/services/bootstrap");
const runner_1 = require("../../../lib/services/runner");
const drizzle_orm_1 = require("drizzle-orm");
const server_1 = require("next/server");
exports.dynamic = "force-dynamic";
async function POST(req) {
    const denied = await (0, auth_1.requireAdminAuth)(req);
    if (denied)
        return denied;
    const body = (await req.json().catch(() => null));
    if (!body)
        return server_1.NextResponse.json({ error: "بدنه درخواست نامعتبر است" }, { status: 400 });
    const defaultSupplier = body.defaultSupplierName?.trim() || "همکار اصلی";
    const defaultCity = body.defaultSupplierCity?.trim() || null;
    const defaultCurrency = body.defaultCurrency ?? "auto";
    const now = new Date();
    const incomingRows = Array.isArray(body.rows) ? [...body.rows] : [];
    if (body.text && body.text.trim()) {
        const lines = body.text
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith("#"));
        for (const line of lines) {
            const parts = line.split(/[,;\t|]+/).map((p) => p.trim());
            if (parts.length < 2)
                continue;
            if (/^(sku|کد کالا|کد محصول|شناسه)$/i.test(parts[0]))
                continue;
            if (parts.length === 2) {
                incomingRows.push({
                    sku: parts[0],
                    supplierName: defaultSupplier,
                    supplierCity: defaultCity,
                    price: parts[1],
                    currency: defaultCurrency,
                    inStock: true,
                });
            }
            else {
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
        return server_1.NextResponse.json({ error: "هیچ ردیف معتبری از لیست همکاران یافت نشد" }, { status: 400 });
    }
    const allProducts = await index_ts_1.db.select().from(schema_1.products);
    const bySku = new Map(allProducts.map((p) => [p.sku.trim().toUpperCase(), p]));
    const { config } = await (0, bootstrap_1.getProfileConfig)();
    const updatedProductIds = new Set();
    const notFoundSkus = [];
    const groupedByProduct = new Map();
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
        const product = allProducts.find((x) => x.id === productId);
        const existingQuotes = body.replaceAllQuotesForProduct
            ? []
            : Array.isArray(product.supplierQuotes)
                ? [...product.supplierQuotes]
                : [];
        for (const r of rows) {
            const buyPriceToman = (0, sourcing_1.parsePriceToToman)(r.price, r.currency ?? defaultCurrency, product.costPrice || null);
            if (buyPriceToman <= 0)
                continue;
            const quote = {
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
            const idx = existingQuotes.findIndex((eqQuote) => eqQuote.supplierName.trim().toLowerCase() === quote.supplierName.toLowerCase());
            if (idx >= 0)
                existingQuotes[idx] = quote;
            else
                existingQuotes.push(quote);
        }
        const resolution = (0, sourcing_1.resolveSupplyCost)({
            supplierQuotes: existingQuotes,
            manualCostPrice: product.costPrice,
            minMarginPctOverride: product.minMarginPct,
            minProfitAmountOverride: product.minProfitAmount,
            config,
            now,
        });
        await index_ts_1.db
            .update(schema_1.products)
            .set({
            supplierQuotes: existingQuotes,
            // هزینه انبار (costPrice) با قیمت همکار بازنویسی یا با سربار باد نمی‌شود؛ قیمت جایگزینی در replacementCost ذخیره می‌شود
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
            .where((0, drizzle_orm_1.eq)(schema_1.products.id, product.id));
        updatedProductIds.add(product.id);
    }
    await (0, bootstrap_1.logActivity)("colleagues", `لیست قیمت همکاران برای ${updatedProductIds.size} محصول بروزرسانی شد`, { updatedCount: updatedProductIds.size, notFoundSkus });
    let runSummary = null;
    if (body.triggerRun === true && updatedProductIds.size > 0) {
        runSummary = await (0, runner_1.runPricing)({
            trigger: "api",
            productIds: [...updatedProductIds],
        });
    }
    return server_1.NextResponse.json({
        ok: true,
        updatedProductsCount: updatedProductIds.size,
        updatedProductIds: [...updatedProductIds],
        notFoundSkus,
        runSummary,
    });
}
