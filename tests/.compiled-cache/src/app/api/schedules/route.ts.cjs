"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.GET = GET;
exports.POST = POST;
exports.DELETE = DELETE;
const db_1 = require("@/db");
const schema_1 = require("../../../db/schema");
const bootstrap_1 = require("../../../lib/services/bootstrap");
const drizzle_orm_1 = require("drizzle-orm");
const server_1 = require("next/server");
exports.dynamic = "force-dynamic";
async function GET() {
    await (0, bootstrap_1.ensureDefaults)();
    return server_1.NextResponse.json(await db_1.db.select().from(schema_1.schedules).orderBy(schema_1.schedules.id));
}
async function POST(req) {
    const b = (await req.json().catch(() => null));
    if (!b)
        return server_1.NextResponse.json({ error: "بدنه نامعتبر" }, { status: 400 });
    const interval = Math.max(5, Number(b.intervalMinutes ?? 360) || 360);
    const values = {
        name: String(b.name ?? "زمان‌بندی"),
        intervalMinutes: interval,
        active: b.active !== false,
        filter: { ...(b.category ? { category: String(b.category) } : {}) },
        nextRunAt: new Date(Date.now() + interval * 60000),
    };
    if (b.id) {
        const [row] = await db_1.db.update(schema_1.schedules).set(values).where((0, drizzle_orm_1.eq)(schema_1.schedules.id, Number(b.id))).returning();
        return server_1.NextResponse.json(row);
    }
    const [row] = await db_1.db.insert(schema_1.schedules).values(values).returning();
    return server_1.NextResponse.json(row, { status: 201 });
}
async function DELETE(req) {
    const { id } = (await req.json().catch(() => ({})));
    if (!id)
        return server_1.NextResponse.json({ error: "id لازم است" }, { status: 400 });
    await db_1.db.delete(schema_1.schedules).where((0, drizzle_orm_1.eq)(schema_1.schedules.id, Number(id)));
    return server_1.NextResponse.json({ ok: true });
}
