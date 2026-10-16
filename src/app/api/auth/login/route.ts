import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, createSessionToken, isAuthEnabled } from "@/lib/auth";

export const dynamic = "force-dynamic";

function passwordMatches(candidate: string): boolean {
  const expected = process.env.ADMIN_PASSWORD ?? "";
  if (!expected) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!isAuthEnabled()) {
    return NextResponse.json({ ok: true, authEnabled: false });
  }
  const body = (await req.json().catch(() => null)) as { password?: string } | null;
  const password = typeof body?.password === "string" ? body.password : "";
  if (!passwordMatches(password)) {
    return NextResponse.json({ error: "رمز عبور نادرست است" }, { status: 401 });
  }
  const token = await createSessionToken();
  const forwardedProto = req.headers.get("x-forwarded-proto") ?? "";
  const originHeader = req.headers.get("origin") ?? req.headers.get("referer") ?? "";
  const isHttps =
    process.env.FORCE_SECURE_COOKIE === "true" ||
    (forwardedProto === "https" && originHeader.startsWith("https://"));
  const res = NextResponse.json({ ok: true, authEnabled: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // ۷ روز
    secure: isHttps,
  });
  return res;
}
