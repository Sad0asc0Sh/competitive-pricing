"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TorobPanelComparison = TorobPanelComparison;
exports.TorobOfferDetails = TorobOfferDetails;
exports.TorobSearchDetails = TorobSearchDetails;
const jsx_runtime_1 = require("react/jsx-runtime");
const format_1 = require("../lib/format");
const adminStateMeta = {
    never_discovered: { label: "کشف‌نشده", cls: "bg-slate-100 text-slate-700" },
    discovered_not_inspected: { label: "کشف‌شده (بدون بررسی جزئیات)", cls: "bg-sky-50 text-sky-900" },
    inspected_insufficient_evidence: { label: "بررسی‌شده — شواهد ناکافی", cls: "bg-amber-50 text-amber-900" },
    confirmed_compatible: { label: "هم‌هویت تأییدشده", cls: "bg-emerald-50 text-emerald-800" },
    confirmed_incompatible: { label: "ناسازگار تأییدشده", cls: "bg-rose-50 text-rose-800" },
};
const classificationLabels = {
    CONFIRMED_COMPATIBLE: "سازگار قطعی",
    POTENTIAL_MATCH: "نامزد بالقوه",
    CONFIRMED_INCOMPATIBLE: "ناسازگار قطعی",
    NOT_YET_INSPECTED: "در انتظار بررسی",
};
const retrievalOriginLabels = {
    search: "جست‌وجو",
    similar_products: "کالاهای مشابه",
    known_prk: "گراف شناخته‌شده",
    hybrid_index: "نمایه ترکیبی",
    direct_prk: "PRK مستقیم",
};
const groupRoleMeta = {
    primary: { label: "پنل مرجع اصلی", cls: "bg-emerald-100 text-emerald-900", groupTitle: "پنل‌های منتخب بازار" },
    compatible_secondary: { label: "پنل سازگار تکمیلی", cls: "bg-cyan-100 text-cyan-900", groupTitle: "پنل‌های منتخب بازار" },
    self_only: { label: "فقط فروشگاه خودمان", cls: "bg-amber-100 text-amber-900", groupTitle: "فقط فروشگاه خودمان (فاقد رقیب مستقل)" },
    review_required: { label: "نیازمند بازبینی", cls: "bg-amber-50 text-amber-900 border border-amber-200", groupTitle: "نامزدهای نیازمند بررسی" },
    rejected: { label: "ردشده / ناسازگار", cls: "bg-rose-100 text-rose-800", groupTitle: "کارت‌های ردشده" },
};
const evidenceSourceLabels = {
    product_details: "جزئیات کارت ترب",
    search_card: "عنوان جست‌وجو",
    seller_listing: "عنوان فروشنده",
    card_title: "عنوان کارت",
    card_specs: "جدول مشخصات",
    seller_corroboration: "تأیید متقاطع فروشندگان",
    admin_confirmation: "تأیید مدیر",
};
function TorobPanelComparison({ panels }) {
    if (!panels?.length)
        return null;
    const groups = [
        {
            key: "selected",
            title: "پنل‌های منتخب بازار (مرجع قیمت‌گذاری)",
            items: panels.filter((p) => p.groupRole === "primary" || p.groupRole === "compatible_secondary"),
        },
        {
            key: "self",
            title: "کارت‌های فقط فروشگاه خودمان (حذف از کف رقبا)",
            items: panels.filter((p) => p.groupRole === "self_only"),
        },
        {
            key: "review",
            title: "نامزدهای نیازمند بازبینی",
            items: panels.filter((p) => !p.groupRole || p.groupRole === "review_required"),
        },
        {
            key: "rejected",
            title: "کارت‌های ردشده (واریانت/محصول متفاوت)",
            items: panels.filter((p) => p.groupRole === "rejected"),
        },
    ].filter((g) => g.items.length > 0);
    return ((0, jsx_runtime_1.jsxs)("div", { className: "space-y-2.5 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-center justify-between gap-2", children: [(0, jsx_runtime_1.jsxs)("span", { className: "font-bold text-slate-900", children: ["\u0645\u0642\u0627\u06CC\u0633\u0647 \u0648 \u062A\u0634\u062E\u06CC\u0635 \u067E\u0646\u0644\u200C\u0647\u0627\u06CC \u062A\u0631\u0628 (", (0, format_1.faNum)(panels.length), " \u06A9\u0627\u0631\u062A)"] }), (0, jsx_runtime_1.jsx)("span", { className: "text-[11px] text-slate-500", children: "\u062A\u0641\u06A9\u06CC\u06A9 \u0641\u0631\u0648\u0634\u06AF\u0627\u0647 \u062E\u0648\u062F\u0645\u0627\u0646\u060C \u0631\u0642\u0628\u0627\u06CC \u0645\u0633\u062A\u0642\u0644 \u062A\u0623\u06CC\u06CC\u062F\u0634\u062F\u0647 \u0648 \u0648\u0627\u0631\u06CC\u0627\u0646\u062A\u200C\u0647\u0627\u06CC \u0646\u06CC\u0627\u0632\u0645\u0646\u062F \u0628\u0627\u0632\u0628\u06CC\u0646\u06CC" })] }), groups.map((group) => ((0, jsx_runtime_1.jsxs)("div", { className: "space-y-1.5", children: [(0, jsx_runtime_1.jsx)("div", { className: "text-[11px] font-semibold text-slate-600", children: group.title }), (0, jsx_runtime_1.jsx)("div", { className: "space-y-1.5", children: group.items.map((p) => {
                            const role = groupRoleMeta[p.groupRole ?? "review_required"];
                            const cov = coverageLabels[p.coverageStatus];
                            const pctScore = p.score != null ? Math.round(p.score) : Math.round(p.matchConfidence * 100);
                            return ((0, jsx_runtime_1.jsxs)("div", { className: "rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 space-y-1.5", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-center justify-between gap-2", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-center gap-1.5 min-w-0", children: [(0, jsx_runtime_1.jsx)("span", { className: `badge ${role.cls}`, children: role.label }), (0, jsx_runtime_1.jsxs)("span", { className: "badge bg-slate-100 text-slate-700", children: [format_1.torobStatusLabel[p.identityStatus], " (", (0, format_1.faNum)(pctScore), "\u066A)"] }), (0, jsx_runtime_1.jsx)("span", { className: `badge ${cov.cls}`, children: cov.label }), p.offersTruncated && (0, jsx_runtime_1.jsx)("span", { className: "badge bg-amber-100 text-amber-900", children: "\u0628\u0631\u0634\u200C\u062E\u0648\u0631\u062F\u0647 (Truncated)" })] }), (0, jsx_runtime_1.jsxs)("a", { href: p.url ?? `https://torob.com/p/${encodeURIComponent(p.prk)}/`, target: "_blank", rel: "noreferrer", className: "num shrink-0 font-mono text-[11px] text-indigo-700 underline", children: ["PRK: ", p.prk] })] }), (0, jsx_runtime_1.jsx)("div", { className: "font-semibold text-slate-900", children: p.title || "بدون عنوان" }), (0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-600 num", children: [(0, jsx_runtime_1.jsxs)("span", { children: ["\u06AF\u0632\u0627\u0631\u0634\u200C\u0634\u062F\u0647 \u062F\u0631 \u062A\u0631\u0628: ", (0, jsx_runtime_1.jsx)("strong", { children: p.reportedSellerCount == null ? "نامشخص" : (0, format_1.faNum)(p.reportedSellerCount) })] }), (0, jsx_runtime_1.jsxs)("span", { children: ["\u0627\u0633\u062A\u062E\u0631\u0627\u062C\u200C\u0634\u062F\u0647: ", (0, jsx_runtime_1.jsx)("strong", { children: (0, format_1.faNum)(p.extractedOfferCount) })] }), (0, jsx_runtime_1.jsxs)("span", { children: ["\u0641\u0631\u0648\u0634\u06AF\u0627\u0647 \u062E\u0648\u062F\u0645\u0627\u0646: ", (0, jsx_runtime_1.jsx)("strong", { className: p.ownStoreOfferCount > 0 ? "text-amber-800" : "", children: (0, format_1.faNum)(p.ownStoreOfferCount) })] }), (0, jsx_runtime_1.jsxs)("span", { children: ["\u0631\u0642\u0628\u0627\u06CC \u0645\u0633\u062A\u0642\u0644 \u06CC\u06A9\u062A\u0627: ", (0, jsx_runtime_1.jsx)("strong", { children: (0, format_1.faNum)(p.uniqueExternalSellerCount) })] }), (0, jsx_runtime_1.jsxs)("span", { children: ["\u0631\u0642\u0628\u0627\u06CC \u062A\u0623\u06CC\u06CC\u062F\u0634\u062F\u0647: ", (0, jsx_runtime_1.jsx)("strong", { className: "text-emerald-800", children: (0, format_1.faNum)(p.confirmedCompetitorCount) })] }), p.reviewRequiredCompetitorCount > 0 && (0, jsx_runtime_1.jsxs)("span", { children: ["\u0646\u06CC\u0627\u0632\u0645\u0646\u062F \u0628\u0631\u0631\u0633\u06CC: ", (0, jsx_runtime_1.jsx)("strong", { className: "text-amber-800", children: (0, format_1.faNum)(p.reviewRequiredCompetitorCount) })] }), p.rejectedCompetitorCount > 0 && (0, jsx_runtime_1.jsxs)("span", { children: ["\u0631\u062F\u0634\u062F\u0647: ", (0, jsx_runtime_1.jsx)("strong", { className: "text-rose-800", children: (0, format_1.faNum)(p.rejectedCompetitorCount) })] }), p.freshness && (0, jsx_runtime_1.jsxs)("span", { children: ["\u062A\u0627\u0632\u0647\u200C\u062A\u0631\u06CC\u0646 \u067E\u06CC\u0634\u0646\u0647\u0627\u062F: ", (0, jsx_runtime_1.jsx)("strong", { children: (0, format_1.faDate)(p.freshness) })] })] }), (p.discoveringQueries?.length || p.evidenceSources?.length) ? ((0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500", children: [p.discoveringQueries && p.discoveringQueries.length > 0 && ((0, jsx_runtime_1.jsxs)("span", { children: ["\u067E\u0631\u0633\u200C\u0648\u062C\u0648\u0647\u0627: ", p.discoveringQueries.join("، ")] })), p.evidenceSources && p.evidenceSources.length > 0 && ((0, jsx_runtime_1.jsxs)("span", { children: ["\u0645\u0646\u0627\u0628\u0639 \u0634\u0648\u0627\u0647\u062F: ", p.evidenceSources.map((s) => evidenceSourceLabels[s] ?? s).join(" · ")] }))] })) : null, (p.selectionReason || p.exclusionReason) && ((0, jsx_runtime_1.jsxs)("p", { className: "text-[11px] leading-5 text-slate-700", children: [(0, jsx_runtime_1.jsx)("strong", { children: p.selectionReason ? "دلیل انتخاب:" : "دلیل عدم انتخاب/جداسازی:" }), " ", p.selectionReason ?? p.exclusionReason] }))] }, p.prk));
                        }) })] }, group.key)))] }));
}
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
    return ((0, jsx_runtime_1.jsxs)("details", { className: "mt-1 max-w-lg text-xs whitespace-normal text-slate-700", children: [(0, jsx_runtime_1.jsxs)("summary", { className: "cursor-pointer", children: [(0, jsx_runtime_1.jsx)("span", { className: `badge ${color}`, children: format_1.torobStatusLabel[identity.status] }), identity.identityScore != null && (0, jsx_runtime_1.jsxs)("span", { className: "mr-1.5 text-[11px] text-slate-500 num", children: ["(", (0, format_1.faNum)(Math.round(identity.identityScore)), "\u066A)"] })] }), (0, jsx_runtime_1.jsxs)("div", { className: "mt-2 space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2 leading-5", children: [(0, jsx_runtime_1.jsx)("p", { children: identity.reason }), (0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap gap-x-2", children: [(0, jsx_runtime_1.jsx)("a", { className: "text-indigo-700 underline", href: `https://torob.com/p/${encodeURIComponent(identity.prk)}/`, target: "_blank", rel: "noreferrer", children: "\u06A9\u0627\u0631\u062A \u062A\u0631\u0628" }), identity.origin && (0, jsx_runtime_1.jsx)("span", { children: transportLabels[identity.origin] }), identity.sources.map((source) => (0, jsx_runtime_1.jsx)("span", { children: sourceLabels[source] }, source))] }), (0, jsx_runtime_1.jsx)(Specs, { specs: identity.specs, expected: identity.expectedSpecs }), Boolean(identity.matchedAttributes?.length) && ((0, jsx_runtime_1.jsxs)("p", { className: "text-[11px] text-emerald-800", children: [(0, jsx_runtime_1.jsx)("strong", { children: "\u0648\u06CC\u0698\u06AF\u06CC\u200C\u0647\u0627\u06CC \u0647\u0645\u200C\u062A\u0631\u0627\u0632:" }), " ", identity.matchedAttributes.join("، ")] })), Boolean(identity.missingAttributes?.length) && ((0, jsx_runtime_1.jsxs)("p", { className: "text-[11px] text-amber-900", children: [(0, jsx_runtime_1.jsx)("strong", { children: "\u0634\u0648\u0627\u0647\u062F \u0646\u0627\u0645\u0634\u062E\u0635 / \u0646\u06CC\u0627\u0632\u0645\u0646\u062F \u0628\u0631\u0631\u0633\u06CC:" }), " ", identity.missingAttributes.join("، ")] })), Boolean(identity.conflictingAttributes?.length) && ((0, jsx_runtime_1.jsxs)("p", { className: "text-[11px] text-rose-800", children: [(0, jsx_runtime_1.jsx)("strong", { children: "\u062A\u0639\u0627\u0631\u0636\u200C\u0647\u0627\u06CC \u0641\u0646\u06CC:" }), " ", identity.conflictingAttributes.join("، ")] })), Boolean(identity.brands?.length || identity.models?.length) && (0, jsx_runtime_1.jsx)("p", { dir: "auto", children: [...(identity.brands ?? []), ...(identity.models ?? [])].join(" · ") }), identity.packageUnits != null && (0, jsx_runtime_1.jsxs)("p", { children: ["\u062A\u0639\u062F\u0627\u062F \u062F\u0631 \u0628\u0633\u062A\u0647 \u00B7 ", (0, format_1.faNum)(identity.packageUnits)] }), identity.sharedImage && (0, jsx_runtime_1.jsx)("p", { children: "\u0646\u0634\u0627\u0646\u06CC \u062A\u0635\u0648\u06CC\u0631 \u0645\u0634\u062A\u0631\u06A9 \u062F\u0631 \u06A9\u0627\u0631\u062A \u0648 \u067E\u06CC\u0634\u0646\u0647\u0627\u062F \u0641\u0631\u0648\u0634\u0646\u062F\u0647 \u062B\u0628\u062A \u0634\u062F." }), (0, jsx_runtime_1.jsx)(ImageLinks, { urls: evidence.imageUrls })] })] }));
}
function DiscoveryDiagnosticsSection({ diagnostics }) {
    if (!diagnostics?.length)
        return null;
    return ((0, jsx_runtime_1.jsxs)("div", { className: "space-y-2 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-center justify-between gap-2", children: [(0, jsx_runtime_1.jsxs)("span", { className: "font-bold text-slate-900", children: ["\u0648\u0636\u0639\u06CC\u062A \u06A9\u0634\u0641 \u0648 \u0627\u0631\u0632\u06CC\u0627\u0628\u06CC \u062A\u06A9\u200C\u062A\u06A9 \u06A9\u0627\u0631\u062A\u200C\u0647\u0627 (", (0, format_1.faNum)(diagnostics.length), " PRK)"] }), (0, jsx_runtime_1.jsx)("span", { className: "text-[11px] text-slate-500", children: "\u062A\u0641\u06A9\u06CC\u06A9 \u0645\u0646\u0634\u0623 \u06A9\u0634\u0641\u060C \u0639\u0646\u0648\u0627\u0646 \u0641\u0631\u0648\u0634\u0646\u062F\u06AF\u0627\u0646\u060C \u0634\u0648\u0627\u0647\u062F \u0647\u0645\u200C\u062A\u0631\u0627\u0632 \u0648 \u062F\u0644\u06CC\u0644 \u0634\u0645\u0648\u0644/\u0631\u062F" })] }), (0, jsx_runtime_1.jsx)("div", { className: "space-y-2", children: diagnostics.map((d) => {
                    const stateStyle = adminStateMeta[d.adminState];
                    return ((0, jsx_runtime_1.jsxs)("details", { className: "rounded-lg border border-slate-200 bg-slate-50/70 p-2.5", children: [(0, jsx_runtime_1.jsxs)("summary", { className: "flex cursor-pointer flex-wrap items-center justify-between gap-2", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-center gap-1.5 min-w-0", children: [(0, jsx_runtime_1.jsx)("span", { className: `badge ${stateStyle.cls}`, children: stateStyle.label }), (0, jsx_runtime_1.jsx)("span", { className: "badge bg-slate-100 text-slate-700", children: classificationLabels[d.classification] }), (0, jsx_runtime_1.jsx)("span", { className: "badge bg-indigo-50 text-indigo-800", children: retrievalOriginLabels[d.retrievalOrigin] }), (0, jsx_runtime_1.jsx)("strong", { className: "text-slate-900", children: d.canonicalCardTitle || "بدون عنوان متعارف" })] }), (0, jsx_runtime_1.jsxs)("span", { className: "num font-mono text-[11px] text-slate-600", children: ["PRK: ", d.prk] })] }), (0, jsx_runtime_1.jsxs)("div", { className: "mt-2 space-y-1.5 leading-5 text-[11px]", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap gap-x-3 gap-y-1 text-slate-600 num", children: [(0, jsx_runtime_1.jsxs)("span", { children: ["\u062A\u06A9\u0645\u06CC\u0644 \u0627\u0633\u062A\u0639\u0644\u0627\u0645 \u062C\u0632\u0626\u06CC\u0627\u062A: ", (0, jsx_runtime_1.jsx)("strong", { children: d.inspectionCompleted ? "بله" : "خیر" })] }), d.candidateInspectionPriority != null && (0, jsx_runtime_1.jsxs)("span", { children: ["\u0627\u0648\u0644\u0648\u06CC\u062A \u0628\u0631\u0631\u0633\u06CC: ", (0, jsx_runtime_1.jsx)("strong", { children: (0, format_1.faNum)(d.candidateInspectionPriority) })] }), d.similarProductSeed && (0, jsx_runtime_1.jsxs)("span", { children: ["\u0628\u0630\u0631 \u06A9\u0627\u0644\u0627\u0647\u0627\u06CC \u0645\u0634\u0627\u0628\u0647: ", (0, jsx_runtime_1.jsx)("strong", { className: "font-mono", children: d.similarProductSeed })] }), (0, jsx_runtime_1.jsxs)("span", { children: ["\u0641\u0631\u0648\u0634\u0646\u062F\u06AF\u0627\u0646 \u062A\u0623\u06CC\u06CC\u062F\u0634\u062F\u0647: ", (0, jsx_runtime_1.jsx)("strong", { className: "text-emerald-800", children: (0, format_1.faNum)(d.confirmedSellerCount) })] }), (0, jsx_runtime_1.jsxs)("span", { children: ["\u0646\u06CC\u0627\u0632\u0645\u0646\u062F \u0628\u0627\u0632\u0628\u06CC\u0646\u06CC: ", (0, jsx_runtime_1.jsx)("strong", { className: "text-amber-800", children: (0, format_1.faNum)(d.reviewRequiredSellerCount) })] }), (0, jsx_runtime_1.jsxs)("span", { children: ["\u0631\u062F\u0634\u062F\u0647: ", (0, jsx_runtime_1.jsx)("strong", { className: "text-rose-800", children: (0, format_1.faNum)(d.rejectedSellerCount) })] }), (0, jsx_runtime_1.jsxs)("span", { children: ["\u0631\u0642\u0628\u0627\u06CC \u0645\u0633\u062A\u0642\u0644: ", (0, jsx_runtime_1.jsx)("strong", { children: (0, format_1.faNum)(d.externalCompetitorCount) })] })] }), (0, jsx_runtime_1.jsxs)("p", { children: [(0, jsx_runtime_1.jsx)("strong", { children: "\u062F\u0644\u06CC\u0644 \u0634\u0645\u0648\u0644 \u06CC\u0627 \u0639\u062F\u0645 \u0634\u0645\u0648\u0644:" }), " ", d.reasonForInclusionOrExclusion] }), d.sellerSpecificTitles.length > 0 && ((0, jsx_runtime_1.jsxs)("p", { children: [(0, jsx_runtime_1.jsx)("strong", { children: "\u0639\u0646\u0648\u0627\u0646\u200C\u0647\u0627\u06CC \u0641\u0631\u0648\u0634\u0646\u062F\u06AF\u0627\u0646:" }), " ", d.sellerSpecificTitles.join(" | ")] })), d.technicalAttributeMatches.length > 0 && ((0, jsx_runtime_1.jsxs)("p", { className: "text-emerald-800", children: [(0, jsx_runtime_1.jsx)("strong", { children: "\u0627\u0646\u0637\u0628\u0627\u0642\u200C\u0647\u0627\u06CC \u0641\u0646\u06CC:" }), " ", d.technicalAttributeMatches.join("، ")] })), d.missingIdentityEvidence.length > 0 && ((0, jsx_runtime_1.jsxs)("p", { className: "text-amber-900", children: [(0, jsx_runtime_1.jsx)("strong", { children: "\u0634\u0648\u0627\u0647\u062F \u0646\u0627\u0645\u0634\u062E\u0635/\u06A9\u0633\u0631\u06CC:" }), " ", d.missingIdentityEvidence.join("، ")] })), d.hardContradictions.length > 0 && ((0, jsx_runtime_1.jsxs)("p", { className: "text-rose-800", children: [(0, jsx_runtime_1.jsx)("strong", { children: "\u062A\u0639\u0627\u0631\u0636\u200C\u0647\u0627\u06CC \u0633\u062E\u062A:" }), " ", d.hardContradictions.join("، ")] })), d.sellerAssessments && d.sellerAssessments.length > 0 && ((0, jsx_runtime_1.jsx)("ul", { className: "space-y-1 rounded border border-slate-200 bg-white p-2", children: d.sellerAssessments.map((s, idx) => ((0, jsx_runtime_1.jsxs)("li", { className: "border-b border-slate-100 pb-1 last:border-b-0 last:pb-0", children: [(0, jsx_runtime_1.jsx)("span", { className: "font-semibold text-slate-900", children: s.sellerName }), " · ", (0, jsx_runtime_1.jsxs)("span", { children: [format_1.torobStatusLabel[s.status], " (", (0, format_1.faNum)(Math.round(s.identityScore)), "\u066A)"] }), s.sellerListingTitle && (0, jsx_runtime_1.jsxs)("span", { children: [" \u00B7 \u00AB", s.sellerListingTitle, "\u00BB"] }), (0, jsx_runtime_1.jsx)("span", { className: "block text-slate-500", children: s.confidenceReason })] }, `${s.sellerName}-${idx}`))) }))] })] }, d.prk));
                }) })] }));
}
function TorobSearchDetails({ audit }) {
    if (!audit?.search && !audit?.candidate && !audit?.coverage && !audit?.panelEvidence?.length && !audit?.discoveryDiagnostics?.length)
        return null;
    const queries = audit.search?.queries ?? [];
    const cards = audit.search?.candidates?.length ? audit.search.candidates : audit.candidate ? [audit.candidate] : [];
    const counts = audit.offerIdentityCounts;
    const coverage = audit.coverage ?? audit.search?.coverage;
    const covStyle = coverage ? coverageLabels[coverage.status] : undefined;
    const diagnostics = audit.discoveryDiagnostics ?? audit.search?.discoveryDiagnostics;
    return ((0, jsx_runtime_1.jsxs)("details", { className: "space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-xs text-slate-700", children: [(0, jsx_runtime_1.jsx)("summary", { className: "cursor-pointer font-semibold", children: "\u0634\u0648\u0627\u0647\u062F \u062C\u0633\u062A\u200C\u0648\u062C\u0648 \u0648 \u062A\u0637\u0628\u06CC\u0642 \u062A\u0631\u0628" }), (0, jsx_runtime_1.jsx)(TorobPanelComparison, { panels: audit?.panelEvidence }), (0, jsx_runtime_1.jsx)(DiscoveryDiagnosticsSection, { diagnostics: diagnostics }), coverage && covStyle && ((0, jsx_runtime_1.jsxs)("div", { className: "space-y-1.5 rounded-lg border border-slate-200 bg-white p-2", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-center gap-2", children: [(0, jsx_runtime_1.jsx)("span", { className: `badge ${covStyle.cls}`, children: covStyle.label }), (0, jsx_runtime_1.jsxs)("span", { children: ["\u062D\u0627\u0644\u062A: ", coverage.mode === "extended" ? "توسعه‌یافته" : "تعاملی"] }), (0, jsx_runtime_1.jsxs)("span", { children: ["\u062A\u0648\u0642\u0641: ", stoppingLabels[coverage.stoppingReason]] })] }), (0, jsx_runtime_1.jsxs)("p", { className: "text-slate-600", children: [(0, format_1.faNum)(coverage.queriesExecuted), "/", (0, format_1.faNum)(coverage.queriesGenerated), " \u067E\u0631\u0633\u200C\u0648\u062C\u0648 \u00B7", " ", (0, format_1.faNum)(coverage.pagesRequested), " \u0635\u0641\u062D\u0647 \u0628\u0631\u0631\u0633\u06CC\u200C\u0634\u062F\u0647 (", (0, format_1.faNum)(coverage.pagesRemaining), " \u0635\u0641\u062D\u0647 \u0628\u0627\u0642\u06CC\u200C\u0645\u0627\u0646\u062F\u0647) \u00B7", " ", (0, format_1.faNum)(coverage.uniquePrksDiscovered), " PRK \u06CC\u06A9\u062A\u0627 (", (0, format_1.faNum)(coverage.candidatePrksInspected), " \u0628\u0631\u0631\u0633\u06CC\u200C\u0634\u062F\u0647\u060C", " ", (0, format_1.faNum)(coverage.promisingUninspectedCount), " \u0645\u0648\u0631\u062F\u0650 \u0645\u0633\u062A\u0639\u062F\u0650 \u0628\u0631\u0631\u0633\u06CC\u200C\u0646\u0634\u062F\u0647) \u00B7", " ", (0, format_1.faNum)(coverage.apiRequestsMade), " \u062F\u0631\u062E\u0648\u0627\u0633\u062A API (\u06A9\u0634 ", (0, format_1.faNum)(Math.round(coverage.cacheHitRate * 100)), "\u066A)"] }), coverage.limitations.length > 0 && ((0, jsx_runtime_1.jsx)("ul", { className: "list-inside list-disc text-amber-900", children: coverage.limitations.map((item, i) => (0, jsx_runtime_1.jsx)("li", { children: item }, i)) }))] })), counts && (0, jsx_runtime_1.jsxs)("p", { children: [(0, format_1.faNum)(counts.MATCH_CONFIRMED), " \u067E\u06CC\u0634\u0646\u0647\u0627\u062F \u0647\u0645\u200C\u0647\u0648\u06CC\u062A \u00B7 ", (0, format_1.faNum)(counts.REVIEW_REQUIRED), " \u0646\u06CC\u0627\u0632\u0645\u0646\u062F \u0628\u0631\u0631\u0633\u06CC \u00B7 ", (0, format_1.faNum)(counts.IDENTITY_MISMATCH), " \u0646\u0627\u0645\u0646\u0637\u0628\u0642"] }), queries.length > 0 && (0, jsx_runtime_1.jsx)("ol", { className: "space-y-1", children: queries.map((query, index) => (0, jsx_runtime_1.jsxs)("li", { children: [(0, format_1.faNum)(index + 1), ". ", query.query, " \u00B7 ", (0, format_1.faNum)(query.mapped), " \u06A9\u0627\u0631\u062A", query.origin && (0, jsx_runtime_1.jsxs)("span", { children: [" \u00B7 ", transportLabels[query.origin]] }), query.issue && (0, jsx_runtime_1.jsxs)("span", { className: "text-amber-800", children: [" \u00B7 ", query.issue] })] }, query.query)) }), (0, jsx_runtime_1.jsx)("div", { className: "space-y-1.5", children: cards.map((card) => {
                    const selected = audit.candidate?.prk === card.prk;
                    const inspection = card.inspection;
                    const observed = inspection ?? card;
                    const title = card.titleFa || card.titleEn || "عنوان کارت دریافت نشد";
                    return ((0, jsx_runtime_1.jsxs)("details", { className: "rounded-lg border border-slate-200 bg-white p-2", children: [(0, jsx_runtime_1.jsxs)("summary", { className: "cursor-pointer leading-5", children: [(0, jsx_runtime_1.jsx)("strong", { children: title }), " \u00B7 ", format_1.torobStatusLabel[observed.status], selected && " · کارت منتخب"] }), (0, jsx_runtime_1.jsxs)("div", { className: "mt-2 space-y-2 leading-5", children: [card.titleFa && card.titleEn && (0, jsx_runtime_1.jsx)("p", { dir: "auto", children: card.titleEn }), card.queries.length > 0 && (0, jsx_runtime_1.jsxs)("p", { children: ["\u0639\u0628\u0627\u0631\u062A\u200C\u0647\u0627\u06CC \u062C\u0633\u062A\u200C\u0648\u062C\u0648 \u00B7 ", [...new Set(card.queries)]
                                                .map((index) => queries[index - 1]?.query).filter(Boolean).join("، ")] }), card.observations?.some(({ titleFa, titleEn }) => titleFa !== card.titleFa || titleEn !== card.titleEn) &&
                                        (0, jsx_runtime_1.jsx)("ul", { children: card.observations.map(({ query, titleFa, titleEn }, i) => (0, jsx_runtime_1.jsxs)("li", { children: [(0, format_1.faNum)(query), " \u00B7 ", [titleFa, titleEn].filter(Boolean).join(" / ") || "عنوان دریافت نشد"] }, i)) }), inspection && (0, jsx_runtime_1.jsxs)("p", { children: ["\u0639\u0646\u0648\u0627\u0646 \u062F\u0631 \u062C\u0632\u0626\u06CC\u0627\u062A \u00B7 ", [inspection.titleFa, inspection.titleEn].filter(Boolean).join(" / ") || "دریافت نشد"] }), observed.origin && (0, jsx_runtime_1.jsx)("p", { children: transportLabels[observed.origin] }), !inspection && card.extraction === "not_requested" && (0, jsx_runtime_1.jsx)("p", { children: "\u062C\u0632\u0626\u06CC\u0627\u062A \u0627\u06CC\u0646 \u06A9\u0627\u0631\u062A \u062F\u0631 \u0645\u062D\u062F\u0648\u062F\u0647\u0654 \u0627\u0633\u062A\u0639\u0644\u0627\u0645 \u062F\u0631\u06CC\u0627\u0641\u062A \u0646\u0634\u062F." }), (0, jsx_runtime_1.jsx)(Specs, { specs: observed.specs }), (0, jsx_runtime_1.jsx)(ImageLinks, { urls: observed.imageUrls }), observed.reasons.length > 0 && (0, jsx_runtime_1.jsx)("ul", { className: "list-inside list-disc", children: observed.reasons.map((reason, i) => (0, jsx_runtime_1.jsx)("li", { children: reason }, i)) })] })] }, card.prk));
                }) })] }));
}
