"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.GET = GET;
exports.POST = POST;
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
    const rows = await index_ts_1.db.select().from(schema_1.pricingProfiles).orderBy(schema_1.pricingProfiles.id);
    return server_1.NextResponse.json(rows.map((r) => ({ ...r, config: (0, bootstrap_1.mergeConfig)(r.config) })));
}
/** POST: ایجاد یا بروزرسانی پروفایل  body: { id?, name, config, isDefault? } */
async function POST(req) {
    const denied = await (0, auth_1.requireAdminAuth)(req);
    if (denied)
        return denied;
    const body = (await req.json().catch(() => null));
    if (!body)
        return server_1.NextResponse.json({ error: "بدنه نامعتبر" }, { status: 400 });
    let baseExisting;
    if (body.id) {
        const [existing] = await index_ts_1.db
            .select()
            .from(schema_1.pricingProfiles)
            .where((0, drizzle_orm_1.eq)(schema_1.pricingProfiles.id, body.id))
            .limit(1);
        baseExisting = existing?.config;
    }
    const incoming = body.config ?? {};
    const mergedInput = {
        ...(baseExisting ?? {}),
        ...incoming,
        sourcing: { ...(baseExisting?.sourcing ?? {}), ...(incoming.sourcing ?? {}) },
        filters: { ...(baseExisting?.filters ?? {}), ...(incoming.filters ?? {}) },
        outliers: { ...(baseExisting?.outliers ?? {}), ...(incoming.outliers ?? {}) },
        aggregation: { ...(baseExisting?.aggregation ?? {}), ...(incoming.aggregation ?? {}) },
        rank1: { ...(baseExisting?.rank1 ?? {}), ...(incoming.rank1 ?? {}) },
        margin: { ...(baseExisting?.margin ?? {}), ...(incoming.margin ?? {}) },
        guards: { ...(baseExisting?.guards ?? {}), ...(incoming.guards ?? {}) },
        discount: { ...(baseExisting?.discount ?? {}), ...(incoming.discount ?? {}) },
        rounding: { ...(baseExisting?.rounding ?? {}), ...(incoming.rounding ?? {}) },
        supervisor: {
            ...(baseExisting?.supervisor ?? {}),
            ...(incoming.supervisor ?? {}),
            gates: {
                ...(baseExisting?.supervisor?.gates ?? {}),
                ...(incoming.supervisor?.gates ?? {}),
            },
        },
        ai: { ...(baseExisting?.ai ?? {}), ...(incoming.ai ?? {}) },
        ...(baseExisting?.costless || incoming.costless
            ? {
                costless: {
                    ...(baseExisting?.costless ?? {}),
                    ...(incoming.costless ?? {}),
                },
            }
            : {}),
        ...(baseExisting?.estimator || incoming.estimator
            ? {
                estimator: {
                    ...(baseExisting?.estimator ?? {}),
                    ...(incoming.estimator ?? {}),
                },
            }
            : {}),
    };
    const config = (0, bootstrap_1.mergeConfig)(mergedInput);
    if (body.isDefault)
        await index_ts_1.db.update(schema_1.pricingProfiles).set({ isDefault: false });
    if (body.id) {
        const [row] = await index_ts_1.db
            .update(schema_1.pricingProfiles)
            .set({
            config,
            ...(body.name ? { name: body.name } : {}),
            ...(body.isDefault != null ? { isDefault: body.isDefault } : {}),
            updatedAt: new Date(),
        })
            .where((0, drizzle_orm_1.eq)(schema_1.pricingProfiles.id, body.id))
            .returning();
        return server_1.NextResponse.json(row);
    }
    const [row] = await index_ts_1.db
        .insert(schema_1.pricingProfiles)
        .values({ name: body.name ?? "پروفایل جدید", config, isDefault: !!body.isDefault })
        .returning();
    return server_1.NextResponse.json(row, { status: 201 });
}
