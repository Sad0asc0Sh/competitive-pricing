"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.default = ReviewPage;
const jsx_runtime_1 = require("react/jsx-runtime");
const db_1 = require("@/db");
const schema_1 = require("../../db/schema");
const actions_1 = require("@/components/actions");
const format_1 = require("../../lib/format");
const drizzle_orm_1 = require("drizzle-orm");
const link_1 = __importDefault(require("next/link"));
exports.dynamic = "force-dynamic";
async function ReviewPage() {
    const [rows, rejectedRows] = await Promise.all([
        db_1.db
            .select({ d: schema_1.priceDecisions, name: schema_1.products.name, sku: schema_1.products.sku, cost: schema_1.products.costPrice, current: schema_1.products.currentFinalPrice })
            .from(schema_1.priceDecisions)
            .innerJoin(schema_1.products, (0, drizzle_orm_1.eq)(schema_1.products.id, schema_1.priceDecisions.productId))
            .where((0, drizzle_orm_1.eq)(schema_1.priceDecisions.status, "pending_review"))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.priceDecisions.createdAt)),
        db_1.db
            .select({ d: schema_1.priceDecisions, name: schema_1.products.name, sku: schema_1.products.sku })
            .from(schema_1.priceDecisions)
            .innerJoin(schema_1.products, (0, drizzle_orm_1.eq)(schema_1.products.id, schema_1.priceDecisions.productId))
            .where((0, drizzle_orm_1.eq)(schema_1.priceDecisions.status, "rejected"))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.priceDecisions.createdAt))
            .limit(20),
    ]);
    return ((0, jsx_runtime_1.jsxs)("div", { className: "space-y-6", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("h1", { className: "text-2xl font-bold", children: "\u0635\u0641 \u0628\u0627\u0632\u0628\u06CC\u0646\u06CC \u0627\u0646\u0633\u0627\u0646\u06CC" }), (0, jsx_runtime_1.jsx)("p", { className: "mt-1 text-sm text-slate-500", children: "\u062A\u0635\u0645\u06CC\u0645\u200C\u0647\u0627\u06CC\u06CC \u06A9\u0647 \u0645\u0648\u062A\u0648\u0631 \u0628\u0647 \u062F\u0644\u06CC\u0644 \u0627\u0639\u062A\u0645\u0627\u062F \u067E\u0627\u06CC\u06CC\u0646\u060C \u06A9\u0645\u0628\u0648\u062F \u062F\u0627\u062F\u0647\u060C \u062C\u0647\u0634 \u0642\u06CC\u0645\u062A \u06CC\u0627 \u0628\u0631\u062E\u0648\u0631\u062F \u0628\u0627 \u06A9\u0641 \u0633\u0648\u062F\u060C \u0628\u0631\u0627\u06CC \u062A\u0623\u06CC\u06CC\u062F \u0646\u06AF\u0647 \u062F\u0627\u0634\u062A\u0647 \u0627\u0633\u062A." })] }), rows.map(({ d, name, sku, cost, current }) => {
                const steps = Array.isArray(d.steps) ? d.steps : [];
                const reasons = steps.find((s) => s.step === "decision")?.message ?? "";
                const supMsg = steps.find((s) => s.step === "supervisor")?.message;
                const aiMsg = steps.find((s) => s.step === "ai_review")?.message;
                // ۴.۱.۲ (N5): رتبه‌ی رسمی فقط روی فروشنده‌های قابل‌اتکاست؛ رتبه‌ی «با احتساب
                // فروشنده‌های مشکوک/کهنه» کنارش نمایش داده می‌شود تا ریویوور بداند آیا ارزان‌فروش
                // تازه‌ای زیر قیمت ما هست یا نه. برای تصمیم‌های قدیمی از steps می‌خوانیم.
                const positionStep = steps.find((s) => s.step === "position");
                const rankIncludingSuspect = d.rankIncludingSuspect ?? (Number(positionStep?.data?.rankIncludingSuspect) || null);
                const totalIncludingSuspect = d.totalSellersIncludingSuspect || Number(positionStep?.data?.totalSellersIncludingSuspect) || 0;
                return ((0, jsx_runtime_1.jsxs)("div", { className: "card", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-start justify-between gap-3", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)(link_1.default, { href: `/products/${d.productId}`, className: "text-lg font-bold text-indigo-700 hover:underline", children: name }), (0, jsx_runtime_1.jsxs)("div", { className: "text-xs text-slate-400", children: [sku, " \u00B7 \u062A\u0635\u0645\u06CC\u0645 #", d.id, " \u00B7 ", (0, format_1.faDate)(d.createdAt)] })] }), (0, jsx_runtime_1.jsx)(actions_1.DecisionActions, { decisionId: d.id })] }), (0, jsx_runtime_1.jsxs)("div", { className: "mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-7", children: [(0, jsx_runtime_1.jsx)(Item, { k: "\u062A\u0645\u0627\u0645\u200C\u0634\u062F\u0647", v: (0, format_1.toman)(cost) }), (0, jsx_runtime_1.jsx)(Item, { k: "\u0642\u06CC\u0645\u062A \u0641\u0639\u0644\u06CC", v: (0, format_1.toman)(current) }), (0, jsx_runtime_1.jsx)(Item, { k: "\u0645\u0631\u062C\u0639 \u0628\u0627\u0632\u0627\u0631", v: (0, format_1.toman)(d.referencePrice) }), (0, jsx_runtime_1.jsx)(Item, { k: "\u067E\u06CC\u0634\u0646\u0647\u0627\u062F: \u0627\u0635\u0644\u06CC", v: (0, format_1.toman)(d.basePrice) }), (0, jsx_runtime_1.jsx)(Item, { k: "\u067E\u06CC\u0634\u0646\u0647\u0627\u062F: \u0646\u0647\u0627\u06CC\u06CC", v: (0, format_1.toman)(d.finalPrice), strong: true }), (0, jsx_runtime_1.jsx)(Item, { k: "\u062A\u062E\u0641\u06CC\u0641 / \u06A9\u0645\u067E\u06CC\u0646", v: `${(0, format_1.pct)(d.discountPct)} · ${format_1.campaignLabel[d.campaignType ?? "none"]}` }), (0, jsx_runtime_1.jsx)(Item, { k: "\u0631\u062A\u0628\u0647 \u0645\u0644\u06CC / \u0628\u0627 \u0645\u0634\u06A9\u0648\u06A9", v: `${d.projectedNationalRank ?? "—"} / ${rankIncludingSuspect ?? "—"} از ${totalIncludingSuspect || "—"}` })] }), d.marketConflict && ((0, jsx_runtime_1.jsx)("p", { className: "mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800", children: "\u26A0\uFE0F \u062A\u0639\u0627\u0631\u0636 \u0628\u0627\u0632\u0627\u0631: \u0641\u0631\u0648\u0634\u0646\u062F\u0647\u200C\u06CC \u00AB\u0645\u0634\u06A9\u0648\u06A9 \u067E\u0627\u06CC\u06CC\u0646\u00BB \u0632\u06CC\u0631 \u0642\u06CC\u0645\u062A \u067E\u06CC\u0634\u0646\u0647\u0627\u062F\u06CC \u0645\u0627 \u0647\u0633\u062A \u2014 \u067E\u06CC\u0634 \u0627\u0632 \u062A\u0623\u06CC\u06CC\u062F\u060C \u0631\u062A\u0628\u0647\u200C\u06CC \u0633\u062A\u0648\u0646 \u00AB\u0628\u0627 \u0645\u0634\u06A9\u0648\u06A9\u00BB \u0631\u0627 \u0628\u0627 \u0631\u062A\u0628\u0647\u200C\u06CC \u0631\u0633\u0645\u06CC \u0645\u0642\u0627\u06CC\u0633\u0647 \u06A9\u0646\u06CC\u062F." })), (0, jsx_runtime_1.jsx)("p", { className: "mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800", children: reasons }), supMsg && (0, jsx_runtime_1.jsxs)("p", { className: "mt-2 rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-900", children: ["\uD83D\uDEE1\uFE0F \u0646\u0627\u0638\u0631: ", supMsg] }), aiMsg && (0, jsx_runtime_1.jsxs)("p", { className: "mt-2 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-700", children: ["\uD83E\uDD16 \u0647\u0648\u0634 \u0645\u0635\u0646\u0648\u0639\u06CC: ", aiMsg] })] }, d.id));
            }), !rows.length && (0, jsx_runtime_1.jsx)("div", { className: "card text-center text-slate-400", children: "\u0635\u0641 \u0628\u0627\u0632\u0628\u06CC\u0646\u06CC \u062E\u0627\u0644\u06CC \u0627\u0633\u062A \u2705" }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("h2", { className: "text-lg font-bold", children: "\u0631\u062F\u0634\u062F\u0647\u200C\u0647\u0627\u06CC \u0627\u062E\u06CC\u0631 \u0646\u0627\u0638\u0631 (\u0648\u0627\u0631\u062F \u0641\u0631\u0648\u0634\u06AF\u0627\u0647 \u0646\u0645\u06CC\u200C\u0634\u0648\u0646\u062F)" }), (0, jsx_runtime_1.jsx)("p", { className: "mt-1 text-xs text-slate-500", children: "\u062A\u0635\u0645\u06CC\u0645\u200C\u0647\u0627\u06CC \u0632\u06CC\u0631 \u0627\u0645\u062A\u06CC\u0627\u0632 \u0622\u0633\u062A\u0627\u0646\u0647 \u0631\u062F \u06AF\u0631\u0641\u062A\u0647\u200C\u0627\u0646\u062F \u0648 \u0628\u0647\u200C\u0635\u0648\u0631\u062A \u062E\u0648\u062F\u06A9\u0627\u0631 \u0645\u062A\u0648\u0642\u0641 \u0634\u062F\u0647\u200C\u0627\u0646\u062F\u061B \u062F\u06A9\u0645\u0647 \u00AB\u062A\u0623\u06CC\u06CC\u062F \u0648 \u0627\u0639\u0645\u0627\u0644\u00BB \u0628\u0631\u0627\u06CC \u0622\u0646\u200C\u0647\u0627 \u0642\u0641\u0644 \u0627\u0633\u062A." })] }), rejectedRows.map(({ d, name, sku }) => {
                const steps = Array.isArray(d.steps) ? d.steps : [];
                const supMsg = steps.find((s) => s.step === "supervisor")?.message ?? "رد توسط ناظر SystemOne";
                return ((0, jsx_runtime_1.jsxs)("div", { className: "card border-rose-200", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-center justify-between gap-2", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)(link_1.default, { href: `/products/${d.productId}`, className: "font-bold text-rose-700 hover:underline", children: name }), (0, jsx_runtime_1.jsxs)("div", { className: "text-xs text-slate-400", children: [sku, " \u00B7 \u062A\u0635\u0645\u06CC\u0645 #", d.id, " \u00B7 ", (0, format_1.faDate)(d.createdAt)] })] }), (0, jsx_runtime_1.jsx)("span", { className: "badge bg-rose-100 text-rose-700", children: "\u26D4 \u0631\u062F\u0634\u062F\u0647 \u2014 \u063A\u06CC\u0631\u0642\u0627\u0628\u0644 \u0627\u0639\u0645\u0627\u0644" })] }), (0, jsx_runtime_1.jsx)("p", { className: "mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800", children: supMsg })] }, d.id));
            }), !rejectedRows.length && (0, jsx_runtime_1.jsx)("div", { className: "card text-center text-xs text-slate-400", children: "\u0645\u0648\u0631\u062F \u0631\u062F\u0634\u062F\u0647\u200C\u0627\u06CC \u062B\u0628\u062A \u0646\u0634\u062F\u0647" })] }));
}
function Item({ k, v, strong }) {
    return ((0, jsx_runtime_1.jsxs)("div", { className: "rounded-lg bg-slate-50 px-3 py-2", children: [(0, jsx_runtime_1.jsx)("div", { className: "text-xs text-slate-500", children: k }), (0, jsx_runtime_1.jsx)("div", { className: `num ${strong ? "font-bold text-emerald-700" : "font-medium"}`, children: v })] }));
}
