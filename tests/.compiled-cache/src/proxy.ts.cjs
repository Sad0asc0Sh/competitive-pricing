"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
exports.proxy = proxy;
const server_1 = require("next/server");
const auth_1 = require("./lib/auth");
const PUBLIC_PATHS = [
    "/login",
    "/api/auth/login",
    "/api/auth/logout",
    "/api/health",
];
const CRON_PATHS = [
    "/api/cron",
    "/api/scheduler/tick",
];
async function proxy(req) {
    const { pathname } = req.nextUrl;
    if (pathname.startsWith("/_next") ||
        pathname.startsWith("/favicon") ||
        pathname.includes(".")) {
        return server_1.NextResponse.next();
    }
    if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
        return server_1.NextResponse.next();
    }
    if (CRON_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
        const denied = await (0, auth_1.requireCronOrAdminAuth)(req);
        if (denied)
            return denied;
        return server_1.NextResponse.next();
    }
    if (pathname.startsWith("/api/")) {
        const denied = await (0, auth_1.requireAdminAuth)(req);
        if (denied)
            return denied;
        return server_1.NextResponse.next();
    }
    const status = (0, auth_1.getAuthConfigStatus)();
    if (status.bypass) {
        return server_1.NextResponse.next();
    }
    if (!status.configured) {
        const loginUrl = new URL("/login", req.url);
        loginUrl.searchParams.set("error", "auth_not_configured");
        loginUrl.searchParams.set("next", pathname);
        return server_1.NextResponse.redirect(loginUrl);
    }
    const token = (0, auth_1.extractSessionTokenFromRequest)(req);
    const valid = await (0, auth_1.verifySessionToken)(token);
    if (!valid) {
        const loginUrl = new URL("/login", req.url);
        loginUrl.searchParams.set("next", pathname);
        return server_1.NextResponse.redirect(loginUrl);
    }
    return server_1.NextResponse.next();
}
exports.config = {
    matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
