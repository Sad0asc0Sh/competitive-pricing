/**
 * ۴.۱.۲ (N2) — SQLهای پاک‌سازی timed_sale در یک ماژول خالص.
 *
 * قاعده‌ی ایمنی که با تست محافظت می‌شود:
 *  - UPDATE محصولات timed_sale فقط همان ردیف‌ها را می‌گیرد.
 *  - UPDATE پاک‌سازی ترب دقیقاً همان شرط SELECT است: cost_price = 0 AND torob_prk IS NOT NULL.
 *  - هیچ UPDATE‌ای status تصمیم‌ها را بازنویسی نمی‌کند (تاریخچه دست‌نخورده).
 */
const SELECT_PRODUCTS = `
  SELECT id, sku, name, cost_price, torob_prk, current_campaign, current_campaign_name,
         current_discount_pct, current_base_price, current_final_price
  FROM products
  WHERE current_campaign = 'timed_sale'
     OR (cost_price = 0 AND torob_prk IS NOT NULL)
  ORDER BY id ASC
`

const SELECT_DECISIONS = `
  SELECT d.id, d.product_id, p.sku, p.name, d.status, d.campaign_type, d.campaign_name,
         d.base_price, d.final_price, d.discount_pct
  FROM price_decisions d
  JOIN products p ON p.id = d.product_id
  WHERE d.campaign_type = 'timed_sale'
  ORDER BY d.id DESC
`

const SELECT_CAMPAIGNS = `
  SELECT id, name, type, active, min_discount_pct, card_range_from, card_range_to
  FROM discount_campaigns
  WHERE type = 'timed_sale' AND min_discount_pct <= 5 AND active = true
  ORDER BY id ASC
`

// A) فقط کارت‌های timed_sale؛ status محصول و لینک ترب دست‌نخورده می‌ماند.
const UPDATE_PRODUCT_CAMPAIGN = `
  UPDATE products
  SET current_campaign = 'none',
      current_campaign_name = NULL,
      current_discount_pct = 0,
      current_show_in_featured = false,
      updated_at = NOW()
  WHERE current_campaign = 'timed_sale'
`

// B) فقط محصولات بدون قیمت خرید که PRK ترب دارند (همان شرط SELECT).
const UPDATE_PRODUCT_NO_COST = `
  UPDATE products
  SET torob_prk = NULL,
      torob_details_url = NULL,
      auto_apply = false,
      updated_at = NOW()
  WHERE cost_price = 0 AND torob_prk IS NOT NULL
`

// C) تصمیم‌های غیر-applied فقط برچسب کمپینشان پاک می‌شود. status هرگز بازنویسی نمی‌شود.
const UPDATE_DECISIONS = `
  UPDATE price_decisions
  SET campaign_type = 'none',
      campaign_name = NULL,
      show_in_featured = false
  WHERE campaign_type = 'timed_sale' AND status <> 'applied'
`

const UPDATE_CAMPAIGN_SETTINGS = `
  UPDATE discount_campaigns
  SET active = false,
      min_discount_pct = 10,
      card_range_from = 21,
      card_range_to = 50
  WHERE type = 'timed_sale' AND min_discount_pct <= 5 AND active = true
`

module.exports = {
  SELECT_PRODUCTS,
  SELECT_DECISIONS,
  SELECT_CAMPAIGNS,
  UPDATE_PRODUCT_CAMPAIGN,
  UPDATE_PRODUCT_NO_COST,
  UPDATE_DECISIONS,
  UPDATE_CAMPAIGN_SETTINGS,
}
