import { NextRequest, NextResponse } from "next/server";
import {
  extractSessionTokenFromRequest,
  getAuthConfigStatus,
  requireAdminAuth,
  requireCronOrAdminAuth,
  verifySessionToken,
} from "@/lib/auth";

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

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  if (CRON_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    const denied = await requireCronOrAdminAuth(req);
    if (denied) return denied;
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    const denied = await requireAdminAuth(req);
    if (denied) return denied;
    return NextResponse.next();
  }

  const status = getAuthConfigStatus();
  if (status.bypass) {
    return NextResponse.next();
  }

  if (!status.configured) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("error", "auth_not_configured");
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const token = extractSessionTokenFromRequest(req);
  const valid = await verifySessionToken(token);

  if (!valid) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
