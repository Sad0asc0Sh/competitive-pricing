"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = Loading;
const jsx_runtime_1 = require("react/jsx-runtime");
function Loading() {
    return ((0, jsx_runtime_1.jsxs)("div", { className: "space-y-5 sm:space-y-6", "aria-busy": "true", "aria-label": "\u062F\u0631 \u062D\u0627\u0644 \u0628\u0627\u0631\u06AF\u0630\u0627\u0631\u06CC", children: [(0, jsx_runtime_1.jsxs)("div", { className: "space-y-3", children: [(0, jsx_runtime_1.jsx)("div", { className: "skeleton h-8 w-72 max-w-full" }), (0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap gap-2", children: [(0, jsx_runtime_1.jsx)("div", { className: "skeleton h-7 w-36 rounded-full" }), (0, jsx_runtime_1.jsx)("div", { className: "skeleton h-7 w-40 rounded-full" }), (0, jsx_runtime_1.jsx)("div", { className: "skeleton h-7 w-32 rounded-full" })] })] }), (0, jsx_runtime_1.jsxs)("div", { className: "grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4", children: [(0, jsx_runtime_1.jsx)("div", { className: "skeleton h-24 rounded-2xl" }), (0, jsx_runtime_1.jsx)("div", { className: "skeleton h-24 rounded-2xl" }), (0, jsx_runtime_1.jsx)("div", { className: "skeleton h-24 rounded-2xl" }), (0, jsx_runtime_1.jsx)("div", { className: "skeleton h-24 rounded-2xl" })] }), (0, jsx_runtime_1.jsx)("div", { className: "skeleton h-64 rounded-2xl" })] }));
}
