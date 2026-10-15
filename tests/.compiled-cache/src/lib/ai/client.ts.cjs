"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.aiEnabled = aiEnabled;
exports.extractOffersWithAI = extractOffersWithAI;
exports.getAIStatus = getAIStatus;
exports.reviewDecisionWithAI = reviewDecisionWithAI;
exports.subqEnabled = subqEnabled;
function aiEnabled() {
  return Boolean((process.env.AI_API_KEY ?? "").trim());
}
function subqEnabled() {
  return Boolean((process.env.SUBQ_API_KEY ?? "").trim());
}
function getAIStatus() {
  return {
    aiEnabled: aiEnabled(),
    aiBaseUrl: (process.env.AI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, ""),
    aiModel: process.env.AI_MODEL ?? "gpt-4o-mini",
    subqEnabled: subqEnabled(),
    subqBaseUrl: (process.env.SUBQ_BASE_URL ?? "https://api.subq.ai/v1").replace(/\/+$/, ""),
    subqModel: process.env.SUBQ_MODEL ?? "subq-snap-preview"
  };
}
async function chat(messages, jsonMode = true) {
  if (!aiEnabled()) return null;
  const base = (process.env.AI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.AI_MODEL ?? "gpt-4o-mini";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
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
