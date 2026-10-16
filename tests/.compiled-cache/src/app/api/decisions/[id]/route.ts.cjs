"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.GET = GET;
exports.POST = POST;
exports.dynamic = void 0;
var _db = require("@/db");
var _schema = require("../../../../db/schema");
var _runner = require("../../../../lib/services/runner");
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
  const [d] = await _db.db.select().from(_schema.priceDecisions).where((0, _drizzleOrm.eq)(_schema.priceDecisions.id, Number(id))).limit(1);
  if (!d) return _server.NextResponse.json({
    error: "یافت نشد"
  }, {
    status: 404
  });
  const offers = await _db.db.select().from(_schema.competitorOffers).where((0, _drizzleOrm.eq)(_schema.competitorOffers.decisionId, d.id));
  return _server.NextResponse.json({
    ...d,
    offers
  });
}

/** POST /api/decisions/:id  body: { action: 'approve' | 'reject', force?: boolean } */
async function POST(req, {
  params
}) {
  const {
    id
  } = await params;
  const {
    action,
    force
  } = await req.json().catch(() => ({}));
  if (action === "approve") {
    const r = await (0, _runner.applyDecision)(Number(id), null, {
      force: force === true
    });
    return _server.NextResponse.json(r, {
      status: r.ok ? 200 : 400
    });
  }
  if (action === "reject") {
    await (0, _runner.rejectDecision)(Number(id));
    return _server.NextResponse.json({
      ok: true
    });
  }
  return _server.NextResponse.json({
    error: "action نامعتبر"
  }, {
    status: 400
  });
}