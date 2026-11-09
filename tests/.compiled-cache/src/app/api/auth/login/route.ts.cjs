"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.POST = POST;
const node_crypto_1 = require("node:crypto");
const server_1 = require("next/server");
const auth_1 = require("../../../../lib/auth");
exports.dynamic = "force-dynamic";
function passwordMatches(candidate) {
    const expected = process.env.ADMIN_PASSWORD ?? "";
    if (!expected)
        return false;
    const a = Buffer.from(candidate);
    const b = Buffer.from(expected);
    if (a.length !== b.length)
        return false;
    return (0, node_crypto_1.timingSafeEqual)(a, b);
}
async function POST(req) {
    if (!(0, auth_1.isAuthEnabled)()) {
        return server_1.NextResponse.json({ ok: true, authEnabled: false });
    }
    const body = (await req.json().catch(() => null));
    const password = typeof body?.password === "string" ? body.password : "";
    if (!passwordMatches(password)) {
        return server_1.NextResponse.json({ error: "رمز عبور نادرست است" }, { status: 401 });
    }
    const token = await (0, auth_1.createSessionToken)();
    const forwardedProto = req.headers.get("x-forwarded-proto") ?? "";
    const originHeader = req.headers.get("origin") ?? req.headers.get("referer") ?? "";
    const isHttps = process.env.FORCE_SECURE_COOKIE === "true" ||
        (forwardedProto === "https" && originHeader.startsWith("https://"));
    const res = server_1.NextResponse.json({ ok: true, authEnabled: true });
    res.cookies.set(auth_1.SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 7, // ۷ روز
        secure: isHttps,
    });
    return res;
}
