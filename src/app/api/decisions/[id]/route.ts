import { db } from "@/db";
import { competitorOffers, priceDecisions, products } from "@/db/schema";
import { requireAdminAuth } from "@/lib/auth";
import * as runnerService from "@/lib/services/runner";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const denied = await requireAdminAuth(req);
  if (denied) return denied;

  const { id } = await params;
  const [d] = await db.select().from(priceDecisions).where(eq(priceDecisions.id, Number(id))).limit(1);
  if (!d) return NextResponse.json({ error: "یافت نشد" }, { status: 404 });
  const offers = await db.select().from(competitorOffers).where(eq(competitorOffers.decisionId, d.id));
  return NextResponse.json({ ...d, offers });
}

/**
 * POST /api/decisions/:id
 * body: {
 *   action: 'approve' | 'reject' | 'retry_sync',
 *   force?: boolean,
 *   allowBelowCost?: boolean,
 *   belowCostReason?: string,
 *   authorizedBy?: string
 * }
 */
export async function POST(req: Request, { params }: Ctx) {
  const denied = await requireAdminAuth(req);
  if (denied) return denied;

  const { id } = await params;
  const decisionId = Number(id);
  if (!Number.isFinite(decisionId) || decisionId <= 0) {
    return NextResponse.json({ ok: false, error: "شناسه تصمیم نامعتبر است" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    force?: boolean;
    allowBelowCost?: boolean;
    belowCostReason?: string;
    authorizedBy?: string;
  };
  const action = body.action;
  const force = body.force === true;
  const allowBelowCost = body.allowBelowCost === true;
  const belowCostReason = typeof body.belowCostReason === "string" ? body.belowCostReason.trim() : "";
  const authorizedBy = typeof body.authorizedBy === "string" ? body.authorizedBy.trim() : "";

  if (action === "reject") {
    await runnerService.rejectDecision(decisionId);
    return NextResponse.json({ ok: true, message: "تصمیم رد شد" });
  }

  if (action !== "approve" && action !== "retry_sync") {
    return NextResponse.json({ ok: false, error: "action نامعتبر" }, { status: 400 });
  }

  if (allowBelowCost) {
    if (belowCostReason.length < 5 || authorizedBy.length < 2) {
      const msg =
        "برای تایید زیر قیمت خرید یا کف سود، ثبت دلیل معتبر (حداقل ۵ کاراکتر) و نام تاییدکننده (authorizedBy) الزامی است.";
      return NextResponse.json(
        {
          ok: false,
          code: "INVALID_BELOW_COST_OVERRIDE",
          belowCostBlocked: true,
          error: msg,
          message: msg,
        },
        { status: 400 }
      );
    }
  }

  // Defence-in-depth floor guard at API boundary:
  // Ordinary force=true MUST NOT bypass cost or hard profit floors without explicit authorized override.
  const [d] = await db.select().from(priceDecisions).where(eq(priceDecisions.id, decisionId)).limit(1);
  if (!d) {
    return NextResponse.json({ ok: false, error: "تصمیم یافت نشد", message: "تصمیم یافت نشد" }, { status: 404 });
  }
  const [p] = await db.select().from(products).where(eq(products.id, d.productId)).limit(1);

  const finalPrice = d.finalPrice ?? 0;
  const effectiveCost = Math.max(d.effectiveCostPrice ?? 0, p?.costPrice ?? 0);
  const effectiveFloor = Math.max(d.hardFloorPrice ?? 0, p?.currentHardFloorPrice ?? 0, effectiveCost);

  const isBelowCostOrFloor =
    (effectiveCost > 0 && finalPrice <= effectiveCost) ||
    (effectiveFloor > 0 && finalPrice < effectiveFloor);

  if (isBelowCostOrFloor && !allowBelowCost) {
    const floorLabel = Math.max(effectiveCost, effectiveFloor).toLocaleString("fa-IR");
    const finalLabel = finalPrice.toLocaleString("fa-IR");
    const msg = `خط قرمز قیمت‌گذاری: قیمت نهایی (${finalLabel}) پایین‌تر از کف مجاز/قیمت خرید (${floorLabel}) است. تایید معمولی یا force مجاز به عبور از کف هزینه نیست؛ نیازمند مجوز صریح زیر قیمت خرید (allowBelowCost + دلیل + نام تاییدکننده) است.`;
    return NextResponse.json(
      {
        ok: false,
        code: "BELOW_FLOOR_BLOCKED",
        belowCostBlocked: true,
        error: msg,
        message: msg,
      },
      { status: 422 }
    );
  }

  const applyOpts = {
    force,
    allowBelowCost,
    belowCostReason: allowBelowCost ? belowCostReason : undefined,
    authorizedBy: allowBelowCost ? authorizedBy : undefined,
  };

  type ExtendedRunner = typeof runnerService & {
    applyDecision: (
      id: number,
      campaignEndsAt?: Date | null,
      opts?: typeof applyOpts
    ) => Promise<{
      ok: boolean;
      message?: string;
      error?: string;
      code?: string;
      status?: string;
      pushStatus?: string;
    }>;
    retryDecisionSync?: (
      id: number,
      opts?: typeof applyOpts
    ) => Promise<{
      ok: boolean;
      message?: string;
      error?: string;
      code?: string;
      status?: string;
      pushStatus?: string;
    }>;
  };

  const extRunner = runnerService as ExtendedRunner;
  const r =
    action === "retry_sync" && typeof extRunner.retryDecisionSync === "function"
      ? await extRunner.retryDecisionSync(decisionId, applyOpts)
      : await extRunner.applyDecision(decisionId, null, applyOpts);

  const msg = r.message || r.error || (r.ok ? "انجام شد" : "خطا در اعمال تصمیم");
  return NextResponse.json(
    {
      ...r,
      ok: r.ok,
      message: msg,
      ...(r.ok ? {} : { error: msg }),
    },
    { status: r.ok ? 200 : 400 }
  );
}
