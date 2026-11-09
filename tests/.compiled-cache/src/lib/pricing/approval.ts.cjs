"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateApproveMargin = evaluateApproveMargin;
function evaluateApproveMargin(input) {
    const threshold = Math.max(0, Number(input.approveMarginPct) || 0);
    const margin = Number(input.netMarginPct) || 0;
    if (threshold <= 0 ||
        !input.hasPrice ||
        !input.strictlyAboveCost ||
        !input.autoApply ||
        input.needsReview ||
        input.rejectedBySupervisor ||
        input.isProvisional) {
        return { needsReview: false, reason: null };
    }
    if (margin >= threshold)
        return { needsReview: false, reason: null };
    return {
        needsReview: true,
        reason: `حاشیه‌ی سود ${margin.toFixed(1)}% کمتر از حد تأیید خودکار ${threshold}% است — نیازمند بازبینی`,
    };
}
