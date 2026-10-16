import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

function clearAndRedirect(req: Request) {
  const origin = req.headers.get("origin") || req.headers.get("referer") || req.url;
  let targetUrl: URL;
  try {
    targetUrl = new URL("/login", origin);
  } catch {
    targetUrl = new URL("/login", req.url);
  }
  const res = NextResponse.redirect(targetUrl, { status: 303 });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}

export async function POST(req: Request) {
  return clearAndRedirect(req);
}

export async function GET(req: Request) {
  return clearAndRedirect(req);
}
