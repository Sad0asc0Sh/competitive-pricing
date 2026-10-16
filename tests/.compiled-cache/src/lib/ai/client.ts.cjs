"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.aiEnabled = aiEnabled;
exports.extractOffersWithAI = extractOffersWithAI;
exports.reviewDecisionWithAI = reviewDecisionWithAI;
var _config = require("./config");
/**
 * لایه هوش مصنوعی — سازگار با هر API شبیه OpenAI (OpenAI, OpenRouter, Groq, Ollama, ...)
 *
 * توکن/آدرس/مدل از پنل تنظیمات (دیتابیس) یا در نبود آن از env خوانده می‌شود:
 *   AI_API_KEY      کلید (اجباری برای فعال‌سازی)
 *   AI_BASE_URL     پیش‌فرض https://api.openai.com/v1
 *   AI_MODEL        پیش‌فرض gpt-4o-mini
 *
 * کاربردها:
 *  1) استخراج پیشنهادها از HTML وقتی API ساخت‌یافته در دسترس نیست
 *  2) بازبینی تصمیم‌های کم‌اعتماد (second opinion) و توضیح انسانی
 *  3) تأیید تطابق محصول (آیا لیستینگ ترب همان کالای ماست؟)
 */

/** آیا هوش مصنوعی مکمل فعال و دارای توکن واقعی است؟ */
async function aiEnabled() {
  const cfg = await (0, _config.getAIConfig)();
  return cfg.enabled && Boolean(cfg.apiKey);
}
async function chat(messages, jsonMode = true) {
  const cfg = await (0, _config.getAIConfig)();
  if (!cfg.enabled || !cfg.apiKey) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0,
        messages,
        ...(jsonMode ? {
          response_format: {
            type: "json_object"
          }
        } : {})
      }),
      signal: ctrl.signal,
      cache: "no-store"
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
function stripHtml(html, maxLen = 60000) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, maxLen);
}
async function extractOffersWithAI(html, productName) {
  const text = stripHtml(html);
  const content = await chat([{
    role: "system",
    content: "You extract seller offers from a Persian price-comparison page (Torob). Return JSON: {title: string, totalSellerCount: number, offers: [{shopName, price (toman, integer), lastChangedDaysAgo (number|null), isAd (bool), inStock (bool)}]}. Ignore navigation and unrelated products."
  }, {
    role: "user",
    content: `Product we are pricing: ${productName}\n\nPAGE TEXT:\n${text}`
  }]);
  if (!content) return null;
  try {
    const parsed = JSON.parse(content);
    const now = Date.now();
    const offers = (parsed.offers ?? []).filter(o => o && typeof o.price === "number" && o.price > 0).map(o => ({
      shopName: o.shopName ?? "نامشخص",
      price: Math.round(o.price),
      lastChangedAt: o.lastChangedDaysAgo != null ? new Date(now - o.lastChangedDaysAgo * 86400000) : null,
      isAd: Boolean(o.isAd),
      inStock: o.inStock !== false
    }));
    return {
      offers,
      title: parsed.title,
      totalSellerCount: parsed.totalSellerCount ?? offers.length
    };
  } catch {
    return null;
  }
}
/** بازبینی تصمیم توسط AI — یک «نظر دوم» انسانی روی تصمیم آماری */
async function reviewDecisionWithAI(input) {
  const content = await chat([{
    role: "system",
    content: "You are a senior pricing analyst for an Iranian e-commerce store. Given competitor offers from Torob and a proposed price, judge whether the proposal is sane and competitive while keeping margin. Respond JSON: {verdict: 'approve'|'reject'|'adjust', suggestedFinalPrice: number|null, reasoning: string (Persian, concise)}."
  }, {
    role: "user",
    content: JSON.stringify(input)
  }]);
  if (!content) return null;
  try {
    const p = JSON.parse(content);
    if (!["approve", "reject", "adjust"].includes(p.verdict)) return null;
    const suggested = typeof p.suggestedFinalPrice === "number" && Number.isFinite(p.suggestedFinalPrice) && p.suggestedFinalPrice > 0 ? Math.round(p.suggestedFinalPrice) : null;
    return {
      verdict: p.verdict,
      suggestedFinalPrice: suggested,
      reasoning: typeof p.reasoning === "string" && p.reasoning.trim() ? p.reasoning.trim().slice(0, 2000) : "—"
    };
  } catch {
    return null;
  }
}