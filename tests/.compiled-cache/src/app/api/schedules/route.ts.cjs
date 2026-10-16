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
  return _server.NextResponse.json(await _db.db.select().from(_schema.schedules).orderBy(_schema.schedules.id));
}
async function POST(req) {
  const b = await req.json().catch(() => null);
  if (!b) return _server.NextResponse.json({
    error: "بدنه نامعتبر"
  }, {
    status: 400
  });
  const interval = Math.max(5, Number(b.intervalMinutes ?? 360) || 360);
  const values = {
    name: String(b.name ?? "زمان‌بندی"),
    intervalMinutes: interval,
    active: b.active !== false,
    filter: {
      ...(b.category ? {
        category: String(b.category)
      } : {})
    },
    nextRunAt: new Date(Date.now() + interval * 60000)
  };
  if (b.id) {
    const [row] = await _db.db.update(_schema.schedules).set(values).where((0, _drizzleOrm.eq)(_schema.schedules.id, Number(b.id))).returning();
    return _server.NextResponse.json(row);
  }
  const [row] = await _db.db.insert(_schema.schedules).values(values).returning();
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
  await _db.db.delete(_schema.schedules).where((0, _drizzleOrm.eq)(_schema.schedules.id, Number(id)));
  return _server.NextResponse.json({
    ok: true
  });
}