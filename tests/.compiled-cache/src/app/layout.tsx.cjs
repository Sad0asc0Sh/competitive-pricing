"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.viewport = exports.metadata = void 0;
exports.default = RootLayout;
const jsx_runtime_1 = require("react/jsx-runtime");
const app_shell_1 = require("@/components/app-shell");
const auth_1 = require("../lib/auth");
require("./globals.css");
exports.metadata = {
    title: "سامانه قیمت‌گذاری هوشمند",
    description: "اتوماسیون قیمت‌گذاری رقابتی بر اساس بازار ترب",
};
exports.viewport = {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
};
function RootLayout({ children }) {
    return ((0, jsx_runtime_1.jsxs)("html", { lang: "fa", dir: "rtl", children: [(0, jsx_runtime_1.jsxs)("head", { children: [(0, jsx_runtime_1.jsx)("link", { rel: "preconnect", href: "https://cdn.jsdelivr.net" }), (0, jsx_runtime_1.jsx)("link", { href: "https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css", rel: "stylesheet" })] }), (0, jsx_runtime_1.jsx)("body", { className: "min-h-screen bg-slate-50 text-slate-900 antialiased", children: (0, jsx_runtime_1.jsx)(app_shell_1.AppShell, { authEnabled: (0, auth_1.isAuthEnabled)(), children: children }) })] }));
}
