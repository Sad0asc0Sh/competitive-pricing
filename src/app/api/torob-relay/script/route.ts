import { readFile } from "node:fs/promises";
import path from "node:path";
import { requireAdminAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireAdminAuth(req);
  if (denied) return denied;

  const filePath = path.join(process.cwd(), "scripts", "torob-relay.mjs");
  const script = await readFile(filePath, "utf8");
  return new NextResponse(script, {
    status: 200,
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Content-Disposition": 'attachment; filename="torob-relay.mjs"',
      "Cache-Control": "no-store",
    },
  });
}
