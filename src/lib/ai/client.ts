import type { RawOffer } from "@/lib/pricing/types";

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

export function aiEnabled(): boolean {
  return Boolean(process.env.AI_API_KEY);
}

async function chat(messages: { role: "system" | "user"; content: string }[], jsonMode = true): Promise<string | null> {
  if (!aiEnabled()) return null;
  const base = (process.env.AI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.AI_MODEL ?? "gpt-4o-mini";
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.AI_API_KEY}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages,
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

function stripHtml(html: string, maxLen = 60000): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, maxLen);
}

export async function extractOffersWithAI(
  html: string,
  productName: string,
): Promise<{ offers: RawOffer[]; title?: string; totalSellerCount: number } | null> {
  const text = stripHtml(html);
  const content = await chat([
    {
      role: "system",
      content:
        "You extract seller offers from a Persian price-comparison page (Torob). Return JSON: {title: string, totalSellerCount: number, offers: [{shopName, price (toman, integer), lastChangedDaysAgo (number|null), isAd (bool), inStock (bool)}]}. Ignore navigation and unrelated products.",
    },
    { role: "user", content: `Product we are pricing: ${productName}\n\nPAGE TEXT:\n${text}` },
  ]);
  if (!content) return null;
  try {
    const parsed = JSON.parse(content) as {
      title?: string;
      totalSellerCount?: number;
      offers?: { shopName?: string; price?: number; lastChangedDaysAgo?: number | null; isAd?: boolean; inStock?: boolean }[];
    };
    const now = Date.now();
    const offers: RawOffer[] = (parsed.offers ?? [])
      .filter((o) => o && typeof o.price === "number" && o.price > 0)
      .map((o) => ({
        shopName: o.shopName ?? "نامشخص",
        price: Math.round(o.price!),
        lastChangedAt: o.lastChangedDaysAgo != null ? new Date(now - o.lastChangedDaysAgo * 86400000) : null,
        isAd: Boolean(o.isAd),
        inStock: o.inStock !== false,
      }));
    return { offers, title: parsed.title, totalSellerCount: parsed.totalSellerCount ?? offers.length };
  } catch {
    return null;
  }
}

export interface AIReview {
  verdict: "approve" | "reject" | "adjust";
  suggestedFinalPrice?: number | null;
  reasoning: string;
}

/** بازبینی تصمیم توسط AI — یک «نظر دوم» انسانی روی تصمیم آماری */
export async function reviewDecisionWithAI(input: {
  productName: string;
  costPrice: number;
  offers: { shopName: string; price: number; included: boolean; excludeReason?: string }[];
  referencePrice: number | null;
  finalPrice: number | null;
  basePrice: number | null;
  reviewReasons: string[];
}): Promise<AIReview | null> {
  const content = await chat([
    {
      role: "system",
      content:
        "You are a senior pricing analyst for an Iranian e-commerce store. Given competitor offers from Torob and a proposed price, judge whether the proposal is sane and competitive while keeping margin. Respond JSON: {verdict: 'approve'|'reject'|'adjust', suggestedFinalPrice: number|null, reasoning: string (Persian, concise)}.",
    },
    { role: "user", content: JSON.stringify(input) },
  ]);
  if (!content) return null;
  try {
    const p = JSON.parse(content) as AIReview;
    if (!["approve", "reject", "adjust"].includes(p.verdict)) return null;
    return p;
  } catch {
    return null;
  }
}
