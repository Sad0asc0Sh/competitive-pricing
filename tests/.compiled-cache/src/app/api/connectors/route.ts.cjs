"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.GET = GET;
exports.POST = POST;
const index_ts_1 = require("../../../db/index.ts");
const schema_1 = require("../../../db/schema");
const auth_1 = require("../../../lib/auth");
const format_1 = require("../../../lib/format");
const bootstrap_1 = require("../../../lib/services/bootstrap");
const drizzle_orm_1 = require("drizzle-orm");
const server_1 = require("next/server");
exports.dynamic = "force-dynamic";
function maskConnectorConfig(config) {
    return Object.fromEntries(Object.entries(config ?? {}).map(([k, v]) => [k, /secret|key/i.test(k) && v ? "••••••" : v]));
}
async function GET(req) {
    const denied = await (0, auth_1.requireAdminAuth)(req);
    if (denied)
        return denied;
    await (0, bootstrap_1.ensureDefaults)();
    const rows = await index_ts_1.db.select().from(schema_1.storeConnectors).orderBy(schema_1.storeConnectors.id);
    // مخفی کردن رازها در خروجی
    return server_1.NextResponse.json(rows.map((r) => ({
        ...r,
        config: maskConnectorConfig(r.config),
    })));
}
/** POST { id, active?, config? } — فعال‌سازی یک کانکتور بقیه را غیرفعال می‌کند */
async function POST(req) {
    const denied = await (0, auth_1.requireAdminAuth)(req);
    if (denied)
        return denied;
    const b = (await req.json().catch(() => null));
    const connectorId = (0, format_1.parsePositiveInt)(b?.id);
    if (connectorId == null)
        return server_1.NextResponse.json({ error: "id معتبر لازم است" }, { status: 400 });
    const [existing] = await index_ts_1.db.select().from(schema_1.storeConnectors).where((0, drizzle_orm_1.eq)(schema_1.storeConnectors.id, connectorId)).limit(1);
    if (!existing)
        return server_1.NextResponse.json({ error: "یافت نشد" }, { status: 404 });
    const config = { ...(existing.config ?? {}) };
    for (const [k, v] of Object.entries(b?.config ?? {})) {
        if (v !== "••••••" && v !== "••••••••")
            config[k] = v;
    }
    if (b?.active)
        await index_ts_1.db.update(schema_1.storeConnectors).set({ active: false });
    const [row] = await index_ts_1.db
        .update(schema_1.storeConnectors)
        .set({ config, ...(b?.active != null ? { active: b.active } : {}) })
        .where((0, drizzle_orm_1.eq)(schema_1.storeConnectors.id, connectorId))
        .returning();
    return server_1.NextResponse.json({
        ...row,
        config: maskConnectorConfig(row.config),
    });
}
