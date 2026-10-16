"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.GET = GET;
exports.POST = POST;
exports.dynamic = void 0;
var _db = require("@/db");
var _schema = require("../../../db/schema");
var _sourcing = require("../../../lib/pricing/sourcing");
var _bootstrap = require("../../../lib/services/bootstrap");
var _registry = require("../../../lib/sources/registry");
var _drizzleOrm = require("drizzle-orm");
var _server = require("next/server");
const dynamic = "force-dynamic";
exports.dynamic = dynamic;
async function GET() {
  const rows = await _db.db.select().from(_schema.products).orderBy((0, _drizzleOrm.desc)(_schema.products.updatedAt));
  return _server.NextResponse.json(rows);
}
async function POST(req) {
  const body = await req.json().catch(() => null);
  if (!body?.sku || !body?.name) return _server.NextResponse.json({
    error: "sku و name الزامی است"
  }, {
    status: 400
  });
  if (body.sourceType != null && body.sourceType !== "" && !(0, _registry.isAllowedSourceType)(String(body.sourceType))) {
    return _server.NextResponse.json({
      error: "منبع استعلام نامعتبر است؛ فقط «ترب» پشتیبانی می‌شود"
    }, {
      status: 400
    });
  }
  try {
    const {
      config
    } = await (0, _bootstrap.getProfileConfig)(body.profileId ? Number(body.profileId) : null);
    const supplierQuotes = Array.isArray(body.supplierQuotes) ? body.supplierQuotes : typeof body.colleagueListText === "string" && body.colleagueListText.trim() ? (0, _sourcing.parseColleaguePriceListText)(body.colleagueListText, "auto") : [];
    const manualCost = Number(body.costPrice ?? 0) || 0;
    const minMarginPct = body.minMarginPct != null && body.minMarginPct !== "" ? Number(body.minMarginPct) : null;
    const minProfitAmount = body.minProfitAmount != null && body.minProfitAmount !== "" ? Number(body.minProfitAmount) : null;
    const supply = (0, _sourcing.resolveSupplyCost)({
      supplierQuotes,
      manualCostPrice: manualCost,
      minMarginPctOverride: minMarginPct,
      minProfitAmountOverride: minProfitAmount,
      config
    });
    const [row] = await _db.db.insert(_schema.products).values({
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
      profileId: body.profileId ? Number(body.profileId) : null
    }).returning();
    return _server.NextResponse.json(row, {
      status: 201
    });
  } catch (e) {
    return _server.NextResponse.json({
      error: e instanceof Error ? e.message : "خطا"
    }, {
      status: 400
    });
  }
}