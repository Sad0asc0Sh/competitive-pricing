"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = Loading;
const jsx_runtime_1 = require("react/jsx-runtime");
function Loading() {
    return ((0, jsx_runtime_1.jsxs)("div", { className: "space-y-6", "aria-busy": "true", "aria-label": "\u062F\u0631 \u062D\u0627\u0644 \u0628\u0627\u0631\u06AF\u0630\u0627\u0631\u06CC", children: [(0, jsx_runtime_1.jsx)("div", { className: "skeleton h-9 w-64 max-w-full" }), (0, jsx_runtime_1.jsxs)("div", { className: "grid grid-cols-2 gap-4 md:grid-cols-4", children: [(0, jsx_runtime_1.jsx)("div", { className: "skeleton h-24" }), (0, jsx_runtime_1.jsx)("div", { className: "skeleton h-24" }), (0, jsx_runtime_1.jsx)("div", { className: "skeleton h-24" }), (0, jsx_runtime_1.jsx)("div", { className: "skeleton h-24" })] }), (0, jsx_runtime_1.jsx)("div", { className: "skeleton h-64" })] }));
}
