"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ListingLinks = ListingLinks;
const jsx_runtime_1 = require("react/jsx-runtime");
function ListingLinks({ panels }) {
    if (!panels.length)
        return null;
    return ((0, jsx_runtime_1.jsx)("div", { className: "flex flex-wrap items-center gap-x-3 gap-y-1 text-xs", children: panels.map(({ prk, sellerCount }, i) => ((0, jsx_runtime_1.jsxs)("a", { href: `https://torob.com/p/${encodeURIComponent(prk)}/`, target: "_blank", rel: "noreferrer", className: "font-medium text-indigo-700 underline underline-offset-4", children: [sellerCount === 1 ? "پنل تک‌فروشنده" : sellerCount ? `پنل ادغام · ${sellerCount.toLocaleString("fa-IR")} فروشنده` : "پنل ترب", panels.length > 1 && ` (${(i + 1).toLocaleString("fa-IR")})`, " \u2197"] }, prk))) }));
}
