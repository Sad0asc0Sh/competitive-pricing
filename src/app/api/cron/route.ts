import { requireCronOrAdminAuth } from "@/lib/auth";
import { tickScheduler } from "@/lib/services/scheduler";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handleCron(req: Request) {
  const denied = await requireCronOrAdminAuth(req);
  if (denied) return denied;

  const r = await tickScheduler();
  return NextResponse.json({ ok: true, ...r });
}

export async function GET(req: Request) {
  return handleCron(req);
}

export async function POST(req: Request) {
  return handleCron(req);
}
