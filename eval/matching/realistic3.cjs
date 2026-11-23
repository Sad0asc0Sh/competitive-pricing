'use strict'
/**
 * مجموعهٔ «دست‌نویس تازه ۳» (held-out #2) — نوشته‌شده در ۱۴۰۴/۸ (۲۰۲۶-۱۱-۱۱) «پس از» بررسی مخزن فعلی و «پیش از» هر اجرا.
 *
 * هدف: سنجش اثر تغییرهای پس از ۴.۲.۰ (لنز به‌عنوان ویژگی اصلی، الزام برند برای کالای بدون کد، واژگان شیائومی/ردمی/لاجیتک)
 * بدون سوگیری. مجموعه‌های H01–H32 (realistic2) پس از آن تغییرها دیگر «تازه» نیستند.
 * قواعد برچسب مثل realistic2: same / diff / amb؛ برچسب‌ها فقط با دانش دامنه، قبل از اجرا روی هر موتوری؛
 * پس از اجرا تغییری در برچسب‌ها یا موتور «بر پایهٔ این مجموعه» مجاز نیست (مجموعهٔ بعدی لازم می‌شود).
 *
 * اجرا: node eval/matching/realistic3.cjs [--root DIR] [--verbose] [--json FILE]
 */
const path = require('path')
const fs = require('fs')
const { run } = require('./realistic.cjs')

const S = 'same'
const D = 'diff'
const A = 'amb'

const CASES = [
  {
    id: 'N01-dahua-hfw1230-lens36',
    target: { productName: 'دوربین مداربسته تحت شبکه داهوا مدل DH-IPC-HFW1230S1P-S5 لنز 3.6 میلی متر', sku: 'DH-IPC-HFW1230S1P-S5', anchorPriceToman: 2650000 },
    cands: [
      ['دوربین بولت تحت شبکه داهوا مدل DH-IPC-HFW1230S1P-S5 2 مگاپیکسل لنز 3.6mm', 2680000, 14, S],
      ['دوربین داهوا DH-IPC-HFW1230S1P-S5', 2650000, 9, S],
      ['دوربین مداربسته تحت شبکه داهوا مدل DH-IPC-HFW1230S1P-S5 لنز 2.8 میلی متر', 2690000, 8, D],
      ['دوربین مداربسته تحت شبکه داهوا مدل DH-IPC-HFW1230S1P-S5 لنز 6 میلی‌متر', 2750000, 4, D],
      ['دوربین مداربسته تحت شبکه داهوا مدل DH-IPC-HFW1230T1P-S5', 2500000, 12, D],
      ['دوربین مداربسته تحت شبکه داهوا مدل DH-IPC-HFW1430S1P-S5 4 مگاپیکسل', 3400000, 10, D],
    ],
  },
  {
    id: 'N02-hik-2cd1023-lens28',
    target: { productName: 'دوربین مداربسته تحت شبکه هایک ویژن مدل DS-2CD1023G0E-I لنز 2.8 میلی متر', sku: 'DS-2CD1023G0E-I', anchorPriceToman: 2300000 },
    cands: [
      ['دوربین هایک ویژن DS-2CD1023G0E-I 2MP لنز 2.8mm', 2320000, 11, S],
      ['دوربین مداربسته تحت شبکه هایک ویژن مدل DS-2CD1023G0E-I', 2300000, 7, S],
      ['دوربین مداربسته تحت شبکه هایک ویژن مدل DS-2CD1023G0E-I لنز 4 میلی متر', 2350000, 5, D],
      ['دوربین مداربسته تحت شبکه هایک ویژن مدل DS-2CD1043G0-I 4 مگاپیکسل', 3100000, 13, D],
      ['دوربین مداربسته تحت شبکه هایک ویژن مدل DS-2CD1023G0-IU دارای میکروفن', 2700000, 6, D],
    ],
  },
  {
    id: 'N03-dahua-xvr1b04',
    target: { productName: 'دستگاه ضبط ویدیو XVR داهوا مدل DH-XVR1B04-I چهار کانال', sku: 'DH-XVR1B04-I', anchorPriceToman: 2800000 },
    cands: [
      ['داهوا XVR1B04-I چهار کانال', 2820000, 10, S],
      ['دستگاه XVR داهوا مدل DH-XVR1B04-I 4CH 1080N', 2800000, 6, S],
      ['دستگاه ضبط ویدیو XVR داهوا مدل DH-XVR1B08-I هشت کانال', 3900000, 9, D],
      ['دستگاه ضبط ویدیو XVR داهوا مدل DH-XVR5104HS-I3 چهار کانال', 4600000, 8, D],
      ['هارد دیسک مخصوص دستگاه ضبط داهوا ۱ ترابایت', 2400000, 15, D],
    ],
  },
  {
    id: 'N04-no-brand-in-store-title-with-code',
    target: { productName: 'دوربین مداربسته DS-2CE76D0T-EXIPF', sku: null, anchorPriceToman: 1180000 },
    cands: [
      ['دوربین مداربسته دام هایک ویژن مدل DS-2CE76D0T-EXIPF', 1190000, 16, S],
      ['Hikvision DS-2CE76D0T-EXIPF 2MP Turbo HD', 1180000, 5, S],
      ['دوربین مداربسته دام هایک ویژن مدل DS-2CE76D0T-ITMF', 1330000, 14, D],
      ['دوربین مداربسته دام هایک ویژن مدل DS-2CE76D0T-EXIPF پک ۴ عددی', 4700000, 3, D],
    ],
  },
  {
    id: 'N05-logitech-m185',
    target: { productName: 'ماوس بی‌سیم لاجیتک مدل M185', sku: null, anchorPriceToman: 480000 },
    cands: [
      ['Logitech M185 Wireless Mouse', 490000, 21, S],
      ['ماوس لاجیتک M185', 480000, 12, S],
      ['ماوس بی سیم لاجیتک مدل M170', 420000, 19, D],
      ['ماوس بی‌سیم لاجیتک مدل M186', 560000, 7, D],
      ['ماوس بی سیم لاجیتک مدل M190', 780000, 11, D],
      ['ماوس بی سیم لاجیتک مدل M185 بسته ۲ عددی', 950000, 3, D],
      ['گیرنده یونیفایینگ لاجیتک', 250000, 6, D],
    ],
  },
  {
    id: 'N06-logitech-mk270',
    target: { productName: 'ماوس و کیبورد بی‌سیم لاجیتک مدل MK270', sku: 'MK270', anchorPriceToman: 1650000 },
    cands: [
      ['کیبورد و ماوس بی سیم لاجیتک مدل MK270', 1680000, 17, S],
      ['Logitech MK270 Wireless Combo', 1650000, 8, S],
      ['کیبورد و ماوس بی سیم لاجیتک مدل MK235', 1500000, 9, D],
      ['کیبورد و ماوس بی سیم لاجیتک مدل MK295', 2450000, 7, D],
      ['کیبورد و ماوس بی سیم لاجیتک مدل MK540', 3600000, 5, D],
      ['ماوس بی‌سیم لاجیتک مدل M185', 480000, 20, D],
    ],
  },
  {
    id: 'N07-generic-mouse-no-code',
    target: { productName: 'ماوس بی سیم', sku: null, anchorPriceToman: 250000 },
    cands: [
      ['ماوس بی سیم', 240000, 6, A],
      ['ماوس بی سیم لاجیتک مدل M185', 480000, 21, A],
      ['ماوس بی سیم ایسوس مدل WT425', 520000, 8, A],
      ['ماوس سیم دار ای فورتک', 180000, 9, A],
    ],
  },
  {
    id: 'N08-seagate-barracuda-1tb',
    target: { productName: 'هارد دیسک اینترنال سیگیت مدل BarraCuda ST1000DM010 ظرفیت 1 ترابایت', sku: 'ST1000DM010', anchorPriceToman: 2900000 },
    cands: [
      ['هارد اینترنال سیگیت BarraCuda 1TB ST1000DM010', 2950000, 18, S],
      ['Seagate ST1000DM010 1TB', 2900000, 6, S],
      ['هارد دیسک اینترنال سیگیت مدل BarraCuda ST2000DM008 ظرفیت 2 ترابایت', 3900000, 14, D],
      ['هارد دیسک اکسترنال سیگیت مدل Basic ظرفیت 1 ترابایت', 3600000, 12, D],
      ['هارد دیسک اینترنال سیگیت مدل SkyHawk ST1000VX005 ظرفیت 1 ترابایت', 3300000, 10, D],
    ],
  },
  {
    id: 'N09-wd-purple-2tb',
    target: { productName: 'هارد دیسک اینترنال وسترن دیجیتال مدل Purple WD22PURZ ظرفیت 2 ترابایت', sku: 'WD22PURZ', anchorPriceToman: 4600000 },
    cands: [
      ['هارد وسترن دیجیتال بنفش ۲ ترابایت WD22PURZ', 4650000, 13, S],
      ['WD Purple 2TB WD22PURZ Surveillance HDD', 4600000, 5, S],
      ['هارد دیسک اینترنال وسترن دیجیتال مدل Purple WD42PURZ ظرفیت 4 ترابایت', 7400000, 11, D],
      ['هارد دیسک اینترنال وسترن دیجیتال مدل Purple WD10PURZ ظرفیت 1 ترابایت', 3100000, 9, D],
      ['هارد دیسک اینترنال وسترن دیجیتال مدل Blue WD20EZBX ظرفیت 2 ترابایت', 3900000, 15, D],
    ],
  },
  {
    id: 'N10-tplink-wr840n',
    target: { productName: 'مودم روتر بی‌سیم تی پی لینک مدل TL-WR840N', sku: 'TL-WR840N', anchorPriceToman: 780000 },
    cands: [
      ['روتر بی سیم تی پی لینک TL-WR840N N300', 790000, 22, S],
      ['TP-Link TL-WR840N 300Mbps Wireless Router', 780000, 8, S],
      ['روتر بی سیم تی پی لینک مدل TL-WR841N', 920000, 17, D],
      ['روتر بی سیم تی پی لینک مدل TL-WR844N', 1100000, 6, D],
      ['روتر بی سیم تی پی لینک مدل Archer C6 AC1200', 2100000, 14, D],
      ['منبع تغذیه روتر تی پی لینک ۹ ولت', 120000, 5, D],
    ],
  },
  {
    id: 'N11-redmi-note12-4g',
    target: { productName: 'گوشی موبایل شیائومی مدل Redmi Note 12 4G دو سیم کارت ظرفیت 128 گیگابایت و رم 6 گیگابایت', sku: null, anchorPriceToman: 8900000 },
    cands: [
      ['Xiaomi Redmi Note 12 4G 128GB 6GB RAM', 9000000, 19, S],
      ['گوشی شیائومی Redmi Note 12 4G ظرفیت 128 رم 6', 8900000, 11, S],
      ['گوشی موبایل شیائومی مدل Redmi Note 12 Pro 4G ظرفیت 128 گیگابایت و رم 8 گیگابایت', 12500000, 16, D],
      ['گوشی موبایل شیائومی مدل Redmi Note 12 5G ظرفیت 128 گیگابایت و رم 4 گیگابایت', 9800000, 18, D],
      ['گوشی موبایل شیائومی مدل Redmi Note 12 4G ظرفیت 256 گیگابایت و رم 8 گیگابایت', 11300000, 9, D],
      ['گوشی موبایل شیائومی مدل Redmi Note 12S ظرفیت 128 گیگابایت', 9600000, 7, D],
      ['قاب محافظ گوشی شیائومی Redmi Note 12 4G', 150000, 14, D],
      ['محافظ صفحه نمایش گلس برای Redmi Note 12 4G', 90000, 12, D],
    ],
  },
  {
    id: 'N12-redmi-buds4-lite',
    target: { productName: 'هدفون بی سیم شیائومی مدل Redmi Buds 4 Lite', sku: null, anchorPriceToman: 1450000 },
    cands: [
      ['Xiaomi Redmi Buds 4 Lite', 1480000, 12, S],
      ['هندزفری بلوتوثی ردمی Buds 4 Lite شیائومی', 1450000, 6, S],
      ['هدفون بی سیم شیائومی مدل Redmi Buds 4 Active', 1250000, 11, D],
      ['هدفون بی سیم شیائومی مدل Redmi Buds 4', 2100000, 9, D],
      ['هدفون بی سیم شیائومی مدل Redmi Buds 4 Pro', 3900000, 8, D],
      ['هدفون بی سیم شیائومی مدل Redmi Buds 3 Lite', 1300000, 10, D],
    ],
  },
  {
    id: 'N13-mi-band-8',
    target: { productName: 'مچ بند هوشمند شیائومی مدل Mi Band 8', sku: null, anchorPriceToman: 2400000 },
    cands: [
      ['Xiaomi Smart Band 8', 2450000, 15, S],
      ['مچ بند هوشمند شیائومی مدل Mi Band 8 نسخه گلوبال', 2400000, 8, S],
      ['مچ بند هوشمند شیائومی مدل Mi Band 7', 1900000, 13, D],
      ['مچ بند هوشمند شیائومی مدل Smart Band 8 Active', 1350000, 10, D],
      ['مچ بند هوشمند شیائومی مدل Smart Band 8 Pro', 4500000, 7, D],
      ['بند سیلیکونی مچ بند شیائومی Mi Band 8', 120000, 9, D],
    ],
  },
  {
    id: 'N14-generic-adapter-12v2a',
    target: { productName: 'آداپتور 12 ولت 2 آمپر دوربین مداربسته', sku: null, anchorPriceToman: 120000 },
    cands: [
      ['آداپتور 12 ولت 2 آمپر', 115000, 14, A],
      ['آداپتور 12 ولت 5 آمپر دوربین مداربسته', 270000, 12, D],
      ['آداپتور 12 ولت 1 آمپر', 80000, 10, D],
      ['منبع تغذیه 12 ولت 10 آمپر ۸ کانال دوربین مداربسته', 650000, 8, D],
    ],
  },
  {
    id: 'N15-samsung-870evo-500',
    target: { productName: 'حافظه SSD اینترنال سامسونگ مدل 870 EVO ظرفیت 500 گیگابایت', sku: 'MZ-77E500BW', anchorPriceToman: 4300000 },
    cands: [
      ['SSD سامسونگ 870 EVO 500GB MZ-77E500BW', 4350000, 20, S],
      ['حافظه SSD اینترنال سامسونگ مدل 870 EVO ظرفیت 500 گیگابایت', 4300000, 9, S],
      ['حافظه SSD اینترنال سامسونگ مدل 870 EVO ظرفیت 1 ترابایت MZ-77E1T0BW', 7900000, 18, D],
      ['حافظه SSD اینترنال سامسونگ مدل 870 EVO ظرفیت 250 گیگابایت MZ-77E250BW', 2700000, 14, D],
      ['حافظه SSD اینترنال سامسونگ مدل 860 EVO ظرفیت 500 گیگابایت MZ-76E500BW', 4100000, 6, D],
      ['حافظه SSD اینترنال سامسونگ مدل 980 NVMe ظرفیت 500 گیگابایت', 4500000, 12, D],
    ],
  },
  {
    id: 'N16-kingston-a400-480',
    target: { productName: 'حافظه SSD اینترنال کینگستون مدل A400 ظرفیت 480 گیگابایت', sku: 'SA400S37/480G', anchorPriceToman: 2600000 },
    cands: [
      ['Kingston A400 480GB SA400S37/480G', 2650000, 17, S],
      ['اس اس دی کینگستون A400 ظرفیت 480 گیگابایت', 2600000, 9, S],
      ['حافظه SSD اینترنال کینگستون مدل A400 ظرفیت 240 گیگابایت SA400S37/240G', 1700000, 15, D],
      ['حافظه SSD اینترنال کینگستون مدل A400 ظرفیت 960 گیگابایت SA400S37/960G', 4600000, 8, D],
      ['حافظه SSD اینترنال کینگستون مدل NV2 ظرفیت 500 گیگابایت', 2900000, 10, D],
    ],
  },
  {
    id: 'N17-samsung-a15',
    target: { productName: 'گوشی موبایل سامسونگ مدل Galaxy A15 ظرفیت 128 گیگابایت رم 4 گیگابایت', sku: 'SM-A155F', anchorPriceToman: 8300000 },
    cands: [
      ['Samsung Galaxy A15 SM-A155F 128GB 4GB', 8400000, 21, S],
      ['گوشی سامسونگ Galaxy A15 ظرفیت 128 رم 4', 8300000, 10, S],
      ['گوشی موبایل سامسونگ مدل Galaxy A15 5G SM-A156E ظرفیت 128 گیگابایت', 10900000, 13, D],
      ['گوشی موبایل سامسونگ مدل Galaxy A15 ظرفیت 256 گیگابایت رم 8 گیگابایت', 10200000, 8, D],
      ['گوشی موبایل سامسونگ مدل Galaxy A25 5G ظرفیت 128 گیگابایت', 12800000, 11, D],
      ['گوشی موبایل سامسونگ مدل Galaxy A05 ظرفیت 64 گیگابایت', 5500000, 14, D],
      ['قاب محافظ گوشی سامسونگ Galaxy A15', 140000, 9, D],
    ],
  },
  {
    id: 'N18-sandisk-ultra-128',
    target: { productName: 'کارت حافظه microSDXC سن دیسک مدل Ultra A1 ظرفیت 128 گیگابایت', sku: 'SDSQUAB-128G-GN6MN', anchorPriceToman: 1350000 },
    cands: [
      ['SanDisk Ultra microSDXC A1 128GB SDSQUAB-128G-GN6MN', 1380000, 16, S],
      ['کارت حافظه microSDXC سن دیسک مدل Ultra A1 ظرفیت 128 گیگابایت', 1350000, 8, S],
      ['کارت حافظه microSDXC سن دیسک مدل Ultra A1 ظرفیت 64 گیگابایت SDSQUAB-064G-GN6MN', 850000, 14, D],
      ['کارت حافظه microSDXC سن دیسک مدل Ultra A1 ظرفیت 256 گیگابایت SDSQUAB-256G-GN6MN', 2400000, 10, D],
      ['کارت حافظه microSDXC سن دیسک مدل Extreme V30 ظرفیت 128 گیگابایت', 1900000, 9, D],
    ],
  },
  {
    id: 'N19-ezviz-h3c-lens-and-model',
    target: { productName: 'دوربین هوشمند ایزویز مدل H3C 2MP لنز 2.8 میلی متر', sku: null, anchorPriceToman: 2300000 },
    cands: [
      ['دوربین ایزویز مدل H3C 2MP لنز 2.8mm', 2350000, 9, S],
      ['Ezviz H3C 1080P Wi-Fi Camera', 2300000, 7, S],
      ['دوربین ایزویز مدل H3C 2MP لنز 4 میلی متر', 2380000, 4, D],
      ['دوربین ایزویز مدل H3C 2K 3MP', 2900000, 8, D],
      ['دوربین ایزویز مدل H8C 2MP', 3400000, 6, D],
      ['دوربین ایزویز مدل C3N', 1700000, 18, D],
    ],
  },
  {
    id: 'N20-uniview-ipc322-lens',
    target: { productName: 'دوربین مداربسته تحت شبکه یونی ویو مدل IPC322LB-SF28-A لنز 2.8 میلی متر', sku: 'IPC322LB-SF28-A', anchorPriceToman: 3100000 },
    cands: [
      ['دوربین تحت شبکه یونی ویو IPC322LB-SF28-A 2MP', 3120000, 6, S],
      ['Uniview IPC322LB-SF28-A 2MP', 3100000, 4, S],
      ['دوربین مداربسته تحت شبکه یونی ویو مدل IPC322LB-SF40-A لنز 4 میلی متر', 3150000, 5, D],
      ['دوربین مداربسته تحت شبکه یونی ویو مدل IPC322LB-SF28-A لنز 6 میلی متر', 3200000, 3, D],
      ['دوربین مداربسته تحت شبکه یونی ویو مدل IPC2122LB-SF28-A', 2900000, 7, D],
    ],
  },
  {
    id: 'N21-generic-hdmi-cable',
    target: { productName: 'کابل HDMI طول 3 متر', sku: null, anchorPriceToman: 160000 },
    cands: [
      ['کابل HDMI طول 3 متر', 150000, 12, A],
      ['کابل HDMI طول 5 متر', 230000, 10, D],
      ['کابل HDMI طول 1.5 متر', 110000, 9, D],
      ['کابل HDMI انکر طول 3 متر', 420000, 6, A],
      ['کابل تبدیل HDMI به VGA', 210000, 11, D],
    ],
  },
  {
    id: 'N22-codeless-cctv-bullet-2mp',
    target: { productName: 'دوربین مداربسته بولت AHD دو مگاپیکسل', sku: null, anchorPriceToman: 900000 },
    cands: [
      ['دوربین بولت AHD 2MP', 880000, 13, A],
      ['دوربین مداربسته بولت هایک ویژن مدل DS-2CE16D0T-IT3F', 1550000, 16, A],
      ['دوربین مداربسته بولت AHD چهار مگاپیکسل', 1300000, 9, D],
      ['دوربین مداربسته دام AHD دو مگاپیکسل', 920000, 10, D],
    ],
  },
]

module.exports = { CASES }

if (require.main === module) {
  function arg(name, def) {
    const i = process.argv.indexOf('--' + name)
    return i >= 0 ? process.argv[i + 1] : def
  }
  const root = path.resolve(arg('root', path.join(__dirname, '..', '..')))
  const verbose = process.argv.includes('--verbose')
  const r = run(root, verbose, CASES)
  const pc = (a, b) => (b ? ((a / b) * 100).toFixed(1) + '%' : 'n/a')
  console.log(`\nمجموعهٔ تازهٔ ۳ (held-out #2) — ${CASES.length} کیس ، ${r.pairs} جفت — root=${path.basename(root)}`)
  console.log(`same(${r.same.n}): approve ${pc(r.same.approve, r.same.n)} review ${pc(r.same.review, r.same.n)} reject ${pc(r.same.reject, r.same.n)}`)
  console.log(`diff(${r.diff.n}): تایید اشتباه ${r.diff.approve} (${pc(r.diff.approve, r.diff.n)}) review ${pc(r.diff.review, r.diff.n)} reject ${pc(r.diff.reject, r.diff.n)}`)
  console.log(`amb (${r.amb.n}): تایید خودکار ${r.amb.approve} (${pc(r.amb.approve, r.amb.n)}) review ${pc(r.amb.review, r.amb.n)} reject ${pc(r.amb.reject, r.amb.n)}`)
  console.log(`سطح کیس: انتخاب نهایی تاییدشده و درست ${r.caseCorrect} | تاییدشدهٔ اشتباه ${r.caseWrong} | کارت درست بود ولی خودکار نشد ${r.caseReviewSame} | بدون کارت درست و تایید نشد ${r.caseNoSame}`)
  if (r.fails.length) {
    console.log('\nتاییدهای خودکارِ ممنوع:')
    for (const f of r.fails) console.log(`  [${f.id}/${f.label}] «${f.target}» ⇒ «${f.cand}» ${f.score}%  ${f.notes.join(' | ')}`)
  }
  if (r.misses.length && !process.argv.includes('--quiet')) {
    console.log('\nکارت‌های درستی که خودکار نشدند:')
    for (const m of r.misses) console.log(`  [${m.id}] «${m.target}» ⇢ «${m.cand}» ${m.verdict} ${m.score}%  ${m.why}`)
  }
  const jf = arg('json', null)
  if (jf) fs.writeFileSync(jf, JSON.stringify({ cases: CASES.length, ...r, root: path.basename(root) }, null, 2))
}
