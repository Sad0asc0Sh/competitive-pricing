"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.register = register;
/**
 * زمان‌بند داخلی: هر ۶۰ ثانیه tickScheduler را صدا می‌زند (فقط در runtime نود).
 * برای محیط‌های serverless، به‌جای این از cron خارجی → GET /api/scheduler/tick استفاده کنید.
 */
async function register() {
    if (process.env.NEXT_RUNTIME !== "nodejs")
        return;
    if (process.env.DISABLE_INTERNAL_SCHEDULER === "1")
        return;
    const g = globalThis;
    if (g.__pricingSchedulerStarted)
        return;
    g.__pricingSchedulerStarted = true;
    const { tickScheduler } = await Promise.resolve().then(() => __importStar(require("@/lib/services/scheduler")));
    const tick = async () => {
        try {
            await tickScheduler();
        }
        catch (e) {
            console.error("[scheduler] tick failed:", e);
        }
    };
    setTimeout(tick, 15000);
    setInterval(tick, 60000);
}
