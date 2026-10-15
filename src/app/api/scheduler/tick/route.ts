import { tickScheduler } from "@/lib/services/scheduler";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/scheduler/tick — برای cron خارجی.
 * اگر CRON_SECRET تنظیم شده باشد، هدر Authorization: Bearer <secret> لازم است.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "CRON_SECRET روی سرور تنظیم نشده است؛ اندپوینت کرون در محیط تولید بسته است" }, { status: 500 });
  }
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const r = await tickScheduler();
  return NextResponse.json({ ok: true, ...r });
}
