"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
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
  const rows = await _db.db.select().from(_schema.pricingProfiles).orderBy(_schema.pricingProfiles.id);
  return _server.NextResponse.json(rows.map(r => ({
    ...r,
    config: (0, _bootstrap.mergeConfig)(r.config)
  })));
}

/** POST: ایجاد یا بروزرسانی پروفایل  body: { id?, name, config, isDefault? } */
async function POST(req) {
  const body = await req.json().catch(() => null);
  if (!body) return _server.NextResponse.json({
    error: "بدنه نامعتبر"
  }, {
    status: 400
  });
  const config = (0, _bootstrap.mergeConfig)(body.config);
  if (body.isDefault) await _db.db.update(_schema.pricingProfiles).set({
    isDefault: false
  });
  if (body.id) {
    const [row] = await _db.db.update(_schema.pricingProfiles).set({
      config,
      ...(body.name ? {
        name: body.name
      } : {}),
      ...(body.isDefault != null ? {
        isDefault: body.isDefault
      } : {}),
      updatedAt: new Date()
    }).where((0, _drizzleOrm.eq)(_schema.pricingProfiles.id, body.id)).returning();
    return _server.NextResponse.json(row);
  }
  const [row] = await _db.db.insert(_schema.pricingProfiles).values({
    name: body.name ?? "پروفایل جدید",
    config,
    isDefault: !!body.isDefault
  }).returning();
  return _server.NextResponse.json(row, {
    status: 201
  });
}