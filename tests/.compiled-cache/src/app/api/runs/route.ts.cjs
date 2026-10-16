"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.GET = GET;
exports.POST = POST;
exports.maxDuration = exports.dynamic = void 0;
var _db = require("@/db");
var _schema = require("../../../db/schema");
var _runner = require("../../../lib/services/runner");
var _drizzleOrm = require("drizzle-orm");
var _server = require("next/server");
const dynamic = "force-dynamic";
exports.dynamic = dynamic;
const maxDuration = 300;
exports.maxDuration = maxDuration;
async function GET() {
  try {
    const rows = await _db.db.select().from(_schema.priceRuns).orderBy((0, _drizzleOrm.desc)(_schema.priceRuns.startedAt)).limit(50);
    return _server.NextResponse.json(rows);
  } catch (e) {
    return _server.NextResponse.json({
      error: e instanceof Error ? e.message : "خطا در خواندن تاریخچه اجراها"
    }, {
      status: 500
    });
  }
}

/**
 * POST /api/runs
 * body: { productIds?: number[], category?: string, cardRangeFrom?: number, cardRangeTo?: number, manualOffers?: RawOffer[] }
 * اجرای دستی موتور قیمت (همه محصولات فعال، رنج مشخصی از کارت‌ها یا زیرمجموعه انتخابی)
 */
async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const manualOffers = body.manualOffers?.map(o => ({
      shopName: o.shopName,
      price: Number(o.price),
      lastChangedAt: o.lastChangedDaysAgo != null ? new Date(Date.now() - Number(o.lastChangedDaysAgo) * 86400000) : null,
      isAd: !!o.isAd,
      inStock: o.inStock !== false
    }));
    const summary = await (0, _runner.runPricing)({
      trigger: "manual",
      productIds: body.productIds,
      category: body.category,
      cardRangeFrom: body.cardRangeFrom ? Number(body.cardRangeFrom) : undefined,
      cardRangeTo: body.cardRangeTo ? Number(body.cardRangeTo) : undefined,
      manualOffers
    });
    return _server.NextResponse.json(summary);
  } catch (e) {
    return _server.NextResponse.json({
      error: e instanceof Error ? e.message : "خطا در اجرای استعلام قیمت‌گذاری"
    }, {
      status: 500
    });
  }
}