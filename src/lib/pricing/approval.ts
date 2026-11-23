import { computeHardFloorPrice } from "./sourcing";
import type {
  BelowCostAuthorization,
  DecisionFloorSafetyInput,
  DecisionFloorSafetyResult,
} from "./types";

/**
 * ۴.۱.۲ / ۴.۲.۰ — گیت حداقل حاشیه برای «اعمال خودکار» و کنترل مجوز رسمی فروش زیر کف/قیمت تمام‌شده.
 *
 * پیش‌فرض profitApproveMarginPct=0 یعنی رفتار ۴.۱.۱: هر قیمت بالای کف سود، اگر
 * ناظر/گاردها ریویو نخواسته باشند، خودکار اعمال می‌شود. اگر اپراتور عددی مثبت
 * بگذارد، حاشیه‌ی کمتر از آن به صف بازبینی می‌رود. این تابع خالص است تا بدون
 * دیتابیس تست شود و منطق runner/گزارش یکسان بماند.
 */
export interface ApproveMarginInput {
  approveMarginPct: number;
  netMarginPct: number;
  strictlyAboveCost: boolean;
  autoApply: boolean;
  needsReview: boolean;
  rejectedBySupervisor: boolean;
  isProvisional: boolean;
  hasPrice: boolean;
}

export interface ApproveMarginResult {
  needsReview: boolean;
  reason: string | null;
}

export function evaluateApproveMargin(input: ApproveMarginInput): ApproveMarginResult {
  const threshold = Math.max(0, Number(input.approveMarginPct) || 0);
  const margin = Number(input.netMarginPct) || 0;
  if (
    threshold <= 0 ||
    !input.hasPrice ||
    !input.strictlyAboveCost ||
    !input.autoApply ||
    input.needsReview ||
    input.rejectedBySupervisor ||
    input.isProvisional
  ) {
    return { needsReview: false, reason: null };
  }
  if (margin >= threshold) return { needsReview: false, reason: null };
  return {
    needsReview: true,
    reason: `حاشیه‌ی سود ${margin.toFixed(1)}% کمتر از حد تأیید خودکار ${threshold}% است — نیازمند بازبینی`,
  };
}

export interface ValidatedBelowCostAuth {
  valid: boolean;
  allowBelowCost: boolean;
  allowBelowFloor: boolean;
  authorizedBy: string | null;
  reason: string | null;
  policyCode: string | null;
  maxLossPct: number;
  errorReason: string | null;
}

const INVALID_ACTORS = new Set([
  "",
  "none",
  "null",
  "undefined",
  "anonymous",
  "anon",
  "system",
  "auto",
]);

/**
 * اعتبارسنجی مجوز صریح، مستند و قابل ممیزی برای فروش استثنایی زیر قیمت تمام‌شده یا زیر کف سود.
 * اکشن عادی `force` هرگز جایگزین این مجوز نمی‌شود.
 */
export function validateBelowCostAuthorization(
  auth: BelowCostAuthorization | null | undefined,
  context?: {
    finalPrice?: number | null;
    effectiveCost?: number | null;
    effectiveFloor?: number | null;
    requireBelowCost?: boolean;
  },
): ValidatedBelowCostAuth {
  const allowBelowCost = Boolean(auth?.allowBelowCost);
  const allowBelowFloor = Boolean(auth?.allowBelowFloor || auth?.allowBelowCost);
  const rawReason = String(auth?.reason ?? auth?.belowCostReason ?? "").trim();
  const rawActor = String(auth?.authorizedBy ?? "").trim();
  const rawPolicy = String(auth?.policyCode ?? "manual_executive_override").trim() || "manual_executive_override";
  const maxLossPct =
    auth?.maxLossPct != null && Number.isFinite(Number(auth.maxLossPct))
      ? Math.min(100, Math.max(0, Number(auth.maxLossPct)))
      : 50;

  const needsBelowCost = Boolean(context?.requireBelowCost);
  if (needsBelowCost && !allowBelowCost) {
    return {
      valid: false,
      allowBelowCost,
      allowBelowFloor,
      authorizedBy: null,
      reason: null,
      policyCode: null,
      maxLossPct,
      errorReason: "فروش زیر قیمت تمام‌شده نیازمند پرچم صریح allowBelowCost=true است",
    };
  }

  if (!allowBelowCost && !allowBelowFloor) {
    return {
      valid: false,
      allowBelowCost: false,
      allowBelowFloor: false,
      authorizedBy: null,
      reason: null,
      policyCode: null,
      maxLossPct,
      errorReason: "هیچ مجوز صریحی برای عبور از کف سود/قیمت تمام‌شده ارسال نشده است",
    };
  }

  if (rawReason.length < 5) {
    return {
      valid: false,
      allowBelowCost,
      allowBelowFloor,
      authorizedBy: null,
      reason: null,
      policyCode: null,
      maxLossPct,
      errorReason: "ثبت دلیل مکتوب و معتبر (حداقل ۵ کاراکتر) برای ممیزی فروش زیر کف/هزینه الزامی است",
    };
  }

  if (rawActor.length < 2 || INVALID_ACTORS.has(rawActor.toLowerCase())) {
    return {
      valid: false,
      allowBelowCost,
      allowBelowFloor,
      authorizedBy: null,
      reason: rawReason,
      policyCode: null,
      maxLossPct,
      errorReason: "شناسه تاییدکننده مجاز (authorizedBy) برای ثبت در گزارش ممیزی الزامی است",
    };
  }

  if (
    context?.effectiveCost != null &&
    context.effectiveCost > 0 &&
    context?.finalPrice != null &&
    Number.isFinite(context.finalPrice) &&
    context.finalPrice < context.effectiveCost
  ) {
    const lossPct = ((context.effectiveCost - context.finalPrice) / context.effectiveCost) * 100;
    if (lossPct > maxLossPct + 1e-6) {
      return {
        valid: false,
        allowBelowCost,
        allowBelowFloor,
        authorizedBy: rawActor,
        reason: rawReason,
        policyCode: rawPolicy,
        maxLossPct,
        errorReason: `میزان زیان (${lossPct.toFixed(1)}%) از سقف زیان مجاز سیاست (${maxLossPct}%) بیشتر است`,
      };
    }
  }

  return {
    valid: true,
    allowBelowCost,
    allowBelowFloor,
    authorizedBy: rawActor,
    reason: rawReason,
    policyCode: rawPolicy,
    maxLossPct,
    errorReason: null,
  };
}

/**
 * ارزیابی جامع حفاظت از قیمت تمام‌شده (انبار + ریپلیس) و کف سود برای اعمال تصمیم‌ها (`applyDecision` و اجرای خودکار).
 * - `force: true` عادی تنها مجوز عبور از وضعیت `pending_review`/`rejected` ناظر است و هرگز اجازهٔ فروش زیر قیمت تمام‌شده یا کف سود را نمی‌دهد.
 * - فروش زیر قیمت تمام‌شده فقط با مجوز رسمی، دلیل ممیزی و تاییدکننده مشخص (`validateBelowCostAuthorization`) مجاز است.
 * - در صورت نامشخص بودن قیمت تمام‌شده (`effectiveCost <= 0`)، اعمال خودکار مسدود است مگر سیاست صریح `allowMarketMakerWithoutCost` با کف امن بازار فعال باشد یا مجوز ممیزی ثبت شود.
 */
export function evaluateDecisionFloorSafety(input: DecisionFloorSafetyInput): DecisionFloorSafetyResult {
  const finalPrice = Number(input.finalPrice);
  const invCost = Math.max(
    0,
    Math.round(Number(input.inventoryCost) || 0),
    Math.round(Number(input.manualCostPrice) || 0),
  );
  const repCost = Math.max(0, Math.round(Number(input.replacementCost) || 0));
  const decCost = Math.max(0, Math.round(Number(input.effectiveCostPrice) || 0));
  const effectiveCost = Math.max(invCost, repCost, decCost);

  const strictAboveCost = input.strictAboveCost !== false;
  const computedFloor =
    effectiveCost > 0
      ? computeHardFloorPrice({
          effectiveCostPrice: effectiveCost,
          minMarginPct: Math.max(0, Number(input.minMarginPct) || 0),
          minProfitAmountToman: Math.max(0, Number(input.minProfitAmountToman) || 0),
          fixedCostToman: Math.max(0, Number(input.fixedCostToman) || 0),
          finalStep: Math.max(1, Number(input.finalStep) || 1000),
          psychological: input.psychological ?? "none",
          strictAboveCost,
        })
      : 0;

  const effectiveFloor = Math.max(
    0,
    Math.round(Number(input.hardFloorPrice) || 0),
    Math.round(Number(input.currentHardFloorPrice) || 0),
    computedFloor,
  );

  if (!Number.isFinite(finalPrice) || finalPrice <= 0) {
    return {
      ok: false,
      status: "blocked_invalid_price",
      isBelowCost: false,
      isBelowFloor: false,
      isCostUnknown: effectiveCost <= 0,
      authorizedOverride: false,
      effectiveCost,
      effectiveFloor,
      inventoryCost: invCost,
      replacementCost: repCost,
      lossAmountToman: 0,
      lossPct: 0,
      reason: "قیمت نهایی تصمیم نامعتبر یا غیرمثبت است",
      auditRecord: null,
    };
  }

  const mergedAuth: BelowCostAuthorization = {
    ...(input.authorization ?? {}),
    allowBelowCost: input.allowBelowCost ?? input.authorization?.allowBelowCost,
    allowBelowFloor: input.allowBelowFloor ?? input.authorization?.allowBelowFloor,
    reason: input.reason ?? input.belowCostReason ?? input.authorization?.reason ?? input.authorization?.belowCostReason,
    belowCostReason: input.belowCostReason ?? input.authorization?.belowCostReason,
    authorizedBy: input.authorizedBy ?? input.authorization?.authorizedBy,
    policyCode: input.policyCode ?? input.authorization?.policyCode,
    maxLossPct: input.maxLossPct ?? input.authorization?.maxLossPct,
  };

  if (effectiveCost <= 0) {
    const mmAllowed =
      Boolean(input.allowMarketMakerWithoutCost) &&
      Boolean(input.usedMarketConsensusFloor) &&
      !input.isProvisional &&
      effectiveFloor > 0 &&
      finalPrice >= effectiveFloor &&
      (input.minConfidenceAutoApply == null ||
        (input.confidence != null && input.confidence >= input.minConfidenceAutoApply));

    if (mmAllowed) {
      return {
        ok: true,
        status: "safe",
        isBelowCost: false,
        isBelowFloor: false,
        isCostUnknown: true,
        authorizedOverride: false,
        effectiveCost: 0,
        effectiveFloor,
        inventoryCost: invCost,
        replacementCost: repCost,
        lossAmountToman: 0,
        lossPct: 0,
        reason: null,
        auditRecord: null,
      };
    }

    const authCheck = validateBelowCostAuthorization(mergedAuth, {
      finalPrice,
      effectiveCost: 0,
      effectiveFloor,
      requireBelowCost: true,
    });

    if (authCheck.valid && authCheck.allowBelowCost && (effectiveFloor <= 0 || finalPrice >= effectiveFloor || authCheck.allowBelowFloor)) {
      return {
        ok: true,
        status: "authorized_below_cost",
        isBelowCost: false,
        isBelowFloor: effectiveFloor > 0 && finalPrice < effectiveFloor,
        isCostUnknown: true,
        authorizedOverride: true,
        effectiveCost: 0,
        effectiveFloor,
        inventoryCost: invCost,
        replacementCost: repCost,
        lossAmountToman: 0,
        lossPct: 0,
        reason: `اعمال قیمت بدون بهای تمام‌شده با مجوز ممیزی (${authCheck.authorizedBy}): ${authCheck.reason}`,
        auditRecord: {
          authorizedBy: authCheck.authorizedBy!,
          reason: authCheck.reason!,
          policyCode: authCheck.policyCode!,
          finalPrice,
          effectiveCost: 0,
          effectiveFloor,
          lossAmountToman: 0,
          lossPct: 0,
          timestamp: new Date().toISOString(),
        },
      };
    }

    return {
      ok: false,
      status: "blocked_unknown_cost",
      isBelowCost: false,
      isBelowFloor: effectiveFloor > 0 && finalPrice < effectiveFloor,
      isCostUnknown: true,
      authorizedOverride: false,
      effectiveCost: 0,
      effectiveFloor,
      inventoryCost: invCost,
      replacementCost: repCost,
      lossAmountToman: 0,
      lossPct: 0,
      reason:
        "قیمت تمام‌شده/تامین کالا نامشخص است (cost_unknown) — فروش خودکار یا تایید بدون ثبت قیمت خرید یا مجوز رسمی ممیزی مجاز نیست",
      auditRecord: null,
    };
  }

  const isBelowCost = strictAboveCost ? finalPrice <= effectiveCost : finalPrice < effectiveCost;
  const isBelowFloor = isBelowCost || (effectiveFloor > 0 && finalPrice < effectiveFloor);
  const lossAmountToman = Math.max(0, effectiveCost - finalPrice);
  const lossPct = effectiveCost > 0 ? Math.max(0, (lossAmountToman / effectiveCost) * 100) : 0;

  if (isBelowCost) {
    const authCheck = validateBelowCostAuthorization(mergedAuth, {
      finalPrice,
      effectiveCost,
      effectiveFloor,
      requireBelowCost: true,
    });

    if (!authCheck.valid) {
      return {
        ok: false,
        status: "blocked_below_cost",
        isBelowCost: true,
        isBelowFloor: true,
        isCostUnknown: false,
        authorizedOverride: false,
        effectiveCost,
        effectiveFloor,
        inventoryCost: invCost,
        replacementCost: repCost,
        lossAmountToman,
        lossPct,
        reason:
          `قیمت نهایی (${finalPrice.toLocaleString("fa-IR")}) مساوی یا کمتر از قیمت تمام‌شده مؤثر (${effectiveCost.toLocaleString("fa-IR")} تومان) است — ` +
          `${authCheck.errorReason ?? "فروش با ضرر بدون مجوز رسمی allowBelowCost، دلیل ممیزی و تاییدکننده مجاز مسدود است"}`,
        auditRecord: null,
      };
    }

    return {
      ok: true,
      status: "authorized_below_cost",
      isBelowCost: true,
      isBelowFloor: true,
      isCostUnknown: false,
      authorizedOverride: true,
      effectiveCost,
      effectiveFloor,
      inventoryCost: invCost,
      replacementCost: repCost,
      lossAmountToman,
      lossPct,
      reason: `مجوز استثنایی فروش زیر قیمت تمام‌شده توسط «${authCheck.authorizedBy}» (${authCheck.policyCode}): ${authCheck.reason}`,
      auditRecord: {
        authorizedBy: authCheck.authorizedBy!,
        reason: authCheck.reason!,
        policyCode: authCheck.policyCode!,
        finalPrice,
        effectiveCost,
        effectiveFloor,
        lossAmountToman,
        lossPct,
        timestamp: new Date().toISOString(),
      },
    };
  }

  if (isBelowFloor) {
    const authCheck = validateBelowCostAuthorization(mergedAuth, {
      finalPrice,
      effectiveCost,
      effectiveFloor,
      requireBelowCost: false,
    });

    if (!authCheck.valid) {
      return {
        ok: false,
        status: "blocked_below_floor",
        isBelowCost: false,
        isBelowFloor: true,
        isCostUnknown: false,
        authorizedOverride: false,
        effectiveCost,
        effectiveFloor,
        inventoryCost: invCost,
        replacementCost: repCost,
        lossAmountToman: 0,
        lossPct: 0,
        reason:
          `قیمت نهایی (${finalPrice.toLocaleString("fa-IR")}) کمتر از کف سود مجاز (${effectiveFloor.toLocaleString("fa-IR")} تومان) است — ` +
          `${authCheck.errorReason ?? "عبور از کف سود نیازمند مجوز صریح، دلیل ممیزی و تاییدکننده مجاز است"}`,
        auditRecord: null,
      };
    }

    return {
      ok: true,
      status: "authorized_below_floor",
      isBelowCost: false,
      isBelowFloor: true,
      isCostUnknown: false,
      authorizedOverride: true,
      effectiveCost,
      effectiveFloor,
      inventoryCost: invCost,
      replacementCost: repCost,
      lossAmountToman: 0,
      lossPct: 0,
      reason: `مجوز عبور از کف سود توسط «${authCheck.authorizedBy}» (${authCheck.policyCode}): ${authCheck.reason}`,
      auditRecord: {
        authorizedBy: authCheck.authorizedBy!,
        reason: authCheck.reason!,
        policyCode: authCheck.policyCode!,
        finalPrice,
        effectiveCost,
        effectiveFloor,
        lossAmountToman: 0,
        lossPct: 0,
        timestamp: new Date().toISOString(),
      },
    };
  }

  return {
    ok: true,
    status: "safe",
    isBelowCost: false,
    isBelowFloor: false,
    isCostUnknown: false,
    authorizedOverride: false,
    effectiveCost,
    effectiveFloor,
    inventoryCost: invCost,
    replacementCost: repCost,
    lossAmountToman: 0,
    lossPct: 0,
    reason: null,
    auditRecord: null,
  };
}
