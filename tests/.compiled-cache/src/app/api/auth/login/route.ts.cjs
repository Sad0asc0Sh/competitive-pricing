"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.POST = POST;
const server_1 = require("next/server");
const auth_1 = require("../../../../lib/auth");
exports.dynamic = "force-dynamic";
async function POST(req) {
    const status = (0, auth_1.getAuthConfigStatus)();
    if (status.bypass) {
        return server_1.NextResponse.json({ ok: true, authEnabled: false, mode: "dev_bypass" });
    }
    if (!status.configured) {
        return server_1.NextResponse.json({
            ok: false,
            error: "احراز هویت ادمین در سرور به صورت ایمن پیکربندی نشده است (Fail-Closed). متغیرهای ADMIN_PASSWORD و SESSION_SECRET را تنظیم کنید.",
            reason: status.reason,
        }, { status: 503 });
    }
    const body = (await req.json().catch(() => null));
    const password = typeof body?.password === "string" ? body.password : "";
    if (!(0, auth_1.verifyAdminPassword)(password)) {
        return server_1.NextResponse.json({ ok: false, error: "رمز عبور نادرست است" }, { status: 401 });
    }
    const token = await (0, auth_1.createSessionToken)();
    const res = server_1.NextResponse.json({ ok: true, authEnabled: true });
    res.cookies.set(auth_1.SESSION_COOKIE, token, (0, auth_1.getSessionCookieOptions)(req, auth_1.SESSION_MAX_AGE_SECONDS));
    return res;
}
