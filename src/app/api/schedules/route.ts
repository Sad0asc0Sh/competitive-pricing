import { db } from "@/db";
import { schedules } from "@/db/schema";
import { ensureDefaults } from "@/lib/services/bootstrap";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureDefaults();
  return NextResponse.json(await db.select().from(schedules).orderBy(schedules.id));
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return NextResponse.json({ error: "بدنه نامعتبر" }, { status: 400 });
  const interval = Math.max(5, Number(b.intervalMinutes ?? 360) || 360);
  const values = {
    name: String(b.name ?? "زمان‌بندی"),
    intervalMinutes: interval,
    active: b.active !== false,
    filter: { ...(b.category ? { category: String(b.category) } : {}) },
    nextRunAt: new Date(Date.now() + interval * 60000),
  };
  if (b.id) {
    const [row] = await db.update(schedules).set(values).where(eq(schedules.id, Number(b.id))).returning();
    return NextResponse.json(row);
  }
  const [row] = await db.insert(schedules).values(values).returning();
  return NextResponse.json(row, { status: 201 });
}

export async function DELETE(req: Request) {
  const { id } = (await req.json().catch(() => ({}))) as { id?: number };
  if (!id) return NextResponse.json({ error: "id لازم است" }, { status: 400 });
  await db.delete(schedules).where(eq(schedules.id, Number(id)));
  return NextResponse.json({ ok: true });
}
