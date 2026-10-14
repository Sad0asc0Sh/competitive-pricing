import { db } from "@/db";
import { competitorOffers, priceDecisions } from "@/db/schema";
import { applyDecision, rejectDecision } from "@/lib/services/runner";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Ctx) {
  const { id } = await params;
  const [d] = await db.select().from(priceDecisions).where(eq(priceDecisions.id, Number(id))).limit(1);
  if (!d) return NextResponse.json({ error: "یافت نشد" }, { status: 404 });
  const offers = await db.select().from(competitorOffers).where(eq(competitorOffers.decisionId, d.id));
  return NextResponse.json({ ...d, offers });
}

/** POST /api/decisions/:id  body: { action: 'approve' | 'reject' } */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  if (action === "approve") {
    const r = await applyDecision(Number(id));
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  if (action === "reject") {
    await rejectDecision(Number(id));
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "action نامعتبر" }, { status: 400 });
}
