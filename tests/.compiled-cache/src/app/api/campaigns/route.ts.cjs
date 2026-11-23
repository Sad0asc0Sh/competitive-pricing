"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.GET = GET;
exports.POST = POST;
exports.DELETE = DELETE;
const index_ts_1 = require("../../../db/index.ts");
const schema_1 = require("../../../db/schema");
const auth_1 = require("../../../lib/auth");
const bootstrap_1 = require("../../../lib/services/bootstrap");
const drizzle_orm_1 = require("drizzle-orm");
const server_1 = require("next/server");
exports.dynamic = "force-dynamic";
async function GET(req) {
    const denied = await (0, auth_1.requireAdminAuth)(req);
    if (denied)
        return denied;
    await (0, bootstrap_1.ensureDefaults)();
    const rows = await index_ts_1.db.select().from(schema_1.discountCampaigns).orderBy(schema_1.discountCampaigns.priority);
    return server_1.NextResponse.json(rows);
}
const toNums = (v) => Array.isArray(v)
    ? v.map(Number).filter((n) => Number.isFinite(n))
    : typeof v === "string"
        ? v
            .split(",")
            .map((s) => Number(s.trim()))
            .filter((n) => Number.isFinite(n))
        : [];
const toStrs = (v) => Array.isArray(v)
    ? v.map(String)
    : typeof v === "string"
        ? v
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
async function POST(req) {
    const denied = await (0, auth_1.requireAdminAuth)(req);
    if (denied)
        return denied;
    const b = (await req.json().catch(() => null));
    if (!b)
        return server_1.NextResponse.json({ error: "بدنه نامعتبر" }, { status: 400 });
    const type = b.type === "flash" ? "flash" : b.type === "timed_sale" ? "timed_sale" : "featured";
    const badgeTheme = b.badgeTheme === "gold-red"
        ? "gold-red"
        : b.badgeTheme === "red-purple"
            ? "red-purple"
            : "green-orange";
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
        targetProductIds: toNums(b.targetProductIds),
    };
    if (b.id) {
        const [row] = await index_ts_1.db
            .update(schema_1.discountCampaigns)
            .set(values)
            .where((0, drizzle_orm_1.eq)(schema_1.discountCampaigns.id, Number(b.id)))
            .returning();
        return server_1.NextResponse.json(row);
    }
    const [row] = await index_ts_1.db.insert(schema_1.discountCampaigns).values(values).returning();
    return server_1.NextResponse.json(row, { status: 201 });
}
async function DELETE(req) {
    const denied = await (0, auth_1.requireAdminAuth)(req);
    if (denied)
        return denied;
    const body = (await req.json().catch(() => ({})));
    const urlId = new URL(req.url, "http://localhost").searchParams.get("id");
    const id = Number(body.id ?? urlId);
    if (!id)
        return server_1.NextResponse.json({ error: "id لازم است" }, { status: 400 });
    await index_ts_1.db.delete(schema_1.discountCampaigns).where((0, drizzle_orm_1.eq)(schema_1.discountCampaigns.id, id));
    return server_1.NextResponse.json({ ok: true });
}
