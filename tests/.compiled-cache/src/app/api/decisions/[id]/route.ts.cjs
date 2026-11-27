"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.GET = GET;
exports.POST = POST;
const index_ts_1 = require("../../../../db/index.ts");
const schema_1 = require("../../../../db/schema");
const auth_1 = require("../../../../lib/auth");
const runnerService = __importStar(require("../../../../lib/services/runner"));
const torob_1 = require("../../../../lib/sources/torob");
const drizzle_orm_1 = require("drizzle-orm");
const server_1 = require("next/server");
exports.dynamic = "force-dynamic";
async function GET(req, { params }) {
    const denied = await (0, auth_1.requireAdminAuth)(req);
    if (denied)
        return denied;
    const { id } = await params;
    const [d] = await index_ts_1.db.select().from(schema_1.priceDecisions).where((0, drizzle_orm_1.eq)(schema_1.priceDecisions.id, Number(id))).limit(1);
    if (!d)
        return server_1.NextResponse.json({ error: "یافت نشد" }, { status: 404 });
    const offers = await index_ts_1.db.select().from(schema_1.competitorOffers).where((0, drizzle_orm_1.eq)(schema_1.competitorOffers.decisionId, d.id));
    return server_1.NextResponse.json({ ...d, offers });
}
/**
 * POST /api/decisions/:id
 * body: {
 *   action: 'approve' | 'reject' | 'retry_sync' | 'relink_torob',
 *   force?: boolean,
 *   finalPrice?: number | null,
 *   useDisplayDiscount?: boolean | null,
 *   basePrice?: number | null,
 *   discountPct?: number | null,
 *   campaignType?: string | null,
 *   torobUrl?: string
 * }
 */
async function POST(req, { params }) {
    const denied = await (0, auth_1.requireAdminAuth)(req);
    if (denied)
        return denied;
    const { id } = await params;
    const decisionId = Number(id);
    if (!Number.isFinite(decisionId) || decisionId <= 0) {
        return server_1.NextResponse.json({ ok: false, error: "شناسه تصمیم نامعتبر است" }, { status: 400 });
    }
    const body = (await req.json().catch(() => ({})));
    const action = body.action;
    const force = body.force === true;
    if (action === "reject") {
        await runnerService.rejectDecision(decisionId);
        return server_1.NextResponse.json({ ok: true, message: "تصمیم رد شد" });
    }
    if (action === "relink_torob") {
        const [d] = await index_ts_1.db.select().from(schema_1.priceDecisions).where((0, drizzle_orm_1.eq)(schema_1.priceDecisions.id, decisionId)).limit(1);
        if (!d) {
            return server_1.NextResponse.json({ ok: false, error: "تصمیم یافت نشد", message: "تصمیم یافت نشد" }, { status: 404 });
        }
        const rawUrl = typeof body.torobUrl === "string" ? body.torobUrl.trim() : "";
        const isHttp = /^https?:\/\//i.test(rawUrl);
        if (!rawUrl || (isHttp && !/^https?:\/\/([^/]+\.)?torob\.com\//i.test(rawUrl))) {
            const msg = "لینک معتبر صفحه محصول ترب (torob.com/p/...) وارد کنید";
            return server_1.NextResponse.json({ ok: false, error: msg, message: msg }, { status: 400 });
        }
        const prk = (0, torob_1.extractPrk)(rawUrl, isHttp ? null : rawUrl);
        if (!prk || prk.length < 3) {
            const msg = "شناسه محصول ترب (prk) در لینک واردشده یافت نشد";
            return server_1.NextResponse.json({ ok: false, error: msg, message: msg }, { status: 400 });
        }
        const normalizedUrl = isHttp ? rawUrl : `https://torob.com/p/${prk}/`;
        await index_ts_1.db
            .update(schema_1.products)
            .set({
            torobUrl: normalizedUrl,
            torobPrk: prk,
            torobDetailsUrl: null,
            lockedUntil: null,
            updatedAt: new Date(),
        })
            .where((0, drizzle_orm_1.eq)(schema_1.products.id, d.productId));
        if (d.status === "rejected" || d.status === "pending_review") {
            await index_ts_1.db
                .update(schema_1.priceDecisions)
                .set({ status: "superseded", pushStatus: "superseded" })
                .where((0, drizzle_orm_1.eq)(schema_1.priceDecisions.id, d.id));
        }
        const summary = await runnerService.runPricing({
            trigger: "manual",
            productIds: [d.productId],
            runMode: "live",
        });
        return server_1.NextResponse.json({
            ok: true,
            message: `لینک ترب به شناسه ${prk} متصل شد و استعلام جدید در صف قرار گرفت`,
            prk,
            torobUrl: normalizedUrl,
            summary,
        });
    }
    if (action !== "approve" && action !== "retry_sync") {
        return server_1.NextResponse.json({ ok: false, error: "action نامعتبر" }, { status: 400 });
    }
    const [d] = await index_ts_1.db.select().from(schema_1.priceDecisions).where((0, drizzle_orm_1.eq)(schema_1.priceDecisions.id, decisionId)).limit(1);
    if (!d) {
        return server_1.NextResponse.json({ ok: false, error: "تصمیم یافت نشد", message: "تصمیم یافت نشد" }, { status: 404 });
    }
    const [p] = await index_ts_1.db.select().from(schema_1.products).where((0, drizzle_orm_1.eq)(schema_1.products.id, d.productId)).limit(1);
    const hasHumanOverride = action === "approve" &&
        (body.finalPrice != null ||
            body.useDisplayDiscount != null ||
            body.basePrice != null ||
            body.discountPct != null ||
            body.campaignType != null);
    if (hasHumanOverride && body.finalPrice != null) {
        const n = Number(body.finalPrice);
        if (!Number.isFinite(n) || Math.round(n) <= 0) {
            const msg = "قیمت نهایی یوزر نامعتبر است";
            return server_1.NextResponse.json({ ok: false, error: msg, message: msg }, { status: 400 });
        }
    }
    const finalPrice = hasHumanOverride && body.finalPrice != null ? Math.round(Number(body.finalPrice)) : (d.finalPrice ?? 0);
    const effectiveCost = Math.max(d.effectiveCostPrice ?? 0, p?.costPrice ?? 0);
    const effectiveFloor = Math.max(d.hardFloorPrice ?? 0, p?.currentHardFloorPrice ?? 0, effectiveCost);
    const isBelowCostOrFloor = (effectiveCost > 0 && finalPrice <= effectiveCost) ||
        (effectiveFloor > 0 && finalPrice < effectiveFloor);
    if (isBelowCostOrFloor) {
        const floorLabel = Math.max(effectiveCost, effectiveFloor).toLocaleString("fa-IR");
        const finalLabel = finalPrice.toLocaleString("fa-IR");
        const msg = `خط قرمز قیمت‌گذاری: قیمت نهایی (${finalLabel}) پایین‌تر از کف مجاز/قیمت خرید (${floorLabel}) است. قیمت فروش را اصلاح کنید.`;
        return server_1.NextResponse.json({
            ok: false,
            code: "BELOW_FLOOR_BLOCKED",
            belowCostBlocked: true,
            error: msg,
            message: msg,
        }, { status: 422 });
    }
    const applyOpts = { force };
    const extRunner = runnerService;
    if (hasHumanOverride && typeof extRunner.applyHumanOverrideToDecision === "function") {
        const ov = await extRunner.applyHumanOverrideToDecision(decisionId, {
            finalPrice: body.finalPrice,
            useDisplayDiscount: body.useDisplayDiscount,
            basePrice: body.basePrice,
            discountPct: body.discountPct,
            campaignType: body.campaignType,
        });
        if (!ov.ok) {
            const msg = ov.message || "خطا در ثبت ویرایش دستی";
            return server_1.NextResponse.json({ ok: false, error: msg, message: msg }, { status: 400 });
        }
    }
    const r = action === "retry_sync" && typeof extRunner.retryDecisionSync === "function"
        ? await extRunner.retryDecisionSync(decisionId, applyOpts)
        : await extRunner.applyDecision(decisionId, null, applyOpts);
    const msg = r.message || r.error || (r.ok ? "انجام شد" : "خطا در اعمال تصمیم");
    return server_1.NextResponse.json({
        ...r,
        ok: r.ok,
        message: msg,
        ...(r.ok ? {} : { error: msg }),
    }, { status: r.ok ? 200 : 400 });
}
