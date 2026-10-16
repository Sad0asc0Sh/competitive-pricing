/** One seller offer for a product. */
export interface Offer {
    shop_name: string;
    shop_city: string | null;
    shop_id: string | null;
    /** 0-5, or null when too few votes to mean anything. */
    shop_score: number | null;
    shop_votes: number;
    price_toman: number | null;
    price_text: string | null;
    /** Struck-through price when the shop had a discount. */
    was_price_text: string | null;
    available: boolean;
    /** Torob itself flags some prices as untrustworthy; surfaced, never hidden. */
    price_unreliable: boolean;
    free_shipping: boolean | null;
    payment_on_delivery: boolean | null;
    same_day_delivery: string | null;
    /** The shop's page on torob.com, e.g. https://torob.com/shop/392309/. */
    url: string | null;
    /**
     * Torob's own click-through link (the site's "خرید اینترنتی" button). It is an
     * api.torob.com redirect carrying tracking parameters and a session id, so it
     * is kept apart from `url` instead of being handed over as the shop's address.
     */
    buy_url: string | null;
    /** Torob's own sentence about this seller, when it sent one. */
    shop_note: string | null;
    /** Torob's own ad flag for this offer. */
    is_adv: boolean;
    /** Torob's postage line as sent, e.g. "هزینه ارسال ۷۰٫۰۰۰ تومان". */
    postage_text: string | null;
    /** Postage parsed from that line; null when it is free or unstated. */
    postage_fee_toman: number | null;
    /** price_toman + stated postage; equals price when postage is free/unstated. */
    delivered_price_toman: number | null;
    /** "enabled" / "disabled" from Torob's guarantee_info. */
    guarantee: string | null;
    /** BNPL providers Torob lists for this offer, by name. */
    installment_providers: string[];
    /** Persian relative time, e.g. "۲ ساعت پیش". */
    last_price_change_date: string | null;
    /** Whether the shop has a public Torob profile page. */
    has_public_torob_profile: boolean | null;
    /** The shop's percentile on Torob, 0-100, when sent. */
    shop_score_percentile: number | null;
}
export interface ProductCard {
    prk: string;
    name_fa: string | null;
    name_en: string | null;
    /** Cheapest available offer in Toman; null when out of stock. */
    price_toman: number | null;
    price_text: string | null;
    available: boolean;
    shop_name: string | null;
    image: string | null;
    image_count: number;
    badges: string[];
    url: string;
    /** Torob's ad flag for this row. */
    is_adv: boolean;
    /**
     * Torob's own details URL for this row. It carries the `search_id` the
     * details endpoint wants, so passing it back to product_details /
     * similar_products lets the server open the product without remembering
     * anything between requests.
     */
    details_url: string | null;
}
export interface ProductDetails extends ProductCard {
    offers: Offer[];
    offer_count: number;
    /** Spread between cheapest and dearest available offer, in Toman. */
    price_spread_toman: number | null;
    cheapest_offer: Offer | null;
    best_rated_offer: Offer | null;
    /** Cheapest offer once stated postage is added. */
    cheapest_delivered_offer: Offer | null;
    /** How this id was resolved: exact-id, name-search, details-url, remembered or id-only. */
    resolved_by: string;
    /** Torob's own cheapest and dearest price for this product, before slicing. */
    price_range_toman?: {
        min: number | null;
        max: number | null;
    };
    /** How many shops sell this product in person (حضوری), before slicing. */
    in_person_count: number;
    in_person_sellers: InPersonSeller[];
    /** torob.com's own map of those shops, when Torob sent the link. */
    in_person_map_url?: string;
    specs?: SpecItem[];
    specs_truncated?: true;
    specs_available?: number;
    variants?: ProductVariant[];
    category_path?: {
        id: string;
        title: string;
    }[];
    purchase_options?: PurchaseOption[];
    is_authentic?: true;
    has_wiki?: true;
    /** Torob's own reason for reporting availability differently than the price. */
    availability_note?: string;
    attribution: string;
}
interface RawProduct {
    random_key?: unknown;
    name1?: unknown;
    name2?: unknown;
    price?: unknown;
    price_text?: unknown;
    stock_status?: unknown;
    availability?: unknown;
    is_accessible?: unknown;
    image_url?: unknown;
    image_count?: unknown;
    web_client_absolute_url?: unknown;
    more_info_url?: unknown;
    badges?: unknown;
    is_adv?: unknown;
    product_page_url?: unknown;
    products_info?: {
        result?: unknown;
    };
    products_in_store_info?: {
        count?: unknown;
        result?: unknown;
        is_visible?: unknown;
        map_sellers_url?: unknown;
    };
    key_specs?: unknown;
    structural_specs?: unknown;
    variants?: unknown;
    breadcrumbs?: unknown;
    filters?: {
        items?: unknown;
    };
    min_price?: unknown;
    max_price?: unknown;
    torob_category?: unknown;
    is_authentic?: unknown;
    has_wiki?: unknown;
}
export interface RawSearch {
    results?: unknown;
    count?: unknown;
    min_price?: unknown;
    max_price?: unknown;
    next?: unknown;
    categories?: unknown;
    filters1?: unknown[];
    filters2?: unknown[];
    attributes?: unknown[];
    /**
     * The modern name for the same list, sent beside the three above and empty on
     * every live search measured (2026-10-09). Read as a fourth source so a
     * rename upstream cannot quietly turn the whole filter surface into "this
     * search takes no filters".
     */
    available_filters?: unknown[];
    spellcheck?: unknown;
    has_visible_result?: unknown;
}
/** A URL only when it is one of Torob's own details URLs, otherwise null. */
export declare function detailsUrlOf(v: unknown): string | null;
export declare function toCard(row: RawProduct): ProductCard | null;
export interface WaitUntil {
    waitUntil(promise: Promise<unknown>): void;
}
export declare function setWaitUntilEnabled(value: boolean): void;
/** Everything queued since the last drain, and nothing after it. */
export declare function takePendingWrites(): Promise<unknown>[];
export declare function offersOf(row: RawProduct): Offer[];
/** One shop that sells this product in person, as Torob lists it. */
export interface InPersonSeller {
    shop_name: string;
    shop_id: string | null;
    /** The shop's city, e.g. "مشهد". */
    city: string | null;
    /** Street address as Torob reports it (itself often truncated upstream). */
    address: string | null;
    /** The shop's own note, e.g. "تست و تحویل در حضور مشتری". */
    note: string | null;
    price_toman: number | null;
    price_text: string | null;
    /** Torob's own warning about this shelf price. */
    price_unreliable: boolean;
    is_open: boolean | null;
    /** Torob's own line for today, e.g. "تا ۰۹:۰۰ امروز" or "باز است". */
    hours_today: string | null;
    /** Torob's own status word, e.g. "بسته". */
    hours_status: string | null;
    /**
     * How long ago this shop's price was last touched, as Torob words it
     * (measured: "8 ماه و 9 روز پیش" on a live row). A shelf price can be old,
     * which is exactly why it travels with the number instead of being hidden.
     */
    last_price_change_date: string | null;
    fast_delivery: boolean;
    /**
     * Torob's own grade for this shop in the in-person list (measured live: 5, 4,
     * 3 on one product) - the badge the site shows beside the shop's name. It is
     * Torob's trust grade, not the 0-5 shopper score an offer carries.
     */
    score: number | null;
    /** Torob's own line for that grade, e.g. "خرید حضوری". */
    score_note: string | null;
    /** The shop's page on torob.com, where its details live. */
    url: string;
}
/** The in-person seller list a product's own details payload carries. */
export declare function inPersonSellersOf(raw: RawProduct): {
    count: number;
    sellers: InPersonSeller[];
    map_url: string | null;
};
/** One spec line. `group` is Torob's own table header when it sends one. */
export interface SpecItem {
    group: string | null;
    key: string;
    value: string;
}
/** The spec tables a product page shows, flattened into one capped list. */
export declare function specsOf(raw: RawProduct): {
    items: SpecItem[];
    available: number;
    truncated: boolean;
};
/** The variant tabs a product page shows (e.g. "اصالت کالا"), as cards. */
export interface ProductVariant {
    title: string;
    count: number;
    items: ProductCard[];
}
export declare function variantsOf(raw: RawProduct): ProductVariant[];
/** The category path Torob shows above the product, without its root. */
export declare function categoryPathOf(raw: RawProduct): {
    id: string;
    title: string;
}[];
/**
 * Torob's own quick purchase filters for this product ("دارای ضمانت ترب",
 * "با اعتبار ترب‌پی"): the price it starts at and how many sellers behind it.
 * They are reported as sent, because the wording and the price are Torob's.
 */
export interface PurchaseOption {
    title: string;
    price_from_text: string | null;
    online_sellers: number | null;
    offline_sellers: number | null;
}
export declare function purchaseOptionsOf(raw: RawProduct): PurchaseOption[];
/**
 * The full price window Torob knows for this product: its own cheapest and
 * dearest offer, straight from the details payload rather than from the
 * (partially truncated) seller list this server hands back.
 */
export declare function priceWindowOf(raw: RawProduct): {
    min: number | null;
    max: number | null;
} | null;
export interface SearchOptions {
    q: string;
    page: number;
    sort: string;
    category?: string;
    brand?: string;
    city?: string;
    shopType?: string;
    /** Upstream filter params, already validated by the tool layer. */
    filters?: Record<string, string>;
}
export interface SearchResult {
    products: ProductCard[];
    total: number;
    page: number;
    page_count: number;
    has_next_page: boolean;
    next_url: string | null;
    min_price_toman: number | null;
    max_price_toman: number | null;
    /**
     * The price group's own bounds for this result set (Torob sends the real
     * minimum and maximum as a filter, measured: 47,985 to 444,480,000 on
     * "هدفون"). It is the range of what is on this page set, not of the page.
     */
    price_bounds_toman: {
        min: number | null;
        max: number | null;
    } | null;
    /**
     * Every brand this search offers, with the value (the brand id) a `brand`
     * filter needs and the slug to recognise it by. The brand group in
     * available_filters is only a preview, so this is the list to read when the
     * wanted brand is not in it.
     */
    brand_values: {
        name: string;
        value: string;
        slug: string;
    }[];
    brand_values_truncated?: true;
    /** Categories Torob suggested for this wording, so an agent can narrow down. */
    suggested_categories: {
        id: string;
        title: string;
    }[];
    /** Every filter group this search accepts, with its slug. */
    available_filters: FilterGroup[];
    /**
     * Set when the groups above could not be read. The products are still a
     * complete answer - only the narrowing surface is missing, and saying so is
     * the difference between "this search takes no filters" and "this server and
     * Torob disagree about the shape".
     */
    available_filters_note?: string;
    spellcheck: {
        corrected: string | null;
        original: string;
    } | null;
    attribution: string;
}
export interface FilterOption {
    /** The label the search UI shows. */
    name: string;
    /** The value to pass back in `filters` (or, for a brand, in `brand`). */
    value: string;
    /** A brand's readable slug, for recognising it; Torob filters on `value`. */
    slug?: string;
}
export interface FilterGroup {
    title: string;
    slug: string;
    type: string;
    /** How many values this group advertises. */
    values: number;
    /** The values to pass back in `filters`; absent when the group takes none. */
    options?: FilterOption[];
    /** True when `options` is a preview rather than the whole list. */
    options_truncated?: boolean;
    /** For a brand group, the endpoint that lists all its values. */
    values_url?: string;
}
export declare const OPTION_PREVIEW = 10;
export declare function canonicalSlug(slug: string): string;
export declare function filterKeyMap(groups: FilterGroup[]): Map<string, FilterGroup>;
export declare function priceBoundsOf(raw: RawSearch): {
    min: number | null;
    max: number | null;
} | null;
export declare function brandValuesOf(raw: RawSearch): {
    values: {
        name: string;
        value: string;
        slug: string;
    }[];
    truncated: boolean;
};
export declare function filterMemoryKey(q: string, opts?: {
    category?: string;
    city?: string;
    shopType?: string;
}): string;
export declare function rememberFilterGroups(key: string, groups: FilterGroup[]): void;
export declare function rememberedFilterGroups(key: string): Promise<FilterGroup[] | null>;
export declare function searchProducts(opts: SearchOptions): Promise<SearchResult>;
/** A shared cap on the extra upstream lookups one tool call may make. */
export interface LookupBudget {
    left: number;
}
export declare function idFrom(source: string): string;
export interface ProductDetailsOptions {
    /** The `details_url` a card carried, handed back by the caller. */
    detailsUrl?: unknown;
    /** The words the caller searched with, as a last-resort way back to the row. */
    query?: unknown;
    /**
     * Internal: a shared cap on the extra upstream lookups a batch (compare) may
     * spend resolving ids. Omitted means no cap beyond the normal path.
     */
    lookupBudget?: LookupBudget;
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
export declare function productDetails(source: {
    more_info_url?: string;
    random_key?: string;
    prk?: string;
} | string, opts?: ProductDetailsOptions): Promise<ProductDetails>;
/**
 * Products Torob considers comparable to this one. This is the "that one is
 * too expensive - what else?" call, and it needs the same id resolution as
 * product_details.
 */
export declare function similarProducts(prkInput: string, limit: number, opts?: ProductDetailsOptions): Promise<ProductCard[]>;
/**
 * Torob's own price chart for a product: monthly points, each series carrying
 * its own label ("میانگین قیمت", "کمترین قیمت"). The upstream call takes only
 * the prk - the site adds a timestamp to defeat its CDN, which this server
 * deliberately does not do: the local TTL is what decides freshness, and a
 * cache-buster on every call would turn a free read into a fresh round trip.
 */
export declare function productPriceChart(prkInput: string, months: number, opts?: ProductDetailsOptions): Promise<PriceChart>;
export interface PriceChangesResult {
    /** How many changes Torob has on record for this product. */
    count: number;
    changes: PriceChange[];
}
/** Torob's own feed of price changes for one product, newest first. */
export declare function productPriceChanges(prkInput: string, limit: number, opts?: ProductDetailsOptions): Promise<PriceChangesResult>;
/** When Torob last changed this product's prices, as its own timestamp. */
export declare function productLastModified(prkInput: string, opts?: ProductDetailsOptions): Promise<string | null>;
/** One shop's Torob profile page, projected. */
export declare function shopProfile(shopIdInput: unknown): Promise<ShopProfile>;
export interface ShopCatalog {
    shop_id: string;
    /** How many products this shop has listed on Torob. */
    count: number;
    min_price_toman: number | null;
    max_price_toman: number | null;
    page: number;
    /** How many cards this upstream page held, before our own `limit`. */
    page_count: number;
    has_next_page: boolean;
    products: ProductCard[];
}
/** A shop's own catalogue, as search-style cards. */
export declare function shopProducts(shopIdInput: unknown, page: number, limit: number): Promise<ShopCatalog>;
export interface ShopSearchResult {
    count: number;
    page: number;
    has_next_page: boolean;
    shops: ShopSummary[];
}
/**
 * Torob's shop directory: a search over SHOPS, not products. Kept apart from
 * search_products on purpose - "موبایل" here means 11,124 businesses with that
 * word in their name, not products.
 */
export declare function findShops(opts: {
    q?: string;
    city?: string;
    shopType?: string;
    page: number;
    limit: number;
}): Promise<ShopSearchResult>;
export interface ImageSearchResult {
    page: number;
    page_count: number;
    has_next_page: boolean;
    /** Torob's echo of the image it looked at. */
    uploaded_image_url: string | null;
    /** Set when Torob recognised the image as one specific product. */
    matched_product: ProductCard | null;
    /** What Torob says it saw in the picture, when it says anything. */
    detected_objects: string[];
    products: ProductCard[];
}
export declare function searchByImage(imageUrl: string, page: number, limit: number): Promise<ImageSearchResult>;
/**
 * Torob's trending searches. The site sends `t=<now>` to defeat Torob's own
 * CDN; here the value is rounded to this server's TTL window, so the data
 * refreshes on the same rhythm as the cache without asking upstream for a
 * fresh copy on every call.
 */
export declare function trendingSearches(limit: number): Promise<TrendItem[]>;
/** The cities Torob's own users pick most, for a sensible default. */
export declare function popularCities(): Promise<City[]>;
export interface PricePoint {
    /** Torob's own label for that month, e.g. "۲۶ مرداد ۱۴۰۵". */
    date: string;
    value: number;
}
export interface PriceSeries {
    /** Torob's own series name, e.g. "میانگین قیمت" or "کمترین قیمت". */
    label: string;
    color: string | null;
    points: PricePoint[];
    latest: PricePoint | null;
    lowest: PricePoint | null;
    highest: PricePoint | null;
}
export interface PriceChart {
    series: PriceSeries[];
    /** How many monthly points Torob charts in total, before our own window. */
    points_available: number;
    window: {
        from: string | null;
        to: string | null;
        points: number;
    };
}
/** Project Torob's chart, keeping only the last `months` monthly points. */
export declare function priceChartOf(raw: unknown, months: number): PriceChart;
/** One entry of Torob's own price-change feed for a product. */
export interface PriceChange {
    title: string;
    description: string | null;
    time_ago: string | null;
}
export declare function priceChangesOf(raw: unknown, limit: number): {
    count: number;
    changes: PriceChange[];
};
export interface ShopProfile {
    shop_id: string;
    name: string | null;
    shop_type: string | null;
    city: string | null;
    province: string | null;
    address: string | null;
    website: string | null;
    logo: string | null;
    is_marketplace: boolean;
    /** Torob's own word for the shop's state, e.g. "فعال". */
    status: string | null;
    active_since: string | null;
    active_time: string | null;
    last_updated: string | null;
    score: number | null;
    score_percentile: number | null;
    /** Torob's own sentences about this shop, including any violation note. */
    score_notes: string[];
    trust_seal: {
        level: string | null;
        valid_until: string | null;
        notes: string[];
    };
    support: {
        schedule: string | null;
        badges: string[];
    } | null;
    payment: string[];
    delivery: string[];
    about: {
        title: string;
        text: string;
        link: string | null;
    }[];
    guarantee: string | null;
    url: string;
}
/** A Torob shop page's own data, projected. */
export declare function shopProfileOf(raw: unknown, shopId: string): ShopProfile;
/** A row of Torob's shop directory (its own search over shops). */
export interface ShopSummary {
    id: string;
    name: string;
    city: string | null;
    shop_type: string | null;
    is_marketplace: boolean;
    logo: string | null;
    url: string;
}
export declare function shopsOf(raw: unknown, limit: number): {
    count: number;
    shops: ShopSummary[];
};
/** One trending search, with a sample product when Torob sends one. */
export interface TrendItem {
    query: string;
    category_id: string | null;
    sample: ProductCard | null;
}
export declare function trendsOf(raw: unknown, limit: number): TrendItem[];
export interface CategoryNode {
    id: string;
    title: string;
    slug: string | null;
    image: string | null;
    url: string | null;
    /** How many products Torob has under this category. */
    product_count: number;
    has_children: boolean;
    parent_id: string | null;
}
/**
 * Torob's category tree, one level at a time. There is no "list all
 * categories" endpoint - the tree is walked through this one, which is why a
 * parent id is required. The live payload nests under `categories` and carries
 * a product count, which is what makes the walk worth doing.
 */
export declare function categoryChildren(id: string, limit: number): Promise<{
    parent: string;
    categories: CategoryNode[];
    has_more: boolean;
}>;
export interface Province {
    id: string;
    name: string;
}
export interface City {
    id: string;
    name: string;
    province_id: string | null;
}
export declare function provinces(): Promise<Province[]>;
export declare function cities(provinceId?: string, search?: string): Promise<City[]>;
export interface SpecialOffer {
    /** The banner/deal group this item belongs to. */
    group: string | null;
    title: string | null;
    description: string | null;
    image: string | null;
    url: string | null;
}
/**
 * Torob's featured-deals page. This is merchandising, not shop data: the live
 * payload is grouped banners under `results[].data[]`, each with a link and an
 * image, and some point off-site (TorobPay). Kept clearly separate from the
 * seller-offers list on a product, and the destination is reported as-is so a
 * caller can see when it leaves torob.com.
 */
export declare function specialOffers(limit: number): Promise<SpecialOffer[]>;
export declare function suggestTerms(q: string): Promise<{
    query: string;
    suggestions: string[];
    dropped: number;
}>;
/**
 * Torob's own guide for a product ("راهنمای جامع محصول"), the article the site
 * shows above the specs: an introduction to the model, its strengths and
 * weaknesses, what buyers said and who the product suits. Verified live on
 * 2026-10-09: `/v4/base-product/wiki/` answered 200 with 9.2KB of HTML for a
 * product whose details payload said only `has_wiki: true`.
 */
export interface GuideSection {
    /** Torob's own heading, e.g. "نقاط قوت"; null for text before the first one. */
    heading: string | null;
    text: string;
}
export interface ProductGuide {
    prk: string;
    /** The product's name as the guide titles it. */
    title: string | null;
    sections: GuideSection[];
    /** How many characters the whole guide holds, before the requested cap. */
    text_length: number;
    truncated: boolean;
    /** The product page, where this guide is rendered. */
    guide_url: string;
    attribution: string;
}
/**
 * Project Torob's guide into headings and text. Markup never reaches the caller:
 * the answer is the article's content, not its HTML.
 */
export declare function guideOf(raw: unknown): {
    title: string | null;
    sections: GuideSection[];
    text_length: number;
};
/**
 * The guide for one product, in text. The id goes through the same ladder every
 * other product call uses (`confirmedPrk`), so a prk plus the card's
 * `details_url` opens it with no server-side memory involved.
 */
export declare function productGuide(prkInput: string, maxChars: number, opts?: ProductDetailsOptions): Promise<ProductGuide>;
export {};
