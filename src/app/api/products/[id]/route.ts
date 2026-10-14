import { db } from "@/db";
import { products } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Ctx) {
  const { id } = await params;
  const [row] = await db.select().from(products).where(eq(products.id, Number(id))).limit(1);
  if (!row) return NextResponse.json({ error: "یافت نشد" }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const allowed = ["sku", "name", "category", "storeExternalId", "sourceType", "torobUrl", "torobPrk", "costPrice", "minMarginPct", "autoApply", "profileId", "status"] as const;
  const patch: Record<string, unknown> = {};
  for (const k of allowed) if (k in body) patch[k] = body[k];
  if ("costPrice" in patch) patch.costPrice = Number(patch.costPrice) || 0;
  if ("minMarginPct" in patch) patch.minMarginPct = patch.minMarginPct === "" || patch.minMarginPct == null ? null : Number(patch.minMarginPct);
  if ("profileId" in patch) patch.profileId = patch.profileId ? Number(patch.profileId) : null;
  patch.updatedAt = new Date();
  try {
    const [row] = await db.update(products).set(patch).where(eq(products.id, Number(id))).returning();
    return NextResponse.json(row);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "خطا" }, { status: 400 });
  }
}

export async function DELETE(_: Request, { params }: Ctx) {
  const { id } = await params;
  await db.delete(products).where(eq(products.id, Number(id)));
  return NextResponse.json({ ok: true });
}
