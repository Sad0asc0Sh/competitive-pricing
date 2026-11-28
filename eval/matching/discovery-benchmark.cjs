#!/usr/bin/env node
'use strict'
const assert = require('node:assert/strict')
const { loadTsModule } = require('../../tests/helpers/ts-loader.cjs')
const { mcpOffer } = require('../../tests/helpers/fake-torob-mcp.cjs')
const regFixture = require('../../tests/fixtures/torob-discovery-regression.json')

const { resolveTorobSource } = loadTsModule('src/lib/sources/torob-discovery.ts')
const { evaluateTorobCandidate, selectBestTorobSearchMatch } = loadTsModule('src/lib/pricing/matcher.ts')
const { decodeTorobSearch } = loadTsModule('src/lib/sources/torob-payload.ts')
const { parseTitle } = loadTsModule('src/lib/pricing/match/parse.ts')
const { normalizeText } = loadTsModule('src/lib/pricing/match/text.ts')
const { TorobDiscoveryCache } = loadTsModule('src/lib/sources/torob-cache.ts')
const wallFixture = require('../../tests/fixtures/torob-wall-remote-incident.json')

const NOW = new Date('2026-11-27T14:00:00.000Z')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const offer = (shop, price, title, specs) => ({
  shopName: shop,
  shopId: shop,
  price,
  currency: 'toman',
  observedAt: NOW,
  listingTitle: title,
  listingSpecs: specs,
  inStock: true,
  sellerType: 'online',
  shopScore: 4.7,
  shopVotes: 50,
})
const detail = (prk, titleFa, offers, extra = {}) => ({
  prk,
  titleFa,
  titleEn: extra.titleEn ?? null,
  titleEvidence: { fields: ['name1'], parsed: true },
  specs: extra.specs ?? [],
  offers,
  sellerRows: offers.length,
  totalSellerCount: extra.totalSellerCount ?? offers.length,
  inPersonSellerCount: 0,
  onlineOfferCount: offers.length,
  offersTruncated: Boolean(extra.offersTruncated),
})

/**
 * Multi-category benchmark corpus (7 distinct product categories):
 * Tests retrieval recall, seller recall, precision, false confirmations, latency, and API efficiency.
 */
const BENCHMARK_CASES = [
  {
    id: 'CAT1-remote-hsp-315',
    category: 'Remotes',
    target: { productName: regFixture.target.name, sku: regFixture.target.sku, anchorPriceToman: 589000 },
    relevantPrks: ['syn-hsp-bazar-a', 'syn-hsp-jahan-b', 'syn-hsp-volta-c', 'syn-hsp-ekg-d', 'syn-hsp-ghofl-e'],
    relevantSellers: ['بازار قفل', 'جهان ریموت', 'ولتاتک', 'ای کا جی کالا', 'قفل مشهد'],
    forbiddenPrks: ['syn-hsp-433', 'syn-hsp-pack5', 'syn-hsp-4btn'],
    searchPages: (req) => {
      const q = req.query
      const page = req.page ?? 1
      const sort = req.sort ?? 'popularity'
      const distractors = [
        { random_key: 'syn-hsp-d1', name1: 'ریموت بلوتوثی سوئیچی تیغه پرایدی 315MHz برند HSP', price: 600000, shop_count: 1 },
        { random_key: 'syn-hsp-d2', name1: 'ریموت آزارا ۳۱۵ بلوتوث hsp', price: 600000, shop_count: 1 },
        { random_key: 'syn-hsp-d3', name1: 'ریموت بلوتوثی سوئیچی تیغه پژویی 315MHz برند HSP', price: 600000, shop_count: 1 },
        { random_key: 'syn-hsp-d4', name1: 'ریموت بلوتوث HSP آنتن‌دار مدل 57 فرکانس 315 مگاهرتز', price: 600000, shop_count: 1 },
        { random_key: 'syn-hsp-433', name1: 'ریموت بلوتوثی 433 بنزی 5 دکمه Hsp', price: 580000, shop_count: 1 },
        { random_key: 'syn-hsp-4btn', name1: 'ریموت بلوتوثی 315 بنزی 4 دکمه Hsp', price: 570000, shop_count: 1 },
        { random_key: 'syn-hsp-pack5', name1: 'ریموت بلوتوث بنزی فرکانس ۳۱۵ بسته ۵ عددی', name2: 'Hsp', price: 3250000, shop_count: 1 },
      ]
      if (sort === 'sellers') {
        return { results: [{ random_key: 'syn-hsp-ekg-d', name1: 'ریموت بلوتوثی 315 بنزی 5 دکمه', price: 589000, shop_count: 1 }], count: 60, next: null }
      }
      if (page === 2) {
        return { results: [{ random_key: 'syn-hsp-ghofl-e', name1: 'ریموت بلوتوثی بنزی ۵ دکمه ۳۱۵', price: 650000, shop_count: 1 }], count: 30, next: null }
      }
      if (q.includes('طرح بنزی')) {
        return { results: [regFixture.cards.cardC_volta, { random_key: 'syn-hsp-ghofl-e', name1: 'ریموت بلوتوثی بنزی ۵ دکمه ۳۱۵', price: 650000, shop_count: 1 }], count: 20, next: null }
      }
      if (q === 'ریموت بنزی') {
        return { results: [regFixture.cards.cardB_jahan, ...distractors], count: 40, next: 'page2' }
      }
      if (q.includes('اچ اس پی') || q.includes('315')) {
        return { results: [...distractors, regFixture.cards.cardA_bazar, regFixture.cards.cardC_volta], count: 40, next: 'page2' }
      }
      return { results: [...distractors, regFixture.cards.cardA_bazar], count: 40, next: 'page2' }
    },
    detailsMap: {
      'syn-hsp-bazar-a': detail('syn-hsp-bazar-a', regFixture.cards.cardA_bazar.name_fa, [offer('بازار قفل', 580000, regFixture.cards.cardA_bazar.name_fa)]),
      'syn-hsp-jahan-b': detail('syn-hsp-jahan-b', regFixture.cards.cardB_jahan.name_fa, [offer('جهان ریموت', 750000, 'ریموت بنزی بلوتوثی بنزی فرکانس 315 Hsp')], { titleEn: 'Hsp' }),
      'syn-hsp-volta-c': detail('syn-hsp-volta-c', regFixture.cards.cardC_volta.name_fa, [offer('ولتاتک', 610190, 'ریموت بلوتوثی طرح بنزی 315MHz برند HSP')]),
      'syn-hsp-ekg-d': detail('syn-hsp-ekg-d', 'ریموت بلوتوثی 315 بنزی 5 دکمه', [offer('ای کا جی کالا', 589000, 'ریموت بلوتوثی 315 بنزی 5 دکمه اصل')], { specs: [{ key: 'برند', value: 'Hsp' }] }),
      'syn-hsp-ghofl-e': detail('syn-hsp-ghofl-e', 'ریموت بلوتوثی بنزی ۵ دکمه ۳۱۵', [offer('قفل مشهد', 650000, 'ریموت بلوتوثی بنزی ۵ دکمه ۳۱۵')]),
      'syn-hsp-d1': detail('syn-hsp-d1', 'ریموت بلوتوثی سوئیچی تیغه پرایدی 315MHz برند HSP', [offer('دکو ۱', 600000, 'ریموت پرایدی 315 HSP')]),
      'syn-hsp-d2': detail('syn-hsp-d2', 'ریموت آزارا ۳۱۵ بلوتوث hsp', [offer('دکو ۲', 600000, 'ریموت آزارا 315 HSP')]),
      'syn-hsp-d3': detail('syn-hsp-d3', 'ریموت بلوتوثی سوئیچی تیغه پژویی 315MHz برند HSP', [offer('دکو ۳', 600000, 'ریموت پژویی 315 HSP')]),
      'syn-hsp-d4': detail('syn-hsp-d4', 'ریموت بلوتوث HSP آنتن‌دار مدل 57 فرکانس 315 مگاهرتز', [offer('دکو ۴', 600000, 'ریموت مدل 57 315 HSP')]),
    },
  },
  {
    id: 'CAT2-cctv-dahua-fragmented',
    category: 'CCTV Cameras',
    target: { productName: 'دوربین مداربسته داهوا مدل DH-HAC-HFW1200T لنز 3.6 میلی متر', sku: 'DH-HAC-HFW1200T', anchorPriceToman: 2450000 },
    relevantPrks: ['cam-1', 'cam-2'],
    relevantSellers: ['آلفا ویژن', 'سکیور تک'],
    forbiddenPrks: ['cam-lens28', 'cam-sib'],
    searchPages: (req) => {
      if (req.page === 2 || (req.query.includes('HFW1200T') && !req.query.includes('DH-'))) {
        return { results: [{ random_key: 'cam-2', name1: 'دوربین داهوا مدل HFW1200T لنز 3.6mm', price: 2420000, shop_count: 1 }], count: 10, next: null }
      }
      return {
        results: [
          { random_key: 'cam-1', name1: 'دوربین مداربسته داهوا مدل DH-HAC-HFW1200T لنز 3.6 میلی متر', price: 2450000, shop_count: 1 },
          { random_key: 'cam-lens28', name1: 'دوربین مداربسته داهوا مدل DH-HAC-HFW1200T لنز 2.8 میلی متر', price: 2450000, shop_count: 3 },
          { random_key: 'cam-sib', name1: 'دوربین مداربسته داهوا مدل DH-HAC-HFW1200TP', price: 2400000, shop_count: 4 },
        ],
        count: 30,
        next: 'p2',
      }
    },
    detailsMap: {
      'cam-1': detail('cam-1', 'دوربین مداربسته داهوا مدل DH-HAC-HFW1200T لنز 3.6 میلی متر', [offer('آلفا ویژن', 2450000, 'دوربین داهوا DH-HAC-HFW1200T لنز 3.6 میلی متر')]),
      'cam-2': detail('cam-2', 'دوربین داهوا مدل HFW1200T لنز 3.6mm', [offer('سکیور تک', 2420000, 'دوربین داهوا HFW1200T لنز 3.6mm')]),
      'cam-lens28': detail('cam-lens28', 'دوربین مداربسته داهوا مدل DH-HAC-HFW1200T لنز 2.8 میلی متر', [offer('تست لنز', 2450000, 'دوربین داهوا DH-HAC-HFW1200T لنز 2.8 میلی متر')]),
    },
  },
  {
    id: 'CAT3-access-control-remotag',
    category: 'Access Control',
    target: { productName: 'ماژول ریموتگ بتا (مناسب برای ریموتی و کارتی کردن آیفون اماکن)', sku: 'KY-8061', anchorPriceToman: 1360000 },
    relevantPrks: ['rem-1', 'rem-2'],
    relevantSellers: ['هوشمند سازان', 'ایمن آیفون'],
    forbiddenPrks: ['rem-tag', 'rem-pack2'],
    searchPages: (req) => {
      if (req.page === 2) {
        return { results: [{ random_key: 'rem-2', name1: 'برد کنترل دسترسی ریموتگ آیفون بتا', price: 1390000, shop_count: 1 }], count: 30, next: null }
      }
      return {
        results: [
          { random_key: 'rem-1', name1: 'اکسس کنترل ریموتگ بتا مدل هوشمند', price: 1360000, shop_count: 1 },
          { random_key: 'rem-tag', name1: 'کارت ریموتگ بتا', price: 35000, shop_count: 5 },
          { random_key: 'rem-pack2', name1: 'پک ۲ عددی ماژول ریموتگ بتا', price: 2700000, shop_count: 2 },
        ],
        count: 30,
        next: 'p2',
      }
    },
    detailsMap: {
      'rem-1': detail('rem-1', 'اکسس کنترل ریموتگ بتا مدل هوشمند', [offer('هوشمند سازان', 1360000, 'اکسس کنترل ریموتگ بتا مدل هوشمند')]),
      'rem-2': detail('rem-2', 'برد کنترل دسترسی ریموتگ آیفون بتا', [offer('ایمن آیفون', 1390000, 'برد کنترل دسترسی ریموتگ آیفون بتا')]),
    },
  },
  {
    id: 'CAT4-network-switch-poe',
    category: 'Network Switches',
    target: { productName: 'سوئیچ PoE ۸ پورت تی پی لینک مدل TL-SF1008P', sku: 'TL-SF1008P', anchorPriceToman: 2300000 },
    relevantPrks: ['sw-1', 'sw-2'],
    relevantSellers: ['نت بازار', 'پارس نت'],
    forbiddenPrks: ['sw-nonpoe', 'sw-gig'],
    searchPages: (req) => {
      if (req.sort === 'sellers') {
        return { results: [{ random_key: 'sw-2', name1: 'TP-Link TL-SF1008P 8-Port PoE Switch', price: 2350000, shop_count: 1 }], count: 40, next: null }
      }
      return {
        results: [
          { random_key: 'sw-1', name1: 'سوئیچ 8 پورت PoE تی پی لینک مدل TL-SF1008P', price: 2300000, shop_count: 1 },
          { random_key: 'sw-nonpoe', name1: 'سوئیچ 8 پورت 10/100 تی پی لینک مدل TL-SF1008D', price: 700000, shop_count: 12 },
          { random_key: 'sw-gig', name1: 'سوئیچ 8 پورت PoE+ گیگابیت تی پی لینک مدل TL-SG1008P', price: 4300000, shop_count: 8 },
        ],
        count: 40,
        next: 'p2',
      }
    },
    detailsMap: {
      'sw-1': detail('sw-1', 'سوئیچ 8 پورت PoE تی پی لینک مدل TL-SF1008P', [offer('نت بازار', 2300000, 'سوئیچ 8 پورت PoE تی پی لینک TL-SF1008P')]),
      'sw-2': detail('sw-2', 'TP-Link TL-SF1008P 8-Port PoE Switch', [offer('پارس نت', 2350000, 'TP-Link TL-SF1008P 8-Port PoE Switch')]),
    },
  },
  {
    id: 'CAT5-storage-ssd',
    category: 'Storage SSD',
    target: { productName: 'حافظه SSD اینترنال سامسونگ مدل 870 EVO ظرفیت 500 گیگابایت', sku: 'MZ-77E500BW', anchorPriceToman: 3300000 },
    relevantPrks: ['ssd-1', 'ssd-2'],
    relevantSellers: ['تک حافظه', 'آوا دیجیتال'],
    forbiddenPrks: ['ssd-1tb', 'ssd-250'],
    searchPages: (req) => {
      if (req.page === 2) {
        return { results: [{ random_key: 'ssd-2', name1: 'اس اس دی سامسونگ 870 EVO 500GB', price: 3340000, shop_count: 1 }], count: 35, next: null }
      }
      return {
        results: [
          { random_key: 'ssd-1', name1: 'اس اس دی اینترنال سامسونگ MZ-77E500BW 870 EVO 500GB', price: 3300000, shop_count: 1 },
          { random_key: 'ssd-1tb', name1: 'اس اس دی اینترنال سامسونگ مدل 870 EVO ظرفیت 1 ترابایت', price: 5600000, shop_count: 10 },
          { random_key: 'ssd-250', name1: 'SSD سامسونگ 870 EVO 250GB', price: 2100000, shop_count: 8 },
        ],
        count: 35,
        next: 'p2',
      }
    },
    detailsMap: {
      'ssd-1': detail('ssd-1', 'اس اس دی اینترنال سامسونگ MZ-77E500BW 870 EVO 500GB', [offer('تک حافظه', 3300000, 'اس اس دی سامسونگ MZ-77E500BW 870 EVO 500GB')]),
      'ssd-2': detail('ssd-2', 'اس اس دی سامسونگ 870 EVO 500GB', [offer('آوا دیجیتال', 3340000, 'اس اس دی سامسونگ MZ-77E500BW 870 EVO 500GB')]),
    },
  },
  {
    id: 'CAT6-psu-codeless',
    category: 'Power Supply',
    target: { productName: 'آداپتور 12 ولت 5 آمپر مین ول', sku: null, anchorPriceToman: 420000 },
    relevantPrks: ['psu-1', 'psu-2'],
    relevantSellers: ['برق ایران', 'تغذیه صنعت'],
    forbiddenPrks: ['psu-2a', 'psu-24v'],
    searchPages: (req) => {
      if (req.query.includes('12v') || req.query.includes('meanwell')) {
        return { results: [{ random_key: 'psu-2', name1: 'آداپتور مین ول 12V 5A', price: 430000, shop_count: 1 }], count: 12, next: null }
      }
      return {
        results: [
          { random_key: 'psu-1', name1: 'آداپتور 12 ولت 5 آمپر مین ول', price: 420000, shop_count: 1 },
          { random_key: 'psu-2a', name1: 'آداپتور 12 ولت 2 آمپر مین ول', price: 240000, shop_count: 5 },
          { random_key: 'psu-24v', name1: 'آداپتور 24 ولت 5 آمپر مین ول', price: 650000, shop_count: 4 },
        ],
        count: 20,
        next: null,
      }
    },
    detailsMap: {
      'psu-1': detail('psu-1', 'آداپتور 12 ولت 5 آمپر مین ول', [offer('برق ایران', 420000, 'آداپتور 12 ولت 5 آمپر مین ول')]),
      'psu-2': detail('psu-2', 'آداپتور مین ول 12V 5A', [offer('تغذیه صنعت', 430000, 'آداپتور 12 ولت 5 آمپر مین ول')]),
    },
  },
  {
    id: 'CAT7-cable-cat6',
    category: 'Cables & Industrial',
    target: { productName: 'کابل شبکه Cat6 UTP لگراند 305 متر', sku: null, anchorPriceToman: 7800000 },
    relevantPrks: ['cab-1', 'cab-2'],
    relevantSellers: ['تجهیز شبکه', 'کابل لاله زار'],
    forbiddenPrks: ['cab-100m', 'cab-cat5e'],
    searchPages: (req) => {
      if (req.query.includes('کت 6')) {
        return { results: [{ random_key: 'cab-2', name1: 'کابل شبکه کت 6 UTP لگراند 305 متری', price: 7900000, shop_count: 1 }], count: 10, next: null }
      }
      return {
        results: [
          { random_key: 'cab-1', name1: 'کابل شبکه لگراند Cat6 UTP 305 متر', price: 7800000, shop_count: 1 },
          { random_key: 'cab-100m', name1: 'کابل شبکه لگراند Cat6 UTP 100 متری', price: 2800000, shop_count: 4 },
          { random_key: 'cab-cat5e', name1: 'کابل شبکه لگراند Cat5e UTP 305 متری', price: 5200000, shop_count: 6 },
        ],
        count: 24,
        next: null,
      }
    },
    detailsMap: {
      'cab-1': detail('cab-1', 'کابل شبکه لگراند Cat6 UTP 305 متر', [offer('تجهیز شبکه', 7800000, 'کابل شبکه لگراند Cat6 UTP 305 متر')]),
      'cab-2': detail('cab-2', 'کابل شبکه کت 6 UTP لگراند 305 متری', [offer('کابل لاله زار', 7900000, 'کابل شبکه کت 6 UTP لگراند 305 متری')]),
    },
  },
  {
    id: 'CAT8-wall-remote-self-only-vs-consolidated',
    category: 'Wall Remotes (Self-Only Incident)',
    target: {
      productName: 'ریموت دیواری بتا مدل WLC-3CH 3 کانال لرن 433MHz',
      sku: 'WLC-3CH',
      anchorPriceToman: 235000,
    },
    relevantPrks: ['wall-consol-coded-b'],
    selfOnlyPrks: ['wall-self-coded-a'],
    relevantSellers: ['تهران گیت', 'امنیت پارس', 'دیجی ریموت', 'الکترو شرق', 'کیفیت کنترل', 'آلفا کنترل'],
    forbiddenPrks: ['wall-mismatch-315-d'],
    searchPages: (req) => {
      if (req.sort === 'sellers' || req.page === 2 || req.query.includes('دیواری') || req.query.includes('WLC')) {
        return {
          results: [
            { random_key: 'wall-self-coded-a', name1: 'ریموت دیواری بتا مدل WLC-3CH 3 کانال لرن 433MHz', price: 250000, shop_count: 1 },
            ...(req.sort === 'sellers' || req.page === 2 || req.query.includes('کد لرن') || req.query.includes('دیواری 433')
              ? [{ random_key: 'wall-consol-coded-b', name1: 'ریموت دیواری بتا مدل WLC-3CH 3 کانال کد لرن 433 مگاهرتز', price: 215000, shop_count: 7 }]
              : []),
            { random_key: 'wall-mismatch-315-d', name1: wallFixture.cards.cardD_mismatch.name_fa, price: 195000, shop_count: 3 },
          ],
          count: 30,
          next: 'page2',
        }
      }
      return {
        results: [
          { random_key: 'wall-self-coded-a', name1: 'ریموت دیواری بتا مدل WLC-3CH 3 کانال لرن 433MHz', price: 250000, shop_count: 1 },
        ],
        count: 30,
        next: 'page2',
      }
    },
    detailsMap: {
      'wall-self-coded-a': detail(
        'wall-self-coded-a',
        'ریموت دیواری بتا مدل WLC-3CH 3 کانال لرن 433MHz',
        [offer('ای کا جی کالا', 250000, 'ریموت دیواری بتا مدل WLC-3CH 3 کانال لرن 433MHz')],
      ),
      'wall-consol-coded-b': detail(
        'wall-consol-coded-b',
        'ریموت دیواری بتا مدل WLC-3CH 3 کانال کد لرن 433 مگاهرتز',
        [
          offer('ای کا جی کالا', 250000, 'ریموت دیواری بتا مدل WLC-3CH 3 کانال کد لرن 433 مگاهرتز'),
          offer('تهران گیت', 215000, 'ریموت دیواری بتا مدل WLC-3CH 3 کانال کد لرن 433 مگاهرتز'),
          offer('امنیت پارس', 220000, 'ریموت دیواری بتا مدل WLC-3CH 3 کانال کد لرن 433 مگاهرتز'),
          offer('دیجی ریموت', 224000, 'ریموت دیواری بتا مدل WLC-3CH 3 کانال کد لرن 433 مگاهرتز'),
          offer('الکترو شرق', 229000, 'ریموت دیواری بتا مدل WLC-3CH 3 کانال کد لرن 433 مگاهرتز'),
          offer('کیفیت کنترل', 235000, 'ریموت دیواری بتا مدل WLC-3CH 3 کانال کد لرن 433 مگاهرتز'),
          offer('آلفا کنترل', 240000, 'ریموت دیواری بتا مدل WLC-3CH 3 کانال کد لرن 433 مگاهرتز'),
        ],
      ),
      'wall-mismatch-315-d': detail(
        'wall-mismatch-315-d',
        wallFixture.cards.cardD_mismatch.name_fa,
        [offer('ناهمخوان ۳۱۵ یک', 195000, wallFixture.cards.cardD_mismatch.name_fa)],
      ),
    },
  },
  {
    id: 'CAT9-codeless-cosmetic-similar-incident',
    category: 'Remotes (Codeless Similar & Seller Vocabulary)',
    target: {
      productName: 'ریموت بلوتوثی رنگی فرکانس 433 لوکس',
      sku: null,
      anchorPriceToman: 360000,
    },
    // §13 سند رخداد — کارت «طرح ساده» مرتبط است؛ کارت پرلا (خانوادهٔ نام‌دار متفاوت) ممنوع.
    relevantPrks: ['lux-bt-433-1', 'fancy-bt-433-2', 'silicone-bt-433-3', 'simple-bt-433-4'],
    relevantSellers: ['باسلام', 'بست کنترل', 'آرکسیس سیستم‌های حفاظتی', 'قفلک', 'فروشگاه سیلیکون', 'فروشگاه طرح ساده'],
    forbiddenPrks: ['wrong-bt-315', 'perla-bt-433-9'],
    searchPages: (req) => {
      if (req.query.includes('سیلیکونی') || req.query.includes('مکعب')) {
        return {
          results: [
            { random_key: 'silicone-bt-433-3', name1: 'ریموت بلوتوثی سیلیکونی 433', price: 330000, shop_count: 1 },
          ],
          count: 10,
          next: null,
        }
      }
      if (req.query.includes('ساده')) {
        return {
          results: [
            { random_key: 'simple-bt-433-4', name1: 'ریموت بلوتوث فرکانس 433 مگاهرتز مدل رنگی طرح ساده', price: 345000, shop_count: 1 },
          ],
          count: 10,
          next: null,
        }
      }
      return {
        results: [
          { random_key: 'lux-bt-433-1', name1: 'ریموت بلوتوثی رنگی فرکانس 433 لوکس', price: 365000, shop_count: 1 },
          { random_key: 'wrong-bt-315', name1: 'ریموت بلوتوثی رنگی فرکانس 315 لوکس', price: 350000, shop_count: 2 },
          // کارت منفی پرلا با ۳ فروشندهٔ خانواده‌دار — سخت‌ترین حالت رخداد (در نتایج پیش‌فرض دیده می‌شود)
          { random_key: 'perla-bt-433-9', name1: 'ریموت بلوتوثی ۴۳۳ رنگی طرح پرلا', price: 149000, shop_count: 3 },
          // کارت «طرح ساده» هم در نتایج پیش‌فرض دیده می‌شود؛ شاخهٔ کوئری «ساده» مسیر کشف جایگزین می‌ماند.
          { random_key: 'simple-bt-433-4', name1: 'ریموت بلوتوث فرکانس 433 مگاهرتز مدل رنگی طرح ساده', price: 345000, shop_count: 1 },
        ],
        count: 15,
        next: null,
      }
    },
    similarFn: (card) => {
      if (card.prk === 'lux-bt-433-1') {
        return {
          results: [
            { random_key: 'fancy-bt-433-2', name1: 'ریموت بلوتوثی فانتزی ۴۳۳ رنگی', price: 340000, shop_count: 3 },
          ],
          count: 1,
          next: null,
        }
      }
      return { results: [], count: 0, next: null }
    },
    detailsMap: {
      'lux-bt-433-1': detail('lux-bt-433-1', 'ریموت بلوتوثی رنگی فرکانس 433 لوکس', [
        offer('باسلام', 365000, 'ریموت بلوتوثی رنگی فرکانس 433 لوکس'),
      ]),
      'fancy-bt-433-2': detail('fancy-bt-433-2', 'ریموت بلوتوثی فانتزی ۴۳۳ رنگی', [
        offer('بست کنترل', 335000, 'ریموت بلوتوثی فرکانس 433 سیلیکونی رنگی'),
        offer('آرکسیس سیستم‌های حفاظتی', 345000, 'ریموت بلوتوثی 433 فانتزی رنگی'),
        offer('قفلک', 355000, 'ریموت بلوتوثی 433 مکعب رنگی'),
      ], {
        specs: [
          { key: 'فرکانس', value: '433 مگاهرتز' },
          { key: 'نوع ریموت', value: 'بلوتوثی' },
          { key: 'باتری', value: '12V 27A' },
        ],
      }),
      'silicone-bt-433-3': detail('silicone-bt-433-3', 'ریموت بلوتوثی سیلیکونی 433', [
        offer('فروشگاه سیلیکون', 330000, 'ریموت بلوتوثی سیلیکونی فرکانس 433 رنگی'),
      ]),
      'simple-bt-433-4': detail('simple-bt-433-4', 'ریموت بلوتوث فرکانس 433 مگاهرتز مدل رنگی طرح ساده', [
        offer('فروشگاه طرح ساده', 345000, 'ریموت بلوتوثی 433 طرح ساده رنگی'),
      ], {
        specs: [
          { key: 'فرکانس', value: '433 مگاهرتز' },
          { key: 'نوع ریموت', value: 'بلوتوثی' },
        ],
      }),
      'perla-bt-433-9': detail('perla-bt-433-9', 'ریموت بلوتوثی ۴۳۳ رنگی طرح پرلا', [
        offer('فروشنده پرلا ۱', 149000, 'ریموت بلوتوثی 433 طرح پرلا رنگی'),
        offer('فروشنده پرلا ۲', 152000, 'ریموت بلوتوثی طرح پرلا 433 رنگی'),
        offer('فروشنده پرلا ۳', 155000, 'ریموت بلوتوثی پرلا فرکانس 433'),
      ], {
        specs: [
          { key: 'فرکانس', value: '433 مگاهرتز' },
          { key: 'نوع ریموت', value: 'بلوتوثی' },
          { key: 'طرح', value: 'پرلا' },
        ],
      }),
    },
  },
  {
    id: 'CAT10-mixed-variant-seller-partition',
    category: 'Remotes (Mixed Variant Card Partitioning)',
    target: {
      productName: 'ریموت بلوتوثی بتا فرکانس 433 مدل RX-4330',
      sku: 'RX-4330',
      anchorPriceToman: 400000,
    },
    relevantPrks: ['mv-generic-1', 'mv-compat-2'],
    relevantSellers: ['فروشنده الف', 'فروشنده ب', 'فروشنده ه'],
    forbiddenPrks: ['mv-wrong-card'],
    searchPages: () => ({
      results: [
        { random_key: 'mv-generic-1', name1: 'ریموت بلوتوثی', price: 400000, shop_count: 4 },
        { random_key: 'mv-compat-2', name1: 'ریموت بلوتوثی بتا فرکانس 433 RX-4330', price: 415000, shop_count: 1 },
        { random_key: 'mv-wrong-card', name1: 'ریموت بلوتوثی بتا فرکانس 315 مدل RX-4330', price: 390000, shop_count: 2 },
      ],
      count: 3,
      next: null,
    }),
    detailsMap: {
      'mv-generic-1': detail('mv-generic-1', 'ریموت بلوتوثی', [
        offer('فروشنده الف', 410000, 'ریموت بلوتوثی بتا فرکانس 433 مدل RX-4330'),
        offer('فروشنده ب', 420000, 'ریموت بلوتوثی بتا 433 مدل RX-4330 اصل'),
        offer('فروشنده ج', 405000, 'ریموت بلوتوثی بتا فرکانس 315 مدل RX-4330'),
        offer('فروشنده د', 120000, 'کاور سیلیکونی ریموت 433 مدل RX-4330'),
      ]),
      'mv-compat-2': detail('mv-compat-2', 'ریموت بلوتوثی بتا فرکانس 433 RX-4330', [
        offer('فروشنده ه', 430000, 'ریموت بلوتوثی بتا فرکانس 433 مدل RX-4330'),
      ]),
    },
  },
]

// Simulates the pre-fix baseline discovery loop (MAX_QUERIES=6, MAX_DETAILS=4, page 1 popularity only, old طرح veto).
async function runLegacyBaselineCase(c) {
  const queries = []
  const seen = new Set()
  const addQ = (q) => {
    const n = normalizeText(q)
    if (n.length >= 3 && !seen.has(n) && queries.length < 6) { seen.add(n); queries.push(q) }
  }
  addQ(c.target.productName)
  const p = parseTitle(c.target.productName, { sku: c.target.sku })
  const code = p.codes.find((x) => !x.inCompat && x.canon.length >= 5)
  if (code) addQ(code.raw)
  if (p.head?.cls === 'acc:remote') {
    addQ('ریموت بنزی 315 hsp'); addQ('ریموت 315 hsp'); addQ('ریموت بنزی hsp'); addQ('ریموت بنزی')
  }

  let apiCalls = 0
  const candMap = new Map()
  const t0 = Date.now()
  const codeless = !code
  for (const q of queries) {
    apiCalls++
    await sleep(25)
    const raw = c.searchPages({ query: q, page: 1, sort: 'popularity', limit: 24 })
    const decoded = decodeTorobSearch(raw, 24, 1)
    for (const card of decoded.candidates) {
      // Legacy over-broad طرح veto simulation
      if (!candMap.has(card.prk)) candMap.set(card.prk, card)
    }
    const outcome = selectBestTorobSearchMatch(c.target, [...candMap.values()])
    if (outcome.confident && !codeless) break
  }
  const ranked = selectBestTorobSearchMatch(c.target, [...candMap.values()]).allRanked
  const outcome = selectBestTorobSearchMatch(c.target, [...candMap.values()])
  const shortlist = ranked.filter((r) => !r.rejected && !/طرح/.test(r.candidate.titleFa)).slice(0, 4)
  const inspected = []
  for (const s of shortlist) {
    apiCalls++
    await sleep(30)
    const d = c.detailsMap[s.candidate.prk]
    if (d) inspected.push(d)
  }
  const latencyMs = Date.now() - t0
  const retrievedPrks = new Set(candMap.keys())
  const inspectedPrks = new Set(inspected.map((d) => d.prk))
  const foundSellers = new Set(inspected.flatMap((d) => d.offers.map((o) => o.shopName)))
  const confirmedWrong = inspected.some((d) => c.forbiddenPrks.includes(d.prk)) ? 1 : 0
  const selfOnlySelected = Array.isArray(c.selfOnlyPrks) && c.selfOnlyPrks.includes(outcome.best?.candidate?.prk) ? 1 : 0
  return {
    candidateRecall: c.relevantPrks.filter((id) => retrievedPrks.has(id)).length / c.relevantPrks.length,
    recallAt4: c.relevantPrks.filter((id) => inspectedPrks.has(id)).length / c.relevantPrks.length,
    sellerRecall: c.relevantSellers.filter((s) => foundSellers.has(s)).length / c.relevantSellers.length,
    falseConfirmations: confirmedWrong,
    selfOnlyFalseCompletion: selfOnlySelected,
    apiCalls,
    latencyMs,
    uninspectedPromising: ranked.filter((r) => !r.rejected && !inspectedPrks.has(r.candidate.prk) && c.relevantPrks.includes(r.candidate.prk)).length,
    uniqueRelevantPerReq: c.relevantPrks.filter((id) => retrievedPrks.has(id)).length / Math.max(1, apiCalls),
    cacheHits: 0,
  }
}

async function runAdaptiveCase(c, cache) {
  let apiCalls = 0
  const t0 = Date.now()
  const res = await resolveTorobSource({
    ...c.target,
    now: NOW,
    via: 'benchmark',
    mode: 'interactive',
    cache,
    search: async (req) => {
      apiCalls++
      await sleep(25)
      return { data: c.searchPages(req), origin: 'torob_mcp' }
    },
    details: async (card) => {
      apiCalls++
      await sleep(30)
      const d = c.detailsMap[card.prk]
      return d ? { data: d, origin: 'torob_mcp' } : { unavailable: true, issue: 'not_found' }
    },
    ...(c.similarFn
      ? {
          similar: async (card) => {
            apiCalls++
            await sleep(25)
            return { data: c.similarFn(card), origin: 'torob_mcp' }
          },
        }
      : {}),
    priceTrend: async () => null,
  })
  const latencyMs = Date.now() - t0
  const cov = res.torob.coverage
  const retrievedPrks = new Set((res.torob.search?.candidates ?? []).map((x) => x.prk))
  const inspectedPrks = new Set((res.torob.search?.candidates ?? []).filter((x) => x.extraction !== 'not_requested').map((x) => x.prk))
  const foundSellers = new Set(res.offers.map((o) => o.shopName))
  const confirmedForbidden = res.offers.some((o) => o.torobIdentity?.status === 'MATCH_CONFIRMED' && c.forbiddenPrks.includes(o.torobIdentity.prk)) ? 1 : 0
  const confirmedNonTarget = res.offers.some((o) => o.torobIdentity?.status === 'MATCH_CONFIRMED' && !c.relevantSellers.includes(o.shopName) && o.shopName !== 'ای کا جی کالا') ? 1 : 0
  const transparencyViolation = cov.status === 'complete_within_scope' && (cov.pagesRemaining > 0 || cov.promisingUninspectedCount > 0 || cov.sellerOffersTruncated) ? 1 : 0
  const selfOnlySelected = Array.isArray(c.selfOnlyPrks) && (c.selfOnlyPrks.includes(res.prk) || Boolean(res.torob.ownStoreOnlyOnPrimary)) ? 1 : 0
  return {
    candidateRecall: c.relevantPrks.filter((id) => retrievedPrks.has(id)).length / c.relevantPrks.length,
    recallAtK: c.relevantPrks.filter((id) => inspectedPrks.has(id)).length / c.relevantPrks.length,
    sellerRecall: c.relevantSellers.filter((s) => foundSellers.has(s)).length / c.relevantSellers.length,
    falseConfirmations: confirmedForbidden + confirmedNonTarget,
    selfOnlyFalseCompletion: selfOnlySelected,
    apiCalls,
    latencyMs,
    uninspectedPromising: cov.promisingUninspectedCount,
    uniqueRelevantPerReq: c.relevantPrks.filter((id) => retrievedPrks.has(id)).length / Math.max(1, apiCalls),
    cacheHits: cov.cacheHits,
    cacheHitRate: cov.cacheHitRate,
    transparencyViolation,
  }
}

function summarize(rows) {
  const avg = (k) => rows.reduce((s, r) => s + r[k], 0) / rows.length
  const sortedLat = rows.map((r) => r.latencyMs).sort((a, b) => a - b)
  const p = (q) => sortedLat[Math.min(sortedLat.length - 1, Math.floor((sortedLat.length - 1) * q))]
  return {
    candidateRecall: Number(avg('candidateRecall').toFixed(4)),
    sellerRecall: Number(avg('sellerRecall').toFixed(4)),
    recallAtK: Number(avg(rows[0].recallAtK != null ? 'recallAtK' : 'recallAt4').toFixed(4)),
    falseConfirmations: rows.reduce((s, r) => s + r.falseConfirmations, 0),
    selfOnlyFalseCompletions: rows.reduce((s, r) => s + (r.selfOnlyFalseCompletion ?? 0), 0),
    apiCallsPerInquiry: Number(avg('apiCalls').toFixed(2)),
    uniqueRelevantPerReq: Number(avg('uniqueRelevantPerReq').toFixed(3)),
    uninspectedPromising: Number(avg('uninspectedPromising').toFixed(2)),
    latencyP50Ms: p(0.5),
    latencyP95Ms: p(0.95),
    cacheHitRate: Number(avg('cacheHitRate' in rows[0] ? 'cacheHitRate' : 'cacheHits').toFixed(3)),
    transparencyViolations: rows.reduce((s, r) => s + (r.transparencyViolation ?? 0), 0),
  }
}

async function main() {
  const baselineRows = []
  const coldRows = []
  const warmRows = []
  const cache = new TorobDiscoveryCache()
  for (const c of BENCHMARK_CASES) {
    baselineRows.push(await runLegacyBaselineCase(c))
    coldRows.push(await runAdaptiveCase(c, cache))
  }
  for (const c of BENCHMARK_CASES) {
    warmRows.push(await runAdaptiveCase(c, cache))
  }
  const report = {
    cases: BENCHMARK_CASES.length,
    categories: BENCHMARK_CASES.map((c) => c.category),
    baseline: summarize(baselineRows),
    adaptiveCold: summarize(coldRows),
    adaptiveWarm: summarize(warmRows),
  }
  console.log(JSON.stringify(report, null, 2))
  assert.ok(report.adaptiveCold.candidateRecall > report.baseline.candidateRecall, 'adaptive candidate recall must exceed baseline')
  assert.ok(report.adaptiveCold.sellerRecall > report.baseline.sellerRecall, 'adaptive seller recall must exceed baseline')
  assert.equal(report.adaptiveCold.falseConfirmations, 0)
  assert.equal(report.adaptiveCold.selfOnlyFalseCompletions, 0)
  assert.equal(report.adaptiveCold.transparencyViolations, 0)
  assert.ok(report.adaptiveWarm.cacheHitRate >= 0.99)
}

main().catch((err) => { console.error(err); process.exit(1) })
