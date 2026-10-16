"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.GET = GET;
exports.POST = POST;
exports.dynamic = void 0;
var _server = require("next/server");
var _auth = require("../../../../lib/auth");
const dynamic = "force-dynamic";
exports.dynamic = dynamic;
function clearAndRedirect(req) {
  const origin = req.headers.get("origin") || req.headers.get("referer") || req.url;
  let targetUrl;
  try {
    targetUrl = new URL("/login", origin);
  } catch {
    targetUrl = new URL("/login", req.url);
  }
  const res = _server.NextResponse.redirect(targetUrl, {
    status: 303
  });
  res.cookies.set(_auth.SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0
  });
  return res;
}
async function POST(req) {
  return clearAndRedirect(req);
}
async function GET(req) {
  return clearAndRedirect(req);
}