"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.DELETE = DELETE;
exports.GET = GET;
exports.POST = POST;
exports.dynamic = void 0;
var _db = require("@/db");
var _schema = require("../../../db/schema");
var _bootstrap = require("../../../lib/services/bootstrap");
var _drizzleOrm = require("drizzle-orm");
var _server = require("next/server");
const dynamic = "force-dynamic";
exports.dynamic = dynamic;
async function GET() {
  await (0, _bootstrap.ensureDefaults)();
  const rows = await _db.db.select().from(_schema.discountCampaigns).orderBy(_schema.discountCampaigns.priority);
  return _server.NextResponse.json(rows);
}
const toNums = v => Array.isArray(v) ? v.map(Number).filter(n => Number.isFinite(n)) : typeof v === "string" ? v.split(",").map(s => Number(s.trim())).filter(n => Number.isFinite(n)) : [];
const toStrs = v => Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(",").map(s => s.trim()).filter(Boolean) : [];
async function POST(req) {
  const b = await req.json().catch(() => null);
  if (!b) return _server.NextResponse.json({
    error: "بدنه نامعتبر"
  }, {
    status: 400
  });
  const type = b.type === "flash" ? "flash" : b.type === "timed_sale" ? "timed_sale" : "featured";
  const badgeTheme = b.badgeTheme === "gold-red" ? "gold-red" : b.badgeTheme === "red-purple" ? "red-purple" : "green-orange";
  const values = {
    name: String(b.name ?? "کمپین هوشمند"),
    type,
    active: b.active !== false,
    priority: Number(b.priority ?? 0) || 0,
    minDiscountPct: Number(b.minDiscountPct ?? 0) || 0,
    maxDiscountPct: Number(b.maxDiscountPct ?? 100) || 100,
    activeHours: toNums(b.activeHours),
    activeDays: toNums(b.activeDays),
    categories: toStrs(b.categories),
    durationHours: Number(b.durationHours ?? 24) || 24,
    badgeTheme,
    showInFeatured: Boolean(b.showInFeatured),
    cardRangeFrom: Math.max(1, Number(b.cardRangeFrom ?? 1) || 1),
    cardRangeTo: Math.max(1, Number(b.cardRangeTo ?? 9999) || 9999),
    maxCards: Math.max(0, Number(b.maxCards ?? 0) || 0),
    minPriceToman: Math.max(0, Number(b.minPriceToman ?? 0) || 0),
    maxPriceToman: Math.max(0, Number(b.maxPriceToman ?? 0) || 0),
    onlyTopRanked: Boolean(b.onlyTopRanked),
    targetProductIds: toNums(b.targetProductIds)
  };
  if (b.id) {
    const [row] = await _db.db.update(_schema.discountCampaigns).set(values).where((0, _drizzleOrm.eq)(_schema.discountCampaigns.id, Number(b.id))).returning();
    return _server.NextResponse.json(row);
  }
  const [row] = await _db.db.insert(_schema.discountCampaigns).values(values).returning();
  return _server.NextResponse.json(row, {
    status: 201
  });
}
async function DELETE(req) {
  const {
    id
  } = await req.json().catch(() => ({}));
  if (!id) return _server.NextResponse.json({
    error: "id لازم است"
  }, {
    status: 400
  });
  await _db.db.delete(_schema.discountCampaigns).where((0, _drizzleOrm.eq)(_schema.discountCampaigns.id, Number(id)));
  return _server.NextResponse.json({
    ok: true
  });
}