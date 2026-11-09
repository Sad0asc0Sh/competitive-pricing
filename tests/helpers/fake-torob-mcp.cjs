'use strict'
/**
 * ترب جعلی برای تست‌های یکپارچه: fetch را طوری جایگزین می‌کند که سرور `torob-mcp` (JSON-RPC روی HTTP) را شبیه‌سازی کند.
 *   const fake = installFakeTorob({ search: (query, args) => [...cards], details: { [prk]: payload }, history: {...} })
 *   ... تست ...
 *   fake.restore()
 * fake.calls همهٔ فراخوانی‌های ابزار را نگه می‌دارد.
 */
function installFakeTorob(spec) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    const { name, arguments: args } = body.params
    calls.push({ name, args })
    const reply = (payload, isError = false) =>
      new Response(
        JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { isError, content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload) }] } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    if (spec.challenge && spec.challenge(name, args)) return reply('Torob challenged the request (HTTP 490)', true)
    if (name === 'search_products') return reply({ products: spec.search ? spec.search(args.query, args) : [] })
    if (name === 'product_details') {
      const d = spec.details && spec.details[args.prk]
      if (!d) return reply('not found', true)
      const offers = d.offers.slice(0, args.max_offers ?? 10)
      return reply({
        ...d,
        offers,
        ...(d.offers.length > offers.length ? { offers_truncated: true, offers_returned: offers.length } : {}),
        offer_count: d.offers.length,
      })
    }
    if (name === 'price_history') return reply(spec.history || { series: [] })
    return reply('unknown tool', true)
  }
  return { calls, restore: () => { globalThis.fetch = original } }
}

const agoText = (days) => {
  const toFa = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)])
  if (days < 1 / 24) return `${toFa(10)} دقیقه پیش`
  if (days < 1) return `${toFa(Math.max(1, Math.round(days * 24)))} ساعت پیش`
  return `${toFa(Math.round(days))} روز پیش`
}

/** یک پیشنهاد در قالب خروجی torob-mcp */
function mcpOffer({ shop, city = 'تهران', price, score = 4.6, votes = 80, ageDays = 0.3, available = true, guarantee = 'enabled', unreliable = false, adv = false }) {
  return {
    shop_name: shop, shop_city: city, shop_id: shop, shop_score: score, shop_votes: votes,
    price_toman: price, price_text: String(price), was_price_text: null, available, price_unreliable: unreliable,
    free_shipping: null, payment_on_delivery: null, same_day_delivery: null, url: null, buy_url: null, shop_note: null,
    is_adv: adv, postage_text: null, postage_fee_toman: null, delivered_price_toman: price, guarantee,
    installment_providers: [], last_price_change_date: agoText(ageDays), has_public_torob_profile: true, shop_score_percentile: null,
  }
}

module.exports = { installFakeTorob, mcpOffer, agoText }
