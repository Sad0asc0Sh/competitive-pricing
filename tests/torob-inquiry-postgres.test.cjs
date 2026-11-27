'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { eq } = require('drizzle-orm')
const { randomBytes } = require('node:crypto')
const { installFakeTorob } = require('./helpers/fake-torob-mcp.cjs')
const { loadTsModule } = require('./helpers/ts-loader.cjs')
const fixture = require('./fixtures/torob-remotag-replay.json')

const testUrl = process.env.TOROB_TEST_DATABASE_URL

test('PostgreSQL runner and authenticated review persist extracted offers and scoped confirmation', { skip: !testUrl }, async (t) => {
  const dbUrl = new URL(testUrl)
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(dbUrl.hostname))
  assert.ok(dbUrl.pathname.endsWith('_test'), 'use a dedicated local test database')
  process.env.DATABASE_URL = testUrl
  process.env.TOROB_MCP_URL = 'http://fixture.invalid/mcp'
  process.env.ADMIN_PASSWORD = randomBytes(24).toString('hex')
  process.env.SESSION_SECRET = randomBytes(32).toString('hex')
  process.env.NODE_ENV = 'production'

  const { db, pool } = loadTsModule('src/db/index.ts')
  t.after(() => pool.end())
  const schema = loadTsModule('src/db/schema.ts')
  const { products, priceDecisions, competitorOffers } = schema
  const { runPricing, applyDecision } = loadTsModule('src/lib/services/runner.ts')
  const route = loadTsModule('src/app/api/decisions/[id]/route.ts')
  const productsRoute = loadTsModule('src/app/api/products/[id]/route.ts')
  const { createSessionToken, SESSION_COOKIE } = loadTsModule('src/lib/auth.ts')
  const known = fixture.search.results.find((row) => row.random_key === fixture.prk)
  const offers = fixture.details.products_info.result.slice(0, 2).map((offer, i) => ({
    shop_name: offer.shop_name, shop_id: offer.shop_id, shop_city: offer.shop_name2,
    product_title: offer.name1, price_toman: 1360000 + i * 30000, available: true,
    last_price_change_date: offer.last_price_change_date, shop_score: offer.shop_score, shop_votes: offer.shop_votes_count,
  }))
  const fake = installFakeTorob({
    search: () => fixture.search.results,
    details: { [fixture.prk]: { prk: fixture.prk, name_fa: known.name1, offers, in_person_sellers: [] } },
  })
  t.after(fake.restore)
  const [product] = await db.insert(products).values({
    sku: fixture.product.sku, name: fixture.product.name, costPrice: fixture.product.costPrice, sourceType: 'torob',
  }).returning()
  try {
    await runPricing({ trigger: 'manual', productIds: [product.id], runMode: 'shadow' })
    const [selectedProduct] = await db.select().from(products).where(eq(products.id, product.id))
    assert.equal(selectedProduct.torobPrk, null)
    assert.ok(selectedProduct.lastDecisionId)
    const decisionId = selectedProduct.lastDecisionId
    const [decision] = await db.select().from(priceDecisions).where(eq(priceDecisions.id, decisionId))
    assert.equal(decision.status, 'pending_review')
    assert.equal(decision.strategy, 'no_data')
    assert.equal(decision.finalPrice, null)
    assert.equal(decision.offersTotal, 2)
    assert.equal(decision.steps.find(({ step }) => step === 'torob_inquiry').data.validOffers, null)
    const denied = await applyDecision(decisionId, { force: true })
    assert.equal(denied.code, 'TOROB_REVIEW_REQUIRED')
    const storedOffers = await db.select().from(competitorOffers).where(eq(competitorOffers.decisionId, decisionId))
    assert.equal(storedOffers.length, 2)
    assert.ok(storedOffers.every((offer) => !offer.included && offer.torobEvidence.currency === 'toman'))
    assert.equal(storedOffers[0].torobEvidence.listingTitle, offers[0].product_title)

    const url = `http://localhost/api/decisions/${decisionId}`
    const params = { params: Promise.resolve({ id: String(decisionId) }) }
    const unauthorized = await route.GET(new Request(url), params)
    assert.equal(unauthorized.status, 401)
    assert.equal((await unauthorized.json()).reason, 'missing_token')
    const token = await createSessionToken()
    const request = (method, body) => new Request(url, {
      method,
      headers: { Cookie: `${SESSION_COOKIE}=${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const trace = await route.GET(request('GET'), params)
    assert.equal(trace.status, 200)
    assert.equal((await trace.json()).offers.length, 2)
    const callsBefore = fake.calls.length
    const relinked = await route.POST(request('POST', {
      action: 'relink_torob', torobUrl: `https://torob.com/p/${fixture.prk}/`, confirmIdentity: true,
    }), params)
    assert.equal(relinked.status, 200)
    const ack = await relinked.json()
    assert.equal(ack.confirmation.origin, 'admin_review')
    assert.equal(ack.confirmation.decisionId, decisionId)
    const [linked] = await db.select().from(products).where(eq(products.id, product.id))
    assert.equal(linked.torobLinkConfirmation.prk, fixture.prk)
    assert.ok(Number.isFinite(Date.parse(linked.torobLinkConfirmation.confirmedAt)))
    const [previous] = await db.select().from(priceDecisions).where(eq(priceDecisions.id, decisionId))
    assert.equal(previous.status, 'superseded')
    assert.ok(previous.steps.some(({ step }) => step === 'torob_link_confirmation'))
    assert.ok(linked.lastDecisionId > decisionId)
    const [next] = await db.select().from(priceDecisions).where(eq(priceDecisions.id, linked.lastDecisionId))
    assert.equal(next.steps.find(({ step }) => step === 'torob_inquiry').data.status, 'MATCH_CONFIRMED')
    assert.equal(next.status, 'pending_review')
    assert.ok(fake.calls.slice(callsBefore).some(({ name }) => name === 'product_details'))
    assert.ok(fake.calls.slice(callsBefore).every(({ name }) => name !== 'search_products'))

    const edited = await productsRoute.PATCH(request('PATCH', { torobUrl: 'https://torob.com/p/new-fixture-card/' }), {
      params: Promise.resolve({ id: String(product.id) }),
    })
    assert.equal(edited.status, 200)
    const revised = await edited.json()
    assert.equal(revised.torobPrk, 'new-fixture-card')
    assert.equal(revised.torobLinkConfirmation, null)
    const stale = await applyDecision(next.id, { force: true })
    assert.equal(stale.code, 'TOROB_REVIEW_REQUIRED')
  } finally {
    await db.delete(products).where(eq(products.id, product.id))
  }
})
