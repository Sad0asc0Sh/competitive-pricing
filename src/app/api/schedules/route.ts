import { db } from "@/db";
import { schedules } from "@/db/schema";
import { requireAdminAuth } from "@/lib/auth";
import { ensureDefaults } from "@/lib/services/bootstrap";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function parseProductIds(raw: unknown): number[] {
  if (Array.isArray(raw)) {
    return raw.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
  }
  if (typeof raw === "string" && raw.trim()) {
    return raw
      .split(/[,\s،]+/)
      .map((x) => Number(x.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
  }
  return [];
}

export async function GET(req: Request) {
  const denied = await requireAdminAuth(req);
  if (denied) return denied;

  await ensureDefaults();
  return NextResponse.json(await db.select().from(schedules).orderBy(schedules.id));
}

export async function POST(req: Request) {
  const denied = await requireAdminAuth(req);
  if (denied) return denied;

  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return NextResponse.json({ error: "بدنه نامعتبر" }, { status: 400 });
  const interval = Math.max(5, Number(b.intervalMinutes ?? 360) || 360);
  const rawFilter = (b.filter && typeof b.filter === "object" ? b.filter : {}) as {
    category?: unknown;
    productIds?: unknown;
  };
  const categoryVal = b.category ?? rawFilter.category;
  const category =
    typeof categoryVal === "string" && categoryVal.trim() ? categoryVal.trim() : undefined;
  const productIds = parseProductIds(b.productIds ?? rawFilter.productIds);

  const values = {
    name: String(b.name ?? "زمان‌بندی"),
    intervalMinutes: interval,
    active: b.active !== false,
    filter: {
      ...(category ? { category } : {}),
      ...(productIds.length > 0 ? { productIds } : {}),
    },
    nextRunAt: new Date(Date.now() + interval * 60000),
  };
  if (b.id) {
    const [row] = await db
      .update(schedules)
      .set(values)
      .where(eq(schedules.id, Number(b.id)))
      .returning();
    return NextResponse.json(row);
  }
  const [row] = await db.insert(schedules).values(values).returning();
  return NextResponse.json(row, { status: 201 });
}

export async function DELETE(req: Request) {
  const denied = await requireAdminAuth(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as { id?: number };
  const urlId = new URL(req.url, "http://localhost").searchParams.get("id");
  const id = Number(body.id ?? urlId);
  if (!id) return NextResponse.json({ error: "id لازم است" }, { status: 400 });
  await db.delete(schedules).where(eq(schedules.id, id));
  return NextResponse.json({ ok: true });
}
