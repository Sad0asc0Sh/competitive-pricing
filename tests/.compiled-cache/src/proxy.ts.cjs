"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
exports.proxy = proxy;
const server_1 = require("next/server");
const auth_1 = require("./lib/auth");
/**
 * دروازه ورود مدیر: وقتی ADMIN_PASSWORD تنظیم شده باشد، همه صفحات و APIها
 * بدون کوکی نشست معتبر بسته‌اند.
 * استثناها: صفحه و API لاگین/خروج، ‎/api/health‎ و اندپوینت‌های کرون
 * (‎/api/cron‎ و ‎/api/scheduler/tick‎) که سکرت جدا (CRON_SECRET) دارند.
 */
const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/logout", "/api/health", "/api/cron", "/api/scheduler/tick"];
async function proxy(req) {
    if (!(0, auth_1.isAuthEnabled)())
        return server_1.NextResponse.next();
    const { pathname } = req.nextUrl;
    if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
        return server_1.NextResponse.next();
    }
    const token = req.cookies.get(auth_1.SESSION_COOKIE)?.value;
    if (await (0, auth_1.isValidSessionToken)(token))
        return server_1.NextResponse.next();
    if (pathname.startsWith("/api/")) {
        return server_1.NextResponse.json({ error: "ابتدا وارد شوید" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
    return server_1.NextResponse.redirect(url);
}
exports.config = {
    matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)"],
};
