"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TorobOfferDetails = TorobOfferDetails;
exports.TorobSearchDetails = TorobSearchDetails;
const jsx_runtime_1 = require("react/jsx-runtime");
const format_1 = require("../lib/format");
const coverageLabels = {
    complete_within_scope: { label: "تکمیل‌شده در محدودهٔ جست‌وجو", cls: "bg-emerald-50 text-emerald-800" },
    partial: { label: "پوشش جزئی", cls: "bg-amber-50 text-amber-900" },
    uncertain: { label: "پوشش نیازمند بررسی", cls: "bg-amber-50 text-amber-900" },
    unavailable: { label: "منبع در دسترس نیست", cls: "bg-rose-50 text-rose-800" },
};
const stoppingLabels = {
    scope_completed: "پایان محدودهٔ طراحی‌شده",
    confirmed_consolidated: "تأیید کارت متمرکز",
    time_budget: "اتمام بودجهٔ زمانی",
    request_budget: "اتمام سقف درخواست",
    plateau: "توقف به‌دلیل نبود نتیجهٔ جدید",
    response_truncated: "برش خروجی جست‌وجو",
    source_unavailable: "اختلال موقت منبع",
    access_restricted: "محدودیت دسترسی",
    direct_prk_lookup: "استعلام مستقیم PRK",
};
const transportLabels = {
    torob_mcp: "MCP ترب",
    torob_api: "API ترب",
    torob_page: "صفحهٔ محصول ترب",
};
const sourceLabels = {
    seller_listing: "عنوان فروشنده",
    seller_specs: "مشخصات فروشنده",
    product_details: "جزئیات کارت",
    search_card: "عنوان کارت در جست‌وجو",
};
const specLabels = {
    frequency: "فرکانس", buttons: "تعداد دکمه", bluetooth: "بلوتوث", access_model: "مدل",
    volt: "ولتاژ", cap: "ظرفیت", ch: "تعداد کانال", ports: "تعداد پورت", mp: "مگاپیکسل",
};
function specValue(key, value) {
    if (key === "bluetooth")
        return value === "yes" ? "دارد" : "ندارد";
    if (key === "frequency" && typeof value === "number") {
        if (value >= 1_000_000)
            return `${(0, format_1.faNum)(value / 1_000_000, 3)} مگاهرتز`;
        if (value >= 1_000)
            return `${(0, format_1.faNum)(value / 1_000, 3)} کیلوهرتز`;
        return `${(0, format_1.faNum)(value)} هرتز`;
    }
    return typeof value === "number" ? (0, format_1.faNum)(value) : value;
}
function Specs({ specs, expected }) {
    const fields = [...new Set([...Object.keys(specs ?? {}), ...Object.keys(expected ?? {})])];
    if (!fields.length)
        return null;
    return ((0, jsx_runtime_1.jsx)("ul", { className: "flex flex-wrap gap-x-3 gap-y-1", children: fields.map((key) => {
            const actual = specs?.[key] ?? [];
            const wanted = expected?.[key] ?? [];
            const tone = !wanted.length ? "" : !actual.length ? "text-amber-800" :
                actual.length === wanted.length && actual.every((value) => wanted.includes(value)) ? "text-emerald-800" : "text-rose-800";
            return (0, jsx_runtime_1.jsxs)("li", { className: tone, children: [(0, jsx_runtime_1.jsx)("strong", { children: specLabels[key] ?? key }), " \u00B7 ", actual.map((value) => specValue(key, value)).join(" / ") || "ذکر نشده", wanted.length > 0 && (0, jsx_runtime_1.jsxs)("span", { children: [" \u00B7 \u0645\u062D\u0635\u0648\u0644 \u0633\u0627\u06CC\u062A ", wanted.map((value) => specValue(key, value)).join(" / ")] })] }, key);
        }) }));
}
function ImageLinks({ urls }) {
    const images = urls?.filter((url) => typeof url === "string" && url.startsWith("https://"));
    if (!images?.length)
        return null;
    return (0, jsx_runtime_1.jsx)("div", { className: "flex flex-wrap gap-3", children: images.map((url, index) => (0, jsx_runtime_1.jsxs)("a", { href: url, target: "_blank", rel: "noreferrer", className: "text-indigo-700 underline", children: ["\u062A\u0635\u0648\u06CC\u0631 ", (0, format_1.faNum)(index + 1)] }, url)) });
}
function TorobOfferDetails({ evidence }) {
    const identity = evidence.identity;
    if (!identity)
        return null;
    const color = identity.status === "MATCH_CONFIRMED" ? "bg-emerald-50 text-emerald-800" :
        identity.status === "REVIEW_REQUIRED" ? "bg-amber-50 text-amber-900" : "bg-rose-50 text-rose-800";
    return ((0, jsx_runtime_1.jsxs)("details", { className: "mt-1 max-w-lg text-xs whitespace-normal text-slate-700", children: [(0, jsx_runtime_1.jsx)("summary", { className: "cursor-pointer", children: (0, jsx_runtime_1.jsx)("span", { className: `badge ${color}`, children: format_1.torobStatusLabel[identity.status] }) }), (0, jsx_runtime_1.jsxs)("div", { className: "mt-2 space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2 leading-5", children: [(0, jsx_runtime_1.jsx)("p", { children: identity.reason }), (0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap gap-x-2", children: [(0, jsx_runtime_1.jsx)("a", { className: "text-indigo-700 underline", href: `https://torob.com/p/${encodeURIComponent(identity.prk)}/`, target: "_blank", rel: "noreferrer", children: "\u06A9\u0627\u0631\u062A \u062A\u0631\u0628" }), identity.origin && (0, jsx_runtime_1.jsx)("span", { children: transportLabels[identity.origin] }), identity.sources.map((source) => (0, jsx_runtime_1.jsx)("span", { children: sourceLabels[source] }, source))] }), (0, jsx_runtime_1.jsx)(Specs, { specs: identity.specs, expected: identity.expectedSpecs }), Boolean(identity.brands?.length || identity.models?.length) && (0, jsx_runtime_1.jsx)("p", { dir: "auto", children: [...(identity.brands ?? []), ...(identity.models ?? [])].join(" · ") }), identity.packageUnits != null && (0, jsx_runtime_1.jsxs)("p", { children: ["\u062A\u0639\u062F\u0627\u062F \u062F\u0631 \u0628\u0633\u062A\u0647 \u00B7 ", (0, format_1.faNum)(identity.packageUnits)] }), identity.sharedImage && (0, jsx_runtime_1.jsx)("p", { children: "\u0646\u0634\u0627\u0646\u06CC \u062A\u0635\u0648\u06CC\u0631 \u0645\u0634\u062A\u0631\u06A9 \u062F\u0631 \u06A9\u0627\u0631\u062A \u0648 \u067E\u06CC\u0634\u0646\u0647\u0627\u062F \u0641\u0631\u0648\u0634\u0646\u062F\u0647 \u062B\u0628\u062A \u0634\u062F." }), (0, jsx_runtime_1.jsx)(ImageLinks, { urls: evidence.imageUrls })] })] }));
}
function TorobSearchDetails({ audit }) {
    if (!audit?.search && !audit?.candidate && !audit?.coverage)
        return null;
    const queries = audit.search?.queries ?? [];
    const cards = audit.search?.candidates?.length ? audit.search.candidates : audit.candidate ? [audit.candidate] : [];
    const counts = audit.offerIdentityCounts;
    const coverage = audit.coverage ?? audit.search?.coverage;
    const covStyle = coverage ? coverageLabels[coverage.status] : undefined;
    return ((0, jsx_runtime_1.jsxs)("details", { className: "space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-xs text-slate-700", children: [(0, jsx_runtime_1.jsx)("summary", { className: "cursor-pointer font-semibold", children: "\u0634\u0648\u0627\u0647\u062F \u062C\u0633\u062A\u200C\u0648\u062C\u0648 \u0648 \u062A\u0637\u0628\u06CC\u0642 \u062A\u0631\u0628" }), coverage && covStyle && ((0, jsx_runtime_1.jsxs)("div", { className: "space-y-1.5 rounded-lg border border-slate-200 bg-white p-2", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-center gap-2", children: [(0, jsx_runtime_1.jsx)("span", { className: `badge ${covStyle.cls}`, children: covStyle.label }), (0, jsx_runtime_1.jsxs)("span", { children: ["\u062D\u0627\u0644\u062A: ", coverage.mode === "extended" ? "توسعه‌یافته" : "تعاملی"] }), (0, jsx_runtime_1.jsxs)("span", { children: ["\u062A\u0648\u0642\u0641: ", stoppingLabels[coverage.stoppingReason]] })] }), (0, jsx_runtime_1.jsxs)("p", { className: "text-slate-600", children: [(0, format_1.faNum)(coverage.queriesExecuted), "/", (0, format_1.faNum)(coverage.queriesGenerated), " \u067E\u0631\u0633\u200C\u0648\u062C\u0648 \u00B7", " ", (0, format_1.faNum)(coverage.pagesRequested), " \u0635\u0641\u062D\u0647 \u0628\u0631\u0631\u0633\u06CC\u200C\u0634\u062F\u0647 (", (0, format_1.faNum)(coverage.pagesRemaining), " \u0635\u0641\u062D\u0647 \u0628\u0627\u0642\u06CC\u200C\u0645\u0627\u0646\u062F\u0647) \u00B7", " ", (0, format_1.faNum)(coverage.uniquePrksDiscovered), " PRK \u06CC\u06A9\u062A\u0627 (", (0, format_1.faNum)(coverage.candidatePrksInspected), " \u0628\u0631\u0631\u0633\u06CC\u200C\u0634\u062F\u0647\u060C", " ", (0, format_1.faNum)(coverage.promisingUninspectedCount), " \u0645\u0648\u0631\u062F\u0650 \u0645\u0633\u062A\u0639\u062F\u0650 \u0628\u0631\u0631\u0633\u06CC\u200C\u0646\u0634\u062F\u0647) \u00B7", " ", (0, format_1.faNum)(coverage.apiRequestsMade), " \u062F\u0631\u062E\u0648\u0627\u0633\u062A API (\u06A9\u0634 ", (0, format_1.faNum)(Math.round(coverage.cacheHitRate * 100)), "\u066A)"] }), coverage.limitations.length > 0 && ((0, jsx_runtime_1.jsx)("ul", { className: "list-inside list-disc text-amber-900", children: coverage.limitations.map((item, i) => (0, jsx_runtime_1.jsx)("li", { children: item }, i)) }))] })), counts && (0, jsx_runtime_1.jsxs)("p", { children: [(0, format_1.faNum)(counts.MATCH_CONFIRMED), " \u067E\u06CC\u0634\u0646\u0647\u0627\u062F \u0647\u0645\u200C\u0647\u0648\u06CC\u062A \u00B7 ", (0, format_1.faNum)(counts.REVIEW_REQUIRED), " \u0646\u06CC\u0627\u0632\u0645\u0646\u062F \u0628\u0631\u0631\u0633\u06CC \u00B7 ", (0, format_1.faNum)(counts.IDENTITY_MISMATCH), " \u0646\u0627\u0645\u0646\u0637\u0628\u0642"] }), queries.length > 0 && (0, jsx_runtime_1.jsx)("ol", { className: "space-y-1", children: queries.map((query, index) => (0, jsx_runtime_1.jsxs)("li", { children: [(0, format_1.faNum)(index + 1), ". ", query.query, " \u00B7 ", (0, format_1.faNum)(query.mapped), " \u06A9\u0627\u0631\u062A", query.origin && (0, jsx_runtime_1.jsxs)("span", { children: [" \u00B7 ", transportLabels[query.origin]] }), query.issue && (0, jsx_runtime_1.jsxs)("span", { className: "text-amber-800", children: [" \u00B7 ", query.issue] })] }, query.query)) }), (0, jsx_runtime_1.jsx)("div", { className: "space-y-1.5", children: cards.map((card) => {
                    const selected = audit.candidate?.prk === card.prk;
                    const inspection = card.inspection;
                    const observed = inspection ?? card;
                    const title = card.titleFa || card.titleEn || "عنوان کارت دریافت نشد";
                    return ((0, jsx_runtime_1.jsxs)("details", { className: "rounded-lg border border-slate-200 bg-white p-2", children: [(0, jsx_runtime_1.jsxs)("summary", { className: "cursor-pointer leading-5", children: [(0, jsx_runtime_1.jsx)("strong", { children: title }), " \u00B7 ", format_1.torobStatusLabel[observed.status], selected && " · کارت منتخب"] }), (0, jsx_runtime_1.jsxs)("div", { className: "mt-2 space-y-2 leading-5", children: [card.titleFa && card.titleEn && (0, jsx_runtime_1.jsx)("p", { dir: "auto", children: card.titleEn }), card.queries.length > 0 && (0, jsx_runtime_1.jsxs)("p", { children: ["\u0639\u0628\u0627\u0631\u062A\u200C\u0647\u0627\u06CC \u062C\u0633\u062A\u200C\u0648\u062C\u0648 \u00B7 ", [...new Set(card.queries)]
                                                .map((index) => queries[index - 1]?.query).filter(Boolean).join("، ")] }), card.observations?.some(({ titleFa, titleEn }) => titleFa !== card.titleFa || titleEn !== card.titleEn) &&
                                        (0, jsx_runtime_1.jsx)("ul", { children: card.observations.map(({ query, titleFa, titleEn }, i) => (0, jsx_runtime_1.jsxs)("li", { children: [(0, format_1.faNum)(query), " \u00B7 ", [titleFa, titleEn].filter(Boolean).join(" / ") || "عنوان دریافت نشد"] }, i)) }), inspection && (0, jsx_runtime_1.jsxs)("p", { children: ["\u0639\u0646\u0648\u0627\u0646 \u062F\u0631 \u062C\u0632\u0626\u06CC\u0627\u062A \u00B7 ", [inspection.titleFa, inspection.titleEn].filter(Boolean).join(" / ") || "دریافت نشد"] }), observed.origin && (0, jsx_runtime_1.jsx)("p", { children: transportLabels[observed.origin] }), !inspection && card.extraction === "not_requested" && (0, jsx_runtime_1.jsx)("p", { children: "\u062C\u0632\u0626\u06CC\u0627\u062A \u0627\u06CC\u0646 \u06A9\u0627\u0631\u062A \u062F\u0631 \u0645\u062D\u062F\u0648\u062F\u0647\u0654 \u0627\u0633\u062A\u0639\u0644\u0627\u0645 \u062F\u0631\u06CC\u0627\u0641\u062A \u0646\u0634\u062F." }), (0, jsx_runtime_1.jsx)(Specs, { specs: observed.specs }), (0, jsx_runtime_1.jsx)(ImageLinks, { urls: observed.imageUrls }), observed.reasons.length > 0 && (0, jsx_runtime_1.jsx)("ul", { className: "list-inside list-disc", children: observed.reasons.map((reason, i) => (0, jsx_runtime_1.jsx)("li", { children: reason }, i)) })] })] }, card.prk));
                }) })] }));
}
