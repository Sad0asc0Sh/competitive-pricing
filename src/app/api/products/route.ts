import { db } from "@/db";
import { products } from "@/db/schema";
import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await db.select().from(products).orderBy(desc(products.updatedAt));
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body?.sku || !body?.name) return NextResponse.json({ error: "sku و name الزامی است" }, { status: 400 });
  try {
    const [row] = await db
      .insert(products)
      .values({
        sku: String(body.sku).trim(),
        name: String(body.name).trim(),
        category: body.category ? String(body.category).trim() : null,
        storeExternalId: body.storeExternalId ? String(body.storeExternalId) : null,
        sourceType: body.sourceType ?? "torob",
        torobUrl: body.torobUrl || null,
        torobPrk: body.torobPrk || null,
        costPrice: Number(body.costPrice ?? 0) || 0,
        minMarginPct: body.minMarginPct != null && body.minMarginPct !== "" ? Number(body.minMarginPct) : null,
        autoApply: body.autoApply !== false,
        profileId: body.profileId ? Number(body.profileId) : null,
      })
      .returning();
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "خطا" }, { status: 400 });
  }
}
