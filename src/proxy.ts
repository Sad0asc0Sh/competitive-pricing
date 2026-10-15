import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, isAuthEnabled, isValidSessionToken } from "@/lib/auth";

/**
 * دروازه ورود مدیر: وقتی ADMIN_PASSWORD تنظیم شده باشد، همه صفحات و APIها
 * بدون کوکی نشست معتبر بسته‌اند.
 * استثناها: صفحه و API لاگین/خروج، ‎/api/health‎ و اندپوینت‌های کرون
 * (‎/api/cron‎ و ‎/api/scheduler/tick‎) که سکرت جدا (CRON_SECRET) دارند.
 */
const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/logout", "/api/health", "/api/cron", "/api/scheduler/tick"];

export async function proxy(req: NextRequest) {
  if (!isAuthEnabled()) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (await isValidSessionToken(token)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "ابتدا وارد شوید" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)"],
};
