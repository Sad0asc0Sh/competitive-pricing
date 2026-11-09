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
    const rows = await db_1.db.select().from(schema_1.pricingProfiles).orderBy(schema_1.pricingProfiles.id);
    return server_1.NextResponse.json(rows.map((r) => ({ ...r, config: (0, bootstrap_1.mergeConfig)(r.config) })));
}
/** POST: ایجاد یا بروزرسانی پروفایل  body: { id?, name, config, isDefault? } */
async function POST(req) {
    const body = (await req.json().catch(() => null));
    if (!body)
        return server_1.NextResponse.json({ error: "بدنه نامعتبر" }, { status: 400 });
    const config = (0, bootstrap_1.mergeConfig)(body.config);
    if (body.isDefault)
        await db_1.db.update(schema_1.pricingProfiles).set({ isDefault: false });
    if (body.id) {
        const [row] = await db_1.db
            .update(schema_1.pricingProfiles)
            .set({ config, ...(body.name ? { name: body.name } : {}), ...(body.isDefault != null ? { isDefault: body.isDefault } : {}), updatedAt: new Date() })
            .where((0, drizzle_orm_1.eq)(schema_1.pricingProfiles.id, body.id))
            .returning();
        return server_1.NextResponse.json(row);
    }
    const [row] = await db_1.db.insert(schema_1.pricingProfiles).values({ name: body.name ?? "پروفایل جدید", config, isDefault: !!body.isDefault }).returning();
    return server_1.NextResponse.json(row, { status: 201 });
}
