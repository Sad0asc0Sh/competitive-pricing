import { db } from "@/db";
import { competitorOffers, priceDecisions, products } from "@/db/schema";
import { requireAdminAuth } from "@/lib/auth";
import { parsePositiveInt } from "@/lib/format";
import type { TorobLinkConfirmation } from "@/lib/pricing/types";
import * as runnerService from "@/lib/services/runner";
import { extractPrk } from "@/lib/sources/torob";
import { torobProductUrl } from "@/lib/sources/torob-payload";
import { syncAdminPrkLink } from "@/lib/sources/torob-index";
import { and, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const denied = await requireAdminAuth(req);
  if (denied) return denied;

  const { id } = await params;
  const decisionId = parsePositiveInt(id);
  if (decisionId == null) {
    return NextResponse.json({ ok: false, error: "شناسه تصمیم نامعتبر است" }, { status: 400 });
  }
  const [d] = await db.select().from(priceDecisions).where(eq(priceDecisions.id, decisionId)).limit(1);
  if (!d) return NextResponse.json({ error: "یافت نشد" }, { status: 404 });
  const offers = await db.select().from(competitorOffers).where(eq(competitorOffers.decisionId, d.id));
  return NextResponse.json({ ...d, offers });
}

/**
 * POST /api/decisions/:id
 * body: {
 *   action: 'approve' | 'reject' | 'retry_sync' | 'relink_torob',
 *   force?: boolean,
 *   finalPrice?: number | null,
 *   useDisplayDiscount?: boolean | null,
 *   basePrice?: number | null,
 *   discountPct?: number | null,
 *   campaignType?: string | null,
 *   torobUrl?: string,
 *   confirmIdentity?: boolean
 * }
 */
export async function POST(req: Request, { params }: Ctx) {
  const denied = await requireAdminAuth(req);
  if (denied) return denied;

  const { id } = await params;
  const decisionId = parsePositiveInt(id);
  if (decisionId == null) {
    return NextResponse.json({ ok: false, error: "شناسه تصمیم نامعتبر است" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    force?: boolean;
    finalPrice?: number | null;
    useDisplayDiscount?: boolean | null;
    basePrice?: number | null;
    discountPct?: number | null;
    campaignType?: string | null;
    torobUrl?: string;
    confirmIdentity?: boolean;
  };
  const action = body.action;
  const force = body.force === true;
  if (action === "reject") {
    await runnerService.rejectDecision(decisionId);
    return NextResponse.json({ ok: true, message: "تصمیم رد شد" });
  }

  if (action === "relink_torob") {
    const [d] = await db.select().from(priceDecisions).where(eq(priceDecisions.id, decisionId)).limit(1);
    if (!d) {
      return NextResponse.json({ ok: false, error: "تصمیم یافت نشد", message: "تصمیم یافت نشد" }, { status: 404 });
    }
    const rawUrl = typeof body.torobUrl === "string" ? body.torobUrl.trim() : "";
    const prk = extractPrk(rawUrl, rawUrl);
    if (!prk || prk.length < 3) {
      const msg = "شناسه محصول ترب (prk) در لینک واردشده یافت نشد";
      return NextResponse.json({ ok: false, error: msg, message: msg }, { status: 400 });
    }
    const normalizedUrl = torobProductUrl(prk);
    const now = new Date();
    const confirmation: TorobLinkConfirmation | null = body.confirmIdentity === true
      ? { prk, confirmedAt: now.toISOString(), origin: "admin_review", decisionId: d.id } : null;
    await db.transaction(async (tx) => {
      await tx.update(products).set({
        torobUrl: normalizedUrl,
        torobPrk: prk,
        torobDetailsUrl: null,
        torobLinkConfirmation: confirmation ?? sql`CASE WHEN ${products.torobPrk} = ${prk} THEN ${products.torobLinkConfirmation} ELSE NULL END`,
        updatedAt: now,
      }).where(eq(products.id, d.productId));
      if (confirmation) {
        const audit = [{ step: "torob_link_confirmation", title: "تأیید ارتباط ترب توسط مدیر",
          message: "شناسهٔ کارت در بازبینی محصول ثبت شد", level: "info", data: confirmation }];
        await tx.update(priceDecisions).set({ steps: sql`${priceDecisions.steps} || ${JSON.stringify(audit)}::jsonb` })
          .where(eq(priceDecisions.id, d.id));
      }
      await tx.update(priceDecisions).set({ status: "superseded", pushStatus: "superseded" })
        .where(and(eq(priceDecisions.id, d.id), inArray(priceDecisions.status, ["rejected", "pending_review"])));
    });

    await syncAdminPrkLink({
      productId: d.productId,
      prk,
      origin: "admin_review",
      confirmed: body.confirmIdentity === true,
      now,
    });

    const summary = await runnerService.runPricing({
      trigger: "manual",
      productIds: [d.productId],
      runMode: "live",
    });
    return NextResponse.json({
      ok: true,
      message: confirmation ? "تأیید ارتباط ترب ثبت شد و استعلام جدید اجرا شد" : "لینک ترب ثبت شد و استعلام جدید اجرا شد",
      prk,
      torobUrl: normalizedUrl,
      confirmation,
      summary,
    });
  }

  if (action !== "approve" && action !== "retry_sync") {
    return NextResponse.json({ ok: false, error: "action نامعتبر" }, { status: 400 });
  }

  const [d] = await db.select().from(priceDecisions).where(eq(priceDecisions.id, decisionId)).limit(1);
  if (!d) {
    return NextResponse.json({ ok: false, error: "تصمیم یافت نشد", message: "تصمیم یافت نشد" }, { status: 404 });
  }
  const [p] = await db.select().from(products).where(eq(products.id, d.productId)).limit(1);

  const hasHumanOverride =
    action === "approve" &&
    (body.finalPrice != null ||
      body.useDisplayDiscount != null ||
      body.basePrice != null ||
      body.discountPct != null ||
      body.campaignType != null);

  if (hasHumanOverride && body.finalPrice != null) {
    const n = Number(body.finalPrice);
    if (!Number.isFinite(n) || Math.round(n) <= 0) {
      const msg = "قیمت نهایی یوزر نامعتبر است";
      return NextResponse.json({ ok: false, error: msg, message: msg }, { status: 400 });
    }
  }

  const finalPrice =
    hasHumanOverride && body.finalPrice != null ? Math.round(Number(body.finalPrice)) : (d.finalPrice ?? 0);
  const effectiveCost = Math.max(d.effectiveCostPrice ?? 0, p?.costPrice ?? 0);
  const effectiveFloor = Math.max(d.hardFloorPrice ?? 0, p?.currentHardFloorPrice ?? 0, effectiveCost);

  const isBelowCostOrFloor =
    (effectiveCost > 0 && finalPrice <= effectiveCost) ||
    (effectiveFloor > 0 && finalPrice < effectiveFloor);

  if (isBelowCostOrFloor) {
    const floorLabel = Math.max(effectiveCost, effectiveFloor).toLocaleString("fa-IR");
    const finalLabel = finalPrice.toLocaleString("fa-IR");
    const msg = `خط قرمز قیمت‌گذاری: قیمت نهایی (${finalLabel}) پایین‌تر از کف مجاز/قیمت خرید (${floorLabel}) است. قیمت فروش را اصلاح کنید.`;
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

  const applyOpts = { force };

  type ExtendedRunner = typeof runnerService & {
    applyHumanOverrideToDecision?: typeof runnerService.applyHumanOverrideToDecision;
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

  if (hasHumanOverride && typeof extRunner.applyHumanOverrideToDecision === "function") {
    const ov = await extRunner.applyHumanOverrideToDecision(decisionId, {
      finalPrice: body.finalPrice,
      useDisplayDiscount: body.useDisplayDiscount,
      basePrice: body.basePrice,
      discountPct: body.discountPct,
      campaignType: body.campaignType,
    });
    if (!ov.ok) {
      const msg = ov.message || "خطا در ثبت ویرایش دستی";
      return NextResponse.json({ ok: false, error: msg, message: msg }, { status: 400 });
    }
  }

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
