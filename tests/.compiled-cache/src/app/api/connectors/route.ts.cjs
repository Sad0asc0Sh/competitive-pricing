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
  const rows = await _db.db.select().from(_schema.storeConnectors).orderBy(_schema.storeConnectors.id);
  // مخفی کردن رازها در خروجی
  return _server.NextResponse.json(rows.map(r => ({
    ...r,
    config: Object.fromEntries(Object.entries(r.config).map(([k, v]) => [k, /secret|key/i.test(k) && v ? "••••••" : v]))
  })));
}

/** POST { id, active?, config? } — فعال‌سازی یک کانکتور بقیه را غیرفعال می‌کند */
async function POST(req) {
  const b = await req.json().catch(() => null);
  if (!b?.id) return _server.NextResponse.json({
    error: "id لازم است"
  }, {
    status: 400
  });
  const [existing] = await _db.db.select().from(_schema.storeConnectors).where((0, _drizzleOrm.eq)(_schema.storeConnectors.id, b.id)).limit(1);
  if (!existing) return _server.NextResponse.json({
    error: "یافت نشد"
  }, {
    status: 404
  });
  const config = {
    ...existing.config
  };
  for (const [k, v] of Object.entries(b.config ?? {})) if (v !== "••••••") config[k] = v;
  if (b.active) await _db.db.update(_schema.storeConnectors).set({
    active: false
  });
  const [row] = await _db.db.update(_schema.storeConnectors).set({
    config,
    ...(b.active != null ? {
      active: b.active
    } : {})
  }).where((0, _drizzleOrm.eq)(_schema.storeConnectors.id, b.id)).returning();
  return _server.NextResponse.json(row);
}