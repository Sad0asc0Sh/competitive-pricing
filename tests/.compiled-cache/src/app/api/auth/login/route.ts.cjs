"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.POST = POST;
exports.dynamic = void 0;
var _nodeCrypto = require("node:crypto");
var _server = require("next/server");
var _auth = require("../../../../lib/auth");
const dynamic = "force-dynamic";
exports.dynamic = dynamic;
function passwordMatches(candidate) {
  const expected = process.env.ADMIN_PASSWORD ?? "";
  if (!expected) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return (0, _nodeCrypto.timingSafeEqual)(a, b);
}
async function POST(req) {
  if (!(0, _auth.isAuthEnabled)()) {
    return _server.NextResponse.json({
      ok: true,
      authEnabled: false
    });
  }
  const body = await req.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : "";
  if (!passwordMatches(password)) {
    return _server.NextResponse.json({
      error: "رمز عبور نادرست است"
    }, {
      status: 401
    });
  }
  const token = await (0, _auth.createSessionToken)();
  const forwardedProto = req.headers.get("x-forwarded-proto") ?? "";
  const originHeader = req.headers.get("origin") ?? req.headers.get("referer") ?? "";
  const isHttps = process.env.FORCE_SECURE_COOKIE === "true" || forwardedProto === "https" && originHeader.startsWith("https://");
  const res = _server.NextResponse.json({
    ok: true,
    authEnabled: true
  });
  res.cookies.set(_auth.SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
    // ۷ روز
    secure: isHttps
  });
  return res;
}