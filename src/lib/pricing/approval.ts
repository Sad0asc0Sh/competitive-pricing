/**
 * ۴.۱.۲ — گیت حداقل حاشیه برای «اعمال خودکار».
 *
 * پیش‌فرض profitApproveMarginPct=0 یعنی رفتار ۴.۱.۱: هر قیمت بالای کف سود، اگر
 * ناظر/گاردها ریویو نخواسته باشند، خودکار اعمال می‌شود. اگر اپراتور عددی مثبت
 * بگذارد، حاشیه‌ی کمتر از آن به صف بازبینی می‌رود. این تابع خالص است تا بدون
 * دیتابیس تست شود و منطق runner/گزارش یکسان بماند.
 */
export interface ApproveMarginInput {
  approveMarginPct: number
  netMarginPct: number
  strictlyAboveCost: boolean
  autoApply: boolean
  needsReview: boolean
  rejectedBySupervisor: boolean
  isProvisional: boolean
  hasPrice: boolean
}

export interface ApproveMarginResult {
  needsReview: boolean
  reason: string | null
}

export function evaluateApproveMargin(input: ApproveMarginInput): ApproveMarginResult {
  const threshold = Math.max(0, Number(input.approveMarginPct) || 0)
  const margin = Number(input.netMarginPct) || 0
  if (
    threshold <= 0 ||
    !input.hasPrice ||
    !input.strictlyAboveCost ||
    !input.autoApply ||
    input.needsReview ||
    input.rejectedBySupervisor ||
    input.isProvisional
  ) {
    return { needsReview: false, reason: null }
  }
  if (margin >= threshold) return { needsReview: false, reason: null }
  return {
    needsReview: true,
    reason: `حاشیه‌ی سود ${margin.toFixed(1)}% کمتر از حد تأیید خودکار ${threshold}% است — نیازمند بازبینی`,
  }
}
