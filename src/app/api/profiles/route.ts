import { db } from "@/db";
import { pricingProfiles } from "@/db/schema";
import { ensureDefaults, mergeConfig } from "@/lib/services/bootstrap";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureDefaults();
  const rows = await db.select().from(pricingProfiles).orderBy(pricingProfiles.id);
  return NextResponse.json(rows.map((r) => ({ ...r, config: mergeConfig(r.config) })));
}

/** POST: ایجاد یا بروزرسانی پروفایل  body: { id?, name, config, isDefault? } */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { id?: number; name?: string; config?: unknown; isDefault?: boolean } | null;
  if (!body) return NextResponse.json({ error: "بدنه نامعتبر" }, { status: 400 });
  const config = mergeConfig(body.config as never);
  if (body.isDefault) await db.update(pricingProfiles).set({ isDefault: false });
  if (body.id) {
    const [row] = await db
      .update(pricingProfiles)
      .set({ config, ...(body.name ? { name: body.name } : {}), ...(body.isDefault != null ? { isDefault: body.isDefault } : {}), updatedAt: new Date() })
      .where(eq(pricingProfiles.id, body.id))
      .returning();
    return NextResponse.json(row);
  }
  const [row] = await db.insert(pricingProfiles).values({ name: body.name ?? "پروفایل جدید", config, isDefault: !!body.isDefault }).returning();
  return NextResponse.json(row, { status: 201 });
}
