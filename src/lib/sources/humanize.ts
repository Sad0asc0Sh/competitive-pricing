/**
 * لایه «رفتار انسان‌نما» برای خزش:
 *  - تأخیر تصادفی بین درخواست‌ها (jitter)
 *  - چرخش User-Agent و هدرهای مرورگر واقعی
 *  - محدودیت نرخ per-host
 *  - تلاش مجدد با backoff نمایی
 *  - پشتیبانی از پروکسی (از طریق env: CRAWL_PROXY_URL — در نسخه Playwright)
 */

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
];

const lastRequestAt = new Map<string, number>();

export function randomBetween(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min));
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function pickUserAgent(): string {
  return USER_AGENTS[randomBetween(0, USER_AGENTS.length)];
}

export function browserHeaders(referer?: string): Record<string, string> {
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
    Pragma: "no-cache",
  };
}

/** قبل از هر درخواست: رعایت فاصله حداقلی per-host + تأخیر تصادفی */
export async function politeDelay(host: string, minMs = 1500, maxMs = 4500): Promise<void> {
  const last = lastRequestAt.get(host) ?? 0;
  const since = Date.now() - last;
  const wait = randomBetween(minMs, maxMs);
  if (since < wait) await sleep(wait - since);
  lastRequestAt.set(host, Date.now());
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: { retries?: number; timeoutMs?: number } = {},
): Promise<Response> {
  const retries = opts.retries ?? 2;
  const timeoutMs = opts.timeoutMs ?? 15000;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal, cache: "no-store" });
      clearTimeout(t);
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}`);
      } else {
        return res;
      }
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
    }
    await sleep(randomBetween(800, 2000) * Math.pow(2, attempt));
  }
  throw lastErr instanceof Error ? lastErr : new Error("درخواست ناموفق");
}
