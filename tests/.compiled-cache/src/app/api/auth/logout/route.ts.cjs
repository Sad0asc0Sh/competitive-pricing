"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.POST = POST;
exports.GET = GET;
const server_1 = require("next/server");
const auth_1 = require("../../../../lib/auth");
exports.dynamic = "force-dynamic";
function clearAndRedirect(req) {
    const origin = req.headers.get("origin") || req.headers.get("referer") || req.url;
    let targetUrl;
    try {
        targetUrl = new URL("/login", origin);
    }
    catch {
        targetUrl = new URL("/login", req.url);
    }
    const res = server_1.NextResponse.redirect(targetUrl, { status: 303 });
    res.cookies.set(auth_1.SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
    return res;
}
async function POST(req) {
    return clearAndRedirect(req);
}
async function GET(req) {
    return clearAndRedirect(req);
}
