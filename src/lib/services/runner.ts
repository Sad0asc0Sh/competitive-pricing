import { db } from "@/db";
import {
  competitorOffers,
  discountCampaigns,
  priceDecisions,
  priceRuns,
  products,
  schedules,
  type PriceDecision,
  type Product,
} from "@/db/schema";
import { aiEnabled, verifyTorobMatchesWithAI } from "@/lib/ai/client";
import { resolveSubqRuntime } from "@/lib/ai/config";
import { evaluateApproveMargin, evaluateDecisionFloorSafety } from "@/lib/pricing/approval";
import { pickCampaign } from "@/lib/pricing/campaigns";
import { calibrateBaseForPct } from "@/lib/pricing/discount";
import { runPricingPipeline } from "@/lib/pricing/engine";
import { summarizeOwnPriceHistory } from "@/lib/pricing/own-price-history";
import { isMarketMakerWithoutCostEnabled, resolveSupplyCost } from "@/lib/pricing/sourcing";
import {
  classifyThreeZoneScore,
  enrichSupervisorWithSubqApi,
  formatSupervisorRejectMessage,
} from "@/lib/pricing/systemone-supervisor";
import type { PricingProfileConfig, PricingResult, RawOffer, SupplierQuote } from "@/lib/pricing/types";
import { fetchFromSource, isAllowedSourceType } from "@/lib/sources/registry";
import { buildIdempotencyKey, pushToStore, type PushResult } from "@/lib/store/connectors";
import { and, asc, eq, gt, gte, inArray, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import { ensureDefaults, getProfileConfig, logActivity } from "./bootstrap";

const PG_INT4_MIN = -2_147_483_648;
const PG_INT4_MAX = 2_147_483_647;

/** تبدیل ایمن مقادیر موتور به عدد صحیح/اعشاری معتبر قبل از درج در دیتابیس (NaN/Infinity/overflow هرگز درج نشود) */
export const safeInt = (v: number | null | undefined): number | null => {
  if (v == null || !Number.isFinite(v)) return null;
  const rounded = Math.round(v);
  if (!Number.isFinite(rounded)) return null;
  return Math.max(PG_INT4_MIN, Math.min(PG_INT4_MAX, rounded));
};
export const safeReal = (v: number | null | undefined, fallback = 0): number =>
  v == null || !Number.isFinite(v) ? fallback : v;
const safeDate = (v: unknown): Date | null =>
  v instanceof Date && Number.isFinite(v.getTime()) ? v : null;

const DEFAULT_INTERVAL_MINUTES = 180;
const MAX_AUTO_SYNC_ATTEMPTS = 5;

export type RunMode = "live" | "shadow" | "simulate";
export type ValidationSource = "live_torob" | "shadow_torob" | "simulated";

export interface RunOptions {
  trigger?: "manual" | "schedule" | "api" | "shadow";
  triggeredBy?: "manual" | "scheduled" | "schedule" | "api" | "shadow";
  runMode?: RunMode;
  isSimulated?: boolean;
  productIds?: number[];
  category?: string;
  scheduleId?: number;
  profileId?: number;
  /** اعمال روی رنج مشخصی از کارت‌های محصول (۱-مبنا: از کارت شماره X تا کارت شماره Y) */
  cardRangeFrom?: number;
  cardRangeTo?: number;
  /** پیشنهادهای دستی بازار (فقط برای اجرای تک‌محصولی یا شبیه‌سازی) */
  manualOffers?: RawOffer[] | Record<number, RawOffer[]>;
  /** پیشنهادهای دستی لیست همکاران (در صورت ارسال در لحظه اجرا) */
  manualSupplierQuotes?: SupplierQuote[];
}

export interface RunSummary {
  runId: number;
  runMode?: RunMode;
  isSimulated?: boolean;
  total: number;
  applied: number;
  pendingReview: number;
  failed: number;
  pendingSync?: number;
  syncFailed?: number;
  skippedLocked?: number;
  decisionIds: number[];
  lastError?: string | null;
}

export interface ApplyDecisionOptions {
  force?: boolean;
  campaignEndsAt?: Date | null;
}

export interface ApplyDecisionResult {
  ok: boolean;
  message: string;
  code?: string;
  status?: string;
  pushStatus?: string;
  push?: PushResult;
  idempotencyKey?: string;
  confirmedPrice?: number;
}

/** نامزد اعمال در پایان اجرا (فاز ۴) — push تا پس از تخصیص صندلی منتخب‌ها عقب انداخته شد (P0-4) */
interface DeferredApply {
  decisionId: number;
  campaignEndsAt: Date | null;
}

/** نامزد تخصیص صندلی «منتخب‌ها» (showInFeatured) برای هر کمپین — نواری‌شدن رتبه‌محور */
interface FeaturedCandidate {
  decisionId: number;
  productId: number;
  sku: string;
  campaignId: number;
  rankKey: number;
  netMarginPct: number;
}

interface ProcessOutcome {
  id: number;
  productId: number;
  status: string;
  errorHint?: string | null;
  deferred?: DeferredApply;
  featuredCandidate?: FeaturedCandidate;
}

interface OwnDiscountContext {
  ownStableHigh7d: number | null;
  ownAvg7d: number | null;
}

/**
 * قفل نرم تک‌محصولی (P0-5): با یک UPDATE اتمی قفل «۵ دقیقه‌ای» گرفته می‌شود؛
 * اجرای موازی/کلاسترِ هم‌زمان هر محصول را حداکثر یک‌بار استعلام می‌کند.
 */
async function tryLockProduct(productId: number): Promise<{ locked: boolean; error?: string }> {
  try {
    const res = await db.execute(
      sql`update products set locked_until = now() + interval '5 minutes' where id = ${productId} and (locked_until is null or locked_until <= now()) returning id`,
    );
    return { locked: (res.rows?.length ?? 0) > 0 };
  } catch (e) {
    // ۴.۱.۱: پس از مهاجرت 0001، نبود ستون یا هر خطای قفل نباید fail-open شود.
    // محصول در این اجرا skip می‌شود تا هرگز دو اجرای هم‌زمان روی یک محصول قیمت نگذارند.
    return { locked: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function unlockProduct(productId: number): Promise<void> {
  try {
    await db.execute(sql`update products set locked_until = null where id = ${productId}`);
  } catch {
    // unlock نباید جریان را بشکند؛ قفل TTL خودش آزاد می‌شود
  }
}

/**
 * مرجع تخفیف بخش رو. (P3): بالاترین قیمت خودیِ «دوام‌یافته» در پنجره ۷ روزی + میانگین ۷ روزی.
 * ۴.۱.۱: دوام از فاصله‌ی هر ردیف تا ردیف بعدی سنجیده می‌شود (نه قدمت خود ردیف)، و فقط
 * تصمیم‌های `pushed` که واقعاً به فروشگاه رسیده‌اند مرجع‌اند؛ `skipped` هرگز.
 */
async function computeOwnDiscountContext(
  productId: number,
  windowDays: number,
  holdHours: number,
): Promise<OwnDiscountContext> {
  const now = new Date();
  const since = new Date(now.getTime() - Math.max(1, windowDays) * 86_400_000);
  try {
    const rows = await db
      .select({
        finalPrice: priceDecisions.finalPrice,
        createdAt: priceDecisions.createdAt,
        pushStatus: priceDecisions.pushStatus,
      })
      .from(priceDecisions)
      .where(
        and(
          eq(priceDecisions.productId, productId),
          eq(priceDecisions.status, "applied"),
          eq(priceDecisions.pushStatus, "pushed"),
          gte(priceDecisions.createdAt, since),
        ),
      )
      .orderBy(asc(priceDecisions.createdAt));

    return summarizeOwnPriceHistory(rows, { now, holdHours, windowDays });
  } catch {
    return { ownStableHigh7d: null, ownAvg7d: null };
  }
}

/**
 * ۴.۲.۱: قیمت‌هایی که خودمان اخیراً داشته‌ایم (برای گارد «پژواک قیمت خودی» در موتور): قیمت فعلی + قیمت نهایی
 * تصمیم‌های applied با push موفق در `days` روز اخیر. پنجره بلند است چون ترب قیمت فروشگاه را با تأخیر می‌خواند
 * (ساعت‌ها تا روزها) و پیشنهاد خودیِ ناشناخته ممکن است هنوز قیمت چند push قبل را نشان دهد.
 */
async function loadOwnRecentPrices(
  productId: number,
  currentPrice: number | null | undefined,
  days = 14,
): Promise<number[]> {
  const out = new Set<number>();
  const add = (v: unknown) => {
    const n = Math.round(Number(v));
    if (Number.isFinite(n) && n > 0) out.add(n);
  };
  add(currentPrice);
  try {
    const since = new Date(Date.now() - Math.max(1, days) * 86_400_000);
    const rows = await db
      .select({ finalPrice: priceDecisions.finalPrice })
      .from(priceDecisions)
      .where(
        and(
          eq(priceDecisions.productId, productId),
          eq(priceDecisions.status, "applied"),
          eq(priceDecisions.pushStatus, "pushed"),
          gte(priceDecisions.createdAt, since),
        ),
      );
    for (const r of rows) add(r.finalPrice);
  } catch {
    // گارد کمکی است؛ خطای دیتابیس جریان قیمت‌گذاری را نمی‌شکند
  }
  return Array.from(out);
}

/**
 * بازیابی و همگام‌سازی مجدد تصمیم‌های در انتظار پوش (`pending_sync` / `sync_failed`)
 * و تصمیم‌های قدیمی `applied` که `push_status` آن‌ها هنوز `pushed` نشده است.
 */
export async function recoverStuckAppliedDecisions(limit = 50): Promise<number> {
  const cutoff = new Date(Date.now() - 10 * 60_000);
  try {
    const stuck = await db
      .select()
      .from(priceDecisions)
      .where(
        and(
          or(
            and(eq(priceDecisions.status, "applied"), isNull(priceDecisions.pushStatus), lt(priceDecisions.createdAt, cutoff)),
            and(
              inArray(priceDecisions.status, ["pending_sync", "sync_failed"]),
              lt(priceDecisions.pushAttempts, MAX_AUTO_SYNC_ATTEMPTS),
              lt(priceDecisions.createdAt, cutoff),
            ),
          ),
        ),
      )
      .orderBy(asc(priceDecisions.id))
      .limit(limit);

    for (const d of stuck) {
      // اگر تصمیم جدیدتری برای همین محصول با موفقیت push شده، بازپخش تصمیم قدیمی
      // قیمت فروشگاه را عقب می‌برد؛ قدیمی را superseded علامت می‌زنیم.
      const [newerPushed] = await db
        .select({ id: priceDecisions.id })
        .from(priceDecisions)
        .where(
          and(
            eq(priceDecisions.productId, d.productId),
            eq(priceDecisions.status, "applied"),
            eq(priceDecisions.pushStatus, "pushed"),
            gt(priceDecisions.id, d.id),
          ),
        )
        .limit(1);
      if (newerPushed) {
        await db
          .update(priceDecisions)
          .set({
            status: "superseded",
            pushStatus: "superseded",
            pushError: `تصمیم جدیدتر #${newerPushed.id} قبلاً push شده است (recovery superseded)`,
            lastPushAttemptAt: new Date(),
          })
          .where(eq(priceDecisions.id, d.id));
        continue;
      }

      const res = await applyDecision(d.id, null);
      if (!res.ok) {
        await db
          .update(priceDecisions)
          .set({
            status: res.push?.skipped ? "pending_sync" : "sync_failed",
            pushStatus: res.push?.skipped ? "skipped" : "failed",
            pushError: res.message,
            lastPushAttemptAt: new Date(),
          })
          .where(eq(priceDecisions.id, d.id));
      }
    }
    if (stuck.length) {
      await logActivity("runner", `بازیابی ${stuck.length} تصمیم همگام‌نشده با فروشگاه انجام شد`, {
        decisionIds: stuck.map((d) => d.id),
      });
    }
    return stuck.length;
  } catch {
    return 0;
  }
}

export async function runPricing(opts: RunOptions = {}): Promise<RunSummary> {
  await ensureDefaults();
  await recoverStuckAppliedDecisions();

  const rawTrigger = opts.trigger ?? opts.triggeredBy ?? "manual";
  const normalizedTrigger = rawTrigger === "scheduled" ? "schedule" : rawTrigger;
  const hasManualOffers =
    Array.isArray(opts.manualOffers)
      ? opts.manualOffers.length > 0
      : Boolean(opts.manualOffers && Object.keys(opts.manualOffers).length > 0);
  const isSimulated = Boolean(opts.isSimulated || opts.runMode === "simulate" || hasManualOffers);
  const runMode: RunMode = isSimulated
    ? "simulate"
    : opts.runMode === "shadow" || normalizedTrigger === "shadow"
      ? "shadow"
      : "live";
  const validationSource: ValidationSource = isSimulated
    ? "simulated"
    : runMode === "shadow"
      ? "shadow_torob"
      : "live_torob";

  const hasRange = Boolean((opts.cardRangeFrom && opts.cardRangeFrom > 0) || (opts.cardRangeTo && opts.cardRangeTo > 0));
  let targets: Product[];
  if (opts.productIds?.length && normalizedTrigger !== "schedule") {
    targets = await db.select().from(products).where(inArray(products.id, opts.productIds)).orderBy(asc(products.id));
    targets = targets.filter((p) => p.status !== "paused");
  } else if (hasRange && !opts.category) {
    // شماره‌گذاری کارت‌ها (#1..#N) در صفحه محصولات بر اساس تمام ردیف‌ها (جز متوقف‌ها هنگام اجرا) است؛
    // ابتدا برش بازه را مطابق اندیس صفحه محصولات انجام می‌دهیم و سپس کارت‌های paused را کنار می‌گذاریم.
    const allRows = await db.select().from(products).orderBy(asc(products.id));
    const startIdx = Math.max(0, (opts.cardRangeFrom ?? 1) - 1);
    const endIdx = opts.cardRangeTo && opts.cardRangeTo > 0 ? opts.cardRangeTo : allRows.length;
    targets = allRows.slice(startIdx, endIdx).filter((p) => p.status !== "paused");
  } else {
    // همهٔ محصولات فعال و در انتظار بازبینی (paused هرگز استعلام نمی‌شود)
    const conds = [ne(products.status, "paused")];
    if (opts.category) conds.push(eq(products.category, opts.category));
    targets = await db.select().from(products).where(and(...conds)).orderBy(asc(products.id));
    if (hasRange) {
      const startIdx = Math.max(0, (opts.cardRangeFrom ?? 1) - 1);
      const endIdx = opts.cardRangeTo && opts.cardRangeTo > 0 ? opts.cardRangeTo : targets.length;
      targets = targets.slice(startIdx, endIdx);
    }
  }

  const [run] = await db
    .insert(priceRuns)
    .values({
      trigger: normalizedTrigger,
      runMode,
      isSimulated,
      scheduleId: opts.scheduleId,
      totalProducts: targets.length,
    })
    .returning();

  const summary: RunSummary = {
    runId: run.id,
    runMode,
    isSimulated,
    total: targets.length,
    applied: 0,
    pendingReview: 0,
    failed: 0,
    pendingSync: 0,
    syncFailed: 0,
    decisionIds: [],
    lastError: null,
  };

  const campaigns = await db.select().from(discountCampaigns);
  const outcomes: ProcessOutcome[] = [];
  let skippedLocked = 0;

  const concurrency = Math.max(1, Math.min(8, Number(process.env.PRICING_RUN_CONCURRENCY ?? 3) || 3));
  let nextIdx = 0;
  const worker = async () => {
    for (;;) {
      const idx = nextIdx++;
      if (idx >= targets.length) return;
      const product = targets[idx];
      const cardIndex = (opts.cardRangeFrom ? Math.max(1, opts.cardRangeFrom) : 1) + idx;
      const lock = await tryLockProduct(product.id);
      if (!lock.locked) {
        if (lock.error) {
          summary.failed++;
          const lockErrMsg = `خطای قفل دیتابیس محصول ${product.sku}: ${lock.error}`;
          if (!summary.lastError) summary.lastError = lockErrMsg;
          await logActivity("runner", lockErrMsg, { productId: product.id, runId: run.id }, "error");
          try {
            const [failedRow] = await db
              .insert(priceDecisions)
              .values({
                runId: run.id,
                productId: product.id,
                source: product.sourceType || "torob",
                offersTotal: 0,
                offersUsed: 0,
                confidence: 0,
                status: "failed",
                pushError: lockErrMsg,
                isSimulated,
                validationSource,
                steps: [
                  {
                    step: "error",
                    title: "خطا در قفل‌گذاری محصول پیش از استعلام",
                    message: lockErrMsg,
                    level: "error",
                  },
                ],
              })
              .returning({ id: priceDecisions.id });
            if (failedRow) summary.decisionIds.push(failedRow.id);
          } catch {
            // ثبت خطا نباید جریان کل را بشکند
          }
        } else {
          skippedLocked++;
          await logActivity(
            "runner",
            `قفل فعال محصول ${product.sku} — این اجرا رد شد (skipped_locked، قفل ۵ دقیقه‌ای نرم)`,
            { productId: product.id, runId: run.id },
            "warn",
          );
        }
        continue;
      }
      try {
        const productManualOffers = Array.isArray(opts.manualOffers)
          ? opts.manualOffers
          : opts.manualOffers?.[product.id];
        const outcome = await priceOneProduct(product, run.id, campaigns, cardIndex, {
          manualOffers: productManualOffers,
          manualSupplierQuotes: opts.manualSupplierQuotes,
          runMode,
          isSimulated,
          profileIdOverride: opts.profileId,
        });
        outcomes.push(outcome);
        summary.decisionIds.push(outcome.id);
        if (outcome.status === "pending_sync") {
          // شمارش نهایی applied در فاز ۴ پس از تایید واقعی فروشگاه انجام می‌شود
        } else if (outcome.status === "pending_review") {
          summary.pendingReview++;
        } else {
          summary.failed++;
          if (outcome.errorHint && !summary.lastError) {
            summary.lastError = outcome.errorHint;
          }
        }
      } catch (e) {
        summary.failed++;
        const errMsg = e instanceof Error ? e.message : String(e);
        if (!summary.lastError) summary.lastError = errMsg;
        await logActivity(
          "runner",
          `خطا در قیمت‌گذاری محصول ${product.sku}: ${errMsg}`,
          { productId: product.id, runId: run.id },
          "error",
        );
        try {
          const [failedRow] = await db
            .insert(priceDecisions)
            .values({
              runId: run.id,
              productId: product.id,
              source: product.sourceType || "torob",
              offersTotal: 0,
              offersUsed: 0,
              confidence: 0,
              status: "failed",
              pushError: errMsg,
              isSimulated,
              validationSource,
              steps: [
                {
                  step: "error",
                  title: "خطای غیرمنتظره هنگام استعلام کارت",
                  message: errMsg,
                  level: "error",
                },
              ],
            })
            .returning({ id: priceDecisions.id });
          if (failedRow) summary.decisionIds.push(failedRow.id);
        } catch {
          // ثبت خطای تصمیم نباید باعث توقف سایر کارت‌ها شود
        }
      } finally {
        await unlockProduct(product.id);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, targets.length)) }, () => worker()));

  summary.skippedLocked = skippedLocked;
  if (targets.length === 0 && !summary.lastError) {
    summary.lastError = "هیچ محصول فعالی در این بازه/فیلتر یافت نشد (بررسی کنید کارت متوقف/paused نباشد)";
  } else if (skippedLocked > 0 && outcomes.length === 0 && !summary.lastError) {
    summary.lastError = `${skippedLocked} کارت به‌دلیل قفل ۵ دقیقه‌ای اجرای قبلی رد شد (برای باز کردن فوری، «ریست قفل ترب» را بزنید)`;
  }

  // ---------- فاز ۲: تخصیص صندلی «منتخب‌ها» (showInFeatured) — نوار رتبه‌محور و تعیین‌شده (P0-4)
  const featuredCandidates: FeaturedCandidate[] = [];
  for (const o of outcomes) {
    if (o.featuredCandidate) featuredCandidates.push(o.featuredCandidate);
  }
  featuredCandidates.sort(
    (a, b) => a.rankKey - b.rankKey || b.netMarginPct - a.netMarginPct || a.sku.localeCompare(b.sku),
  );
  if (featuredCandidates.length) {
    const perCampaignSeats: Record<number, number> = {};
    for (const c of featuredCandidates) {
      const maxCards = campaigns.find((x) => x.id === c.campaignId)?.maxCards ?? 0;
      if (maxCards > 0 && (perCampaignSeats[c.campaignId] ?? 0) >= maxCards) {
        // صندلی تمام شد — showInFeatured تصمیمِ فاز ۱ (false) می‌ماند
        await db.update(priceDecisions).set({ showInFeatured: false }).where(eq(priceDecisions.id, c.decisionId));
        continue;
      }
      perCampaignSeats[c.campaignId] = (perCampaignSeats[c.campaignId] ?? 0) + 1;
      await db.update(priceDecisions).set({ showInFeatured: true }).where(eq(priceDecisions.id, c.decisionId));
    }
  }

  // ---------- فاز ۴: اعمال و push به فروشگاه (فقط در اجرای live و پس از تایید واقعی فروشگاه)
  for (const o of outcomes) {
    if (o.status === "pending_sync" && o.deferred && runMode === "live" && !isSimulated) {
      const pushRes = await applyDecision(o.deferred.decisionId, o.deferred.campaignEndsAt);
      if (pushRes.ok) {
        o.status = "applied";
        summary.applied++;
      } else if (pushRes.push?.skipped) {
        o.status = "pending_sync";
        summary.pendingSync = (summary.pendingSync ?? 0) + 1;
        summary.failed++;
        if (!summary.lastError) summary.lastError = pushRes.message;
      } else {
        o.status = "sync_failed";
        summary.syncFailed = (summary.syncFailed ?? 0) + 1;
        summary.failed++;
        if (!summary.lastError) summary.lastError = pushRes.message;
      }
    }
  }

  // ---------- فاز ۵: گارد انقضا کمپین زمان‌دار (P0-6) — فقط در اجرای live
  if (runMode === "live" && !isSimulated) {
    let intervalMinutes = DEFAULT_INTERVAL_MINUTES;
    try {
      if (opts.scheduleId) {
        const s = await db
          .select({ v: schedules.intervalMinutes })
          .from(schedules)
          .where(eq(schedules.id, opts.scheduleId))
          .limit(1);
        intervalMinutes = s[0]?.v ?? intervalMinutes;
      } else {
        const s = await db
          .select({ v: schedules.intervalMinutes })
          .from(schedules)
          .where(eq(schedules.active, true))
          .orderBy(asc(schedules.id))
          .limit(1);
        intervalMinutes = s[0]?.v ?? intervalMinutes;
      }
    } catch {
      intervalMinutes = DEFAULT_INTERVAL_MINUTES;
    }
    const appliedProductIds = new Set(outcomes.filter((o) => o.status === "applied").map((o) => o.productId));
    await runExpiryGuard(targets, appliedProductIds, intervalMinutes, run.id);
  }

  await db
    .update(priceRuns)
    .set({
      status: "done",
      applied: summary.applied,
      pendingReview: summary.pendingReview,
      failed: summary.failed,
      error: summary.lastError,
      finishedAt: new Date(),
    })
    .where(eq(priceRuns.id, run.id));

  await logActivity(
    "runner",
    `اجرای #${run.id} (${runMode}) پایان یافت: ${summary.applied} اعمال تاییدشده، ${summary.pendingReview} بازبینی، ${summary.failed} رد/خطا${skippedLocked ? `، ${skippedLocked} قفل‌دار رد شد` : ""}`,
    { ...summary, skippedLocked },
  );
  return summary;
}

async function runExpiryGuard(
  targets: Product[],
  appliedProductIds: Set<number>,
  intervalMinutes: number,
  runId: number,
): Promise<void> {
  const now = Date.now();
  const horizonMs = Math.max(10, intervalMinutes * 2) * 60_000;
  for (const p of targets) {
    if (appliedProductIds.has(p.id)) continue;
    const endsAt = p.currentCampaignEndsAt;
    const isActiveCampaign = Boolean(p.currentCampaign && p.currentCampaign !== "none" && endsAt);
    if (!isActiveCampaign || !endsAt) continue;
    const remainingMs = endsAt.getTime() - now;
    if (remainingMs <= 0 || remainingMs > horizonMs) continue;

    const safePrice = p.currentFinalPrice || p.currentBasePrice || 0;
    const { effectiveCostPrice: realCost, hardFloorPrice: hardFloor } = await currentSupply(p);

    // ۴.۱.۱: هرگز هزینه‌ی ساختگی (قیمت × ۰٫۸۵) به فروشگاه نرود؛ اگر نه هزینه واقعی
    // داریم و نه خط قرمز، push نمی‌کنیم (سند فروشگاه با داده نادرست آلوده نمی‌شود).
    if (safePrice <= 0 || realCost <= 0) {
      await logActivity(
        "runner",
        `گارد انقضا: برای محصول ${p.sku} هزینه واقعی/خط قرمز موجود نیست — push «بدون کمپین» انجام نشد`,
        { productId: p.id, runId, safePrice, realCost, hardFloor },
        "warn",
      );
      continue;
    }

    const pushRes = await pushToStore({
      productId: p.id,
      sku: p.sku,
      storeExternalId: p.storeExternalId,
      ...(realCost > 0 ? { effectiveCostPrice: realCost } : {}),
      hardFloorPrice: hardFloor,
      monitoredMarketCeiling: safePrice,
      basePrice: safePrice,
      finalPrice: safePrice,
      discountPct: 0,
      campaignType: "none",
      campaignName: null,
      badgeTheme: "green-orange",
      showInFeatured: false,
      campaignEndsAt: null,
      decisionId: p.lastDecisionId ?? 0,
      confidence: 1,
    });
    await logActivity(
      "runner",
      `گارد انقضا: کمپین ${p.currentCampaign} محصول ${p.sku} در ${Math.round(remainingMs / 60000)} دقیقه منقضی می‌شود و این اجرا جایگزین فعال برای آن اعمال نکرد — وضعیت «بدون کمپین» با قیمت فعلی به فروشگاه ارسال شد (${pushRes.message})`,
      { productId: p.id, runId, remainingMs: Math.round(remainingMs / 60000) },
      pushRes.ok ? "info" : "warn",
    );
  }
}

const SUPERVISOR_REASON_PREFIXES = [
  "رد توسط ناظر بالاسر SystemOne",
  "رد توسط ناظر SystemOne",
  "رد توسط ناظر به دلیل وتوی",
  "ناظر بالاسر SystemOne تصمیم را در بازه ریویو قرار داد",
];

function syncSupervisorAfterEnrichment(
  result: PricingResult,
  sourceOk: boolean,
  allowCostlessAutoApply = false,
): void {
  const sup = result.supervisor;
  result.reviewReasons = result.reviewReasons.filter(
    (r) => !SUPERVISOR_REASON_PREFIXES.some((p) => r.startsWith(p)),
  );
  if (sup.verdict === "reject") {
    result.reviewReasons.push(formatSupervisorRejectMessage(sup));
  } else if (sup.verdict === "review") {
    result.reviewReasons.push(
      `ناظر بالاسر SystemOne تصمیم را در بازه ریویو قرار داد (${sup.overallScorePct}% بین ${sup.rejectBelowPct}% و ${sup.approveAbovePct}%)`,
    );
  }

  result.rejectedBySupervisor = sup.verdict === "reject";
  result.needsReview =
    result.reviewReasons.length > 0 ||
    !sourceOk ||
    (result.supply.effectiveCostPrice <= 0 && !allowCostlessAutoApply) ||
    result.rejectedBySupervisor ||
    sup.verdict !== "approve";

  const level: "info" | "warn" | "error" =
    sup.verdict === "reject" ? "error" : sup.verdict === "review" ? "warn" : "info";
  const apiBadge =
    sup.apiStatus === "ok"
      ? `API زنده SubQ (${sup.model})`
      : sup.apiStatus === "error"
        ? `خطای اتصال API ناظر: ${sup.apiError ?? "نامشخص"}`
        : sup.apiStatus === "not_configured"
          ? "توکن SubQ ثبت نشده — موتور آنی محلی فعال است"
          : "موتور آنی محلی (بدون فراخوانی API)";
  const stepLog = {
    step: "supervisor",
    title: "ناظر و تصمیم‌گیرنده بالاسر (SubQ SystemOne — ۴ مقیاس)",
    message:
      `${sup.summary} | وضعیت اتصال: ${apiBadge} | ` +
      Object.values(sup.gates)
        .map((g) => `${g.key}: ${g.scorePct}% (noul=${g.noul.toFixed(2)} → ${g.verdict})`)
        .join(" · "),
    level,
    data: {
      overallScorePct: sup.overallScorePct,
      overallNoul: sup.overallNoul,
      verdict: sup.verdict,
      gates: sup.gates,
      apiStatus: sup.apiStatus ?? null,
      apiError: sup.apiError ?? null,
    },
  };

  const idx = result.steps.findIndex((s) => s.step === "supervisor");
  if (idx >= 0) result.steps[idx] = stepLog;
  else result.steps.push(stepLog);
}

/**
 * وضعیت اولیه تصمیم قیمت‌گذاری پس از اجرای موتور:
 * با قفل قطعی نظارت انسانی، هیچ تصمیمی به صورت خودکار به `pending_sync` نمی‌رود
 * و تمام تصمیم‌های دارای قیمت معتبر (غیرردشده) به `pending_review` هدایت می‌شوند.
 */
export function resolveInitialDecisionStatus(input: {
  rejectedBySupervisor: boolean;
  hasFinalPrice: boolean;
}): "rejected" | "failed" | "pending_review" {
  if (input.rejectedBySupervisor) return "rejected";
  if (!input.hasFinalPrice) return "failed";
  return "pending_review";
}

async function priceOneProduct(
  product: Product,
  runId: number,
  campaigns: (typeof discountCampaigns.$inferSelect)[],
  cardIndex: number,
  opts?: {
    manualOffers?: RawOffer[];
    manualSupplierQuotes?: SupplierQuote[];
    runMode?: RunMode;
    isSimulated?: boolean;
    profileIdOverride?: number;
  },
): Promise<ProcessOutcome> {
  const manualOffers = opts?.manualOffers;
  const manualSupplierQuotes = opts?.manualSupplierQuotes;
  const runMode: RunMode = opts?.runMode ?? (manualOffers?.length ? "simulate" : "live");
  const isSimulated = Boolean(opts?.isSimulated || runMode === "simulate" || (manualOffers && manualOffers.length > 0));
  const validationSource: ValidationSource = isSimulated
    ? "simulated"
    : runMode === "shadow"
      ? "shadow_torob"
      : "live_torob";

  if (!manualOffers?.length && !isAllowedSourceType(product.sourceType)) {
    throw new Error(
      `منبع «${product.sourceType}» برای محصول ${product.sku} مجاز نیست؛ فقط منبع واقعی «ترب» پشتیبانی می‌شود. منبع محصول را از صفحه محصولات اصلاح کنید.`,
    );
  }

  const { config } = await getProfileConfig(opts?.profileIdOverride ?? product.profileId);
  const supplierQuotes = manualSupplierQuotes ?? product.supplierQuotes ?? [];

  // مرجع تخفیف own_price_7d (P3): تاریخچه قیمت خودی دوام‌یافته در پنجره ۷ روزی
  const discountContext = await computeOwnDiscountContext(
    product.id,
    config.discount.ownPriceWindowDays ?? 7,
    config.discount.ownPriceMinHoldHours ?? 48,
  );

  const source = await fetchFromSource(
    {
      id: product.id,
      sku: product.sku,
      name: product.name,
      category: product.category,
      sourceType: product.sourceType,
      torobUrl: product.torobUrl,
      torobPrk: product.torobPrk,
      torobDetailsUrl: product.torobDetailsUrl,
      costPrice: product.costPrice,
      supplierQuotes,
      currentFinalPrice: product.currentFinalPrice,
      matchConfig: {
        rejectBelowPct:
          config.supervisor?.gates?.identity_match?.rejectBelowPct ?? config.supervisor?.rejectBelowPct ?? 45,
        approveAbovePct:
          config.supervisor?.gates?.identity_match?.approveAbovePct ?? config.supervisor?.approveAbovePct ?? 80,
        minSellerCount: config.filters.minSellerCount,
        aiIdentityEnabled: Boolean(config.ai.enabled && config.ai.torobMatchEnabled === true),
      },
    },
    manualOffers,
  );

  const ownRecentPrices = await loadOwnRecentPrices(product.id, product.currentFinalPrice);

  const result = runPricingPipeline(source, {
    productId: product.id,
    productName: product.name,
    sku: product.sku,
    costPrice: product.costPrice,
    supplierQuotes,
    minMarginPctOverride: product.minMarginPct,
    minProfitAmountOverride: product.minProfitAmount,
    currentFinalPrice: product.currentFinalPrice,
    ownRecentPrices,
    category: product.category,
    torobUrlManual: Boolean(product.torobUrl && product.torobUrl.trim()),
    config,
    discountContext,
  });

  const allowCostless = isMarketMakerWithoutCostEnabled(config);

  // اگر PRK از قبل قفل بوده و گیت هویت در بازه مبهم (review) افتاده، فقط در صورت فعال‌بودن صریح در پروفایل از AI استفاده کن
  if (
    source.ok &&
    source.prk &&
    source.productTitle &&
    !source.meta?.aiIdentityCheck &&
    result.supervisor.gates.identity_match?.verdict === "review" &&
    config.ai.enabled &&
    config.ai.torobMatchEnabled === true &&
    (await aiEnabled())
  ) {
    const prices = source.offers.map((o) => o.price).filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => a - b);
    const repPrice = prices.length ? prices[Math.floor((prices.length - 1) / 2)] : null;
    const aiCheck = await verifyTorobMatchesWithAI({
      productName: product.name,
      sku: product.sku,
      category: product.category,
      anchorPriceToman: result.supply.effectiveCostPrice > 0 ? result.supply.effectiveCostPrice : product.currentFinalPrice,
      candidates: [
        {
          prk: source.prk,
          titleFa: source.productTitle,
          titleEn: source.productTitleEn ?? null,
          sellerCount: source.totalSellerCount,
          priceToman: repPrice,
          available: true,
        },
      ],
    });
    if (aiCheck) {
      result.steps.push({
        step: "ai_identity",
        title: "تطبیق پنل ادغام ترب با هوش مصنوعی",
        message:
          aiCheck.verdict === "match"
            ? `تایید پنل ادغام ترب توسط AI: ${aiCheck.reasoning}`
            : aiCheck.verdict === "no_match"
              ? `عدم تطابق پنل قفل‌شده ترب: ${aiCheck.reasoning}`
              : `نظر مبهم AI در مورد پنل ترب: ${aiCheck.reasoning}`,
        level: aiCheck.verdict === "no_match" ? "error" : aiCheck.verdict === "uncertain" ? "warn" : "info",
        data: { ...aiCheck },
      });

      const idGate = result.supervisor.gates.identity_match;
      if (aiCheck.verdict === "no_match") {
        idGate.scorePct = Math.min(idGate.scorePct, 25);
        idGate.noul = Math.round((idGate.scorePct / 100) * 100) / 100;
        idGate.verdict = "reject";
        idGate.reason = `رد پنل ترب توسط هوش مصنوعی: ${aiCheck.reasoning}`;
        result.supervisor.verdict = "reject";
        result.rejectedBySupervisor = true;
        result.needsReview = true;
        result.reviewReasons.push(`رد پنل قفل‌شده ترب توسط هوش مصنوعی: ${aiCheck.reasoning}`);
      } else if (aiCheck.verdict === "match") {
        idGate.scorePct = Math.max(idGate.scorePct, 88);
        idGate.noul = Math.round((idGate.scorePct / 100) * 100) / 100;
        idGate.verdict = classifyThreeZoneScore(idGate.scorePct, idGate.rejectBelowPct, idGate.approveAbovePct);
        idGate.reason = `تایید پنل ادغام ترب با هوش مصنوعی (${idGate.scorePct}%)`;
        result.reviewReasons = result.reviewReasons.filter((r) => !r.startsWith("امتیاز تطابق هویت کالا در بازه ریویو"));
        const allGates = Object.values(result.supervisor.gates);
        const totalW = allGates.reduce((s, g) => s + (g.weight || 0.25), 0) || 1;
        const wPct = Math.round(allGates.reduce((s, g) => s + g.scorePct * (g.weight || 0.25), 0) / totalW);
        result.supervisor.overallScorePct = wPct;
        result.supervisor.overallNoul = Math.round((wPct / 100) * 100) / 100;
        result.supervisor.verdict = allGates.some((g) => g.verdict === "review")
          ? "review"
          : classifyThreeZoneScore(wPct, result.supervisor.rejectBelowPct, result.supervisor.approveAbovePct);
      }
    }
  }

  if (config.supervisor.enabled) {
    const subqRuntime = await resolveSubqRuntime(config.supervisor);
    result.supervisor = await enrichSupervisorWithSubqApi(result.supervisor, {
      ...config.supervisor,
      apiKey: subqRuntime.apiKey,
      baseUrl: subqRuntime.baseUrl,
      model: subqRuntime.model,
    });
    syncSupervisorAfterEnrichment(result, source.ok, allowCostless);
  }

  const sourceExt = source as typeof source & {
    sourceStatus?: string;
    isChallenged?: boolean;
    degraded?: boolean;
  };
  const sourceDegradedOrChallenged = Boolean(
    sourceExt.isChallenged ||
      sourceExt.degraded ||
      source.meta?.challenged ||
      source.meta?.degraded ||
      sourceExt.sourceStatus === "challenged" ||
      sourceExt.sourceStatus === "degraded" ||
      sourceExt.sourceStatus === "error",
  );
  if (sourceDegradedOrChallenged) {
    result.needsReview = true;
    const reason = "منبع استعلام ترب در وضعیت چالش ضدربات یا داده ناقص (degraded/challenged) قرار دارد — نیازمند بازبینی انسانی";
    if (!result.reviewReasons.includes(reason)) {
      result.reviewReasons.push(reason);
    }
  }

  // گارد امنیتی مضاعف برای جلوگیری از تشخیص اشتباه کارت و اعمال خودکار کالاهای بدون قیمت خرید:
  // اگر محصول فاقد قیمت خرید همکار است (effectiveCost = 0) و هنوز لینک/PRK ترب برای آن توسط مدیر تایید نشده است (!product.torobPrk)،
  // بار اول حتماً به صف بازبینی (pending_review) می‌رود تا کارت پیدا شده در ترب توسط مدیر تایید شود و سرخود وارد کمپین‌های سایت نگردد!
  const unverifiedFirstSearchWithoutCost =
    !product.torobPrk && !product.torobUrl && result.supply.effectiveCostPrice <= 0;
  if (unverifiedFirstSearchWithoutCost && !result.rejectedBySupervisor) {
    result.needsReview = true;
    result.reviewReasons.push(
      "اولین استعلام خودکار بدون لینک ترب و بدون قیمت خرید همکار — نیازمند یک‌بار تایید کارت ترب در صف بازبینی",
    );
  }

  const strictlyAboveCost =
    result.finalPrice != null &&
    result.supply.effectiveCostPrice > 0 &&
    result.supply.hardFloorPrice > 0 &&
    result.finalPrice >= result.supply.hardFloorPrice &&
    result.finalPrice > result.supply.effectiveCostPrice;

  // ۴.۱.۲ (تصمیم #۲): حداقل حاشیه‌ی سود برای اعمال خودکار. پیش‌فرض ۰ = رفتار قبلی؛
  // اگر اپراتور profitApproveMarginPct را مثبت کند، قیمت‌های بالای کف سود ولی با
  // حاشیه‌ی کم به‌جای اعمال خودکار به صف بازبینی می‌روند (برای کالاهای کم‌حاشیه محافظه‌کارانه‌تر).
  const marginGate = evaluateApproveMargin({
    approveMarginPct: config.guards.profitApproveMarginPct,
    netMarginPct: Number(result.position.netMarginPct) || 0,
    strictlyAboveCost,
    autoApply: false,
    needsReview: result.needsReview,
    rejectedBySupervisor: Boolean(result.rejectedBySupervisor),
    isProvisional: Boolean(result.isProvisional),
    hasPrice: Boolean(result.finalPrice),
  });
  if (marginGate.needsReview) {
    result.needsReview = true;
    if (marginGate.reason) result.reviewReasons.push(marginGate.reason);
  }

  // نظارت انسانی قطعی: هیچ تصمیمی بدون تأیید مدیر در پنل قیمت‌گذاری خودکار به فروشگاه ارسال نمی‌شود
  const readyForApproval = Boolean(
    !result.rejectedBySupervisor &&
      result.finalPrice != null &&
      !result.needsReview &&
      !result.isProvisional &&
      strictlyAboveCost,
  );

  const status: string = resolveInitialDecisionStatus({
    rejectedBySupervisor: Boolean(result.rejectedBySupervisor),
    hasFinalPrice: Boolean(result.finalPrice),
  });
  if (status === "pending_review" && runMode === "live" && !isSimulated) {
    result.steps.push({
      step: "supervision_gate",
      title: "نظارت اجباری مدیر پیش از اعمال قیمت",
      message: readyForApproval
        ? "آماده تأیید سریع: محاسبات ریاضی، کف سود و تطابق کارت سالم است — منتظر تأیید شما در صف بازبینی"
        : "نیازمند بررسی هشدارها: پیش از اعمال روی سایت، دلایل بازبینی و رقبای ترب را بررسی یا قیمت را ویرایش کنید",
      level: readyForApproval ? "info" : "warn",
      data: {
        readyForApproval,
        reviewReasons: result.reviewReasons,
      },
    });
  }

  if (runMode === "shadow") {
    result.steps.push({
      step: "shadow_validation",
      title: "اجرای آزمایشی در سایه (Shadow Validation — داده واقعی ترب)",
      message: "تصمیم بر اساس مشاهدات واقعی ترب محاسبه و برای ممیزی/کالیبراسیون ثبت شد (بدون ارسال به فروشگاه)",
      level: "info",
      data: {
        runMode: "shadow",
        validationSource: "shadow_torob",
        isSimulated: false,
        wouldAutoApply: false,
      },
    });
  } else if (isSimulated) {
    result.steps.push({
      step: "simulation_guard",
      title: "گارد شبیه‌سازی (Simulated Run)",
      message: "این تصمیم با داده‌های شبیه‌سازی/دستی ساخته شده و از استخراج کالیبراسیون و پوش خودکار مستثنی است",
      level: "warn",
      data: {
        runMode: "simulate",
        validationSource: "simulated",
        isSimulated: true,
      },
    });
  }

  let campaignType = "none";
  let campaignName: string | null = null;
  let badgeTheme = "green-orange";
  let campaignEndsAt: Date | null = null;
  let campaignId: number | null = null;
  let pickShowInFeatured = false;

  // تخصیص کمپین فقط زمانی انجام می‌شود که تصمیم رد یا خطاددار نباشد!
  if (
    status !== "rejected" &&
    status !== "failed" &&
    strictlyAboveCost &&
    result.discountPct != null &&
    result.finalPrice
  ) {
    const pick = pickCampaign(campaigns, {
      discountPct: result.discountPct,
      category: product.category,
      productId: product.id,
      cardIndex,
      finalPrice: result.finalPrice,
      projectedLocalRank: result.position.projectedLocalRank,
      projectedNationalRank: result.position.projectedNationalRank,
      preferredCampaignType: product.preferredCampaignType,
      discountKind: result.discountReferenceKind ?? null,
      ownAvg7d: discountContext.ownAvg7d,
    });
    campaignType = pick.type;
    campaignName = pick.campaignName;
    badgeTheme = pick.badgeTheme;
    campaignEndsAt = pick.endsAt;
    campaignId = pick.campaignId;
    pickShowInFeatured = pick.showInFeatured && product.showInFeatured;

    // P0-3: پیوستگی تایمر — اگر کمپین همین نوع فعلی کتابستانِ سالم هنوز فعال باشد، تایمر دست نمی‌خورد (S3)
    if (
      pick.type !== "none" &&
      product.currentCampaign === pick.type &&
      product.currentCampaignEndsAt &&
      product.currentCampaignEndsAt.getTime() > Date.now()
    ) {
      pick.reason += " · تایمر کمپین فعلی ادامه دارد (reset نشد — پیوستگی تایمر)";
      campaignEndsAt = product.currentCampaignEndsAt;
      // تایمرِ فعلی حفظ شد → showInFeatured فعلی هم حفظ می‌شود (S3)
      pickShowInFeatured = product.currentShowInFeatured ?? pickShowInFeatured;
    }
    result.steps.push({
      step: "campaign",
      title: "انتخاب هوشمند از بین ۳ سیستم تخفیف",
      message: pick.reason,
      data: {
        type: pick.type,
        campaignName: pick.campaignName,
        badgeTheme: pick.badgeTheme,
        endsAt: campaignEndsAt?.toISOString() ?? null,
        showInFeaturedDesired: pickShowInFeatured,
        cardIndex,
      },
    });
  }

  const [decision] = await db
    .insert(priceDecisions)
    .values({
      runId,
      productId: product.id,
      source: source.source,
      offersTotal: safeInt(result.offersTotal) ?? 0,
      offersUsed: safeInt(result.offersUsed) ?? 0,
      effectiveCostPrice: safeInt(result.supply.effectiveCostPrice),
      hardFloorPrice: safeInt(result.supply.hardFloorPrice),
      lowestRaw: safeInt(result.lowestRaw),
      lowestValid: safeInt(result.lowestValid),
      localLowestValid: safeInt(result.position.localLowestPrice),
      marketMedian: safeInt(result.marketMedian),
      marketMean: safeInt(result.marketMean),
      referencePrice: safeInt(result.referencePrice),
      monitoredMarketCeiling: safeInt(result.floorCeiling.monitoredMarketCeiling),
      basePrice: safeInt(result.basePrice),
      finalPrice: safeInt(result.finalPrice),
      discountPct: safeReal(result.discountPct),
      campaignType,
      campaignName,
      badgeTheme,
      // P0-4: در فاز ۱ «دقیقی» false ثبت می‌شود؛ پس از اولود فاز ۲ صندلی‌ها واقعی می‌شود
      showInFeatured: false,
      strategy: result.strategy,
      competitionTier: result.position.competitionTier,
      projectedNationalRank: safeInt(result.position.projectedNationalRank),
      projectedLocalRank: safeInt(result.position.projectedLocalRank),
      // ۴.۱.۲ (N5): هر دو رتبه در تصمیم ذخیره می‌شوند تا رابط بازبینی هر دو را نشان دهد
      rankIncludingSuspect: safeInt(result.position.rankIncludingSuspect),
      totalSellersIncludingSuspect: safeInt(result.position.totalSellersIncludingSuspect) ?? 0,
      netProfitToman: safeInt(result.position.netProfitToman),
      netMarginPct: safeReal(result.position.netMarginPct),
      confidence: safeReal(result.confidence),
      engineVersion: config.engine?.version ?? "4.2.0",
      marketConflict: result.marketConflict ?? false,
      referenceKind: result.discountReferenceKind ?? "none",
      floorConfirmed: result.floorConfirmed ?? false,
      pushStatus: status === "pending_sync" ? "pending" : null,
      pushAttempts: 0,
      isSimulated,
      validationSource,
      status,
      steps: result.steps,
    })
    .returning();

  const idempotencyKey = buildIdempotencyKey({
    productId: product.id,
    sku: product.sku,
    basePrice: safeInt(result.basePrice) ?? 0,
    finalPrice: safeInt(result.finalPrice) ?? 0,
    discountPct: safeReal(result.discountPct),
    campaignType,
    decisionId: decision.id,
    confidence: decision.confidence,
  });
  await db
    .update(priceDecisions)
    .set({ idempotencyKey })
    .where(eq(priceDecisions.id, decision.id));

  // حذف تکرار در صف بازبینی: تصمیم‌های pending_review قدیمی‌ترِ همین محصول جایگزین می‌شوند تا هر محصول فقط ۱ کارت فعال داشته باشد
  if (status === "pending_review") {
    await db
      .update(priceDecisions)
      .set({
        status: "superseded",
        pushError: `جایگزین شده با تصمیم جدیدتر #${decision.id}`,
      })
      .where(
        and(
          eq(priceDecisions.productId, product.id),
          eq(priceDecisions.status, "pending_review"),
          lt(priceDecisions.id, decision.id),
        ),
      );
  }

  if (result.offers.length) {
    const offerValues = result.offers
      .map((o) => {
        const safeOfferPrice = safeInt(o.price);
        if (!safeOfferPrice || safeOfferPrice <= 0) return null;
        return {
          decisionId: decision.id,
          productId: product.id,
          shopName: o.shopName || "نامشخص",
          shopId: o.shopId ?? null,
          shopCity: o.shopCity ?? null,
          sellerType: o.sellerType ?? "online",
          shopScore: o.shopScore != null && Number.isFinite(o.shopScore) ? o.shopScore : null,
          isLocalCity: !!o.isLocalCity,
          priceUnreliable: !!o.priceUnreliable,
          price: safeOfferPrice,
          lastChangedAt: safeDate(o.lastChangedAt),
          isAd: !!o.isAd,
          inStock: o.inStock !== false,
          url: o.url ?? null,
          included: o.included,
          excludeReason: o.excludeReason ?? null,
          weight: safeReal(o.weight, 0),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    if (offerValues.length) {
      await db.insert(competitorOffers).values(offerValues);
    }
  }

  // قفل کردن PRK در دیتابیس فقط زمانی که تصمیم اعمال شده یا گیت تطابق هویت بالای آستانه تایید خودکار (approve) باشد!
  // A cached primary PRK skips discovery on the next run and loses the secondary panels.
  const combinedPanels = Array.isArray(source.meta?.panels) && source.meta.panels.length > 1;
  const identityApproved = source.ok && !isSimulated && !combinedPanels &&
    result.supervisor.gates.identity_match?.verdict === "approve";

  // P0-1 (M2): write-back قیمت خرید ممنوع. قیمت همکار فقط در replacementCost ثبت می‌شود؛
  // costPrice (هزینه موجودی) هرگز از لیست همکار بازنویسی نمی‌شود (INV-2).
  const lowestQuoteCost = safeInt(result.supply.lowestQuoteCost);
  const safeHardFloor = safeInt(result.supply.hardFloorPrice);
  const shouldStoreReplacement =
    (lowestQuoteCost ?? 0) > 0 &&
    (product.costPrice <= 0 || lowestQuoteCost! > product.costPrice);

  await db
    .update(products)
    .set({
      lastCheckedAt: new Date(),
      lastDecisionId: decision.id,
      updatedAt: new Date(),
      ...(shouldStoreReplacement
        ? {
            replacementCost: lowestQuoteCost!,
            replacementCostAt: new Date(),
          }
        : {}),
      selectedSupplierName: result.supply.selectedQuote?.supplierName ?? product.selectedSupplierName ?? null,
      ...(safeHardFloor && safeHardFloor > 0 ? { currentHardFloorPrice: safeHardFloor } : {}),
      ...(source.prk && !product.torobPrk && identityApproved ? { torobPrk: source.prk } : {}),
      ...(source.detailsUrl && !product.torobDetailsUrl && identityApproved
        ? { torobDetailsUrl: source.detailsUrl }
        : {}),
      ...(status === "pending_review" ? { status: "needs_review" } : {}),
    })
    .where(eq(products.id, product.id));

  // برگشت خروجی به‌همنه با فاز ۴ runner — applyDecision پس از تخصیص صندلی منتخب‌ها صدا زده می‌شود
  const deferred: DeferredApply | undefined =
    status === "pending_sync" ? { decisionId: decision.id, campaignEndsAt } : undefined;

  const featuredCandidate: FeaturedCandidate | undefined =
    status === "pending_sync" &&
    campaignId != null &&
    campaignType !== "none" &&
    (result.position.projectedLocalRank === 1 ||
      result.position.projectedNationalRank === 1 ||
      pickShowInFeatured)
      ? {
          decisionId: decision.id,
          productId: product.id,
          sku: product.sku,
          campaignId: campaignId as number,
          rankKey:
            result.position.projectedNationalRank === 1 || result.position.projectedLocalRank === 1 ? 0 : 1,
          netMarginPct: result.position.netMarginPct ?? 0,
        }
      : undefined;

  const errorHint =
    status === "rejected" || status === "failed"
      ? !source.ok && source.error
        ? source.error
        : result.rejectedBySupervisor
          ? formatSupervisorRejectMessage(result.supervisor)
          : result.reviewReasons[0] ??
            result.steps.find((s) => s.level === "error")?.message ??
            "داده کافی برای محاسبه قیمت یافت نشد"
      : null;

  return { id: decision.id, productId: product.id, status, errorHint, deferred, featuredCandidate };
}

/** آیا تصمیم توسط ناظر SystemOne رد شده؟ (وضعیت rejected یا لاگ supervisor با verdict=reject) */
export function isSupervisorRejected(d: {
  status: string;
  steps: { step: string; message?: string; data?: Record<string, unknown> }[];
}): boolean {
  if (d.status === "rejected") return true;
  const sup = d.steps.find((s) => s.step === "supervisor");
  if (!sup) return false;
  const verdict = (sup.data as { verdict?: string } | undefined)?.verdict;
  if (verdict === "reject") return true;
  if (typeof sup.message === "string" && sup.message.includes("⛔ رد کامل")) return true;
  return false;
}

function resolveApplyOptions(
  campaignEndsAtOrOpts?: Date | null | ApplyDecisionOptions,
  opts?: ApplyDecisionOptions,
): { campaignEndsAt: Date | null; opts: ApplyDecisionOptions } {
  if (
    campaignEndsAtOrOpts &&
    typeof campaignEndsAtOrOpts === "object" &&
    !(campaignEndsAtOrOpts instanceof Date)
  ) {
    return {
      campaignEndsAt: campaignEndsAtOrOpts.campaignEndsAt ?? null,
      opts: campaignEndsAtOrOpts,
    };
  }
  return {
    campaignEndsAt: (campaignEndsAtOrOpts as Date | null | undefined) ?? opts?.campaignEndsAt ?? null,
    opts: opts ?? {},
  };
}

export interface HumanDecisionOverride {
  finalPrice?: number | null;
  useDisplayDiscount?: boolean | null;
  basePrice?: number | null;
  discountPct?: number | null;
  campaignType?: string | null;
}

/** Resolve active supplier quotes again just before sending a price. */
async function currentSupply(p: Product) {
  const { config } = await getProfileConfig(p.profileId);
  const supply = resolveSupplyCost({
    manualCostPrice: p.costPrice, supplierQuotes: p.supplierQuotes,
    minMarginPctOverride: p.minMarginPct, minProfitAmountOverride: p.minProfitAmount, config,
  });
  return { effectiveCostPrice: Math.max(supply.effectiveCostPrice, p.costPrice),
    hardFloorPrice: Math.max(supply.hardFloorPrice, p.currentHardFloorPrice ?? 0), config };
}

async function decisionSafety(p: Product, d: PriceDecision, finalPrice: number) {
  const current = await currentSupply(p);
  const safety = evaluateDecisionFloorSafety({
    finalPrice, finalStep: 1,
    effectiveCostPrice: current.effectiveCostPrice > 0 ? Math.max(d.effectiveCostPrice ?? 0, current.effectiveCostPrice) : 0,
    hardFloorPrice: Math.max(d.hardFloorPrice ?? 0, current.hardFloorPrice),
  });
  return { safety, config: current.config };
}

async function validatePromotion(
  p: Product, d: PriceDecision, finalPrice: number, basePrice: number, discountPct: number,
  campaignType: string, config: PricingProfileConfig, manualSelection: boolean,
): Promise<{ error?: string; endsAt?: Date | null }> {
  if (!discountPct && campaignType === "none" && basePrice === finalPrice) return {};
  const evidence = d.steps?.find((s) => s.step === "discount")?.data;
  const reference = Number(evidence?.referencePrice);
  const kind = evidence?.referenceKind;
  if (config.discount.enabled === false || (kind !== "own_price_7d" && kind !== "market_p75") ||
      !Number.isFinite(reference) || basePrice > reference || basePrice <= finalPrice ||
      !Number.isInteger(discountPct) || discountPct < config.discount.minDiscountPct || discountPct > config.discount.maxDiscountPct ||
      Math.round(basePrice * (1 - discountPct / 100)) !== finalPrice) {
    return { error: "تخفیف با مرجع ثبت‌شده یا بازهٔ مجاز سازگار نیست. قیمت مستقیم را انتخاب کنید یا دوباره استعلام بگیرید." };
  }
  if (campaignType === "none") return {};
  const recorded = d.steps?.find(s => s.step === "campaign")?.data;
  const campaigns = await db.select().from(discountCampaigns).where(eq(discountCampaigns.type, campaignType));
  const history = campaignType === "flash"
    ? await computeOwnDiscountContext(p.id, config.discount.ownPriceWindowDays ?? 7, config.discount.ownPriceMinHoldHours ?? 48)
    : null;
  const pick = pickCampaign(campaigns, {
    productId: p.id, category: p.category, cardIndex: Number(recorded?.cardIndex) || 1,
    preferredCampaignType: manualSelection ? campaignType : p.preferredCampaignType,
    finalPrice, discountPct, discountKind: kind, ownAvg7d: history?.ownAvg7d,
    projectedNationalRank: d.projectedNationalRank, projectedLocalRank: d.projectedLocalRank,
  });
  if (pick.type !== campaignType || !pick.endsAt) return { error: "این قیمت شرایط کمپین انتخاب‌شده را ندارد" };
  const recordedEnd = recorded?.type === campaignType && typeof recorded.endsAt === "string"
    ? new Date(recorded.endsAt).getTime() : Infinity;
  const endsAt = new Date(Math.min(pick.endsAt.getTime(), recordedEnd));
  if (!(endsAt.getTime() > Date.now())) return { error: "بازهٔ کمپین تمام شده است؛ دوباره استعلام بگیرید" };
  return { endsAt };
}

export async function applyHumanOverrideToDecision(
  decisionId: number,
  override: HumanDecisionOverride,
): Promise<{ ok: boolean; finalPrice: number; message?: string }> {
  const [d] = await db.select().from(priceDecisions).where(eq(priceDecisions.id, decisionId)).limit(1);
  if (!d) return { ok: false, finalPrice: 0, message: "تصمیم یافت نشد" };
  const [p] = await db.select().from(products).where(eq(products.id, d.productId)).limit(1);
  if (!p) return { ok: false, finalPrice: 0, message: "محصول یافت نشد" };

  const nextFinal =
    override.finalPrice != null && Number.isFinite(Number(override.finalPrice)) && Number(override.finalPrice) > 0
      ? Math.round(Number(override.finalPrice))
      : Math.round(d.finalPrice ?? 0);
  if (nextFinal <= 0) {
    return { ok: false, finalPrice: 0, message: "قیمت نهایی یوزر نامعتبر است" };
  }

  let nextBase = nextFinal;
  let nextPct = 0;
  let nextCampaign = d.campaignType ?? "none";
  let nextCampaignName = d.campaignName;
  let nextBadge = d.badgeTheme ?? "green-orange";
  let floorConfirmed = false;

  const disableDiscount =
    override.useDisplayDiscount === false ||
    (override.discountPct != null && Number.isFinite(Number(override.discountPct)) && Number(override.discountPct) <= 0);

  if (disableDiscount) {
    nextBase = nextFinal;
    nextPct = 0;
    nextCampaign = "none";
    nextCampaignName = null;
  } else {
    const wantsDiscount =
      override.useDisplayDiscount === true ||
      (override.discountPct != null && Number(override.discountPct) > 0) ||
      (override.basePrice != null && Number(override.basePrice) > nextFinal) ||
      ((d.discountPct ?? 0) > 0 && (d.basePrice ?? 0) > nextFinal);

    if (wantsDiscount) {
      let pct =
        override.discountPct != null && Number.isFinite(Number(override.discountPct)) && Number(override.discountPct) > 0
          ? Math.max(1, Math.min(90, Math.round(Number(override.discountPct))))
          : override.basePrice != null && Number.isFinite(Number(override.basePrice)) && Number(override.basePrice) > nextFinal
            ? Math.max(1, Math.min(90, Math.floor(((Number(override.basePrice) - nextFinal) / Number(override.basePrice)) * 100)))
            : Math.max(1, Math.min(90, Math.round(d.discountPct ?? 10)));

      nextBase = calibrateBaseForPct(nextFinal, pct);
      nextPct = pct;
      floorConfirmed = Math.round(nextBase * (1 - nextPct / 100)) === nextFinal;

      if (override.campaignType && ["none", "flash", "featured", "timed_sale"].includes(override.campaignType)) {
        nextCampaign = override.campaignType;
        nextCampaignName =
          nextCampaign === "flash"
            ? "پیشنهاد لحظه‌ای"
            : nextCampaign === "featured"
              ? "پیشنهاد شگفت‌انگیز"
              : nextCampaign === "timed_sale"
                ? "فرصت زمان‌دار"
                : null;
        nextBadge =
          nextCampaign === "flash" ? "gold-red" : nextCampaign === "featured" ? "red-purple" : "green-orange";
      }
    }
  }

  const { safety, config } = await decisionSafety(p, d, nextFinal);
  if (!safety.ok) return { ok: false, finalPrice: nextFinal, message: safety.reason! };
  const manualSelection = nextCampaign !== d.campaignType ||
    d.steps.some(s => s.step === "human_edit" && s.data?.manualSelection === true);
  const promo = await validatePromotion(p, d, nextFinal, nextBase, nextPct, nextCampaign, config, manualSelection);
  if (promo.error) return { ok: false, finalPrice: nextFinal, message: promo.error };
  const effectiveCost = safety.effectiveCost;
  const netProfitToman = effectiveCost > 0 ? nextFinal - effectiveCost : 0;
  const netMarginPct = effectiveCost > 0 ? Math.round(((nextFinal - effectiveCost) / effectiveCost) * 10000) / 100 : 0;
  const unchanged = nextFinal === d.finalPrice && nextBase === d.basePrice &&
    nextCampaign === d.campaignType && nextPct === d.discountPct;
  const idempotencyKey = unchanged && d.idempotencyKey ? d.idempotencyKey
    : `decision-${d.id}-p${p.id}-${nextFinal}-${nextBase}-${nextPct}-${nextCampaign}`;

  const nextSteps = [
    ...(Array.isArray(d.steps) ? d.steps : []),
    {
      step: "human_edit",
      title: "ویرایش دستی مدیر پیش از تأیید",
      message:
        nextPct > 0
          ? `قیمت نهایی یوزر به ${nextFinal.toLocaleString("fa-IR")} تومان با ${nextPct}% تخفیف نمایشی (سقف ${nextBase.toLocaleString("fa-IR")} تومان · کمپین: ${nextCampaign}) تنظیم شد`
          : `قیمت مستقیم نهایی یوزر به ${nextFinal.toLocaleString("fa-IR")} تومان بدون تخفیف نمایشی تنظیم شد`,
      level: "info" as const,
      data: { finalPrice: nextFinal, basePrice: nextBase, discountPct: nextPct, campaignType: nextCampaign,
        manualSelection },
    },
  ];

  await db
    .update(priceDecisions)
    .set({
      finalPrice: nextFinal,
      basePrice: nextBase,
      discountPct: nextPct,
      campaignType: nextCampaign,
      campaignName: nextCampaignName,
      badgeTheme: nextBadge,
      floorConfirmed,
      netProfitToman,
      netMarginPct,
      idempotencyKey,
      steps: nextSteps,
    })
    .where(eq(priceDecisions.id, d.id));

  return { ok: true, finalPrice: nextFinal };
}

export async function applyDecision(
  decisionId: number,
  campaignEndsAtOrOpts?: Date | null | ApplyDecisionOptions,
  opts?: ApplyDecisionOptions,
): Promise<ApplyDecisionResult> {
  const { campaignEndsAt: requestedEnd, opts: resolvedOpts } = resolveApplyOptions(campaignEndsAtOrOpts, opts);

  const [d] = await db.select().from(priceDecisions).where(eq(priceDecisions.id, decisionId)).limit(1);
  if (!d || !d.finalPrice || !d.basePrice) {
    return { ok: false, code: "INVALID_DECISION", message: "تصمیم نامعتبر" };
  }
  const [p] = await db.select().from(products).where(eq(products.id, d.productId)).limit(1);
  if (!p) {
    return { ok: false, code: "PRODUCT_NOT_FOUND", message: "محصول یافت نشد" };
  }
  if (d.isSimulated || d.validationSource === "simulated" || d.source === "simulate") {
    return {
      ok: false,
      code: "SIMULATED_DECISION_BLOCKED",
      message: "اعمال تصمیم شبیه‌سازی‌شده (simulated) روی فروشگاه واقعی ممنوع است",
    };
  }
  if (d.source !== "torob" && d.source !== "manual") {
    return {
      ok: false,
      code: "INVALID_DECISION_SOURCE",
      message: `اعمال تصمیم با منبع «${d.source}» ممنوع است؛ فقط تصمیم‌های مبتنی بر داده واقعی ترب یا ورود دستی مجاز به ارسال به فروشگاه‌اند`,
    };
  }
  if (
    isSupervisorRejected({ status: d.status, steps: (d.steps ?? []) as { step: string; message?: string }[] }) &&
    !resolvedOpts.force
  ) {
    return {
      ok: false,
      code: "SUPERVISOR_REJECTED",
      message:
        "این تصمیم توسط ناظر SystemOne رد شده (امتیاز زیر آستانه رد) و قابل اعمال نیست. برای بازبینی، محصول را با منبع/قیمت اصلاح و دوباره استعلام بگیرید.",
    };
  }

  const { safety, config } = await decisionSafety(p, d, d.finalPrice);
  if (!safety.ok) return { ok: false, code: safety.status.toUpperCase(), message: safety.reason! };
  const { effectiveCost, effectiveFloor } = safety;
  const manualSelection = d.steps.some(s => s.step === "human_edit" && s.data?.manualSelection === true);
  const promo = await validatePromotion(p, d, d.finalPrice, d.basePrice, d.discountPct ?? 0, d.campaignType ?? "none", config, manualSelection);
  if (promo.error) return { ok: false, code: "INVALID_PROMOTION", message: promo.error };
  const campaignEndsAt = promo.endsAt && requestedEnd
    ? new Date(Math.min(requestedEnd.getTime(), promo.endsAt.getTime())) : promo.endsAt ?? null;

  const idempotencyKey =
    d.idempotencyKey ||
    buildIdempotencyKey({
      productId: p.id,
      sku: p.sku,
      basePrice: d.basePrice,
      finalPrice: d.finalPrice,
      discountPct: d.discountPct ?? 0,
      campaignType: d.campaignType ?? "none",
      decisionId: d.id,
      confidence: d.confidence,
    });

  const attemptTime = new Date();
  const push = await pushToStore({
    productId: p.id,
    sku: p.sku,
    storeExternalId: p.storeExternalId,
    effectiveCostPrice: effectiveCost,
    hardFloorPrice: effectiveFloor,
    monitoredMarketCeiling: d.monitoredMarketCeiling ?? d.basePrice,
    basePrice: d.basePrice,
    finalPrice: d.finalPrice,
    discountPct: d.discountPct ?? 0,
    campaignType: d.campaignType ?? "none",
    campaignName: d.campaignName,
    badgeTheme: d.badgeTheme ?? "green-orange",
    showInFeatured: d.showInFeatured ?? false,
    campaignEndsAt: campaignEndsAt ? campaignEndsAt.toISOString() : null,
    decisionId: d.id,
    idempotencyKey,
    confidence: d.confidence,
    projectedNationalRank: d.projectedNationalRank,
    projectedLocalRank: d.projectedLocalRank,
    competitionTier: d.competitionTier,
  });

  const nextAttempts = (d.pushAttempts ?? 0) + Math.max(1, push.attempts ?? 1);

  // اگر ارسال به فروشگاه تایید نشد (یا کانکتور فعال نبود)، هرگز قیمت محصول در دیتابیس محلی
  // به عنوان قیمت اعمال‌شده بازنویسی نمی‌شود و تصمیم برچسب applied نمی‌خورد!
  if (!push.ok || push.skipped) {
    const nextStatus = push.skipped ? "pending_sync" : "sync_failed";
    const nextPushStatus = push.skipped ? "skipped" : "failed";

    await db
      .update(priceDecisions)
      .set({
        status: nextStatus,
        pushStatus: nextPushStatus,
        pushError: push.message,
        pushAttempts: nextAttempts,
        lastPushAttemptAt: attemptTime,
        idempotencyKey,
      })
      .where(eq(priceDecisions.id, d.id));

    await logActivity(
      "apply",
      `عدم اعمال قیمت ${p.sku} در فروشگاه (${nextStatus}): ${push.message}`,
      {
        decisionId: d.id,
        productId: p.id,
        status: nextStatus,
        pushStatus: nextPushStatus,
        attempts: nextAttempts,
        code: push.code,
      },
      push.skipped ? "warn" : "error",
    );

    return {
      ok: false,
      code: push.code ?? (push.skipped ? "NO_ACTIVE_CONNECTOR" : "STORE_SYNC_FAILED"),
      status: nextStatus,
      pushStatus: nextPushStatus,
      message: push.message,
      push,
      idempotencyKey,
    };
  }

  const confirmedFinalPrice = push.confirmedPrice ?? d.finalPrice;
  // فقط پس از تایید قطعی فروشگاه، قیمت‌های فعلی محصول و وضعیت applied بروزرسانی می‌شوند
  await db
    .update(products)
    .set({
      currentBasePrice: d.basePrice,
      currentFinalPrice: confirmedFinalPrice,
      currentDiscountPct: d.discountPct,
      currentCampaign: d.campaignType,
      currentCampaignName: d.campaignName,
      currentBadgeTheme: d.badgeTheme ?? "green-orange",
      currentShowInFeatured: d.showInFeatured ?? false,
      // P0-3: تایمر کمپین روی خودِ محصول ذخیره می‌شود تا پیوستگی و گارد انقضا کار کند
      currentCampaignEndsAt: campaignEndsAt,
      lastDecisionId: d.id,
      needsRefresh: false,
      status: "active",
      updatedAt: new Date(),
    })
    .where(eq(products.id, p.id));

  await db
    .update(priceDecisions)
    .set({
      status: "applied",
      pushStatus: "pushed",
      pushError: null,
      pushedAt: attemptTime,
      lastPushAttemptAt: attemptTime,
      pushAttempts: nextAttempts,
      storeConfirmedPrice: confirmedFinalPrice,
      idempotencyKey,
    })
    .where(eq(priceDecisions.id, d.id));

  // ۴.۲.۱ (F5): در این ساختار، قیمت محصول فقط پس از تایید قطعی فروشگاه نوشته می‌شود (بالا)؛
  // بنابراین در شکست push، «قیمت فعلی» موتور همان قیمت قبل از تصمیم می‌ماند و اجرای بعد دوباره تلاش می‌کند.
  await logActivity(
    "apply",
    `قیمت ${p.sku}: سقف معیار ${d.basePrice} با ${d.discountPct}% تخفیف → کف تاییدشده ${confirmedFinalPrice} | کمپین: ${d.campaignType}${campaignEndsAt ? ` تا ${campaignEndsAt.toISOString()}` : ""} | رتبه مشهد: #${d.projectedLocalRank ?? "-"} — ${push.message}${resolvedOpts.force ? " (اعمال دستی با force)" : ""}`,
    {
      decisionId: d.id,
      productId: p.id,
      forced: !!resolvedOpts.force,
      idempotencyKey,
      confirmedPrice: confirmedFinalPrice,
      attempts: nextAttempts,
    },
    "info",
  );

  return {
    ok: true,
    code: push.code ?? "STORE_SYNC_CONFIRMED",
    status: "applied",
    pushStatus: "pushed",
    message: push.message,
    push,
    idempotencyKey,
    confirmedPrice: confirmedFinalPrice,
  };
}

export const applyDecisionToStore = applyDecision;

export async function retryDecisionSync(
  decisionId: number,
  opts?: ApplyDecisionOptions,
): Promise<ApplyDecisionResult> {
  const [d] = await db.select().from(priceDecisions).where(eq(priceDecisions.id, decisionId)).limit(1);
  if (!d) {
    return { ok: false, code: "DECISION_NOT_FOUND", message: "تصمیم یافت نشد" };
  }

  const [newerPushed] = await db
    .select({ id: priceDecisions.id })
    .from(priceDecisions)
    .where(
      and(
        eq(priceDecisions.productId, d.productId),
        eq(priceDecisions.status, "applied"),
        eq(priceDecisions.pushStatus, "pushed"),
        gt(priceDecisions.id, d.id),
      ),
    )
    .limit(1);

  if (newerPushed) {
    const msg = `تصمیم جدیدتر #${newerPushed.id} قبلاً روی فروشگاه اعمال شده است (superseded)`;
    await db
      .update(priceDecisions)
      .set({
        status: "superseded",
        pushStatus: "superseded",
        pushError: msg,
        lastPushAttemptAt: new Date(),
      })
      .where(eq(priceDecisions.id, d.id));
    return {
      ok: false,
      code: "DECISION_SUPERSEDED",
      status: "superseded",
      pushStatus: "superseded",
      message: msg,
    };
  }

  return applyDecision(decisionId, opts);
}

export async function reconcilePendingDecisions(opts?: {
  limit?: number;
  productId?: number;
  force?: boolean;
  maxAttempts?: number;
}): Promise<{
  checked: number;
  synced: number;
  failed: number;
  skipped: number;
  superseded: number;
  results: Array<{ decisionId: number; productId: number; ok: boolean; status: string; message: string }>;
}> {
  const limit = Math.max(1, Math.min(200, opts?.limit ?? 50));
  const maxAttempts = Math.max(1, opts?.maxAttempts ?? MAX_AUTO_SYNC_ATTEMPTS);

  const conds = [
    or(
      inArray(priceDecisions.status, ["pending_sync", "sync_failed"]),
      and(eq(priceDecisions.status, "applied"), ne(priceDecisions.pushStatus, "pushed")),
      and(eq(priceDecisions.status, "applied"), isNull(priceDecisions.pushStatus)),
    ),
    lt(priceDecisions.pushAttempts, maxAttempts),
  ];
  if (opts?.productId) {
    conds.push(eq(priceDecisions.productId, opts.productId));
  }

  const pendingRows = await db
    .select()
    .from(priceDecisions)
    .where(and(...conds))
    .orderBy(asc(priceDecisions.id))
    .limit(limit);

  // برای هر محصول فقط آخرین تصمیم در انتظار همگام‌سازی باید اعمال شود و قدیمی‌ترها superseded می‌شوند
  const latestPendingByProduct = new Map<number, number>();
  for (const row of pendingRows) {
    const prev = latestPendingByProduct.get(row.productId) ?? 0;
    if (row.id > prev) latestPendingByProduct.set(row.productId, row.id);
  }

  let synced = 0;
  let failed = 0;
  let skipped = 0;
  let superseded = 0;
  const results: Array<{ decisionId: number; productId: number; ok: boolean; status: string; message: string }> = [];

  for (const row of pendingRows) {
    const latestPendingId = latestPendingByProduct.get(row.productId) ?? row.id;
    if (row.id < latestPendingId) {
      const msg = `تصمیم جدیدتر #${latestPendingId} در صف همگام‌سازی همین محصول وجود دارد (superseded)`;
      await db
        .update(priceDecisions)
        .set({
          status: "superseded",
          pushStatus: "superseded",
          pushError: msg,
          lastPushAttemptAt: new Date(),
        })
        .where(eq(priceDecisions.id, row.id));
      superseded++;
      results.push({ decisionId: row.id, productId: row.productId, ok: false, status: "superseded", message: msg });
      continue;
    }

    const res = await retryDecisionSync(row.id, { force: opts?.force });
    const status = res.status ?? (res.ok ? "applied" : "sync_failed");
    if (res.ok) synced++;
    else if (status === "superseded") superseded++;
    else if (res.push?.skipped) skipped++;
    else failed++;

    results.push({
      decisionId: row.id,
      productId: row.productId,
      ok: res.ok,
      status,
      message: res.message,
    });
  }

  return {
    checked: pendingRows.length,
    synced,
    failed,
    skipped,
    superseded,
    results,
  };
}

export async function rejectDecision(decisionId: number): Promise<void> {
  const [d] = await db.select().from(priceDecisions).where(eq(priceDecisions.id, decisionId)).limit(1);
  if (!d) return;
  await db
    .update(priceDecisions)
    .set({ status: "rejected", campaignType: "none", campaignName: null, showInFeatured: false })
    .where(eq(priceDecisions.id, decisionId));
  await db.update(products).set({ status: "active", updatedAt: new Date() }).where(eq(products.id, d.productId));
  await logActivity("apply", `تصمیم #${decisionId} رد شد`, { decisionId });
}

/**
 * پاک‌سازی فوری کارت‌هایی که به اشتباه در دسته ۳ (فرصت‌های زمان‌دار / timed_sale) قرار گرفته‌اند
 * + حذف آن‌ها از کالکشن Sale در بک‌اند فروشگاه (ekgkala-backend) و ریست قفل ترب
 */
export async function cleanupWrongTimedSaleCards(opts?: {
  productId?: number;
}): Promise<{ cleanedCount: number; cleanedProducts: string[]; storeResetResults: string[]; mcpReset: boolean }> {
  const targetRows = opts?.productId
    ? await db.select().from(products).where(eq(products.id, opts.productId))
    : await db.select().from(products).where(eq(products.currentCampaign, "timed_sale"));

  const cleanedProducts: string[] = [];
  const storeResetResults: string[] = [];

  for (const p of targetRows) {
    const safePrice = p.currentFinalPrice || p.currentBasePrice || 0;
    await db
      .update(products)
      .set({
        currentCampaign: "none",
        currentCampaignName: null,
        currentDiscountPct: 0,
        currentShowInFeatured: false,
        currentCampaignEndsAt: null,
        currentBasePrice: safePrice > 0 ? safePrice : p.currentBasePrice,
        // اگر محصول قیمت خرید نداشت و به اشتباه به یک PRK ترب قفل شده بود، قفل PRK را آزاد کن تا دوباره تمیز استعلام شود
        ...(p.costPrice <= 0 ? { torobPrk: null, torobDetailsUrl: null, autoApply: false } : {}),
        status: "active",
        updatedAt: new Date(),
      })
      .where(eq(products.id, p.id));

    await db
      .update(priceDecisions)
      .set({
        campaignType: "none",
        campaignName: null,
        showInFeatured: false,
        ...(p.costPrice <= 0 ? { status: "rejected" } : {}),
      })
      .where(eq(priceDecisions.productId, p.id));

    cleanedProducts.push(`${p.name} (${p.sku})`);

    if (safePrice > 0) {
      const current = await currentSupply(p);
      const pushRes = await pushToStore({
        productId: p.id,
        sku: p.sku,
        storeExternalId: p.storeExternalId,
        effectiveCostPrice: current.effectiveCostPrice,
        hardFloorPrice: current.hardFloorPrice,
        monitoredMarketCeiling: safePrice,
        basePrice: safePrice,
        finalPrice: safePrice,
        discountPct: 0,
        campaignType: "none",
        campaignName: null,
        badgeTheme: "green-orange",
        showInFeatured: false,
        campaignEndsAt: null,
        decisionId: p.lastDecisionId ?? 0,
        confidence: 1,
      });
      storeResetResults.push(`${p.sku}: ${pushRes.message}`);
    }
  }

  // غیرفعال کردن کمپین پیش‌فرض timed_sale اگر به صورت خودکار همه کارت‌های ۱ تا ۱۰۰ را با ۳٪ تخفیف می‌گرفت
  await db
    .update(discountCampaigns)
    .set({ active: false, minDiscountPct: 10, cardRangeFrom: 21, cardRangeTo: 50 })
    .where(and(eq(discountCampaigns.type, "timed_sale"), eq(discountCampaigns.minDiscountPct, 3)));

  // آزادسازی قفل‌های گیرکردهٔ محصولات در دیتابیس
  await db.update(products).set({ lockedUntil: null }).where(isNotNull(products.lockedUntil));

  // ریست قفل ضدربات (Circuit Breaker Wall) روی سرور torob-mcp در صورت فعال بودن
  let mcpReset = false;
  const mcpUrl = (process.env.TOROB_MCP_URL ?? "http://127.0.0.1:3005/mcp").replace(/\/mcp\/?$/, "");
  try {
    const r = await fetch(`${mcpUrl}/reset`, { method: "POST", cache: "no-store" });
    mcpReset = r.ok;
  } catch {
    mcpReset = false;
  }

  await logActivity(
    "cleanup",
    `پاک‌سازی کمپین‌های زمان‌دار اشتباه انجام شد: ${cleanedProducts.length} کارت بازگردانی شد`,
    { cleanedProducts, storeResetResults, mcpReset },
  );

  return {
    cleanedCount: cleanedProducts.length,
    cleanedProducts,
    storeResetResults,
    mcpReset,
  };
}
