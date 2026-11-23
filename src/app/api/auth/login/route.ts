import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  getAuthConfigStatus,
  getSessionCookieOptions,
  verifyAdminPassword,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const status = getAuthConfigStatus();
  if (status.bypass) {
    return NextResponse.json({ ok: true, authEnabled: false, mode: "dev_bypass" });
  }
  if (!status.configured) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "احراز هویت ادمین در سرور به صورت ایمن پیکربندی نشده است (Fail-Closed). متغیرهای ADMIN_PASSWORD و SESSION_SECRET را تنظیم کنید.",
        reason: status.reason,
      },
      { status: 503 }
    );
  }

  const body = (await req.json().catch(() => null)) as { password?: string } | null;
  const password = typeof body?.password === "string" ? body.password : "";
  if (!verifyAdminPassword(password)) {
    return NextResponse.json({ ok: false, error: "رمز عبور نادرست است" }, { status: 401 });
  }

  const token = await createSessionToken();
  const res = NextResponse.json({ ok: true, authEnabled: true });
  res.cookies.set(
    SESSION_COOKIE,
    token,
    getSessionCookieOptions(req, SESSION_MAX_AGE_SECONDS)
  );
  return res;
}
