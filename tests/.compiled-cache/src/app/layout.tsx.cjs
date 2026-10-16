"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = RootLayout;
exports.viewport = exports.metadata = void 0;
var _appShell = require("@/components/app-shell");
var _auth = require("../lib/auth");
require("./globals.css");
const metadata = {
  title: "سامانه قیمت‌گذاری هوشمند",
  description: "اتوماسیون قیمت‌گذاری رقابتی بر اساس بازار ترب"
};
exports.metadata = metadata;
const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};
exports.viewport = viewport;
function RootLayout({
  children
}) {
  return <html lang="fa" dir="rtl">
      <head>
        <link rel="preconnect" href="https://cdn.jsdelivr.net" />
        <link href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css" rel="stylesheet" />
      </head>
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <_appShell.AppShell authEnabled={(0, _auth.isAuthEnabled)()}>{children}</_appShell.AppShell>
      </body>
    </html>;
}