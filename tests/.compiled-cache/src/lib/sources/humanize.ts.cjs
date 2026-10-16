"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.browserHeaders = browserHeaders;
exports.fetchWithRetry = fetchWithRetry;
exports.pickUserAgent = pickUserAgent;
exports.politeDelay = politeDelay;
exports.randomBetween = randomBetween;
exports.sleep = void 0;
/**
 * لایه «رفتار انسان‌نما» برای خزش:
 *  - تأخیر تصادفی کوتاه بین درخواست‌ها (jitter) بدون فریز کردن درخواست‌های پنل وب
 *  - چرخش User-Agent و هدرهای مرورگر واقعی
 *  - محدودیت نرخ per-host
 *  - تلاش مجدد سریع با تایم‌اوت کنترل‌شده
 */

const USER_AGENTS = ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36", "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1"];
const lastRequestAt = new Map();
function randomBetween(min, max) {
  return Math.floor(min + Math.random() * (max - min));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
exports.sleep = sleep;
function pickUserAgent() {
  return USER_AGENTS[randomBetween(0, USER_AGENTS.length)];
}
function browserHeaders(referer) {
  return {
    "User-Agent": pickUserAgent(),
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "fa-IR,fa;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
    Origin: "https://torob.com",
    Referer: referer ?? "https://torob.com/",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-site",
    "Cache-Control": "no-cache",
    Pragma: "no-cache"
  };
}

/** قبل از هر درخواست: رعایت فاصله کوتاه per-host بدون کند کردن پنل */
async function politeDelay(host, minMs = 200, maxMs = 550) {
  const last = lastRequestAt.get(host) ?? 0;
  const since = Date.now() - last;
  const wait = randomBetween(minMs, maxMs);
  if (since < wait) await sleep(wait - since);
  lastRequestAt.set(host, Date.now());
}
async function fetchWithRetry(url, init, opts = {}) {
  const retries = opts.retries ?? 1;
  const timeoutMs = opts.timeoutMs ?? 7000;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...init,
        signal: ctrl.signal,
        cache: "no-store"
      });
      clearTimeout(t);
      if (res.status === 490) {
        // چالش امنیتی ترب با تلاش مجدد فوری بدتر می‌شود؛ بلافاصله برگردان
        return res;
      }
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}`);
      } else {
        return res;
      }
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
    }
    if (attempt < retries) {
      await sleep(randomBetween(300, 700));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("درخواست ناموفق");
}