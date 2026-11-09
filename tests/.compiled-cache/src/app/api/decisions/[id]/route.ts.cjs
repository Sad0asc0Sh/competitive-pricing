"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.GET = GET;
exports.POST = POST;
const db_1 = require("@/db");
const schema_1 = require("../../../../db/schema");
const runner_1 = require("../../../../lib/services/runner");
const drizzle_orm_1 = require("drizzle-orm");
const server_1 = require("next/server");
exports.dynamic = "force-dynamic";
async function GET(_, { params }) {
    const { id } = await params;
    const [d] = await db_1.db.select().from(schema_1.priceDecisions).where((0, drizzle_orm_1.eq)(schema_1.priceDecisions.id, Number(id))).limit(1);
    if (!d)
        return server_1.NextResponse.json({ error: "یافت نشد" }, { status: 404 });
    const offers = await db_1.db.select().from(schema_1.competitorOffers).where((0, drizzle_orm_1.eq)(schema_1.competitorOffers.decisionId, d.id));
    return server_1.NextResponse.json({ ...d, offers });
}
/** POST /api/decisions/:id  body: { action: 'approve' | 'reject', force?: boolean } */
async function POST(req, { params }) {
    const { id } = await params;
    const { action, force } = (await req.json().catch(() => ({})));
    if (action === "approve") {
        const r = await (0, runner_1.applyDecision)(Number(id), null, { force: force === true });
        return server_1.NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }
    if (action === "reject") {
        await (0, runner_1.rejectDecision)(Number(id));
        return server_1.NextResponse.json({ ok: true });
    }
    return server_1.NextResponse.json({ error: "action نامعتبر" }, { status: 400 });
}
