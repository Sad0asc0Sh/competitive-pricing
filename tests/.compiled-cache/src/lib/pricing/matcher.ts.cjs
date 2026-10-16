"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.evaluateTorobCandidate = evaluateTorobCandidate;
exports.extractModelAndSpecTokens = extractModelAndSpecTokens;
exports.isInternalOrDatabaseId = isInternalOrDatabaseId;
exports.normalizeProductText = normalizeProductText;
exports.selectBestTorobSearchMatch = selectBestTorobSearchMatch;
var _systemoneSupervisor = require("./systemone-supervisor");
const ACCESSORY_KEYWORDS = ["پایه", "براکت", "کاور", "محافظ", "آداپتور", "اداپتور", "ترانس", "کابل", "سوکت", "فیش", "جعبه تقسیم", "کم باکس", "پاور", "منبع تغذیه", "قاب", "پوسته", "لنز یدکی", "برد دوربین", "کارتن خالی", "دفترچه"];
const BUNDLE_KEYWORDS = ["پک 2", "پک ۲", "پک 3", "پک ۳", "پک 4", "پک ۴", "پک 6", "پک ۶", "پک 8", "پک ۸", "پک دو", "پک چهار", "پک هشت", "ست کامل", "باندل", "به همراه هارد", "پکیج کامل"];
const PERSIAN_STOPWORDS = new Set(["مدل", "برند", "اصلی", "اورجینال", "با", "گارانتی", "شرکتی", "فروشگاه", "خرید", "قیمت", "مشخصات", "جدید", "کیفیت", "عالی", "در", "به", "از", "و", "یا", "تا", "برای", "مناسب", "نوع", "طرح"]);

/** کلمات عمومی دسته‌بندی که به تنهایی نباید باعث تایید خودکار (Approve >= 80%) شوند */
const GENERIC_CATEGORY_WORDS = new Set(["دوربین", "مداربسته", "مدار", "بسته", "دستگاه", "دیجیتال", "شبکه", "تحت", "امنیتی", "سیستم", "پکیج", "تصویر", "دید", "شب", "رنگی", "فلزی", "پلاستیکی", "دام", "بولت", "کیس", "بزرگ", "کوچک", "نسل", "سنسور", "چشمی", "هوشمند", "بیسیم", "بی", "سیم", "وارم", "لایت", "ضد", "اب", "آب", "پشتیبانی", "قابلیت", "میکروفون", "میکروفن", "داخلی", "خارجی", "صدا", "ضبط"]);

/** تشخیص شناسه‌های داخلی دیتابیس/فروشگاه که کد مدل سازنده نیستند (مثل MongoDB ObjectId یا KY-XXXX) */
function isInternalOrDatabaseId(token) {
  const clean = token.trim();
  if (!clean) return true;
  if (/^[a-f0-9]{24}$/i.test(clean)) return true; // MongoDB ObjectId
  if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(clean)) return true; // UUID
  if (/^(ky|sku|prd|id|item|code|ekg)[-_]?\d+(?:[-_]\d+)?$/i.test(clean)) return true;
  return false;
}
function normalizeProductText(input) {
  if (!input) return "";
  return String(input).replace(/[۰-۹]/g, d => String.fromCharCode(d.charCodeAt(0) - 1728)).replace(/[٠-٩]/g, d => String.fromCharCode(d.charCodeAt(0) - 1584)).replace(/[\u200c\u200d\u200e\u200f]/g, " ").replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/ة/g, "ه").replace(/[آأإ]/g, "ا").toLowerCase().replace(/[^\w\u0600-\u06FF.-]+/g, " ").replace(/\s+/g, " ").trim();
}
function extractModelAndSpecTokens(text, sku) {
  const safeSku = sku && !isInternalOrDatabaseId(sku) ? sku : "";
  const combined = normalizeProductText(`${text} ${safeSku}`);
  const rawTokens = combined.split(" ").filter(Boolean);
  const modelTokens = new Set();
  const numericSpecs = new Set();
  const words = new Set();
  const distinctiveWords = new Set();
  const specRegex = /\b(\d+)\s*(mp|مگاپیکسل|مگا|کانال|ch|channel|tb|ترابایت|گیگ|gb|متر|امپر|آمپر|ولت)\b/gi;
  let m;
  while ((m = specRegex.exec(combined)) !== null) {
    const num = m[1];
    const unitRaw = m[2].toLowerCase();
    let canonicalUnit = unitRaw;
    if (["مگاپیکسل", "مگا", "mp"].includes(unitRaw)) canonicalUnit = "mp";else if (["کانال", "channel", "ch"].includes(unitRaw)) canonicalUnit = "ch";else if (["ترابایت", "tb"].includes(unitRaw)) canonicalUnit = "tb";else if (["گیگ", "gb"].includes(unitRaw)) canonicalUnit = "gb";
    numericSpecs.add(`${num}${canonicalUnit}`);
  }
  for (const tok of rawTokens) {
    const clean = tok.replace(/^[.-]+|[.-]+$/g, "");
    if (!clean || clean.length < 2) continue;
    if (isInternalOrDatabaseId(clean)) continue;

    // اگر توکن دقیقاً یکی از مشخصات عددی استاندارد است (مثل 2mp, 4tb, 8ch)، به عنوان کد مدل یکتا ذخیره نشود
    if (/^\d+(mp|ch|tb|gb)$/i.test(clean)) {
      numericSpecs.add(clean.toLowerCase());
      continue;
    }
    const hasLatin = /[a-z]/i.test(clean);
    const hasDigit = /\d/.test(clean);
    if (hasLatin && hasDigit && clean.length >= 3) {
      modelTokens.add(clean);
      for (const part of clean.split(/[-_]/)) {
        if (part.length >= 3 && /[a-z]/i.test(part) && /\d/.test(part) && !/^\d+(mp|ch|tb|gb)$/i.test(part)) {
          modelTokens.add(part);
        }
      }
    } else if (/^\d{4,}$/.test(clean)) {
      modelTokens.add(clean);
    } else if (!PERSIAN_STOPWORDS.has(clean)) {
      words.add(clean);
      if (!GENERIC_CATEGORY_WORDS.has(clean) && !/^\d+$/.test(clean)) {
        distinctiveWords.add(clean);
      }
    }
  }
  return {
    modelTokens: [...modelTokens],
    numericSpecs: [...numericSpecs],
    words: [...words],
    distinctiveWords: [...distinctiveWords]
  };
}
function evaluateTorobCandidate(target, candidate, minSellerCount = 1) {
  const rejectBelowPct = target.rejectBelowPct ?? 45;
  const approveAbovePct = target.approveAbovePct ?? 80;
  const targetNorm = normalizeProductText(target.productName);
  const candNorm = normalizeProductText(`${candidate.titleFa} ${candidate.titleEn ?? ""}`);
  const notes = [];
  const makeRejected = (score, reason, missing = []) => ({
    candidate,
    score,
    noul: Math.round(score / 100 * 100) / 100,
    verdict: "reject",
    rejected: true,
    needsReview: false,
    rejectReason: reason,
    matchedModelTokens: [],
    missingModelTokens: missing,
    notes
  });
  if (!candNorm) {
    return makeRejected(0, "عنوان کارت در ترب خالی است");
  }
  for (const acc of ACCESSORY_KEYWORDS) {
    const accNorm = normalizeProductText(acc);
    if (candNorm.includes(accNorm) && !targetNorm.includes(accNorm)) {
      return makeRejected(5, `لوازم جانبی/قطعه فرعی تشخیص داده شد («${acc}» در عنوان ترب هست ولی در محصول سایت نیست)`);
    }
  }
  for (const bnd of BUNDLE_KEYWORDS) {
    const bndNorm = normalizeProductText(bnd);
    if (candNorm.includes(bndNorm) && !targetNorm.includes(bndNorm)) {
      return makeRejected(10, `پک/باندل چندعددی تشخیص داده شد («${bnd}» در عنوان ترب هست ولی محصول سایت تکی است)`);
    }
  }
  if (target.anchorPriceToman && target.anchorPriceToman > 0 && candidate.priceToman && candidate.priceToman > 0) {
    const ratio = candidate.priceToman / target.anchorPriceToman;
    if (ratio < 0.42) {
      return makeRejected(12, `قیمت کارت ترب (${candidate.priceToman.toLocaleString("fa-IR")}) بیش از ۵۸٪ کمتر از لنگر قیمت محصول (${target.anchorPriceToman.toLocaleString("fa-IR")}) است — احتمال قطعه جانبی یا کالای اشتباه`);
    }
    if (ratio > 2.3) {
      return makeRejected(15, `قیمت کارت ترب (${candidate.priceToman.toLocaleString("fa-IR")}) بیش از ۲.۳ برابر لنگر قیمت محصول (${target.anchorPriceToman.toLocaleString("fa-IR")}) است — احتمال پک چندتایی یا مدل بالاتر`);
    }
  }
  const targetFp = extractModelAndSpecTokens(target.productName, target.sku);
  const candFp = extractModelAndSpecTokens(`${candidate.titleFa} ${candidate.titleEn ?? ""}`);
  for (const spec of targetFp.numericSpecs) {
    const unit = spec.replace(/^\d+/, "");
    const candSameUnit = candFp.numericSpecs.filter(s => s.endsWith(unit));
    if (candSameUnit.length > 0 && !candSameUnit.includes(spec)) {
      return makeRejected(18, `تضاد مشخصات فنی: محصول سایت «${spec}» است ولی کارت ترب «${candSameUnit.join("/")}» است`, [spec]);
    }
  }
  const matchedModelTokens = [];
  const missingModelTokens = [];
  const candCompact = candNorm.replace(/[\s-_]/g, "");
  for (const mTok of targetFp.modelTokens) {
    const tokCompact = mTok.replace(/[\s-_]/g, "");
    if (candNorm.includes(mTok) || candCompact.includes(tokCompact)) {
      matchedModelTokens.push(mTok);
    } else {
      missingModelTokens.push(mTok);
    }
  }
  if (targetFp.modelTokens.length > 0 && matchedModelTokens.length === 0 && candFp.modelTokens.length > 0) {
    return makeRejected(20, `عدم تطابق کد مدل فنی: کد مدل محصول سایت (${targetFp.modelTokens.join(", ")}) در کارت ترب (${candFp.modelTokens.join(", ")}) وجود ندارد`, missingModelTokens);
  }
  let matchedWords = 0;
  for (const w of targetFp.words) {
    if (candNorm.includes(w)) matchedWords++;
  }
  const wordCoverage = targetFp.words.length > 0 ? matchedWords / targetFp.words.length : 0.7;
  let matchedDistinctive = 0;
  for (const dw of targetFp.distinctiveWords) {
    if (candNorm.includes(dw)) matchedDistinctive++;
  }
  const distinctiveCoverage = targetFp.distinctiveWords.length > 0 ? matchedDistinctive / targetFp.distinctiveWords.length : wordCoverage;

  // اگر محصول فقط فارسی است و کلمات اختصاصی/برند آن اصلاً در کارت ترب نیست، رد شود
  if (targetFp.modelTokens.length === 0 && targetFp.distinctiveWords.length >= 2 && matchedDistinctive === 0) {
    return makeRejected(22, `عدم تطابق کلمات کلیدی و برند محصول («${targetFp.distinctiveWords.join("، ")}» در کارت ترب یافت نشد)`);
  }
  let score = Math.round((wordCoverage * 0.5 + distinctiveCoverage * 0.5) * 45);
  if (targetFp.modelTokens.length > 0) {
    const modelRatio = matchedModelTokens.length / targetFp.modelTokens.length;
    score += Math.round(modelRatio * 40);
    if (matchedModelTokens.length > 0) {
      notes.push(`تطابق دقیق کد مدل: ${matchedModelTokens.join(", ").toUpperCase()}`);
    } else {
      notes.push(`کد مدل (${targetFp.modelTokens.join(", ")}) در عنوان ترب ذکر نشده — نیازمند بازبینی`);
    }
  } else {
    // محصول سایت فاقد کد مدل انگلیسی است:
    score += Math.round(distinctiveCoverage * 38);
  }
  if (candidate.available !== false) {
    score += 5;
  } else {
    score -= 20;
    notes.push("کارت در ترب ناموجود است");
  }
  const sellers = candidate.sellerCount ?? 1;
  if (sellers >= Math.max(3, minSellerCount)) {
    score += 10;
    notes.push(`لیستینگ ادغام‌شده معتبر (${sellers} فروشنده)`);
  } else if (sellers === 1) {
    notes.push("لیستینگ تک‌فروشنده‌ای");
  }
  if (target.anchorPriceToman && target.anchorPriceToman > 0 && candidate.priceToman && candidate.priceToman > 0) {
    const diffPct = Math.abs(candidate.priceToman - target.anchorPriceToman) / target.anchorPriceToman;
    if (diffPct <= 0.15) {
      score += 5;
      notes.push("هم‌خوانی عالی قیمت با لنگر محصول");
    }
  }

  // گارد نهایی پس از تمام امتیازهای تشویقی:
  // اگر کالای سایت فاقد کد مدل انگلیسی باشد ولی کارت ترب دارای کد مدل فنی مشخص باشد (یا نام کالای سایت فقط شامل کلمات عمومی باشد)،
  // سقف امتیاز در بازه ریویو (حداکثر approveAbovePct - 6) قفل می‌شود تا هرگز بدون تایید انسانی اعمال خودکار نشود!
  if (targetFp.modelTokens.length === 0 && (candFp.modelTokens.length > 0 || targetFp.distinctiveWords.length === 0)) {
    score = Math.min(score, Math.max(rejectBelowPct + 5, approveAbovePct - 6));
    notes.push(candFp.modelTokens.length > 0 ? `محصول سایت فاقد کد مدل انگلیسی است ولی کارت ترب مدل «${candFp.modelTokens.join(", ").toUpperCase()}» دارد — نیازمند تایید انسانی در ریویو` : "نام محصول فقط شامل کلمات عمومی دسته‌بندی است و کد مدل یکتا ندارد — نیازمند تایید انسانی در ریویو");
  }
  score = Math.max(0, Math.min(100, score));
  const verdict = (0, _systemoneSupervisor.classifyThreeZoneScore)(score, rejectBelowPct, approveAbovePct);
  const rejected = verdict === "reject";
  const needsReview = verdict === "review";
  return {
    candidate,
    score,
    noul: Math.round(score / 100 * 100) / 100,
    verdict,
    rejected,
    needsReview,
    rejectReason: rejected ? `امتیاز تطابق (${score}% / noul=${(score / 100).toFixed(2)}) زیر خط قرمز رد ناظر (${rejectBelowPct}%) است` : undefined,
    matchedModelTokens,
    missingModelTokens,
    notes
  };
}
function selectBestTorobSearchMatch(target, candidates, minSellerCount = 1) {
  if (!candidates.length) {
    return {
      best: null,
      allRanked: [],
      confident: false,
      verdict: "reject",
      explanation: "هیچ نتیجه‌ای از جستجوی ترب دریافت نشد"
    };
  }
  const evaluated = candidates.map(c => evaluateTorobCandidate(target, c, minSellerCount));
  const allRanked = [...evaluated].sort((a, b) => {
    if (a.rejected !== b.rejected) return a.rejected ? 1 : -1;
    if (b.score !== a.score) return b.score - a.score;
    return (b.candidate.sellerCount ?? 0) - (a.candidate.sellerCount ?? 0);
  });
  const nonRejected = allRanked.filter(x => !x.rejected);
  if (!nonRejected.length) {
    const topRejected = allRanked[0];
    return {
      best: null,
      allRanked,
      confident: false,
      verdict: "reject",
      explanation: `رد کامل در گیت ورودی: از بین ${candidates.length} نتیجه جستجوی ترب، همه زیر خط قرمز تطابق (${target.rejectBelowPct ?? 45}%) بودند (${topRejected?.rejectReason ?? "نامشخص"})`
    };
  }
  const best = nonRejected[0];
  return {
    best,
    allRanked,
    confident: best.verdict === "approve",
    verdict: best.verdict,
    explanation: best.verdict === "approve" ? `تایید خودکار ورودی (${best.score}% ≥ ${target.approveAbovePct ?? 80}% · noul=${best.noul.toFixed(2)}): کارت «${best.candidate.titleFa}» انتخاب شد و ${candidates.length - nonRejected.length} نتیجه نامرتبط رد گردید` : `ورود مشروط به بخش ریویو (${best.score}% در بازه ${target.rejectBelowPct ?? 45}%..${target.approveAbovePct ?? 80}% · noul=${best.noul.toFixed(2)}): کارت «${best.candidate.titleFa}» انتخاب شد ولی نیازمند تایید بازبینی است`
  };
}