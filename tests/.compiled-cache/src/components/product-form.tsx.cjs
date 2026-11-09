"use client";
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProductForm = ProductForm;
const jsx_runtime_1 = require("react/jsx-runtime");
const navigation_1 = require("next/navigation");
const react_1 = require("react");
function quotesToText(quotes) {
    if (!quotes?.length)
        return "";
    return quotes
        .map((q) => `${q.supplierName}, ${q.buyPriceToman ?? q.rawPrice}, ${q.supplierCity ?? "مشهد"}, ${q.priority ?? 5}, ${q.inStock === false ? "out" : "in"}`)
        .join("\n");
}
const empty = {
    sku: "",
    name: "",
    category: "",
    storeExternalId: "",
    sourceType: "torob",
    torobUrl: "",
    costPrice: "",
    minMarginPct: "",
    minProfitAmount: "",
    preferredCampaignType: "auto",
    colleagueListText: "",
    autoApply: true,
};
function ProductForm({ initial, initialQuotes, onDone, }) {
    const router = (0, navigation_1.useRouter)();
    const [v, setV] = (0, react_1.useState)({
        ...empty,
        ...initial,
        minMarginPct: initial?.minMarginPct ?? "",
        minProfitAmount: initial?.minProfitAmount ?? "",
        preferredCampaignType: initial?.preferredCampaignType ?? "auto",
        colleagueListText: initial?.colleagueListText ?? quotesToText(initialQuotes),
    });
    const [pending, start] = (0, react_1.useTransition)();
    const [err, setErr] = (0, react_1.useState)(null);
    const set = (k, val) => setV((s) => ({ ...s, [k]: val }));
    const submit = () => start(async () => {
        setErr(null);
        const res = await fetch(v.id ? `/api/products/${v.id}` : "/api/products", {
            method: v.id ? "PATCH" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(v),
        });
        const j = await res.json();
        if (!res.ok)
            return setErr(j.error ?? "خطا");
        if (!v.id)
            setV(empty);
        onDone?.();
        router.refresh();
    });
    return ((0, jsx_runtime_1.jsxs)("div", { className: "grid grid-cols-1 gap-3 md:grid-cols-3", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u06A9\u062F \u06A9\u0627\u0644\u0627 (SKU) *" }), (0, jsx_runtime_1.jsx)("input", { className: "input", value: v.sku, onChange: (e) => set("sku", e.target.value) })] }), (0, jsx_runtime_1.jsxs)("div", { className: "md:col-span-2", children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0646\u0627\u0645 \u0645\u062D\u0635\u0648\u0644 *" }), (0, jsx_runtime_1.jsx)("input", { className: "input", value: v.name, onChange: (e) => set("name", e.target.value) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u062F\u0633\u062A\u0647\u200C\u0628\u0646\u062F\u06CC" }), (0, jsx_runtime_1.jsx)("input", { className: "input", value: v.category, onChange: (e) => set("category", e.target.value), placeholder: "\u0645\u062B\u0644\u0627\u064B \u062F\u0648\u0631\u0628\u06CC\u0646 \u0645\u062F\u0627\u0631\u0628\u0633\u062A\u0647" })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0634\u0646\u0627\u0633\u0647 \u0645\u062D\u0635\u0648\u0644 \u062F\u0631 sgeooole (\u06A9\u062F KY-XXXX \u06CC\u0627 _id)" }), (0, jsx_runtime_1.jsx)("input", { className: "input", value: v.storeExternalId, onChange: (e) => set("storeExternalId", e.target.value), placeholder: "KY-1234567" })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0645\u0646\u0628\u0639 \u0627\u0633\u062A\u0639\u0644\u0627\u0645" }), (0, jsx_runtime_1.jsx)("select", { className: "input", value: v.sourceType, onChange: (e) => set("sourceType", e.target.value), children: (0, jsx_runtime_1.jsx)("option", { value: "torob", children: "\u062A\u0631\u0628 (\u0645\u062C\u0647\u0632 \u0628\u0647 Torob MCP \u0648 \u062C\u0633\u062A\u062C\u0648\u06CC \u062E\u0648\u062F\u06A9\u0627\u0631)" }) })] }), (0, jsx_runtime_1.jsxs)("div", { className: "md:col-span-2", children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0644\u06CC\u0646\u06A9 \u0645\u062D\u0635\u0648\u0644 \u062F\u0631 \u062A\u0631\u0628 (\u0627\u062E\u062A\u06CC\u0627\u0631\u06CC \u2014 \u062F\u0631 \u0635\u0648\u0631\u062A \u062E\u0627\u0644\u06CC \u0628\u0648\u062F\u0646 \u0628\u0627 \u0646\u0627\u0645 \u0645\u062D\u0635\u0648\u0644 \u0627\u0632 Torob MCP \u067E\u06CC\u062F\u0627 \u0645\u06CC\u200C\u0634\u0648\u062F)" }), (0, jsx_runtime_1.jsx)("input", { className: "input", dir: "ltr", value: v.torobUrl, onChange: (e) => set("torobUrl", e.target.value), placeholder: "https://torob.com/p/xxxxxxxx/..." })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0633\u06CC\u0633\u062A\u0645 \u062A\u062E\u0641\u06CC\u0641 \u062A\u0631\u062C\u06CC\u062D\u06CC \u0627\u06CC\u0646 \u06A9\u0627\u0631\u062A \u062F\u0631 sgeooole" }), (0, jsx_runtime_1.jsxs)("select", { className: "input font-medium", value: v.preferredCampaignType, onChange: (e) => set("preferredCampaignType", e.target.value), children: [(0, jsx_runtime_1.jsx)("option", { value: "auto", children: "\u062A\u0634\u062E\u06CC\u0635 \u062E\u0648\u062F\u06A9\u0627\u0631 \u0628\u0631 \u0627\u0633\u0627\u0633 \u0642\u0648\u0627\u0646\u06CC\u0646 \u0648 \u0631\u0646\u062C \u06A9\u0627\u0631\u062A\u200C\u0647\u0627" }), (0, jsx_runtime_1.jsx)("option", { value: "flash", children: "\u06F1) \u067E\u06CC\u0634\u0646\u0647\u0627\u062F \u0644\u062D\u0638\u0647\u200C\u0627\u06CC (\u0635\u0641\u062D\u0647 \u0627\u0635\u0644\u06CC)" }), (0, jsx_runtime_1.jsx)("option", { value: "featured", children: "\u06F2) \u067E\u06CC\u0634\u0646\u0647\u0627\u062F \u0634\u06AF\u0641\u062A\u200C\u0627\u0646\u06AF\u06CC\u0632 (\u0635\u0641\u062D\u0647 \u0627\u0635\u0644\u06CC)" }), (0, jsx_runtime_1.jsx)("option", { value: "timed_sale", children: "\u06F3) \u0641\u0631\u0635\u062A \u0632\u0645\u0627\u0646\u200C\u062F\u0627\u0631 (\u0645\u0627\u0644\u06CC \u0648 \u062A\u062E\u0641\u06CC\u0641 / \u0645\u0646\u062A\u062E\u0628\u200C\u0647\u0627)" }), (0, jsx_runtime_1.jsx)("option", { value: "none", children: "\u0628\u062F\u0648\u0646 \u06A9\u0645\u067E\u06CC\u0646 \u062A\u062E\u0641\u06CC\u0641" })] })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0642\u06CC\u0645\u062A \u062E\u0631\u06CC\u062F \u067E\u0627\u06CC\u0647 / \u0627\u0646\u0628\u0627\u0631 (\u062A\u0648\u0645\u0627\u0646\u061B \u06F0 = \u06A9\u0634\u0641 \u0627\u0632 \u062A\u0631\u0628)" }), (0, jsx_runtime_1.jsx)("input", { className: "input num", type: "number", value: v.costPrice, onChange: (e) => set("costPrice", e.target.value) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u062D\u062F\u0627\u0642\u0644 \u0633\u0648\u062F \u062E\u0637 \u0642\u0631\u0645\u0632 \u066A (\u062E\u0627\u0644\u06CC = \u067E\u0631\u0648\u0641\u0627\u06CC\u0644)" }), (0, jsx_runtime_1.jsx)("input", { className: "input num", type: "number", step: "0.5", value: v.minMarginPct ?? "", onChange: (e) => set("minMarginPct", e.target.value) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u062D\u062F\u0627\u0642\u0644 \u0633\u0648\u062F \u062E\u0627\u0644\u0635 \u062A\u0648\u0645\u0627\u0646\u06CC (\u062E\u0627\u0644\u06CC = \u067E\u0631\u0648\u0641\u0627\u06CC\u0644)" }), (0, jsx_runtime_1.jsx)("input", { className: "input num", type: "number", step: "1000", value: v.minProfitAmount ?? "", onChange: (e) => set("minProfitAmount", e.target.value) })] }), (0, jsx_runtime_1.jsxs)("div", { className: "md:col-span-3", children: [(0, jsx_runtime_1.jsx)("label", { className: "label font-bold text-indigo-700", children: "\u0644\u06CC\u0633\u062A \u0642\u06CC\u0645\u062A \u0647\u0645\u06A9\u0627\u0631\u0627\u0646 / \u062A\u0627\u0645\u06CC\u0646\u200C\u06A9\u0646\u0646\u062F\u06AF\u0627\u0646 \u0628\u0631\u0627\u06CC \u0627\u06CC\u0646 \u0645\u062D\u0635\u0648\u0644 (\u0627\u0648\u0644\u0648\u06CC\u062A \u0627\u0648\u0644 \u062A\u0639\u06CC\u06CC\u0646 \u06A9\u0641 \u0642\u06CC\u0645\u062A \u0641\u0631\u0648\u0634)" }), (0, jsx_runtime_1.jsxs)("p", { className: "mb-1 text-xs text-slate-400", children: ["\u0641\u0631\u0645\u062A \u0647\u0631 \u062E\u0637: ", (0, jsx_runtime_1.jsx)("code", { dir: "ltr", children: "\u0646\u0627\u0645 \u0647\u0645\u06A9\u0627\u0631, \u0642\u06CC\u0645\u062A \u062E\u0631\u06CC\u062F (\u062A\u0648\u0645\u0627\u0646 \u06CC\u0627 \u0631\u06CC\u0627\u0644), \u0634\u0647\u0631 \u0647\u0645\u06A9\u0627\u0631 (\u0645\u062B\u0644\u0627\u064B \u0645\u0634\u0647\u062F), \u0627\u0648\u0644\u0648\u06CC\u062A (1-10), [in|out]" })] }), (0, jsx_runtime_1.jsx)("textarea", { className: "input h-24 font-mono text-xs", dir: "ltr", value: v.colleagueListText, onChange: (e) => set("colleagueListText", e.target.value), placeholder: "پخش شرق مشهد, 2320000, مشهد, 9, in\nهمکار تهران, 2290000, تهران, 7, in" })] }), (0, jsx_runtime_1.jsxs)("div", { className: "flex items-end gap-2 pb-2 md:col-span-3", children: [(0, jsx_runtime_1.jsx)("input", { id: `auto-${v.id ?? "new"}`, type: "checkbox", checked: v.autoApply, onChange: (e) => set("autoApply", e.target.checked) }), (0, jsx_runtime_1.jsx)("label", { htmlFor: `auto-${v.id ?? "new"}`, className: "text-sm", children: "\u0627\u0639\u0645\u0627\u0644 \u062E\u0648\u062F\u06A9\u0627\u0631 \u0628\u062F\u0648\u0646 \u062A\u0623\u06CC\u06CC\u062F \u0627\u0646\u0633\u0627\u0646\u06CC (\u0628\u0627 \u062A\u0636\u0645\u06CC\u0646 \u0642\u0637\u0639\u06CC \u0639\u062F\u0645 \u0641\u0631\u0648\u0634 \u0632\u06CC\u0631 \u0642\u06CC\u0645\u062A \u062E\u0631\u06CC\u062F \u0647\u0645\u06A9\u0627\u0631)" })] }), (0, jsx_runtime_1.jsxs)("div", { className: "flex items-center gap-3 md:col-span-3", children: [(0, jsx_runtime_1.jsx)("button", { className: "btn-primary", disabled: pending, onClick: submit, children: pending ? "در حال ذخیره…" : v.id ? "ذخیره تغییرات" : "افزودن محصول" }), err && (0, jsx_runtime_1.jsx)("span", { className: "text-sm text-rose-600", children: err })] })] }));
}
