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
function parseProductIds(raw) {
    if (Array.isArray(raw)) {
        return raw.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
    }
    if (typeof raw === "string" && raw.trim()) {
        return raw
            .split(/[,\s،]+/)
            .map((x) => Number(x.trim()))
            .filter((n) => Number.isFinite(n) && n > 0);
    }
    return [];
}
async function GET(req) {
    const denied = await (0, auth_1.requireAdminAuth)(req);
    if (denied)
        return denied;
    await (0, bootstrap_1.ensureDefaults)();
    return server_1.NextResponse.json(await index_ts_1.db.select().from(schema_1.schedules).orderBy(schema_1.schedules.id));
}
async function POST(req) {
    const denied = await (0, auth_1.requireAdminAuth)(req);
    if (denied)
        return denied;
    const b = (await req.json().catch(() => null));
    if (!b)
        return server_1.NextResponse.json({ error: "بدنه نامعتبر" }, { status: 400 });
    const interval = Math.max(5, Number(b.intervalMinutes ?? 360) || 360);
    const rawFilter = (b.filter && typeof b.filter === "object" ? b.filter : {});
    const categoryVal = b.category ?? rawFilter.category;
    const category = typeof categoryVal === "string" && categoryVal.trim() ? categoryVal.trim() : undefined;
    const productIds = parseProductIds(b.productIds ?? rawFilter.productIds);
    const values = {
        name: String(b.name ?? "زمان‌بندی"),
        intervalMinutes: interval,
        active: b.active !== false,
        filter: {
            ...(category ? { category } : {}),
            ...(productIds.length > 0 ? { productIds } : {}),
        },
        nextRunAt: new Date(Date.now() + interval * 60000),
    };
    if (b.id) {
        const [row] = await index_ts_1.db
            .update(schema_1.schedules)
            .set(values)
            .where((0, drizzle_orm_1.eq)(schema_1.schedules.id, Number(b.id)))
            .returning();
        return server_1.NextResponse.json(row);
    }
    const [row] = await index_ts_1.db.insert(schema_1.schedules).values(values).returning();
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
    await index_ts_1.db.delete(schema_1.schedules).where((0, drizzle_orm_1.eq)(schema_1.schedules.id, id));
    return server_1.NextResponse.json({ ok: true });
}
