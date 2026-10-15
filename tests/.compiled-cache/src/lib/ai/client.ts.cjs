"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.aiEnabled = aiEnabled;
exports.extractOffersWithAI = extractOffersWithAI;
exports.reviewDecisionWithAI = reviewDecisionWithAI;
/**
 * لایه هوش مصنوعی — سازگار با هر API شبیه OpenAI (OpenAI, OpenRouter, Groq, Ollama, ...)
 *  env:
 *   AI_API_KEY      کلید (اجباری برای فعال‌سازی)
 *   AI_BASE_URL     پیش‌فرض https://api.openai.com/v1
 *   AI_MODEL        پیش‌فرض gpt-4o-mini
 *
 * کاربردها:
 *  1) استخراج پیشنهادها از HTML وقتی API ساخت‌یافته در دسترس نیست
 *  2) بازبینی تصمیم‌های کم‌اعتماد (second opinion) و توضیح انسانی
 *  3) تأیید تطابق محصول (آیا لیستینگ ترب همان کالای ماست؟)
 */

function aiEnabled() {
  return Boolean(process.env.AI_API_KEY);
}
async function chat(messages, jsonMode = true) {
  if (!aiEnabled()) return null;
  const base = (process.env.AI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.AI_MODEL ?? "gpt-4o-mini";
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.AI_API_KEY}`
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages,
        ...(jsonMode ? {
          response_format: {
            type: "json_object"
          }
        } : {})
      }),
      cache: "no-store"
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
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
    return p;
  } catch {
    return null;
  }
}