import { requireCronOrAdminAuth } from "@/lib/auth";
import { tickScheduler } from "@/lib/services/scheduler";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET/POST /api/scheduler/tick — برای cron خارجی یا نشست معتبر ادمین.
 * نیازمند نشست معتبر ادمین یا هدر Authorization: Bearer <CRON_SECRET> / X-Cron-Secret.
 */
async function handleTick(req: Request) {
  const denied = await requireCronOrAdminAuth(req);
  if (denied) return denied;

  const r = await tickScheduler();
  return NextResponse.json({ ok: true, ...r });
}

export async function GET(req: Request) {
  return handleTick(req);
}

export async function POST(req: Request) {
  return handleTick(req);
}
