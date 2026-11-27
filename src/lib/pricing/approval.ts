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

/** Check the final checkout price against the current purchase cost and profit floor. */
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

  const invalid = !Number.isSafeInteger(finalPrice) || finalPrice <= 0;
  const unknown = !Number.isFinite(effectiveCost) || effectiveCost <= 0;
  const isBelowCost = !invalid && !unknown && (strictAboveCost ? finalPrice <= effectiveCost : finalPrice < effectiveCost);
  const isBelowFloor = !invalid && (isBelowCost || finalPrice < effectiveFloor);
  const status = invalid ? "blocked_invalid_price" : unknown ? "blocked_unknown_cost"
    : isBelowCost ? "blocked_below_cost" : isBelowFloor ? "blocked_below_floor" : "safe";
  const reasons = {
    blocked_invalid_price: "قیمت فروش باید عدد صحیح و مثبت باشد",
    blocked_unknown_cost: "پیش از اعمال قیمت، بهای خرید یا تأمین کالا را ثبت کنید",
    blocked_below_cost: "قیمت فروش باید بالاتر از بهای خرید یا تأمین کالا باشد",
    blocked_below_floor: "قیمت فروش از کف سود مجاز کمتر است",
    safe: null,
  };
  const loss = Math.max(0, effectiveCost - (invalid ? 0 : finalPrice));
  return {
    ok: status === "safe", status, isBelowCost, isBelowFloor, isCostUnknown: unknown,
    authorizedOverride: false, effectiveCost, effectiveFloor, inventoryCost: invCost, replacementCost: repCost,
    lossAmountToman: invalid ? 0 : loss, lossPct: unknown || invalid ? 0 : loss / effectiveCost * 100,
    reason: reasons[status], auditRecord: null,
  };
}
