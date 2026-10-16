// Projection layer: raw Torob JSON -> small, high-signal objects.
//
// This is the whole point of the server. A Torob search page is ~70KB of
// ranking metadata, experiment ids and ad plumbing; a product page carries the
// same row again plus a seller list. An agent cannot afford any of that, so
// every tool returns compact records built here and nothing else.
//
// Field paths were verified against the live API from a deployed worker
// (probe, 2026-09-24). Two upstream facts drive the shape below:
//
// 1. `more_info_url` is a ready-made absolute details URL. The product id it
//    needs (`prk`, `search_id`) is NOT a response field - third-party scrapers
//    regex it out of this URL. Following the URL verbatim is both simpler and
//    less brittle than rebuilding it.
// 2. Seller offers live at `products_info.result[]` (upstream titles it
//    "فروشنده‌ها"). That list is the reason a Torob MCP exists at all, so it
//    gets a first-class shape rather than being flattened into a string.

import { ATTRIBUTION, MIN_SHOP_VOTES, SORT_PARAMS, SOURCE, TTL } from "./config.js";
import { cacheSet as cachePut, cached, cachedGet } from "./cache.js";
import { torobGet, upstreamBaseUrl, UpstreamError } from "./http.js";
import { storeGet, storeSet } from "./store.js";
import {
availableFrom,
foldKey,
formatToman,
num,
productUrl,
searchTerm,
short,
str,
toman,
tomanFromText } from
"./normalize.js";

/** One seller offer for a product. */

































































































































































































// ----------------------------------------------------------------- normalizers

// A shop score without votes behind it is noise. Reporting 5.0 from two votes
// would make an agent recommend a shop it knows nothing about.
// Torob's own grade for an in-person shop (measured live: 5, 4, 3) - the badge
// the site shows beside the shop's name in its "فروشگاه‌های حضوری" list. It is a
// trust grade from Torob and not the 0-5 shopper score an offer carries, which
// is why it has its own reader instead of reusing shopScore.
function trustGradeOf(score) {
  const s = num(score, NaN);
  return Number.isFinite(s) && s > 0 ? Math.round(s * 10) / 10 : null;
}

// Torob's own sentence about a seller, when it sends one. The site shows it
// under the shop's grade; `score_info.summary` is the readable half of it.
function scoreNoteOf(raw) {
  const info = raw?.score_info;
  const summary = info?.complaints_info?.summary;
  const first = Array.isArray(summary) ? summary[0] : summary;
  return short(first ?? info?.score_text, 200);
}

function shopScore(score, votes) {
  const v = Math.max(0, Math.round(num(votes, 0)));
  const s = num(score, 0);
  if (v < MIN_SHOP_VOTES || s <= 0) return null;
  return Math.round(s * 10) / 10;
}

function badgesOf(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const b of raw) {
    const text = short(b?.text, 60);
    if (text) out.push(text);
  }
  return out.slice(0, 5);
}

// The one price that matters on a search card: the cheapest offer upstream.
// 0 means out of stock, which is not free and must not read as such.
function priceOf(row) {
  const n = num(row.price, 0);
  if (n > 0) return Math.round(n);
  // Some rows carry the number only in the Persian text.
  return tomanFromText(row.price_text);
}

// Torob's details endpoint, and nothing else: the tool layer accepts a URL from
// the caller, so this is the gate that keeps a caller-supplied string from
// pointing a fetch somewhere else.
const DETAILS_HOST = "api.torob.com";
const DETAILS_PATH = "/v4/base-product/details/";

/** A URL only when it is one of Torob's own details URLs, otherwise null. */
export function detailsUrlOf(v) {
  const raw = str(v).trim();
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (parsed.hostname !== DETAILS_HOST) return null;
  if (!parsed.pathname.startsWith(DETAILS_PATH)) return null;
  return parsed.toString();
}

// The id inside a details URL, when the URL carries one. A caller passes a prk
// and a details_url together, and the two have to name the same product: the
// prk is what the question is about, so a URL that belongs to another id is
// refused instead of being opened.
function prkInUrl(url) {
  try {
    const value = new URL(url).searchParams.get("prk");
    return value ? value.trim() : null;
  } catch {
    return null;
  }
}

// Torob's own verdict on availability when it sends a boolean, and the
// price-derived guess otherwise. The search row carries `stock_status` (an empty
// string on every row measured on 2026-10-09) while the product page carries
// `availability` as a real boolean, so the boolean is what is trusted and the
// price stays as the fallback rather than being thrown away.
function availabilityOf(row, price) {
  return typeof row.availability === "boolean" ? row.availability : availableFrom(price);
}

// The product page's own word on whether this product can be bought, plus the
// reason when it says no. A product Torob has taken out of reach must not be
// handed to a caller as buyable because a stale price is still on it.
function upstreamAvailabilityOf(raw) {
  if (raw.is_accessible === false) {
    return {
      available: false,
      note:
      "Torob marks this product as not accessible (withdrawn or hidden), so it is reported as out of " +
      "stock whatever its price says."
    };
  }
  if (typeof raw.availability === "boolean") {
    return raw.availability ?
    { available: true, note: null } :
    { available: false, note: "Torob reports this product as unavailable right now." };
  }
  return { available: null, note: null };
}

export function toCard(row) {
  const prk = str(row.random_key).trim();
  if (!prk) return null;
  const price = priceOf(row);
  return {
    prk,
    name_fa: short(row.name1),
    name_en: short(row.name2, 160),
    price_toman: price,
    price_text: short(row.price_text, 80) ?? (price !== null ? `${formatToman(price)} تومان` : null),
    available: availabilityOf(row, price),
    shop_name: short(row.shop_text, 80),
    image: short(row.image_url, 300),
    image_count: Math.max(0, Math.round(num(row.image_count, 0))),
    badges: badgesOf(row.badges),
    url: productUrl(row.web_client_absolute_url, prk) ?? `https://torob.com/p/${prk}/`,
    is_adv: row.is_adv === true,
    details_url: detailsUrlOf(row.more_info_url)
  };
}

// The id a caller gets back is only half an address: Torob's details endpoint
// also wants a `search_id` that exists only on the row we just saw. Three
// things can supply it, and `detailsUrlForId` tries them in this order: the row
// remembered here, the `details_url` the caller echoes back (every card
// carries it), and a fresh search for the product's own name.
//
// The map is per-isolate, and a Worker hands consecutive requests to different
// isolates, so it is a fast path and never the mechanism.
const detailUrls = new Map();
const DETAIL_URL_MEMORY = 500;

// A Worker may finish a request before a floating promise settles, and a cache
// write that was never awaited is exactly how the shared name used to go
// missing: the entry survived only in the isolate that learned it. Anything
// that has to outlive the response therefore goes through here - the Worker
// hands the promise to its `waitUntil`, and Node simply lets it run.




// Whether this runtime can outlive a response at all. A Worker can (it is given
// an ExecutionContext); Node cannot - and the answer never changes inside one
// process, so it is set once when the server is built, not on every tool call.
//
// It is deliberately NOT a sink. Storing the current request's `waitUntil` here
// was the obvious shape and it is wrong: an isolate serves requests
// concurrently, so a second tool call overwrote the first's sink and the first
// call's writes were handed to a context that could already be gone - silently
// dropping the very memory this design leans on. What is stored instead is the
// promises themselves. The dispatch drains the queue into *its own* context on
// the way out, so a write issued during any call is registered on a context
// that is live at the moment it is registered, whatever else is running at the
// same time.
let waitUntilEnabled = false;

export function setWaitUntilEnabled(value) {
  waitUntilEnabled = value;
}

const pendingWrites = new Set();

/** Everything queued since the last drain, and nothing after it. */
export function takePendingWrites() {
  const out = [...pendingWrites];
  pendingWrites.clear();
  return out;
}

function keepAlive(promise) {
  // A rejected write must never become an unhandled rejection: this layer can
  // only ever save or cost one extra upstream request.
  const guarded = promise.catch(() => undefined);
  if (!waitUntilEnabled) return;
  pendingWrites.add(guarded);
}

function rememberResolved(prk, url, name) {
  if (detailUrls.size >= DETAIL_URL_MEMORY) {
    const oldest = detailUrls.keys().next();
    if (!oldest.done) detailUrls.delete(oldest.value);
  }
  detailUrls.set(prk, { url, name });
}

function rememberDetailUrl(row) {
  const prk = str(row.random_key).trim();
  if (!prk) return;
  const name = short(row.name1, 160);
  const url = detailsUrlOf(row.more_info_url);
  // The name is remembered even when the URL is not usable, and that case is
  // the whole reason the name search exists: a URL that stops parsing (an
  // upstream shape change, a truncated link) leaves the id with no address, and
  // the name is what lets a cold isolate search its way back to the row. Storing
  // only when both were present made that rung unreachable - the id went
  // straight to the id-only probe instead. An entry without a name could not be
  // re-found by a search anyway, so the cache write still needs one.
  rememberResolved(prk, url ?? "", name);
  if (name) {
    keepAlive(cacheSet(prk, { name, ...(url ? { url } : {}) }, REMEMBERED_TTL_SECONDS));
  }
}

// Torob sends the postage as a Persian line ("هزینه ارسال ۷۰٫۰۰۰ تومان",
// "هزینه ارسال رایگان") rather than a number. Keep the text and parse the
// number out of it; an unreadable fee stays null and never blocks the offer.
function postageOf(raw) {
  const text = short(raw.postage_fee, 60);
  if (!text) return { text: null, fee: null };
  return { text, fee: tomanFromText(text) };
}

function installmentProvidersOf(raw) {
  const providers = raw.installment?.providers;
  if (!Array.isArray(providers)) return [];
  const out = [];
  for (const p of providers) {
    const name = short(p?.name ?? p?.short_title, 60);
    if (name) out.push(name);
  }
  return out.slice(0, 5);
}

function toOffer(raw) {
  const shop = short(raw.shop_name, 80);
  if (!shop) return null;
  // Prefer the numeric price; fall back to the Persian text when only that is
  // present. Never invent a price from a shop name.
  const price = num(raw.price, 0) > 0 ? Math.round(num(raw.price, 0)) : tomanFromText(raw.price_text ?? raw.price_string);
  const more = raw.more_info ?? {};
  const postage = postageOf(raw);
  const guarantee = short(raw.guarantee_info?.status, 20);
  const percentile = num(raw.shop_score_percentile, NaN);
  const shopId = str(raw.shop_id).trim();
  return {
    shop_name: shop,
    shop_city: short(raw.shop_name2, 60),
    shop_id: shopId || null,
    shop_score: shopScore(raw.shop_score, raw.shop_votes_count),
    shop_votes: Math.max(0, Math.round(num(raw.shop_votes_count, 0))),
    price_toman: price,
    price_text: short(raw.price_text ?? raw.price_string, 80) ?? (price !== null ? `${formatToman(price)} تومان` : null),
    was_price_text: short(raw.price_text_striked, 60),
    available: raw.availability === undefined ? availableFrom(price) : raw.availability === true,
    price_unreliable: raw.is_price_unreliable === true,
    free_shipping: more.free_shipping === undefined ? null : more.free_shipping === true,
    payment_on_delivery: more.payment_on_delivery === undefined ? null : more.payment_on_delivery === true,
    same_day_delivery: short(more.same_day_delivery, 120),
    // A stable, human address: the shop on torob.com. The link Torob's own buy
    // button uses is an api.torob.com redirect with ~400 characters of tracking
    // around its session id, so it travels as `buy_url` and never as the shop's
    // address.
    url: shopId ? `https://torob.com/shop/${shopId}/` : str(raw.page_url).startsWith("http") ? str(raw.page_url) : null,
    buy_url: str(raw.page_url).startsWith("http") ? str(raw.page_url) : null,
    shop_note: scoreNoteOf(raw),
    is_adv: raw.is_adv === true,
    postage_text: postage.text,
    postage_fee_toman: postage.fee,
    delivered_price_toman: price === null ? null : price + (postage.fee ?? 0),
    guarantee,
    installment_providers: installmentProvidersOf(raw),
    last_price_change_date: short(raw.last_price_change_date, 60),
    has_public_torob_profile: typeof raw.has_public_torob_profile === "boolean" ? raw.has_public_torob_profile : null,
    shop_score_percentile: Number.isFinite(percentile) ? Math.round(percentile) : null
  };
}

export function offersOf(row) {
  const list = row.products_info?.result ?? [];
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const raw of list) {
    const offer = toOffer(raw);
    if (offer) out.push(offer);
  }
  // Cheapest available first, then best rated. An out-of-stock offer is kept
  // (it is real supply information) but sorts after everything buyable.
  out.sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1;
    if (a.price_toman !== b.price_toman) {
      if (a.price_toman === null) return 1;
      if (b.price_toman === null) return -1;
      return a.price_toman - b.price_toman;
    }
    return (b.shop_score ?? -1) - (a.shop_score ?? -1);
  });
  return out;
}

// --------------------------------------------------- in-person (حضوری) shops

/** One shop that sells this product in person, as Torob lists it. */





































function toInPersonSeller(raw) {
  const shop_name = short(raw?.shop_name, 80);
  if (!shop_name) return null;
  const price = num(raw?.price, 0) > 0 ? Math.round(num(raw.price, 0)) : tomanFromText(raw?.price_string ?? raw?.price_text);
  const shopId = str(raw?.shop_id).trim();
  return {
    shop_name,
    shop_id: shopId || null,
    city: short(raw?.shop_name2, 60),
    address: short(raw?.name1, 160),
    note: short(raw?.name2, 120),
    price_toman: price,
    price_text: short(raw?.price_string ?? raw?.price_text, 80) ?? (price !== null ? `${formatToman(price)} تومان` : null),
    price_unreliable: raw?.is_price_unreliable === true,
    is_open: typeof raw?.is_open === "boolean" ? raw.is_open : null,
    hours_today: short(raw?.working_hours?.title?.text, 60),
    hours_status: short(raw?.working_hours?.title?.status, 20),
    last_price_change_date: short(raw?.last_price_change_date, 60),
    fast_delivery: raw?.supports_fast_delivery === true,
    // No coordinates here: measured on a live product, none of the 84 in-person
    // rows carried a `location` at all - the coordinates live behind the map
    // endpoint, whose link this projection hands out as `in_person_map_url`.
    // The old field promised lat/lon and was always null, so it is gone.
    score: trustGradeOf(raw?.score_info?.score),
    score_note: scoreNoteOf(raw),
    url: shopId ?
    `https://torob.com/shop/${shopId}/` :
    `https://torob.com/p/${str(raw?.prk).trim()}/`
  };
}

/** The in-person seller list a product's own details payload carries. */
export function inPersonSellersOf(raw)



{
  const block = raw.products_in_store_info;
  const rows = Array.isArray(block?.result) ? block.result : [];
  const sellers = [];
  for (const row of rows) {
    const seller = toInPersonSeller(row);
    if (seller) sellers.push(seller);
  }
  // Cheapest first, the same way the online offers are ordered, so "where is
  // this cheapest in person" needs no second sort by the caller. A shop with
  // no price sorts last rather than pretending to be cheapest.
  sellers.sort((a, b) => {
    if (a.price_toman === b.price_toman) return 0;
    if (a.price_toman === null) return 1;
    if (b.price_toman === null) return -1;
    return a.price_toman - b.price_toman;
  });
  const link = str(block?.map_sellers_url).trim();
  return {
    count: sellers.length,
    sellers,
    map_url: /^https:\/\/torob\.com\//.test(link) ? link : null
  };
}

// ------------------------------------------------------ specs and variants

/** One spec line. `group` is Torob's own table header when it sends one. */






// Torob marks a table section by sending the literal string "title" as the
// value of the row that names it (measured: {بدنه: "title", وزن: "۱۶۰ گرم",
// پلتفرم: "title"}). Keeping those would hand an agent a spec whose value is
// the word "title", so they are dropped - but only that exact marker, never a
// real value that happens to be short.
const SPEC_GROUP_MARKER = "title";
const SPEC_CAP = 24;

function specValue(v) {
  if (Array.isArray(v)) {
    const parts = v.map((x) => short(x, 120)).filter((x) => Boolean(x));
    return parts.length ? parts.join("، ") : null;
  }
  if (typeof v === "string" || typeof v === "number") {
    const text = short(v, 160);
    return text && text !== SPEC_GROUP_MARKER ? text : null;
  }
  return null;
}

/** The spec tables a product page shows, flattened into one capped list. */
export function specsOf(raw) {
  const all = [];
  const keySpecs = Array.isArray(raw.key_specs) ? raw.key_specs : [];
  for (const block of keySpecs) {
    const header = short(block?.header, 80);
    const items = Array.isArray(block?.items) ? block.items : [];
    for (const item of items) {
      const key = short(item?.key ?? item?.title, 80);
      const value = specValue(item?.value);
      if (key && value) all.push({ group: header, key, value });
    }
  }
  const structural = raw.structural_specs;
  const headers = Array.isArray(structural?.headers) ? structural.headers : [];
  for (const block of headers) {
    const header = short(block?.header, 80);
    const specs = block?.specs && typeof block.specs === "object" ? block.specs : {};
    for (const [key, value] of Object.entries(specs)) {
      const text = specValue(value);
      if (text) all.push({ group: header, key: short(key, 80) ?? key, value: text });
    }
  }
  return {
    items: all.slice(0, SPEC_CAP),
    available: all.length,
    truncated: all.length > SPEC_CAP
  };
}

/** The variant tabs a product page shows (e.g. "اصالت کالا"), as cards. */






const VARIANT_GROUPS = 3;
const VARIANT_ITEMS = 5;

export function variantsOf(raw) {
  const list = Array.isArray(raw.variants) ? raw.variants : [];
  const out = [];
  for (const group of list) {
    const title = short(group?.title, 80);
    const items = Array.isArray(group?.items) ? group.items : [];
    if (!title || !items.length) continue;
    const cards = [];
    for (const item of items) {
      const card = toCard(item);
      if (card) cards.push(card);
      if (cards.length >= VARIANT_ITEMS) break;
    }
    if (cards.length) out.push({ title, count: items.length, items: cards });
    if (out.length >= VARIANT_GROUPS) break;
  }
  return out;
}

/** The category path Torob shows above the product, without its root. */
export function categoryPathOf(raw) {
  const list = Array.isArray(raw.breadcrumbs) ? raw.breadcrumbs : [];
  const out = [];
  for (const step of list) {
    const id = str(step?.cat_id ?? step?.id).trim();
    const title = short(step?.title, 80);
    // The first crumb is always Torob itself (cat_id 0).
    if (!title || id === "0") continue;
    out.push({ id, title });
  }
  return out.slice(0, 6);
}

/**
 * Torob's own quick purchase filters for this product ("دارای ضمانت ترب",
 * "با اعتبار ترب‌پی"): the price it starts at and how many sellers behind it.
 * They are reported as sent, because the wording and the price are Torob's.
 */







const PURCHASE_OPTION_CAP = 6;

export function purchaseOptionsOf(raw) {
  const items = Array.isArray(raw.filters?.items) ? raw.filters?.items : [];
  const out = [];
  for (const item of items) {
    const title = short(item?.title, 80);
    if (!title) continue;
    const online = num(item?.online_shop_display_count, NaN);
    const offline = num(item?.offline_shop_display_count, NaN);
    out.push({
      title,
      price_from_text: short(item?.price_str, 60),
      online_sellers: Number.isFinite(online) ? Math.max(0, Math.round(online)) : null,
      offline_sellers: Number.isFinite(offline) ? Math.max(0, Math.round(offline)) : null
    });
    if (out.length >= PURCHASE_OPTION_CAP) break;
  }
  return out;
}

/**
 * The full price window Torob knows for this product: its own cheapest and
 * dearest offer, straight from the details payload rather than from the
 * (partially truncated) seller list this server hands back.
 */
export function priceWindowOf(raw) {
  const min = toman(raw.min_price);
  const max = toman(raw.max_price);
  if (min === null && max === null) return null;
  return { min, max };
}

// ----------------------------------------------------------------- endpoints

function searchKey(
q,
page,
sort,
category,
shopType,
filters,
brand,
city)
{
  // Folded so two spellings of one query share one cache entry and one upstream
  // call ("آيفون" / "آیفون"). Every input that changes the upstream URL belongs
  // in the key: brand and city used to be left out, so a second search with the
  // same words and a different brand or city was answered from the first one.
  return `s:${foldKey(q)}|${page}|${sort}|${category}|${shopType}|${filters}|${brand}|${city}`;
}



















































function categoriesOf(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const c of raw) {
    const id = str(c?.id ?? c?.category_id).trim();
    const title = short(c?.title ?? c?.name, 80);
    if (id && title) out.push({ id, title });
  }
  return out.slice(0, 8);
}
























// Groups whose items are a fixed set of choices ship their option list, so a
// caller can pass one back without a second call. Brand groups are a preview
// plus their own values endpoint (their full list is not inlined), and price
// groups are a range, not choices: they compile to price__gt / price__lt.
// Exported because the tool layer names the preview size when it reports the
// full brand list instead of the group's own excerpt.
export const OPTION_PREVIEW = 10;
const OPTION_CAP = 60;

function optionValueOf(item) {
  if (item && typeof item === "object" && "value" in item) return str(item.value);
  return str(item?.slug);
}

// Torob filters a search on a brand's numeric id and ignores its slug, the same
// way it ignores an unknown brand (measured 2026-10-02 on routers, category
// 1248: brand=17418 returned 26 of 26 MikroTik rows, brand=mikrotik-میکروتیک
// came back unfiltered). Brand items arrive as {id, slug, name1, name2} with the
// slug already percent-encoded, so the slug is decoded once, here, and kept only
// to recognise the brand by.
export function canonicalSlug(slug) {
  try {
    return decodeURIComponent(slug.trim());
  } catch {
    return slug.trim();
  }
}

function brandOf(item) {
  const slug = canonicalSlug(str(item?.slug));
  return { value: str(item?.id).trim() || slug, slug };
}

function filterGroupsOf(raw) {
  const out = new Map();
  const brief = (g) => {
    const slug = str(g?.slug).trim();
    if (!slug) return null;
    const type = str(g?.type, "unknown");
    const items = Array.isArray(g?.items) ? g.items : [];
    const options = [];
    if (type !== "price") {
      for (const item of items) {
        const brand = type === "brand" ? brandOf(item) : null;
        const value = brand ? brand.value : optionValueOf(item);
        const name =
        short(item?.name ?? item?.name1 ?? item?.title ?? item?.name2, 80) ?? value;
        if (name || value) options.push({ name, value, ...(brand?.slug ? { slug: brand.slug } : {}) });
        if (options.length >= OPTION_CAP) break;
      }
    }
    // A brand group's list is a preview (values_url has the rest), so it is
    // never treated as the complete set when a caller's value is checked.
    const truncated = type === "brand" ? true : items.length > options.length;
    return {
      title: str(g?.title, slug),
      slug,
      type,
      values: items.length,
      ...(options.length ? { options: type === "brand" ? options.slice(0, OPTION_PREVIEW) : options } : {}),
      ...(options.length && truncated ? { options_truncated: true } : {}),
      ...(str(g?.url) ? { values_url: str(g.url) } : {})
    };
  };
  // Every source this response carries the groups in. Torob sends the same
  // groups more than once - measured on a live search (2026-10-09): 18 groups
  // arrived across these lists and only 12 of them were unique (brand, usage,
  // type, bluetooth_version, shop_type and stock_status each came twice, byte
  // for byte). One group per slug survives, so the caller is not handed the same
  // list twice and an agent never has to guess which copy is authoritative.
  const sources = [
  ...(raw.filters1 ?? []),
  ...(raw.filters2 ?? []),
  ...(raw.attributes ?? []),
  // Its modern name, already sent beside the others and empty today. Reading
  // it means a rename upstream cannot quietly drop the whole filter surface.
  ...(raw.available_filters ?? [])];

  let rows = 0;
  for (const group of sources) {
    if (!group || typeof group !== "object") continue;
    rows += 1;
    const b = brief(group);
    if (!b) continue;
    const kept = out.get(b.slug);
    if (!kept) {
      out.set(b.slug, b);
      continue;
    }
    // The first copy keeps its place in the list; a later one only fills what
    // the kept copy lacks (values, the group's own URL).
    out.set(b.slug, {
      ...kept,
      title: kept.title || b.title,
      type: kept.type === "unknown" ? b.type : kept.type,
      values: Math.max(kept.values, b.values),
      ...(b.options && !kept.options ? { options: b.options } : {}),
      ...((kept.options_truncated || b.options_truncated) && (kept.options || b.options) ?
      { options_truncated: true } :
      {}),
      ...(kept.values_url || b.values_url ? { values_url: kept.values_url ?? b.values_url } : {})
    });
  }
  // Rows that exist and cannot be read are not "this search takes no filters".
  // The same rule the location endpoints follow, for the same reason: an empty
  // list reads as a real answer while a wrong field name is a bug.
  //
  // The second half of the check is the one that catches a *rename*. The first
  // only fires while the four source arrays still exist; if upstream moves the
  // groups onto a key this server does not read, `rows` stays 0 and an empty
  // list would slip through as a real answer - which is exactly the failure
  // this guard is here to prevent. A search that came back with products and
  // advertises no filter surface at all is that case, since every live search
  // measured carries at least the price group. An empty result set may
  // legitimately carry nothing, so it is the products that make it an error.
  const hadProducts = Array.isArray(raw.results) && raw.results.length > 0;
  if (out.size === 0 && (rows > 0 || hadProducts)) {
    const unreadable =
    rows > 0 ?
    `${rows} filter group(s) this server could not read` :
    "no filter surface at all, though the search returned products";
    throw new UpstreamError(
    `Torob answered this search with ${unreadable}. The API shape may have changed, so this is reported ` +
    `instead of an empty filter list - "this search takes no filters" would be a different answer.`,
    "http");

  }
  return [...out.values()];
}

// The filter keys a response says it accepts: each group's own slug, plus the
// price group's price__gt / price__lt. `q` is the query itself and `sort` has
// its own argument, so neither is a filter key.
export function filterKeyMap(groups) {
  const map = new Map();
  for (const g of groups) {
    if (g.slug === "q") continue;
    if (g.type === "price") {
      map.set("price__gt", g);
      map.set("price__lt", g);
      continue;
    }
    map.set(g.slug, g);
  }
  return map;
}

// The price group's own bounds: items are [{value, slug: "price__gt"}, {value,
// slug: "price__lt"}], which is Torob telling the UI where its slider ends.
// Read from the groups rather than from raw.min_price/max_price, because those
// two move between identical requests (measured on the same query: 1125 then
// 1200 results), while the bounds track the set that was actually returned.
export function priceBoundsOf(raw) {
  const groups = [...(raw.filters1 ?? []), ...(raw.filters2 ?? [])];
  let min = null;
  let max = null;
  for (const group of groups) {
    if (!group || typeof group !== "object") continue;
    const items = Array.isArray(group.items) ? group.items : [];
    for (const item of items) {
      const slug = str(item?.slug).trim();
      const value = toman(item?.value);
      if (value === null) continue;
      if (slug === "price__gt") min = value;
      if (slug === "price__lt") max = value;
    }
  }
  return min === null && max === null ? null : { min, max };
}

// The brand chips of a search: {id, slug, name1, name2}. This is the complete
// list the search offers, whereas the brand group inside available_filters is a
// preview (OPTION_PREVIEW entries) whose full list lives behind values_url.
const BRAND_VALUE_CAP = 30;

export function brandValuesOf(raw) {
  const groups = Array.isArray(raw.attributes) ? raw.attributes : [];
  const values = [];
  let total = 0;
  for (const group of groups) {
    if (str(group?.type).trim() !== "brand") continue;
    const items = Array.isArray(group?.items) ? group.items : [];
    for (const item of items) {
      const { value, slug } = brandOf(item);
      const name = short(item?.name1 ?? item?.name2, 80);
      if (!value || !name) continue;
      total += 1;
      if (values.length < BRAND_VALUE_CAP) values.push({ name, value, slug });
    }
    break;
  }
  return { values, truncated: total > values.length };
}

// The filter groups a search taught us, remembered for the same query and the
// same narrowing (category/city/shop type). A later call in that exact context
// can be validated before spending an upstream request; any other context falls
// back to the fresh response, which is always the authority - and the fresh
// response is checked against in full whenever filters were passed, so a stale
// memory can refuse a value but can never bless one.
const filterGroupsMemory = new Map();
const FILTER_MEMORY_ENTRIES = 200;
const FILTER_MEMORY_PREFIX = "filters/";
const FILTER_MEMORY_TTL_SECONDS = 30 * 60;

// The narrowing that changes which filter groups a search advertises. `brand`
// is deliberately not part of it: the reader of this memory (tools.ts) knows the
// brand only as the caller worded it, while the writer knows the id it ended up
// sending, so a key built from the brand could never be read back by the code
// that wrote it - which is exactly how brand-bearing searches stopped warming
// this path. The groups are a property of the wording plus its category, city
// and shop type; a value that a brand's own response would not accept is caught
// against the fresh response instead.
export function filterMemoryKey(q, opts) {
  return [foldKey(q), opts?.category ?? "", opts?.city ?? "", opts?.shopType ?? ""].join("|");
}

export function rememberFilterGroups(key, groups) {
  if (filterGroupsMemory.size >= FILTER_MEMORY_ENTRIES) {
    const oldest = filterGroupsMemory.keys().next();
    if (!oldest.done) filterGroupsMemory.delete(oldest.value);
  }
  filterGroupsMemory.set(key, groups);
  keepAlive(cacheSet(`${FILTER_MEMORY_PREFIX}${encodeURIComponent(key)}`, groups, FILTER_MEMORY_TTL_SECONDS));
}

export async function rememberedFilterGroups(key) {
  const local = filterGroupsMemory.get(key);
  if (local) return local;
  const shared = await cacheGet(`${FILTER_MEMORY_PREFIX}${encodeURIComponent(key)}`);
  return Array.isArray(shared) ? shared : null;
}

export async function searchProducts(opts) {
  const raw = await searchRaw(opts);
  const result = projectSearch(raw, opts);
  // Only a surface that was actually read teaches the next call. An unreadable
  // one is a disagreement with Torob rather than a fact about this query, and
  // remembering it would bless an empty list for the next half hour - making
  // the note above a one-off instead of the warning it is meant to be.
  if (result.available_filters.length) {
    rememberFilterGroups(
    filterMemoryKey(opts.q, { category: opts.category, city: opts.city, shopType: opts.shopType }),
    result.available_filters);

  }
  return result;
}

// The upstream payload, cached. Kept separate from the projection so the
// details path can reuse a search it already paid for instead of asking again.
async function searchRaw(opts) {
  const filters = opts.filters ?? {};
  // The one place every search goes through - the tool's own query and the
  // name-search rung alike - so the joined form is what is both keyed and sent.
  // `opts.q` itself is left alone: the response echoes what the caller asked
  // for, and every other key built from it stays consistent.
  const q = searchTerm(opts.q);
  const key = searchKey(
  q,
  opts.page,
  opts.sort,
  opts.category ?? "",
  opts.shopType ?? "",
  JSON.stringify(filters),
  opts.brand ?? "",
  opts.city ?? "");

  return cached(key, TTL.search, () => {
    const params = new URLSearchParams({
      q,
      // Torob pages upstream are 0-based; this server takes 1-based pages.
      page: String(Math.max(0, opts.page - 1)),
      size: "24",
      // Upstream's own sort vocabulary; the tool-facing names are stable.
      sort: SORT_PARAMS[opts.sort] ?? ""
    });
    if (opts.category) params.set("category", opts.category);
    if (opts.brand) params.set("brand", opts.brand);
    if (opts.city) params.set("city", opts.city);
    // Validated slugs, passed through as upstream expects them.
    for (const [k, v] of Object.entries(filters)) params.set(k, v);
    if (opts.shopType) params.set("shop_type", opts.shopType);
    return torobGet(`/v4/base-product/search/?${params.toString()}`);
  });
}

function projectSearch(raw, opts) {
  const rows = Array.isArray(raw.results) ? raw.results : [];
  const products = rows.map(toCard).filter((c) => c !== null);
  // Every row we hand out becomes resolvable by its id alone.
  for (const row of rows) rememberDetailUrl(row);
  const total = Math.max(0, Math.round(num(raw.count, 0)));
  const spell = raw.spellcheck;
  const brands = brandValuesOf(raw);
  // The filter surface is a report about one part of the payload, so a change
  // upstream must not take the products down with it: they are already here,
  // and they are what answered the question. The read is allowed to fail loudly
  // *about itself* - the failure travels as available_filters_note beside an
  // empty list, never as a dead search.
  let availableFilters = [];
  let availableFiltersNote = null;
  try {
    availableFilters = filterGroupsOf(raw);
  } catch (err) {
    availableFiltersNote = err instanceof Error ? err.message : String(err);
  }

  return {
    products,
    total,
    page: opts.page,
    // Upstream returns 24-26 rows regardless of size, so the real per-page
    // count is what we actually got, not what we asked for.
    page_count: rows.length,
    has_next_page: typeof raw.next === "string" && raw.next.length > 0,
    next_url: typeof raw.next === "string" ? raw.next : null,
    min_price_toman: toman(raw.min_price),
    max_price_toman: toman(raw.max_price),
    price_bounds_toman: priceBoundsOf(raw),
    brand_values: brands.values,
    ...(brands.truncated ? { brand_values_truncated: true } : {}),
    suggested_categories: categoriesOf(raw.categories),
    // The filter groups and attributes this search would accept. Reporting
    // them is what lets an agent narrow down without a second discovery call,
    // and it is how a caller learns the real slugs before using `filters`.
    available_filters: availableFilters,
    ...(availableFiltersNote ? { available_filters_note: availableFiltersNote } : {}),
    spellcheck: spell ?
    {
      corrected: str(spell.corrected_query).trim() || null,
      original: str(spell.initial_query, opts.q)
    } :
    null,
    attribution: ATTRIBUTION
  };
}

// The details URL is discovered through a search: Torob only hands out a
// ready-made `more_info_url` on a result row, and it carries the ids needed to
// open the product.
//
// `store: false` reads a cached payload but never writes one. It exists for the
// id-only probe, which is the one caller that may be answered by a *different*
// product: caching that answer under the probed id would later serve the wrong
// product through the details-url path, and a wrong product is worse than an
// extra fetch. The probe's caller stores the payload itself, after it has
// checked the id in it.
async function detailsRaw(moreInfoUrl, prk, store = true) {
  if (!store) {
    const remembered = cachedGet(`d:${prk}`);
    if (remembered) return remembered;
    return torobGet(moreInfoUrl);
  }
  // Filed under the id that was asked for, and only when the payload agrees
  // with it. The id-only probe below already checks this, because it is the
  // caller most likely to be answered by a different product; a caller-supplied
  // details_url is the other one, and `prkInUrl` can only compare when the URL
  // happens to carry the id in it. A payload that names another product is
  // still the answer to this call - the page really was opened - but it is
  // never filed here, so it can never be served later as this product.
  return cached(`d:${prk}`, TTL.product, () => torobGet(moreInfoUrl), {
    accept: (raw) => {
      const answered = str(raw?.random_key).trim();
      return !answered || answered === prk;
    }
  });
}

// A product id on its own is NOT a search term, and this was measured: feeding
// a search result's prk back as a query returns nothing, because the search
// endpoint matches names, not ids. The product's own name does work - a card
// carries name1, and a search for it returns the product again, usually first
// and always with a fresh details URL - so the name is what re-resolves an id
// on a cold isolate. The caller's own wording is tried after it.
//
// A name search can drift onto a similar product ("A57" vs "A37"), and almost
// is a wrong answer when the answer is a price. An exact id match is proof; a
// first row is accepted only when its folded name really is the remembered
// name, and the caller is told it was matched by name rather than by id.





const NAME_TOKENS_RE = /[^\p{L}\p{N}]+/u;

function nameTokens(s) {
  return foldKey(s).
  split(NAME_TOKENS_RE).
  filter((t) => t.length > 1);
}

function sameNameTokens(a, b) {
  if (a.length < 2 || b.length < 2) return false;
  const shared = a.filter((t) => b.includes(t)).length;
  const dice = 2 * shared / (a.length + b.length);
  if (dice < 0.9) return false;
  const numeric = (ts) => ts.filter((t) => /\d/.test(t)).sort().join(",");
  return numeric(a) === numeric(b);
}

function nameMatches(knownName, row) {
  const target = foldKey(knownName ?? "");
  if (!target) return false;
  const targetTokens = nameTokens(target);
  for (const candidate of [row.name1, row.name2]) {
    const folded = foldKey(candidate);
    if (!folded) continue;
    if (folded === target) return true;
    if (sameNameTokens(targetTokens, nameTokens(folded))) return true;
  }
  return false;
}

/** A shared cap on the extra upstream lookups one tool call may make. */




function spend(budget) {
  if (!budget) return true;
  if (budget.left <= 0) return false;
  budget.left -= 1;
  return true;
}

async function rowForId(
prk,
knownName,
budget,
...queries)
{
  // The remembered name counts as a query, and it has to: a prk is not a
  // search term but the name the id was learned under is, and neither caller
  // that reaches here passes a query of its own. Without this the rung took no
  // step at all - no search was ever issued - and `exact-id` / `name-search`
  // could not be reported even though the docs promise both.
  const attempts = [knownName, ...queries].
  map((q) => str(q).trim()).
  filter((q, i, all) => q.length > 0 && all.indexOf(q) === i);
  for (const q of attempts) {
    if (!spend(budget)) return null;
    const raw = await searchRaw({ q, page: 1, sort: "popularity" });
    const rows = Array.isArray(raw.results) ? raw.results : [];
    const exact = rows.find((r) => str(r.random_key) === prk);
    if (exact) return { row: exact, matched_exact: true };
    const first = rows[0];
    if (first?.more_info_url && nameMatches(knownName, first)) return { row: first, matched_exact: false };
  }
  return null;
}

// What an isolate learns has to outlive it. A Worker spreads consecutive
// requests across many isolates, so an in-process map is a fast path and
// nothing more - a live test caught a call failing because it landed somewhere
// the search had never run. The shared layer (`store.ts`) is per-colo on
// Workers and a file on the local server, so one run learning a product spares
// the next run of it, and the entry carries both things it learned: the name
// and the details URL. It is a cache: a write that fails only costs one extra
// search, so failures are swallowed rather than raised - and the write goes
// through `waitUntil`, so it is not cut off when the response finishes.
const REMEMBERED_TTL_SECONDS = 24 * 60 * 60;

async function cacheGet(key) {
  return storeGet(`product/${key}`);
}

async function cacheSet(key, value, ttlSeconds) {
  await storeSet(`product/${key}`, value, ttlSeconds);
}

// What one isolate learned from a search row, read back: the product's name and
// the details URL that row came with. The in-process map is the fast path; the
// per-colo cache is what a *different* isolate can still read.
async function rememberedInfo(prk) {
  const local = detailUrls.get(prk);
  if (local) return { name: local.name, url: local.url };
  const shared = await cacheGet(prk);
  if (!shared) return { name: null, url: null };
  const name = short(shared.name, 160);
  const url = detailsUrlOf(shared.url);
  if (url) rememberResolved(prk, url, name);
  return { name, url };
}

// The caller may hand us a bare id, a /p/<id>/ path, or a full torob.com URL.
// An agent that read an id out of a link should not have to parse it out.
export function idFrom(source) {
  const wanted = source.trim();
  const m =
  wanted.match(/\/p\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i) ??
  wanted.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return (m?.[1] ?? wanted).trim();
}























// The details URL for an id, built from the id alone. It is built on the same
// base the calls go out on (http.ts), so a deployment pointed at a relay hands
// out relay URLs - a caller passing api.torob.com's own URL back would leave the
// relay and meet the challenge the relay exists to avoid.
function prkOnlyDetailsUrl(prk) {
  return `${upstreamBaseUrl()}/v4/base-product/details/?prk=${encodeURIComponent(prk)}`;
}

// A product id is only half an address upstream: the details endpoint also wants
// the `search_id` of the row it was seen on, and that id exists nowhere else.
// Four sources can supply it, tried in this order.
async function detailsUrlForId(wanted, opts) {
  const prk = idFrom(wanted);
  const budget = opts?.lookupBudget;

  // 1. The details_url the caller echoed back. It is fresher than anything this
  // server remembers (a remembered address can outlive the search_id inside
  // it), it is keyed to nothing, and it is the path that works on an isolate
  // that never saw the search - which is why every card carries it.
  const provided = detailsUrlOf(opts?.detailsUrl);
  if (provided) {
    // The identity being resolved is the prk the caller asked about, so a URL
    // that carries a different one is refused rather than opened: answering
    // about product B with product A's page is a wrong price, not a fallback.
    const inUrl = prkInUrl(provided);
    if (inUrl && inUrl !== prk) {
      throw new UpstreamError(
      `The details_url passed belongs to a different product ('${inUrl}') than the id asked about ('${prk}'). ` +
      `Pass the prk and the details_url from the same search_products card, or leave the details_url out.`,
      "usage");

    }
    rememberDetailUrl({ random_key: prk, more_info_url: provided });
    return { prk, url: provided, card: null, resolvedBy: "details-url" };
  }

  // 2. Whatever this isolate, or another one in this colo, already learned.
  const known = await rememberedInfo(prk);
  if (known.url) return { prk, url: known.url, card: null, resolvedBy: "remembered" };

  // 3. The name the id was learned under, then the caller's own wording: a prk
  // is not a search term, a name is.
  const found = await rowForId(prk, known.name, budget, str(opts?.query));
  if (found?.row.more_info_url) {
    return {
      prk,
      url: str(found.row.more_info_url),
      card: toCard(found.row),
      resolvedBy: found.matched_exact ? "exact-id" : "name-search"
    };
  }

  // 4. Last resort: ask the details endpoint for the id alone. Whether it
  // answers is upstream's business, which is why it is tried last - and when it
  // answers, the id in the response is checked so a different product is never
  // handed back as this one. A response with no id at all is accepted only when
  // it still projects to a product: an empty answer to the id-only call is not
  // a product, and accepting it would hide the honest "search first" error
  // below, which is the one a caller can act on.
  if (budget && budget.left <= 0) {
    throw new UpstreamError(
    `This call ran out of its shared lookup budget before it could open '${wanted}'. Open this product with ` +
    `product_details on its own - pass its details_url if you have one - or run search_products for it first.`,
    "usage");

  }
  if (spend(budget)) {
    try {
      // Not stored on the way in: this is the one call that can be answered by
      // a different product, and a payload cached under an id it does not carry
      // would be handed out later as this product. It is stored below instead,
      // after the id in it has agreed with the id that was probed.
      const raw = await detailsRaw(prkOnlyDetailsUrl(prk), prk, false);
      const answeredId = str(raw.random_key).trim();
      const card = toCard(raw);
      if (answeredId === prk || !answeredId && card) {
        cachePut(`d:${prk}`, raw, TTL.product);
        return { prk, url: prkOnlyDetailsUrl(prk), card, raw, resolvedBy: "id-only" };
      }
    } catch {

      /* fall through to the honest error below */}
  }

  throw new UpstreamError(
  `No Torob product matched '${wanted}', and this server has no earlier record of it. Product ids expire ` +
  `and are not searchable on their own: call search_products with what the user asked for, then pass both ` +
  `the prk and the details_url from that fresh result.`,
  "usage");

}

/**
 * Open a product. `source` is either a product id / product URL, or a search
 * result row passed whole.
 *
 * The id is resolved through the details URL this server saw when it handed
 * that id out; a caller that passes the card's `details_url` back needs no
 * memory at all, and a name search covers the case where both are gone (a fresh
 * isolate, a restart, a much older id).
 */
export async function productDetails(
source,
opts)
{
  let resolved;

  if (typeof source === "string") {
    const wanted = source.trim();
    if (!wanted) throw new UpstreamError("Empty product id.", "usage");
    resolved = await detailsUrlForId(wanted, opts);
  } else {
    const url = detailsUrlOf(source.more_info_url);
    if (!url) {
      throw new UpstreamError(
      "This product row carries no details URL. Re-run search_products and pass the fresh row.",
      "usage");

    }
    const prk = str(source.random_key ?? source.prk).trim();
    rememberDetailUrl({ random_key: prk, more_info_url: url });
    resolved = { prk, url, card: null, resolvedBy: "provided-row" };
  }

  const raw = resolved.raw ?? (await detailsRaw(resolved.url, resolved.prk));
  const offers = offersOf(raw);
  const base = resolved.card ?? toCard(raw);
  if (!base) {
    throw new UpstreamError("Torob returned a product page with no product in it.", "http");
  }
  // The product page's own verdict on availability, which is a real boolean
  // here (measured: `availability: true` at the top level of the payload), and
  // the reason when it says no. The price-derived guess on the card is what
  // falls back when Torob stays silent.
  const upstreamAvailability = upstreamAvailabilityOf(raw);

  const prices = offers.filter((o) => o.available && o.price_toman !== null).map((o) => o.price_toman);
  // "Best rated" is the highest score, not the first scored offer in a list
  // sorted cheapest-first (measured: the old pick put a 3.0 shop above a 5.0
  // one whenever the cheaper shop came first). Ties break on votes, then price.
  const bestRated =
  offers.
  filter((o) => o.available && o.shop_score !== null).
  sort(
  (a, b) =>
  b.shop_score - a.shop_score ||
  b.shop_votes - a.shop_votes ||
  (a.price_toman ?? Number.POSITIVE_INFINITY) - (b.price_toman ?? Number.POSITIVE_INFINITY))[
  0] ?? null;
  // Cheapest once stated postage is added. Free and unstated postage both cost
  // nothing extra here, which is why the note next to it says what it includes.
  const delivered =
  offers.
  filter((o) => o.available && o.delivered_price_toman !== null).
  sort(
  (a, b) =>
  a.delivered_price_toman - b.delivered_price_toman ||
  (a.price_toman ?? Number.POSITIVE_INFINITY) - (b.price_toman ?? Number.POSITIVE_INFINITY))[
  0] ?? null;

  // Everything below rides along in the payload this function already fetched:
  // the in-person shop list, the spec tables, the variant tabs, the category
  // path, the full price window and Torob's own quick purchase filters. None of
  // it costs an extra upstream request, which is why it is not behind a flag.
  const inPerson = inPersonSellersOf(raw);
  const specs = specsOf(raw);
  const priceWindow = priceWindowOf(raw);
  const variants = variantsOf(raw);
  const categoryPath = categoryPathOf(raw);
  const purchaseOptions = purchaseOptionsOf(raw);

  return {
    ...base,
    ...(upstreamAvailability.available === null ? {} : { available: upstreamAvailability.available }),
    ...(upstreamAvailability.note ? { availability_note: upstreamAvailability.note } : {}),
    offers,
    offer_count: offers.length,
    price_spread_toman: prices.length > 1 ? Math.max(...prices) - Math.min(...prices) : null,
    cheapest_offer: offers.find((o) => o.available && o.price_toman !== null) ?? null,
    best_rated_offer: bestRated,
    cheapest_delivered_offer: delivered,
    resolved_by: resolved.resolvedBy,
    ...(priceWindow ? { price_range_toman: priceWindow } : {}),
    in_person_count: inPerson.count,
    in_person_sellers: inPerson.sellers,
    ...(inPerson.map_url ? { in_person_map_url: inPerson.map_url } : {}),
    ...(specs.items.length ?
    { specs: specs.items, ...(specs.truncated ? { specs_truncated: true, specs_available: specs.available } : {}) } :
    {}),
    ...(variants.length ? { variants } : {}),
    ...(categoryPath.length ? { category_path: categoryPath } : {}),
    ...(purchaseOptions.length ? { purchase_options: purchaseOptions } : {}),
    ...(raw.is_authentic === true ? { is_authentic: true } : {}),
    ...(raw.has_wiki === true ? { has_wiki: true } : {}),
    attribution: ATTRIBUTION
  };
}

/**
 * Confirm that a product id is one Torob will answer for. Every tool that
 * opens a product by id needs the same proof: Torob's product endpoints take a
 * bare prk but answer nothing for an id they cannot resolve, and a prk alone
 * carries no search_id. This is the ladder product_details walks - memory, the
 * caller's details_url, the name the id was learned under, and finally the
 * id-only probe - because a price chart promised for a torob.com product URL
 * has to open when that URL is all the caller has.
 */
async function confirmedPrk(prkInput, opts) {
  const wanted = str(prkInput).trim();
  if (!wanted) throw new UpstreamError("Empty product id.", "usage");
  const resolved = await detailsUrlForId(wanted, opts);
  return resolved.prk;
}

/**
 * Products Torob considers comparable to this one. This is the "that one is
 * too expensive - what else?" call, and it needs the same id resolution as
 * product_details.
 */
export async function similarProducts(
prkInput,
limit,
opts)
{
  const prk = await confirmedPrk(prkInput, opts);
  const raw = await cached(`sim:${prk}`, TTL.similar, () =>
  torobGet(
  `/v4/base-product/similar-base-product/?prk=${encodeURIComponent(prk)}&limit=24&source=torob_search`));


  const rows = Array.isArray(raw.results) ? raw.results : [];
  for (const row of rows) rememberDetailUrl(row);
  return rows.map(toCard).filter((c) => c !== null).slice(0, limit);
}

// ---------------------------------------------------- price and shop calls

/**
 * Torob's own price chart for a product: monthly points, each series carrying
 * its own label ("میانگین قیمت", "کمترین قیمت"). The upstream call takes only
 * the prk - the site adds a timestamp to defeat its CDN, which this server
 * deliberately does not do: the local TTL is what decides freshness, and a
 * cache-buster on every call would turn a free read into a fresh round trip.
 */
export async function productPriceChart(
prkInput,
months,
opts)
{
  const prk = await confirmedPrk(prkInput, opts);
  const raw = await cached(`ch:${prk}`, TTL.chart, () =>
  torobGet(`/v4/base-product/price-chart/?prk=${encodeURIComponent(prk)}`));

  return priceChartOf(raw, months);
}







/** Torob's own feed of price changes for one product, newest first. */
export async function productPriceChanges(
prkInput,
limit,
opts)
{
  const prk = await confirmedPrk(prkInput, opts);
  const raw = await cached(`pc:${prk}:${limit}`, TTL.changes, () =>
  torobGet(`/v4/base-product/price-history/?prk=${encodeURIComponent(prk)}&page=0&size=${limit}`));

  return priceChangesOf(raw, limit);
}

/** When Torob last changed this product's prices, as its own timestamp. */
export async function productLastModified(prkInput, opts) {
  const prk = await confirmedPrk(prkInput, opts);
  const raw = await cached(`lm:${prk}`, TTL.freshness, () =>
  torobGet(`/v4/base-product/last-modified-date/?prk=${encodeURIComponent(prk)}`));

  return short(raw?.last_modified_date, 40);
}

// Shop ids are numeric upstream. Checking the shape here means a mistyped id
// gets a sentence about ids instead of a 404 from Torob.
function shopIdOf(v) {
  const id = str(v).trim();
  if (!/^\d{1,12}$/.test(id)) {
    throw new UpstreamError(
    `'${id}' is not a Torob shop id. A shop id is the numeric shop_id on a product_details offer, ` +
    `or an id from find_shops.`,
    "usage");

  }
  return id;
}

/** One shop's Torob profile page, projected. */
export async function shopProfile(shopIdInput) {
  const id = shopIdOf(shopIdInput);
  const raw = await cached(`sh:${id}`, TTL.shop, () =>
  torobGet(`/v4/internet-shop/details/?id=${encodeURIComponent(id)}`));

  return shopProfileOf(raw, id);
}














/** A shop's own catalogue, as search-style cards. */
export async function shopProducts(shopIdInput, page, limit) {
  const id = shopIdOf(shopIdInput);
  const raw = await cached(`spl:${id}:${page}`, TTL.shopProducts, () =>
  torobGet(`/v4/internet-shop/base-product/list/?shop_id=${encodeURIComponent(id)}&page=${Math.max(0, page - 1)}`));

  const rows = Array.isArray(raw?.results) ? raw.results : [];
  // The same rule as a search: every card we hand out stays resolvable.
  for (const row of rows) rememberDetailUrl(row);
  return {
    shop_id: id,
    count: Math.max(0, Math.round(num(raw?.count, rows.length))),
    min_price_toman: toman(raw?.min_price),
    max_price_toman: toman(raw?.max_price),
    page,
    page_count: rows.length,
    has_next_page: typeof raw?.next === "string" && raw.next.length > 0,
    products: rows.map(toCard).filter((c) => c !== null).slice(0, limit)
  };
}








/**
 * Torob's shop directory: a search over SHOPS, not products. Kept apart from
 * search_products on purpose - "موبایل" here means 11,124 businesses with that
 * word in their name, not products.
 */
export async function findShops(opts)





{
  const params = new URLSearchParams({
    page: String(Math.max(0, opts.page - 1)),
    size: "24",
    shop_type: opts.shopType ?? "all",
    show_blocks: "true",
    has_payment: "false"
  });
  if (opts.q) params.set("q", opts.q);
  if (opts.city) params.set("city", opts.city);
  const raw = await cached(`shs:${params.toString()}`, TTL.shops, () =>
  torobGet(`/v4/internet-shop/list/?${params.toString()}`));

  const { count, shops } = shopsOf(raw, opts.limit);
  return {
    count,
    page: opts.page,
    has_next_page: typeof raw?.next === "string" && raw.next.length > 0,
    shops
  };
}

// Torob's image search takes a URL, not a file: the page's own upload path is
// for pictures a browser picked, while this endpoint is what the result page
// asks with. A card the agent already has an image URL for is therefore enough.













function detectedObjectsOf(raw) {
  const out = [];
  const push = (v) => {
    const text = short(v, 60);
    if (text && !out.includes(text)) out.push(text);
  };
  const sorted = raw?.detected_objects?.sorted;
  if (Array.isArray(sorted)) {
    for (const item of sorted) {
      if (typeof item === "string") push(item);else
      push(item?.name ?? item?.label ?? item?.title ?? item?.text ?? item?.class_name);
    }
  }
  if (typeof raw?.detected_objects?.initial === "string") push(raw.detected_objects.initial);
  return out.slice(0, 8);
}

export async function searchByImage(imageUrl, page, limit) {
  const wanted = imageUrl.trim();
  let parsed;
  try {
    parsed = new URL(wanted);
  } catch {
    throw new UpstreamError(
    `search_by_image needs an http(s) image URL - '${wanted}' is not a URL. Torob fetches the image itself, ` +
    `so the link has to be reachable from the internet.`,
    "usage");

  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UpstreamError(
    `search_by_image only accepts http(s) image URLs; '${parsed.protocol}' is not one.`,
    "usage");

  }
  const params = new URLSearchParams({ image_url: parsed.toString(), page: String(Math.max(0, page - 1)), size: "24", source: SOURCE });
  const raw = await cached(`img:${page}:${parsed.toString()}`, TTL.image, () =>
  torobGet(`/v4/base-product/search-by-image/?${params.toString()}`));

  const rows = Array.isArray(raw?.results) ? raw.results : [];
  for (const row of rows) rememberDetailUrl(row);
  return {
    page,
    page_count: rows.length,
    has_next_page: typeof raw?.next === "string" && raw.next.length > 0,
    uploaded_image_url: short(raw?.uploaded_image_url, 300),
    matched_product: raw?.searched_product_info ? toCard(raw.searched_product_info) : null,
    detected_objects: detectedObjectsOf(raw),
    products: rows.map(toCard).filter((c) => c !== null).slice(0, limit)
  };
}

/**
 * Torob's trending searches. The site sends `t=<now>` to defeat Torob's own
 * CDN; here the value is rounded to this server's TTL window, so the data
 * refreshes on the same rhythm as the cache without asking upstream for a
 * fresh copy on every call.
 */
export async function trendingSearches(limit) {
  const bucket = Math.floor(Date.now() / TTL.trends);
  const raw = await cached(`tr:${bucket}`, TTL.trends, () =>
  torobGet(`/v4/search-trends/?t=${bucket}`));

  return trendsOf(raw, limit);
}

/** The cities Torob's own users pick most, for a sensible default. */
export async function popularCities() {
  const raw = await cached("citypop", TTL.locations, () =>
  torobGet("/v4/city/most-visited/list/"));

  const out = [];
  for (const row of Array.isArray(raw) ? raw : []) {
    const id = str(row?.id ?? row?.city_id).trim();
    const name = nameOf(row);
    if (id && name) out.push({ id, name, province_id: null });
  }
  return out;
}

// ------------------------------------------------- price chart and changes
























// A chart point is {val, i}: the index is what ties it to its label, because
// the series is sparse in places. Matching on array position instead of `i`
// would shift every date by however many points are missing.
function pointsOf(entries, labels) {
  const list = Array.isArray(entries) ? entries : [];
  const points = [];
  for (const entry of list) {
    const i = Math.round(num(entry?.i, NaN));
    const value = num(entry?.val, NaN);
    const label = Number.isFinite(i) ? labels[i] : undefined;
    if (!Number.isFinite(value) || !label) continue;
    points.push({ i, point: { date: label, value: Math.round(value) } });
  }
  points.sort((a, b) => a.i - b.i);
  return points.map((p) => p.point);
}

/** Project Torob's chart, keeping only the last `months` monthly points. */
export function priceChartOf(raw, months) {
  const labels = Array.isArray(raw?.labels) ? raw.labels.map((l) => str(l).trim()) : [];
  const dataSets = Array.isArray(raw?.dataSets) ? raw.dataSets : [];
  const series = [];
  let available = 0;
  for (const set of dataSets) {
    const all = pointsOf(set?.entries, labels);
    available = Math.max(available, all.length);
    const points = all.slice(Math.max(0, all.length - months));
    if (!points.length) continue;
    const byValue = [...points].sort((a, b) => a.value - b.value);
    series.push({
      label: short(set?.label, 60) ?? "series",
      color: short(set?.color, 20),
      points,
      latest: points[points.length - 1] ?? null,
      lowest: byValue[0] ?? null,
      highest: byValue[byValue.length - 1] ?? null
    });
  }
  const longest = series.reduce((a, b) => a && a.points.length >= b.points.length ? a : b, null);
  return {
    series,
    points_available: available,
    window: {
      from: longest?.points[0]?.date ?? null,
      to: longest?.points[longest.points.length - 1]?.date ?? null,
      points: longest?.points.length ?? 0
    }
  };
}

/** One entry of Torob's own price-change feed for a product. */






export function priceChangesOf(raw, limit) {
  const results = Array.isArray(raw?.results) ? raw.results : [];
  const changes = [];
  for (const row of results) {
    const title = short(row?.title, 120);
    if (!title) continue;
    changes.push({
      title,
      description: short(row?.description, 200),
      time_ago: short(row?.timeago, 40)
    });
    if (changes.length >= limit) break;
  }
  return { count: Math.max(0, Math.round(num(raw?.count, changes.length))), changes };
}

// ------------------------------------------------------------ shop profiles





























function stringsOf(raw, cap = 5, n = 200) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    const text = typeof item === "string" ? short(item, n) : short(item?.title ?? item?.text, n);
    if (text) out.push(text);
    if (out.length >= cap) break;
  }
  return out;
}

/** A Torob shop page's own data, projected. */
export function shopProfileOf(raw, shopId) {
  const j = raw ?? {};
  const domain = str(j.domain).trim();
  const redirect = str(j.website_redirect_url).trim();
  const website = /^https?:\/\//.test(redirect) ?
  redirect :
  /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain) ?
  `https://${domain}` :
  null;
  const licenses = Array.isArray(j.licenses) ? j.licenses : [];
  const sealNotes = [];
  for (const license of licenses) {
    for (const part of [license?.title, license?.description_1, license?.description_2]) {
      const text = short(part, 160);
      if (text) sealNotes.push(text);
    }
  }
  const support = j.customer_support_info ?? null;
  return {
    shop_id: str(j.id, shopId),
    name: short(j.name, 100),
    shop_type: short(j.shop_type, 20),
    city: short(j.city, 60),
    province: short(j.province, 60),
    address: short(j.address, 300),
    website,
    logo: short(j.logo_512 ?? j.shop_logo, 300),
    is_marketplace: j.is_marketplace === true,
    status: short(j.block_description, 60),
    active_since: short(j.date_added, 60),
    active_time: short(j.active_time, 60),
    last_updated: short(j.last_updated, 80),
    score: num(j.shop_score, 0) > 0 ? Math.round(num(j.shop_score, 0) * 10) / 10 : null,
    score_percentile: Number.isFinite(num(j.score_percentile, NaN)) ? Math.round(num(j.score_percentile, 0)) : null,
    score_notes: stringsOf(j.score_info, 5, 200),
    trust_seal: {
      level: short(j.enamad_level, 60),
      valid_until: short(j.enamad_expire_date, 80),
      notes: sealNotes.slice(0, 4)
    },
    support: support ?
    { schedule: short(support.schedule, 120), badges: stringsOf(support.badges, 5, 80) } :
    null,
    payment: stringsOf(j.payment_info?.items, 5, 240),
    delivery: stringsOf(j.delivery_info?.items, 5, 240),
    about: (Array.isArray(j.additional_infos) ? j.additional_infos : []).
    slice(0, 4).
    map((info) => ({
      title: short(info?.title, 80) ?? "",
      text: short(info?.text, 320) ?? "",
      link: short(info?.link, 300)
    })).
    filter((info) => info.title || info.text),
    guarantee: short(j.guarantee_info?.status, 20),
    url: `https://torob.com/shop/${str(j.id, shopId)}/`
  };
}

/** A row of Torob's shop directory (its own search over shops). */










export function shopsOf(raw, limit) {
  const results = Array.isArray(raw?.results) ? raw.results : [];
  const shops = [];
  for (const row of results) {
    const id = str(row?.id).trim();
    const name = short(row?.name, 120);
    if (!id || !name) continue;
    shops.push({
      id,
      name,
      city: short(row?.city, 60),
      shop_type: short(row?.shop_type, 20),
      is_marketplace: row?.is_marketplace === true,
      logo: short(row?.shop_logo, 300),
      url: `https://torob.com/shop/${id}/`
    });
    if (shops.length >= limit) break;
  }
  return { count: Math.max(0, Math.round(num(raw?.count, shops.length))), shops };
}

// -------------------------------------------------------------- trends

/** One trending search, with a sample product when Torob sends one. */






export function trendsOf(raw, limit) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const row of list) {
    const query = short(row?.query, 100);
    if (!query) continue;
    const sample = row?.partial_info ? toCard(row.partial_info) : null;
    out.push({ query, category_id: str(row?.category_id).trim() || null, sample });
    if (out.length >= limit) break;
  }
  return out;
}

// ---------------------------------------------------------------- categories













/**
 * Torob's category tree, one level at a time. There is no "list all
 * categories" endpoint - the tree is walked through this one, which is why a
 * parent id is required. The live payload nests under `categories` and carries
 * a product count, which is what makes the walk worth doing.
 */
export async function categoryChildren(
id,
limit)
{
  const parent = str(id).trim();
  if (!parent) throw new UpstreamError("browse_categories needs a category id. Use id '1' for the top level.", "usage");
  const raw = await cached(`cat:${parent}:${limit}`, TTL.category, () =>
  torobGet(`/v4/category/price-list-nested/?id=${encodeURIComponent(parent)}&page=0&size=${Math.min(30, Math.max(1, limit))}`));

  const list = Array.isArray(raw?.categories) ? raw.categories : [];
  const categories = [];
  for (const c of list) {
    const cid = str(c?.id ?? c?.cat_id).trim();
    const title = short(c?.title ?? c?.name, 80);
    if (!cid || !title) continue;
    const count = num(c?.count, 0);
    categories.push({
      id: cid,
      title,
      slug: short(c?.slug, 120),
      image: short(c?.image, 300),
      url: str(c?.absolute_url).startsWith("/") ? `https://torob.com${str(c.absolute_url)}` : short(c?.absolute_url, 300),
      product_count: Math.max(0, Math.round(count)),
      has_children: count > 0,
      parent_id: parent
    });
  }
  return { parent, categories, has_more: categories.length >= limit };
}

// ----------------------------------------------------------------- locations












// Both location endpoints answer {count, next, previous, results:[{id, name}]}
// - verified live. The first attempt guessed `title` and silently returned an
// empty list, which is exactly the failure this projection exists to prevent:
// an endpoint that answers 200 with the wrong field name looks like "no such
// place", not like a bug.
function nameOf(row) {
  return short(row?.name ?? row?.title, 80);
}

// Rows that all fail to parse are not an empty list. A field renamed upstream
// (measured: `title` against `name` on the location endpoints) produced a clean
// `[]` that read as "there are no provinces" - the wrong answer in the
// direction a caller acts on. `results: []` means none exist; rows that exist
// and cannot be read mean this server and Torob disagree about the shape.
function assertReadable(list, raw, what) {
  const rows = Array.isArray(raw?.results) ? raw.results : [];
  if (list.length === 0 && rows.length > 0) {
    throw new UpstreamError(
    `Torob answered the ${what} endpoint with ${rows.length} row(s) this server could not read. ` +
    `The API shape may have changed, so this is reported instead of an empty list - "none found" ` +
    `would be a different answer.`,
    "http");

  }
}

export async function provinces() {
  // Read and checked inside the cached fetch, on purpose: the cache stores
  // whatever the fetcher returns, so an unreadable payload is the one shape
  // that must not be allowed through. Filing an empty province list under a
  // day-long key would answer "Iran has no provinces" long after upstream had
  // fixed itself.
  return cached("prov", TTL.locations, async () => {
    const raw = await torobGet("/v4/province/list/?size=200");
    const out = [];
    for (const p of Array.isArray(raw?.results) ? raw.results : []) {
      const id = str(p?.id ?? p?.province_id).trim();
      const name = nameOf(p);
      if (id && name) out.push({ id, name });
    }
    assertReadable(out, raw, "province list");
    // The rows-exist check above cannot see a *rename*: it re-reads the same
    // `results` key, so a renamed container reads as "no rows" and that check
    // never fires. Iran always has 31 provinces, so an empty list cannot be an
    // answer - it is this server and Torob disagreeing about the shape, and it
    // has to be said out loud rather than reported as an empty country.
    if (out.length === 0) {
      throw new UpstreamError(
      `Torob answered the province list with no provinces this server could read (it always has 31). ` +
      `The API shape may have changed, so this is reported instead of an empty list.`,
      "http");

    }
    return out;
  });
}

export async function cities(provinceId, search) {
  const params = new URLSearchParams({ size: "200" });
  if (provinceId) params.set("province", provinceId);
  if (search) params.set("search", search);
  const key = `city:${provinceId ?? ""}:${search ?? ""}`;
  // Read inside the cached fetch for the same reason as the province list: a
  // payload this server cannot read must not be the thing the cache remembers.
  // (An empty city list, unlike an empty province list, is a real answer - a
  // name that matches nothing - so only the unreadable case is refused here.)
  return cached(key, TTL.locations, async () => {
    const raw = await torobGet(`/v4/city/list/?${params.toString()}`);
    const out = [];
    for (const c of Array.isArray(raw?.results) ? raw.results : []) {
      const id = str(c?.id ?? c?.city_id).trim();
      const name = nameOf(c);
      if (!id || !name) continue;
      out.push({ id, name, province_id: str(c?.province_id ?? c?.province) || null });
    }
    assertReadable(out, raw, "city list");
    return out;
  });
}

// -------------------------------------------------------------------- offers










/**
 * Torob's featured-deals page. This is merchandising, not shop data: the live
 * payload is grouped banners under `results[].data[]`, each with a link and an
 * image, and some point off-site (TorobPay). Kept clearly separate from the
 * seller-offers list on a product, and the destination is reported as-is so a
 * caller can see when it leaves torob.com.
 */
export async function specialOffers(limit) {
  const raw = await cached("so", TTL.offers, () => torobGet("/v4/special-offers/?page=0"));



  const groupName = short(raw?.name, 120);
  const out = [];
  for (const group of Array.isArray(raw?.results) ? raw.results : []) {
    for (const o of Array.isArray(group?.data) ? group.data : []) {
      const url = str(o?.more_info_url ?? o?.api_url).trim();
      out.push({
        group: groupName ?? (num(group?.type, 0) ? `group ${Math.round(num(group.type, 0))}` : null),
        title: short(o?.title ?? o?.name1 ?? o?.text, 120),
        description: short(o?.description ?? o?.subtitle, 240),
        image: short(o?.desktop_image_url ?? o?.image_url, 300),
        url: url || null
      });
    }
    if (out.length >= limit) break;
  }
  return out.slice(0, limit);
}

// Types Torob sends that name a business listing rather than a wording for a
// product search (measured live: "phone" suggested phoneino.com and
// phonex1.ir with suggestion_type business_profile_query). They are dropped:
// a shop domain is not a query an agent should search Torob with.
const NON_PRODUCT_SUGGESTION_TYPES = new Set(["business_profile_query"]);

export async function suggestTerms(q) {
  const raw = await cached(`sg:${foldKey(q)}`, TTL.suggest, () =>
  torobGet(`/suggestion2/?q=${encodeURIComponent(searchTerm(q))}&source=next_desktop`));

  const out = [];
  let dropped = 0;
  if (Array.isArray(raw)) {
    for (const s of raw) {
      const text = short(s?.text, 80);
      if (!text) continue;
      if (NON_PRODUCT_SUGGESTION_TYPES.has(str(s?.suggestion_type))) {
        dropped += 1;
        continue;
      }
      out.push(text);
    }
  }
  return { query: q, suggestions: [...new Set(out)].slice(0, 10), dropped };
}

// ------------------------------------------------------------------- guide

/**
 * Torob's own guide for a product ("راهنمای جامع محصول"), the article the site
 * shows above the specs: an introduction to the model, its strengths and
 * weaknesses, what buyers said and who the product suits. Verified live on
 * 2026-10-09: `/v4/base-product/wiki/` answered 200 with 9.2KB of HTML for a
 * product whose details payload said only `has_wiki: true`.
 */



















// The guide is an article, not a record: a caller may ask for all of it, and the
// default keeps a product's pros and cons inside the kind of context budget the
// rest of the server respects. The numbers themselves live in tools.ts, next to
// the schema that advertises them (tests/agent-surface.test.mjs compares the two).
// h1 is the product's name - the same string the payload carries as `name1` -
// so it is read as a title and stripped out, while h2-h4 are the article's own
// sections (measured live: معرفی محصول، مشخصات، نقاط قوت، نقاط ضعف …).
const GUIDE_HEADING_RE = /<(h[2-4])[^>]*>([\s\S]*?)<\/\1>/gi;
const GUIDE_H1_RE = /<h1[^>]*>([\s\S]*?)<\/h1>/i;

// A small, deliberately narrow HTML reader: no dependency, and it never returns
// markup to a caller. The guide is generated HTML with headings, paragraphs,
// lists and the occasional admonition box, so the conversion is "headings become
// sections, everything else becomes text".
const HTML_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  // The joiners are written by code point: a literal one is invisible in an
  // editor and does not survive a copy.
  zwnj: String.fromCharCode(0x200c),
  zwj: String.fromCharCode(0x200d),
  "#39": "'",
  "#x27": "'"
};

function plainText(html) {
  return html.
  replace(/<br\s*\/?>/gi, "\n").
  replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "\n").
  replace(/<[^>]*>/g, " ").
  replace(/&([a-z0-9#x]+);/gi, (m, name) => HTML_ENTITIES[name.toLowerCase()] ?? m).
  replace(/[ \t\u00a0]+/g, " ").
  replace(/ *\n */g, "\n").
  replace(/\n{3,}/g, "\n\n").
  trim();
}

function capText(s, n) {
  return s.length > n ? `${s.slice(0, Math.max(1, n - 3)).trimEnd()}...` : s;
}

/**
 * Project Torob's guide into headings and text. Markup never reaches the caller:
 * the answer is the article's content, not its HTML.
 */
export function guideOf(raw) {
  const json = raw ?? {};
  const html = str(json.data_html);
  const h1 = short(plainText(str(html.match(GUIDE_H1_RE)?.[1])), 160);
  const title = short(json.name1, 160) ?? h1;
  if (!html) return { title, sections: [], text_length: 0 };
  const body = html.replace(/<h1[^>]*>[\s\S]*?<\/h1>/gi, "");
  const found = [...body.matchAll(GUIDE_HEADING_RE)];
  const sections = [];
  const before = plainText(found.length ? body.slice(0, found[0].index ?? 0) : body);
  if (before) sections.push({ heading: null, text: before });
  for (let i = 0; i < found.length; i++) {
    const heading = short(plainText(str(found[i][2])), 120);
    const from = (found[i].index ?? 0) + found[i][0].length;
    const to = i + 1 < found.length ? found[i + 1].index ?? body.length : body.length;
    const text = plainText(body.slice(from, to));
    if (!heading && !text) continue;
    sections.push({ heading, text });
  }
  const text_length = sections.reduce((n, s) => n + s.text.length, 0);
  return { title, sections, text_length };
}

/**
 * The guide for one product, in text. The id goes through the same ladder every
 * other product call uses (`confirmedPrk`), so a prk plus the card's
 * `details_url` opens it with no server-side memory involved.
 */
export async function productGuide(
prkInput,
maxChars,
opts)
{
  const prk = await confirmedPrk(prkInput, opts);
  const raw = await cached(`gd:${prk}`, TTL.guide, () =>
  torobGet(`/v4/base-product/wiki/?prk=${encodeURIComponent(prk)}`));

  const { title, sections, text_length } = guideOf(raw);
  const cap = Math.min(Math.max(1, maxChars), 8000);
  const out = [];
  let used = 0;
  let truncated = false;
  for (const section of sections) {
    if (used >= cap) {
      truncated = true;
      break;
    }
    const text = capText(section.text, cap - used);
    used += text.length;
    if (text.length < section.text.length) truncated = true;
    out.push({ heading: section.heading, text });
  }
  return {
    prk,
    title,
    sections: out,
    text_length,
    truncated,
    guide_url: `https://torob.com/p/${prk}/`,
    attribution: ATTRIBUTION
  };
}