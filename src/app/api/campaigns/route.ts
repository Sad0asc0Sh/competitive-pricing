import { db } from "@/db";
import { discountCampaigns } from "@/db/schema";
import { ensureDefaults } from "@/lib/services/bootstrap";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureDefaults();
  const rows = await db.select().from(discountCampaigns).orderBy(discountCampaigns.priority);
  return NextResponse.json(rows);
}

const toNums = (v: unknown): number[] =>
  Array.isArray(v) ? v.map(Number).filter((n) => Number.isFinite(n)) : typeof v === "string" ? v.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n)) : [];
const toStrs = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : [];

export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return NextResponse.json({ error: "بدنه نامعتبر" }, { status: 400 });
  const values = {
    name: String(b.name ?? "کمپین"),
    type: b.type === "flash" ? "flash" : "featured",
    active: b.active !== false,
    priority: Number(b.priority ?? 0) || 0,
    minDiscountPct: Number(b.minDiscountPct ?? 0) || 0,
    maxDiscountPct: Number(b.maxDiscountPct ?? 100) || 100,
    activeHours: toNums(b.activeHours),
    activeDays: toNums(b.activeDays),
    categories: toStrs(b.categories),
    durationHours: Number(b.durationHours ?? 24) || 24,
  };
  if (b.id) {
    const [row] = await db.update(discountCampaigns).set(values).where(eq(discountCampaigns.id, Number(b.id))).returning();
    return NextResponse.json(row);
  }
  const [row] = await db.insert(discountCampaigns).values(values).returning();
  return NextResponse.json(row, { status: 201 });
}

export async function DELETE(req: Request) {
  const { id } = (await req.json().catch(() => ({}))) as { id?: number };
  if (!id) return NextResponse.json({ error: "id لازم است" }, { status: 400 });
  await db.delete(discountCampaigns).where(eq(discountCampaigns.id, Number(id)));
  return NextResponse.json({ ok: true });
}
