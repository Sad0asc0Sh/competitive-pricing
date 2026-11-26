"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.default = DashboardPage;
const jsx_runtime_1 = require("react/jsx-runtime");
const index_ts_1 = require("../db/index.ts");
const schema_1 = require("../db/schema");
const actions_1 = require("@/components/actions");
const dashboard_client_1 = require("@/components/dashboard-client");
const format_1 = require("../lib/format");
const bootstrap_1 = require("../lib/services/bootstrap");
const config_1 = require("../lib/ai/config");
const connectors_1 = require("../lib/store/connectors");
const config_2 = require("../lib/torob-relay/config");
const drizzle_orm_1 = require("drizzle-orm");
const link_1 = __importDefault(require("next/link"));
exports.dynamic = "force-dynamic";
async function DashboardPage() {
    await (0, bootstrap_1.ensureDefaults)();
    const [[{ total }], [{ needsReview }], [{ pending }], recentDecisions, recentRuns, logs, sch, campaignStats] = await Promise.all([
        index_ts_1.db.select({ total: (0, drizzle_orm_1.count)() }).from(schema_1.products),
        index_ts_1.db.select({ needsReview: (0, drizzle_orm_1.count)() }).from(schema_1.products).where((0, drizzle_orm_1.eq)(schema_1.products.status, "needs_review")),
        index_ts_1.db.select({ pending: (0, drizzle_orm_1.count)() }).from(schema_1.priceDecisions).where((0, drizzle_orm_1.eq)(schema_1.priceDecisions.status, "pending_review")),
        index_ts_1.db
            .select({ d: schema_1.priceDecisions, name: schema_1.products.name, sku: schema_1.products.sku })
            .from(schema_1.priceDecisions)
            .innerJoin(schema_1.products, (0, drizzle_orm_1.eq)(schema_1.products.id, schema_1.priceDecisions.productId))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.priceDecisions.createdAt))
            .limit(10),
        index_ts_1.db.select().from(schema_1.priceRuns).orderBy((0, drizzle_orm_1.desc)(schema_1.priceRuns.startedAt)).limit(5),
        index_ts_1.db.select().from(schema_1.activityLogs).orderBy((0, drizzle_orm_1.desc)(schema_1.activityLogs.createdAt)).limit(8),
        index_ts_1.db.select().from(schema_1.schedules).where((0, drizzle_orm_1.eq)(schema_1.schedules.active, true)),
        index_ts_1.db
            .select({ campaign: schema_1.products.currentCampaign, c: (0, drizzle_orm_1.count)(), avg: (0, drizzle_orm_1.sql) `avg(${schema_1.products.currentDiscountPct})` })
            .from(schema_1.products)
            .groupBy(schema_1.products.currentCampaign),
    ]);
    const nextRun = sch.map((s) => s.nextRunAt).filter(Boolean).sort((a, b) => a.getTime() - b.getTime())[0];
    const [aiStatus, torobRelayStatus] = await Promise.all([(0, config_1.getAIStatus)(), (0, config_2.getTorobRelayStatus)()]);
    let storeStatus = null;
    try {
        storeStatus = await (0, connectors_1.getStoreStatus)();
    }
    catch {
        storeStatus = null;
    }
    const serializedDecisions = recentDecisions.map(({ d, name, sku }) => ({
        id: d.id,
        productId: d.productId,
        name,
        sku,
        status: d.status,
        finalPrice: d.finalPrice,
        basePrice: d.basePrice,
        discountPct: d.discountPct,
        campaignType: d.campaignType,
        campaignName: d.campaignName,
        showInFeatured: d.showInFeatured,
        localLowestValid: d.localLowestValid,
        lowestValid: d.lowestValid,
        hardFloorPrice: d.hardFloorPrice,
        effectiveCostPrice: d.effectiveCostPrice,
        projectedLocalRank: d.projectedLocalRank,
        projectedNationalRank: d.projectedNationalRank,
        netProfitToman: d.netProfitToman,
        netMarginPct: d.netMarginPct,
        createdAt: d.createdAt.toISOString(),
    }));
    const storeConnected = Boolean(storeStatus?.activeType || storeStatus?.envFallback);
    return ((0, jsx_runtime_1.jsxs)("div", { className: "space-y-5 sm:space-y-6", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between", children: [(0, jsx_runtime_1.jsxs)("div", { className: "min-w-0 space-y-2.5", children: [(0, jsx_runtime_1.jsx)("h1", { className: "text-lg font-extrabold leading-snug text-slate-900 sm:text-xl lg:text-2xl", children: "\u0645\u0631\u06A9\u0632 \u0641\u0631\u0645\u0627\u0646\u062F\u0647\u06CC \u0642\u06CC\u0645\u062A\u200C\u06AF\u0630\u0627\u0631\u06CC\u060C \u06A9\u0634\u0641 \u06A9\u0641 \u0648 \u0633\u0642\u0641 \u0628\u0627\u0632\u0627\u0631 \u0648 \u06F3 \u0633\u06CC\u0633\u062A\u0645 \u062A\u062E\u0641\u06CC\u0641" }), (0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-center gap-2 text-xs", children: [(0, jsx_runtime_1.jsxs)(link_1.default, { href: "/settings", className: "inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-600 transition hover:border-slate-300", children: [(0, jsx_runtime_1.jsx)("span", { className: "h-2 w-2 rounded-full bg-indigo-500" }), (0, jsx_runtime_1.jsx)("span", { children: "\u0627\u0633\u062A\u0639\u0644\u0627\u0645 \u0628\u0639\u062F\u06CC:" }), (0, jsx_runtime_1.jsx)("b", { className: "text-slate-900", children: (0, format_1.faDate)(nextRun) })] }), (0, jsx_runtime_1.jsxs)(link_1.default, { href: "/settings", className: `inline-flex items-center gap-1.5 rounded-full border px-3 py-1 transition ${aiStatus.ai.configured
                                            ? "border-emerald-200 bg-emerald-50/70 text-emerald-800"
                                            : "border-amber-200 bg-amber-50 text-amber-800"}`, children: [(0, jsx_runtime_1.jsx)("span", { className: `h-2 w-2 rounded-full ${aiStatus.ai.configured ? "bg-emerald-500" : "bg-amber-500"}` }), (0, jsx_runtime_1.jsxs)("span", { children: ["\u0647\u0648\u0634 \u0645\u0635\u0646\u0648\u0639\u06CC:", " ", aiStatus.ai.configured
                                                        ? `${aiStatus.ai.model} (${aiStatus.ai.source === "db" ? "پنل" : ".env"})`
                                                        : "غیرفعال"] })] }), (0, jsx_runtime_1.jsxs)(link_1.default, { href: "/settings", className: `inline-flex items-center gap-1.5 rounded-full border px-3 py-1 transition ${aiStatus.subq.configured
                                            ? "border-emerald-200 bg-emerald-50/70 text-emerald-800"
                                            : "border-slate-200 bg-white text-slate-600"}`, children: [(0, jsx_runtime_1.jsx)("span", { className: `h-2 w-2 rounded-full ${aiStatus.subq.configured ? "bg-emerald-500" : "bg-slate-400"}` }), (0, jsx_runtime_1.jsxs)("span", { children: ["\u0646\u0627\u0638\u0631 SubQ:", " ", aiStatus.subq.configured
                                                        ? `${aiStatus.subq.model} (${aiStatus.subq.source === "db" ? "پنل" : ".env"})`
                                                        : "موتور آنی محلی"] })] }), (0, jsx_runtime_1.jsxs)(link_1.default, { href: "/settings?tab=torob", className: `inline-flex items-center gap-1.5 rounded-full border px-3 py-1 transition ${torobRelayStatus.configured && torobRelayStatus.enabled
                                            ? "border-emerald-200 bg-emerald-50/70 text-emerald-800"
                                            : "border-slate-200 bg-white text-slate-600"}`, children: [(0, jsx_runtime_1.jsx)("span", { className: `h-2 w-2 rounded-full ${torobRelayStatus.configured && torobRelayStatus.enabled ? "bg-emerald-500" : "bg-slate-400"}` }), (0, jsx_runtime_1.jsxs)("span", { children: ["\u0631\u0644\u0647 \u062A\u0631\u0628:", " ", torobRelayStatus.configured && torobRelayStatus.enabled
                                                        ? torobRelayStatus.mode === "encrypted_relay"
                                                            ? "رمزنگاری‌شده (ایران)"
                                                            : "رله HTTPS"
                                                        : "اتصال مستقیم"] })] }), (0, jsx_runtime_1.jsxs)(link_1.default, { href: "/settings", className: `inline-flex items-center gap-1.5 rounded-full border px-3 py-1 transition ${storeConnected
                                            ? "border-emerald-200 bg-emerald-50/70 text-emerald-800"
                                            : "border-rose-200 bg-rose-50 text-rose-800"}`, children: [(0, jsx_runtime_1.jsx)("span", { className: `h-2 w-2 rounded-full ${storeConnected ? "bg-emerald-500" : "bg-rose-500"}` }), (0, jsx_runtime_1.jsxs)("span", { children: ["\u0641\u0631\u0648\u0634\u06AF\u0627\u0647:", " ", storeStatus?.activeType
                                                        ? `متصل (${storeStatus.activeType})`
                                                        : storeStatus?.envFallback
                                                            ? "متصل (env sgeooole)"
                                                            : "قطع"] })] })] })] }), (0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-center gap-2 shrink-0", children: [(0, jsx_runtime_1.jsx)(link_1.default, { href: "/campaigns", className: "btn-secondary flex-1 sm:flex-initial", children: "\uD83C\uDF9B\uFE0F \u0627\u0633\u062A\u0648\u062F\u06CC\u0648 \u062A\u062E\u0641\u06CC\u0641" }), (0, jsx_runtime_1.jsx)(link_1.default, { href: "/simulate", className: "btn-secondary flex-1 sm:flex-initial", children: "\uD83E\uDDEA \u0622\u0632\u0645\u0627\u06CC\u0634\u06AF\u0627\u0647 \u0634\u0628\u06CC\u0647\u200C\u0633\u0627\u0632" }), (0, jsx_runtime_1.jsx)("div", { className: "w-full sm:w-auto", children: (0, jsx_runtime_1.jsx)(actions_1.RunButton, { label: "\u0627\u0633\u062A\u0639\u0644\u0627\u0645 \u06A9\u0627\u0631\u062A\u200C\u0647\u0627\u06CC \u0641\u0639\u0627\u0644", className: "btn-primary w-full sm:w-auto" }) })] })] }), (0, jsx_runtime_1.jsx)(actions_1.CardRangeRunner, { totalCards: total, defaultCollapsedOnMobile: true }), (0, jsx_runtime_1.jsxs)("div", { className: "grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4", children: [(0, jsx_runtime_1.jsx)(Stat, { title: "\u06A9\u0644 \u06A9\u0627\u0631\u062A\u200C\u0647\u0627\u06CC \u0645\u062D\u0635\u0648\u0644", value: (0, format_1.faNum)(total), href: "/products", accent: "indigo" }), (0, jsx_runtime_1.jsx)(Stat, { title: "\u062F\u0631 \u0627\u0646\u062A\u0638\u0627\u0631 \u0628\u0627\u0632\u0628\u06CC\u0646\u06CC", value: (0, format_1.faNum)(pending), href: "/review", tone: pending > 0 ? "amber" : "default" }), (0, jsx_runtime_1.jsx)(Stat, { title: "\u0646\u06CC\u0627\u0632\u0645\u0646\u062F \u062A\u0648\u062C\u0647", value: (0, format_1.faNum)(needsReview), href: "/review", tone: needsReview > 0 ? "amber" : "default" }), (0, jsx_runtime_1.jsx)(Stat, { title: "\u0632\u0645\u0627\u0646\u200C\u0628\u0646\u062F\u06CC\u200C\u0647\u0627\u06CC \u0641\u0639\u0627\u0644", value: (0, format_1.faNum)(sch.length), href: "/settings", accent: "emerald" })] }), (0, jsx_runtime_1.jsx)("div", { className: "grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4", children: ["flash", "featured", "timed_sale", "none"].map((t) => {
                    const s = campaignStats.find((c) => (c.campaign ?? "none") === t);
                    return ((0, jsx_runtime_1.jsxs)(link_1.default, { href: "/campaigns", className: "card block transition hover:shadow-md active:scale-[0.99]", children: [(0, jsx_runtime_1.jsx)("div", { className: "flex items-center justify-between", children: (0, jsx_runtime_1.jsx)("span", { className: `badge border text-[11px] sm:text-xs ${format_1.campaignColor[t] ?? "bg-slate-100"}`, children: format_1.campaignLabel[t] }) }), (0, jsx_runtime_1.jsxs)("div", { className: "num mt-3 text-xl font-bold text-slate-900 sm:text-2xl", children: [(0, format_1.faNum)(s?.c ?? 0), " \u06A9\u0627\u0631\u062A"] }), (0, jsx_runtime_1.jsxs)("div", { className: "mt-1 text-[11px] text-slate-500 sm:text-xs", children: ["\u0645\u06CC\u0627\u0646\u06AF\u06CC\u0646 \u062A\u062E\u0641\u06CC\u0641 \u0633\u0642\u0641 \u0628\u0647 \u06A9\u0641: ", (0, jsx_runtime_1.jsx)("b", { className: "num", children: (0, format_1.pct)(s?.avg ? Number(s.avg) : null, 0) })] })] }, t));
                }) }), (0, jsx_runtime_1.jsx)(dashboard_client_1.DashboardDecisionsSection, { decisions: serializedDecisions }), (0, jsx_runtime_1.jsxs)("div", { className: "grid gap-4 lg:grid-cols-2", children: [(0, jsx_runtime_1.jsxs)("div", { className: "card", children: [(0, jsx_runtime_1.jsxs)("div", { className: "mb-3 flex items-center justify-between", children: [(0, jsx_runtime_1.jsx)("h2", { className: "font-bold text-slate-900", children: "\u0627\u062C\u0631\u0627\u0647\u0627\u06CC \u0627\u062E\u06CC\u0631" }), (0, jsx_runtime_1.jsx)(link_1.default, { href: "/runs", className: "text-xs font-medium text-indigo-600 hover:underline", children: "\u0645\u0634\u0627\u0647\u062F\u0647 \u0647\u0645\u0647" })] }), (0, jsx_runtime_1.jsxs)("ul", { className: "space-y-2 text-sm", children: [recentRuns.map((r) => ((0, jsx_runtime_1.jsx)("li", { children: (0, jsx_runtime_1.jsxs)(link_1.default, { href: `/runs?run=${r.id}`, className: "flex flex-col gap-1.5 rounded-xl bg-slate-50 px-3 py-2.5 transition hover:bg-indigo-50/60 sm:flex-row sm:items-center sm:justify-between", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-center gap-2", children: [(0, jsx_runtime_1.jsxs)("span", { className: "num font-semibold text-slate-800", children: ["#", r.id] }), (0, jsx_runtime_1.jsxs)("span", { className: "text-xs text-slate-600", children: [r.trigger === "schedule" ? "زمان‌بندی" : r.trigger === "manual" ? "دستی" : "API", " \u00B7 ", (0, format_1.faDate)(r.startedAt)] }), (0, jsx_runtime_1.jsx)("span", { className: `badge text-[11px] ${format_1.statusColor[r.status] ?? "bg-slate-100"}`, children: format_1.statusLabel[r.status] ?? r.status })] }), (0, jsx_runtime_1.jsxs)("span", { className: "num text-xs text-slate-500", children: [(0, format_1.faNum)(r.applied), " \u0627\u0639\u0645\u0627\u0644 / ", (0, format_1.faNum)(r.pendingReview), " \u0628\u0627\u0632\u0628\u06CC\u0646\u06CC / ", (0, format_1.faNum)(r.failed), " \u062E\u0637\u0627"] })] }) }, r.id))), !recentRuns.length && (0, jsx_runtime_1.jsx)("li", { className: "py-4 text-center text-xs text-slate-400", children: "\u0627\u062C\u0631\u0627\u06CC\u06CC \u062B\u0628\u062A \u0646\u0634\u062F\u0647" })] })] }), (0, jsx_runtime_1.jsxs)("div", { className: "card", children: [(0, jsx_runtime_1.jsx)("h2", { className: "mb-3 font-bold text-slate-900", children: "\u0644\u0627\u06AF \u0641\u0639\u0627\u0644\u06CC\u062A" }), (0, jsx_runtime_1.jsxs)("ul", { className: "space-y-2.5 text-xs", children: [logs.map((l) => ((0, jsx_runtime_1.jsxs)("li", { className: "rounded-xl bg-slate-50/80 px-3 py-2", children: [(0, jsx_runtime_1.jsxs)("div", { className: "mb-1 flex items-center justify-between gap-2", children: [(0, jsx_runtime_1.jsx)("span", { className: `badge ${l.level === "error"
                                                            ? "bg-rose-100 text-rose-700"
                                                            : l.level === "warn"
                                                                ? "bg-amber-100 text-amber-700"
                                                                : "bg-slate-200/70 text-slate-700"}`, children: l.scope }), (0, jsx_runtime_1.jsx)("span", { className: "whitespace-nowrap text-[11px] text-slate-400", children: (0, format_1.faDate)(l.createdAt) })] }), (0, jsx_runtime_1.jsx)("p", { className: "break-words leading-5 text-slate-700", children: l.message })] }, l.id))), !logs.length && (0, jsx_runtime_1.jsx)("li", { className: "py-4 text-center text-xs text-slate-400", children: "\u0644\u0627\u06AF\u06CC \u062B\u0628\u062A \u0646\u0634\u062F\u0647" })] })] })] })] }));
}
function Stat({ title, value, href, tone = "default", accent, }) {
    const toneClass = tone === "amber"
        ? "border-amber-300 bg-amber-50/80"
        : accent === "indigo"
            ? "border-r-4 border-r-indigo-500"
            : accent === "emerald"
                ? "border-r-4 border-r-emerald-500"
                : "";
    return ((0, jsx_runtime_1.jsxs)(link_1.default, { href: href, className: `card block transition hover:shadow-md active:scale-[0.98] ${toneClass}`, children: [(0, jsx_runtime_1.jsx)("div", { className: "text-xs font-medium text-slate-500", children: title }), (0, jsx_runtime_1.jsx)("div", { className: "num mt-2 text-2xl font-extrabold text-slate-900 sm:text-3xl", children: value })] }));
}
