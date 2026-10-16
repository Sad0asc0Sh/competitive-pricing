"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.DELETE = DELETE;
exports.GET = GET;
exports.PATCH = PATCH;
exports.dynamic = void 0;
var _db = require("@/db");
var _schema = require("../../../../db/schema");
var _sourcing = require("../../../../lib/pricing/sourcing");
var _bootstrap = require("../../../../lib/services/bootstrap");
var _registry = require("../../../../lib/sources/registry");
var _drizzleOrm = require("drizzle-orm");
var _server = require("next/server");
const dynamic = "force-dynamic";
exports.dynamic = dynamic;
async function GET(_, {
  params
}) {
  const {
    id
  } = await params;
  const [row] = await _db.db.select().from(_schema.products).where((0, _drizzleOrm.eq)(_schema.products.id, Number(id))).limit(1);
  if (!row) return _server.NextResponse.json({
    error: "یافت نشد"
  }, {
    status: 404
  });
  return _server.NextResponse.json(row);
}
async function PATCH(req, {
  params
}) {
  const {
    id
  } = await params;
  const body = await req.json().catch(() => ({}));
  const [existing] = await _db.db.select().from(_schema.products).where((0, _drizzleOrm.eq)(_schema.products.id, Number(id))).limit(1);
  if (!existing) return _server.NextResponse.json({
    error: "یافت نشد"
  }, {
    status: 404
  });
  const allowed = ["sku", "name", "category", "storeExternalId", "sourceType", "torobUrl", "torobPrk", "torobDetailsUrl", "costPrice", "supplierQuotes", "minMarginPct", "minProfitAmount", "preferredCampaignType", "autoApply", "profileId", "status"];
  if ("sourceType" in body && !(0, _registry.isAllowedSourceType)(String(body.sourceType))) {
    return _server.NextResponse.json({
      error: "منبع استعلام نامعتبر است؛ فقط «ترب» پشتیبانی می‌شود"
    }, {
      status: 400
    });
  }
  const patch = {};
  for (const k of allowed) if (k in body) patch[k] = body[k];
  if (typeof body.colleagueListText === "string") {
    patch.supplierQuotes = (0, _sourcing.parseColleaguePriceListText)(body.colleagueListText, "auto");
  }
  if ("costPrice" in patch) patch.costPrice = Number(patch.costPrice) || 0;
  if ("minMarginPct" in patch) {
    patch.minMarginPct = patch.minMarginPct === "" || patch.minMarginPct == null ? null : Number(patch.minMarginPct);
  }
  if ("minProfitAmount" in patch) {
    patch.minProfitAmount = patch.minProfitAmount === "" || patch.minProfitAmount == null ? null : Number(patch.minProfitAmount);
  }
  if ("profileId" in patch) patch.profileId = patch.profileId ? Number(patch.profileId) : null;
  const {
    config
  } = await (0, _bootstrap.getProfileConfig)(patch.profileId ?? existing.profileId);
  const supplierQuotes = patch.supplierQuotes ?? existing.supplierQuotes ?? [];
  const manualCost = patch.costPrice ?? existing.costPrice;
  const minMarginPct = patch.minMarginPct ?? existing.minMarginPct;
  const minProfitAmount = patch.minProfitAmount ?? existing.minProfitAmount;
  const supply = (0, _sourcing.resolveSupplyCost)({
    supplierQuotes,
    manualCostPrice: manualCost,
    minMarginPctOverride: minMarginPct,
    minProfitAmountOverride: minProfitAmount,
    config
  });
  if (supply.effectiveCostPrice > 0) {
    patch.costPrice = supply.effectiveCostPrice;
    patch.selectedSupplierName = supply.selectedQuote?.supplierName ?? null;
    patch.currentHardFloorPrice = supply.hardFloorPrice;
  }
  patch.updatedAt = new Date();
  try {
    const [row] = await _db.db.update(_schema.products).set(patch).where((0, _drizzleOrm.eq)(_schema.products.id, Number(id))).returning();
    return _server.NextResponse.json(row);
  } catch (e) {
    return _server.NextResponse.json({
      error: e instanceof Error ? e.message : "خطا"
    }, {
      status: 400
    });
  }
}
async function DELETE(_, {
  params
}) {
  const {
    id
  } = await params;
  await _db.db.delete(_schema.products).where((0, _drizzleOrm.eq)(_schema.products.id, Number(id)));
  return _server.NextResponse.json({
    ok: true
  });
}