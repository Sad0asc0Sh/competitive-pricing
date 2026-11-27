"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.default = ReviewPage;
const jsx_runtime_1 = require("react/jsx-runtime");
const listing_1 = require("../../lib/pricing/listing");
const format_1 = require("../../lib/format");
const index_ts_1 = require("../../db/index.ts");
const schema_1 = require("../../db/schema");
const review_client_1 = require("@/components/review-client");
const drizzle_orm_1 = require("drizzle-orm");
exports.dynamic = "force-dynamic";
function numOrNull(v) {
    return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function extractAlternative(v) {
    if (!v || typeof v !== "object")
        return null;
    const r = v;
    const finalPrice = numOrNull(r.finalPrice);
    const p = numOrNull(r.p);
    const lowestPrice = numOrNull(r.lowestPrice);
    if (finalPrice == null || p == null || lowestPrice == null)
        return null;
    return {
        finalPrice: Math.round(finalPrice),
        p,
        lowestPrice: Math.round(lowestPrice),
        shopName: String(r.shopName ?? "رقیب"),
    };
}
function extractSupervisorGates(supStep) {
    const overallRaw = supStep?.data?.overallScorePct;
    const overallPct = typeof overallRaw === "number" && Number.isFinite(overallRaw) ? Math.round(overallRaw) : null;
    const gatesObj = supStep?.data?.gates;
    if (!gatesObj || typeof gatesObj !== "object") {
        return { overallPct, gates: [] };
    }
    const gates = [];
    for (const val of Object.values(gatesObj)) {
        if (!val || typeof val !== "object")
            continue;
        gates.push({
            key: String(val.key ?? ""),
            title: String(val.title ?? val.key ?? ""),
            scorePct: typeof val.scorePct === "number" ? Math.round(val.scorePct) : 0,
            verdict: String(val.verdict ?? "review"),
            reason: String(val.reason ?? ""),
        });
    }
    return { overallPct, gates };
}
async function ReviewPage() {
    const [rawRows, rawRejectedRows] = await Promise.all([
        index_ts_1.db
            .select({
            d: schema_1.priceDecisions,
            name: schema_1.products.name,
            sku: schema_1.products.sku,
            cost: schema_1.products.costPrice,
            hardFloor: schema_1.products.currentHardFloorPrice,
            current: schema_1.products.currentFinalPrice,
            torobUrl: schema_1.products.torobUrl,
        })
            .from(schema_1.priceDecisions)
            .innerJoin(schema_1.products, (0, drizzle_orm_1.eq)(schema_1.products.id, schema_1.priceDecisions.productId))
            .where((0, drizzle_orm_1.inArray)(schema_1.priceDecisions.status, ["pending_review", "sync_failed", "pending_sync"]))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.priceDecisions.createdAt)),
        index_ts_1.db
            .select({
            d: schema_1.priceDecisions,
            name: schema_1.products.name,
            sku: schema_1.products.sku,
            torobUrl: schema_1.products.torobUrl,
        })
            .from(schema_1.priceDecisions)
            .innerJoin(schema_1.products, (0, drizzle_orm_1.eq)(schema_1.products.id, schema_1.priceDecisions.productId))
            .where((0, drizzle_orm_1.eq)(schema_1.priceDecisions.status, "rejected"))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.priceDecisions.createdAt))
            .limit(40),
    ]);
    const seenPendingProducts = new Set();
    const rows = rawRows.filter(({ d }) => {
        if (seenPendingProducts.has(d.productId))
            return false;
        seenPendingProducts.add(d.productId);
        return true;
    });
    const seenRejectedProducts = new Set();
    const rejectedRows = rawRejectedRows
        .filter(({ d }) => {
        if (seenPendingProducts.has(d.productId))
            return false;
        if (seenRejectedProducts.has(d.productId))
            return false;
        seenRejectedProducts.add(d.productId);
        return true;
    })
        .slice(0, 20);
    const pendingDecisionIds = rows.map(({ d }) => d.id);
    const offersByDecision = new Map();
    if (pendingDecisionIds.length > 0) {
        const offerRows = await index_ts_1.db
            .select({
            id: schema_1.competitorOffers.id,
            decisionId: schema_1.competitorOffers.decisionId,
            shopName: schema_1.competitorOffers.shopName,
            shopCity: schema_1.competitorOffers.shopCity,
            price: schema_1.competitorOffers.price,
            sellerType: schema_1.competitorOffers.sellerType,
            torobEvidence: schema_1.competitorOffers.torobEvidence,
            shopScore: schema_1.competitorOffers.shopScore,
            isLocalCity: schema_1.competitorOffers.isLocalCity,
            included: schema_1.competitorOffers.included,
            excludeReason: schema_1.competitorOffers.excludeReason,
        })
            .from(schema_1.competitorOffers)
            .where((0, drizzle_orm_1.inArray)(schema_1.competitorOffers.decisionId, pendingDecisionIds))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.competitorOffers.price));
        const identityRank = { MATCH_CONFIRMED: 0, REVIEW_REQUIRED: 1, IDENTITY_MISMATCH: 2 };
        for (const o of offerRows) {
            const list = offersByDecision.get(o.decisionId) ?? [];
            list.push({
                id: o.id,
                shopName: o.shopName,
                shopCity: o.shopCity,
                price: o.price,
                sellerType: o.sellerType,
                listingTitle: o.torobEvidence?.listingTitle ?? null,
                torobEvidence: o.torobEvidence,
                shopScore: o.shopScore,
                isLocalCity: o.isLocalCity,
                included: o.included,
                excludeReason: o.excludeReason,
            });
            offersByDecision.set(o.decisionId, list);
        }
        for (const [decisionId, list] of offersByDecision.entries()) {
            list.sort((a, b) => {
                const ra = identityRank[a.torobEvidence?.identity?.status ?? "REVIEW_REQUIRED"] ?? 1;
                const rb = identityRank[b.torobEvidence?.identity?.status ?? "REVIEW_REQUIRED"] ?? 1;
                return ra !== rb ? ra - rb : a.price - b.price;
            });
            offersByDecision.set(decisionId, list.slice(0, 15));
        }
    }
    const pendingItems = rows.map(({ d, name, sku, cost, hardFloor, current, torobUrl }) => {
        const steps = Array.isArray(d.steps) ? d.steps : [];
        const panels = (0, listing_1.decisionPanels)(steps);
        const inquiry = steps.find((s) => s.step === "torob_inquiry")?.data;
        const reasons = steps.find((s) => s.step === "decision")?.message ?? "";
        const supStep = steps.find((s) => s.step === "supervisor");
        const supMsg = supStep?.message ?? null;
        const { overallPct: supOverallPct, gates: supGates } = extractSupervisorGates(supStep);
        const aiMsg = steps.find((s) => s.step === "ai_review")?.message ?? null;
        const aiIdentityMsg = steps.find((s) => s.step === "ai_identity")?.message ?? null;
        const liquidationMsg = steps.find((s) => s.step === "liquidation_guard")?.message ?? null;
        const gateStep = steps.find((s) => s.step === "supervision_gate");
        const robStep = steps.find((s) => s.step === "robustness");
        const valStep = steps.find((s) => s.step === "validity");
        const positionStep = steps.find((s) => s.step === "position");
        const rankIncludingSuspect = d.rankIncludingSuspect ?? (Number(positionStep?.data?.rankIncludingSuspect) || null);
        const totalIncludingSuspect = d.totalSellersIncludingSuspect || Number(positionStep?.data?.totalSellersIncludingSuspect) || 0;
        const effectiveCost = Math.max(d.effectiveCostPrice ?? 0, cost ?? 0);
        const effectiveFloor = Math.max(d.hardFloorPrice ?? 0, hardFloor ?? 0, effectiveCost);
        const finalPrice = d.finalPrice ?? 0;
        const isBelowFloor = finalPrice > 0 &&
            ((effectiveCost > 0 && finalPrice <= effectiveCost) ||
                (effectiveFloor > 0 && finalPrice < effectiveFloor));
        const syncFailed = d.status === "sync_failed" || d.status === "pending_sync" || d.pushStatus === "failed";
        const pRight = numOrNull(robStep?.data?.pRight);
        const pTooHigh = numOrNull(robStep?.data?.pTooHigh);
        const pTooLow = numOrNull(robStep?.data?.pTooLow);
        const alternative = extractAlternative(robStep?.data?.alternative);
        const marketSigma = numOrNull(valStep?.data?.sigma);
        const pAnchorOk = numOrNull(valStep?.data?.pAnchorOk);
        const confidence = Number.isFinite(d.confidence) ? d.confidence : 0;
        const errorRiskPct = Math.max(0, Math.min(100, Math.round((1 - (pRight ?? confidence)) * 100)));
        const readyForApproval = Boolean(!isBelowFloor &&
            !syncFailed &&
            !d.marketConflict && !d.isSimulated && effectiveCost > 0 &&
            finalPrice > 0 &&
            gateStep?.data?.readyForApproval === true);
        return {
            id: d.id,
            productId: d.productId,
            name,
            sku,
            status: d.status,
            createdAt: (0, format_1.toIsoString)(d.createdAt),
            cost,
            effectiveCost,
            current,
            referencePrice: d.referencePrice,
            marketMedian: d.marketMedian,
            basePrice: d.basePrice,
            finalPrice: d.finalPrice,
            discountPct: d.discountPct,
            campaignType: d.campaignType,
            strategy: d.strategy ?? null,
            netProfitToman: d.netProfitToman ?? null,
            netMarginPct: d.netMarginPct ?? null,
            offersUsed: d.offersUsed,
            offersTotal: d.offersTotal,
            confidence,
            errorRiskPct,
            pRight,
            pTooHigh,
            pTooLow,
            alternative,
            marketSigma,
            pAnchorOk,
            projectedNationalRank: d.projectedNationalRank,
            rankIncludingSuspect,
            totalIncludingSuspect,
            marketConflict: d.marketConflict,
            isBelowFloor,
            syncFailed,
            readyForApproval,
            panels,
            inquiry: inquiry ?? null,
            candidateUrl: inquiry?.candidate?.url ?? torobUrl,
            effectiveFloor,
            reasons,
            supMsg,
            supOverallPct,
            supGates,
            aiMsg,
            aiIdentityMsg,
            liquidationMsg,
            competitors: offersByDecision.get(d.id) ?? [],
        };
    });
    const rejectedItems = rejectedRows.map(({ d, name, sku, torobUrl }) => {
        const steps = Array.isArray(d.steps) ? d.steps : [];
        const panels = (0, listing_1.decisionPanels)(steps);
        const inquiry = steps.find((s) => s.step === "torob_inquiry")?.data;
        const supStep = steps.find((s) => s.step === "supervisor");
        const supMsg = supStep?.message ?? inquiry?.reason ?? "رد توسط ناظر SystemOne";
        const { overallPct: supOverallPct, gates: supGates } = extractSupervisorGates(supStep);
        return {
            id: d.id,
            productId: d.productId,
            name,
            sku,
            createdAt: (0, format_1.toIsoString)(d.createdAt),
            finalPrice: d.finalPrice,
            basePrice: d.basePrice,
            offersUsed: d.offersUsed,
            offersTotal: d.offersTotal,
            supMsg,
            supOverallPct,
            supGates,
            panels,
            inquiry: inquiry ?? null,
            torobUrl: inquiry?.candidate?.url ?? (panels[0] ? `https://torob.com/p/${panels[0].prk}/` : torobUrl),
        };
    });
    return (0, jsx_runtime_1.jsx)(review_client_1.ReviewClient, { pendingItems: pendingItems, rejectedItems: rejectedItems });
}
