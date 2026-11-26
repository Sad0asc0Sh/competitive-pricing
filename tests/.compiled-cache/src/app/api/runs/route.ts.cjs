"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.maxDuration = exports.dynamic = void 0;
exports.GET = GET;
exports.POST = POST;
const index_ts_1 = require("../../../db/index.ts");
const schema_1 = require("../../../db/schema");
const auth_1 = require("../../../lib/auth");
const runner_1 = require("../../../lib/services/runner");
const drizzle_orm_1 = require("drizzle-orm");
const server_1 = require("next/server");
exports.dynamic = "force-dynamic";
exports.maxDuration = 300;
async function GET(req) {
    const denied = await (0, auth_1.requireAdminAuth)(req);
    if (denied)
        return denied;
    try {
        const rows = await index_ts_1.db.select().from(schema_1.priceRuns).orderBy((0, drizzle_orm_1.desc)(schema_1.priceRuns.startedAt)).limit(50);
        return server_1.NextResponse.json(rows);
    }
    catch (e) {
        return server_1.NextResponse.json({ error: e instanceof Error ? e.message : "خطا در خواندن تاریخچه اجراها" }, { status: 500 });
    }
}
/**
 * POST /api/runs
 * body: { productIds?: number[], category?: string, cardRangeFrom?: number, cardRangeTo?: number, manualOffers?: RawOffer[], runMode?: "live" | "shadow" | "simulate" }
 * اجرای دستی موتور قیمت (همه محصولات فعال، رنج مشخصی از کارت‌ها یا زیرمجموعه انتخابی)
 */
async function POST(req) {
    const denied = await (0, auth_1.requireAdminAuth)(req);
    if (denied)
        return denied;
    try {
        const body = (await req.json().catch(() => ({})));
        const manualOffers = body.manualOffers?.map((o) => ({
            shopName: o.shopName,
            price: Number(o.price),
            lastChangedAt: o.lastChangedDaysAgo != null ? new Date(Date.now() - Number(o.lastChangedDaysAgo) * 86400000) : null,
            isAd: !!o.isAd,
            inStock: o.inStock !== false,
        }));
        const runOpts = {
            trigger: "manual",
            productIds: body.productIds,
            category: body.category,
            cardRangeFrom: body.cardRangeFrom ? Number(body.cardRangeFrom) : undefined,
            cardRangeTo: body.cardRangeTo ? Number(body.cardRangeTo) : undefined,
            manualOffers,
            ...(body.runMode ? { runMode: body.runMode } : {}),
            ...(typeof body.isSimulated === "boolean" ? { isSimulated: body.isSimulated } : {}),
        };
        const summary = await (0, runner_1.runPricing)(runOpts);
        return server_1.NextResponse.json(summary);
    }
    catch (e) {
        console.error("[API /api/runs] POST error:", e);
        return server_1.NextResponse.json({ error: e instanceof Error ? e.message : "خطا در اجرای استعلام قیمت‌گذاری" }, { status: 500 });
    }
}
