"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.GET = GET;
exports.POST = POST;
const db_1 = require("@/db");
const schema_1 = require("../../../db/schema");
const bootstrap_1 = require("../../../lib/services/bootstrap");
const drizzle_orm_1 = require("drizzle-orm");
const server_1 = require("next/server");
exports.dynamic = "force-dynamic";
async function GET() {
    await (0, bootstrap_1.ensureDefaults)();
    const rows = await db_1.db.select().from(schema_1.storeConnectors).orderBy(schema_1.storeConnectors.id);
    // مخفی کردن رازها در خروجی
    return server_1.NextResponse.json(rows.map((r) => ({
        ...r,
        config: Object.fromEntries(Object.entries(r.config).map(([k, v]) => [k, /secret|key/i.test(k) && v ? "••••••" : v])),
    })));
}
/** POST { id, active?, config? } — فعال‌سازی یک کانکتور بقیه را غیرفعال می‌کند */
async function POST(req) {
    const b = (await req.json().catch(() => null));
    if (!b?.id)
        return server_1.NextResponse.json({ error: "id لازم است" }, { status: 400 });
    const [existing] = await db_1.db.select().from(schema_1.storeConnectors).where((0, drizzle_orm_1.eq)(schema_1.storeConnectors.id, b.id)).limit(1);
    if (!existing)
        return server_1.NextResponse.json({ error: "یافت نشد" }, { status: 404 });
    const config = { ...existing.config };
    for (const [k, v] of Object.entries(b.config ?? {}))
        if (v !== "••••••")
            config[k] = v;
    if (b.active)
        await db_1.db.update(schema_1.storeConnectors).set({ active: false });
    const [row] = await db_1.db
        .update(schema_1.storeConnectors)
        .set({ config, ...(b.active != null ? { active: b.active } : {}) })
        .where((0, drizzle_orm_1.eq)(schema_1.storeConnectors.id, b.id))
        .returning();
    return server_1.NextResponse.json(row);
}
