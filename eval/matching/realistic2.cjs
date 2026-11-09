'use strict'
/**
 * مجموعهٔ «دست‌نویس تازه» (held-out) — نوشته‌شده «پس از» پایان تنظیم تطبیق‌دهنده v2.
 *
 * قواعد (برای اینکه عدد بی‌سوگیری بماند):
 *  1) برچسب‌ها پیش از اجرا روی هر موتوری نوشته شدند و بعداً تغییر نکرده‌اند.
 *  2) روی این مجموعه هیچ تنظیمی (آستانه، قاعده، واژگان) انجام نشده است. نتیجهٔ اولین اجرا در eval/results/matching_heldout_*.json
 *     ثبت شده؛ اگر روزی ایرادی از آن استخراج و رفع شود، همین مجموعه دیگر «کنارگذاشته» نیست و باید مجموعهٔ تازه‌ای نوشته شود.
 *  3) برچسب‌ها فقط با دانش دامنه (نه با خروجی موتور) تعیین شده‌اند:
 *       same : همان کالا (انتظار: تایید خودکار؛ review «خطای ایمنی» نیست و فقط پوشش را کم می‌کند)
 *       diff : کالای دیگر — مدل/پسوند/ظرفیت/طول/تعداد/لوازم جانبی/دست‌دوم (هرگز نباید خودکار تایید شود)
 *       amb  : از روی عنوان فروشگاه قابل‌تشخیص قطعی نیست — بدون کد مدل، بسته‌های چندقلمی (هرگز نباید خودکار تایید شود)
 *
 * اجرا: node eval/matching/realistic2.cjs [--root DIR] [--verbose] [--json FILE]
 */
const path = require('path')
const fs = require('fs')
const { run } = require('./realistic.cjs')

const S = 'same'
const D = 'diff'
const A = 'amb'

const CASES = [
  {
    id: 'H01-hik-turbo-turret-suffix',
    target: { productName: 'دوربین مداربسته دام هایک ویژن مدل DS-2CE76D0T-ITPFS', sku: null, anchorPriceToman: 1250000 },
    cands: [
      ['دوربین مداربسته دام هایک ویژن مدل DS-2CE76D0T-ITPFS 2 مگاپیکسل', 1280000, 17, S],
      ['دوربین مداربسته Hikvision DS-2CE76D0T-ITPFS Turbo HD 2MP', 1260000, 5, S],
      ['دوربین مداربسته دام هایک ویژن مدل DS-2CE76D0T-ITMFS', 1330000, 14, D],
      ['دوربین مداربسته دام هایک ویژن مدل DS-2CE76D0T-EXIPF', 1190000, 8, D],
      ['دوربین مداربسته بولت هایک ویژن مدل DS-2CE16D0T-ITPF', 1220000, 21, D],
      ['کاور محافظ دوربین دام هایک ویژن DS-2CE76D0T-ITPFS', 90000, 3, D],
      ['دوربین مداربسته دام هایک ویژن مدل DS-2CE76D0T', 1100000, 4, A],
    ],
  },
  {
    id: 'H02-dahua-ip-lens-spec-conflict',
    target: { productName: 'دوربین مداربسته تحت شبکه داهوا مدل DH-IPC-HFW2431S-S-S2 لنز 2.8 میلی متر', sku: 'DH-IPC-HFW2431S-S-S2', anchorPriceToman: 3700000 },
    cands: [
      ['دوربین تحت شبکه داهوا DH-IPC-HFW2431S-S-S2 4 مگاپیکسل', 3750000, 19, S],
      ['دوربین مداربسته تحت شبکه داهوا مدل DH-IPC-HFW2431S-S-S2 لنز 2.8mm', 3720000, 6, S],
      ['دوربین مداربسته تحت شبکه داهوا مدل DH-IPC-HFW2431S-S-S2 لنز 3.6 میلی متر', 3780000, 7, D],
      ['دوربین مداربسته تحت شبکه داهوا مدل DH-IPC-HFW2231S-S-S2 2 مگاپیکسل', 2900000, 16, D],
      ['دوربین مداربسته تحت شبکه داهوا مدل DH-IPC-HFW2831S-S-S2 8 مگاپیکسل', 5200000, 11, D],
      ['دوربین مداربسته دام تحت شبکه داهوا مدل DH-IPC-HDW2431T-AS-S2', 3900000, 13, D],
    ],
  },
  {
    id: 'H03-uniview-nvr-poe',
    target: { productName: 'دستگاه ضبط ویدیو NVR یونی ویو مدل NVR301-08S3-P8 ۸ کانال', sku: 'NVR301-08S3-P8', anchorPriceToman: 4900000 },
    cands: [
      ['ان وی آر یونی ویو NVR301-08S3-P8 8 کانال PoE', 4950000, 9, S],
      ['دستگاه ضبط ویدیو یونی ویو مدل NVR301-08S3-P8', 4900000, 12, S],
      ['Uniview NVR301-08S3-P8 8CH 4K PoE NVR', 5000000, 3, S],
      ['دستگاه NVR یونی ویو مدل NVR301-04S3-P4 چهار کانال', 3600000, 10, D],
      ['دستگاه ضبط ویدیو یونی ویو مدل NVR301-08S3 هشت کانال بدون PoE', 3900000, 6, D],
      ['دستگاه ضبط ویدیو یونی ویو مدل NVR301-16S3-P16', 7900000, 7, D],
    ],
  },
  {
    id: 'H04-ezviz-c6n',
    target: { productName: 'دوربین هوشمند ایزویز مدل C6N 2MP', sku: null, anchorPriceToman: 2100000 },
    cands: [
      ['دوربین تحت شبکه ایزویز مدل C6N 1080P', 2150000, 15, S],
      ['دوربین هوشمند Ezviz C6N', 2100000, 8, S],
      ['دوربین ایزویز مدل C6CN', 1950000, 9, D],
      ['دوربین ایزویز مدل C6N 4MP', 3100000, 6, D],
      ['دوربین ایزویز مدل C3N', 1700000, 18, D],
      ['پایه نصب دوربین ایزویز C6N', 120000, 4, D],
      ['کارت حافظه 64 گیگابایت مخصوص دوربین ایزویز', 450000, 10, D],
    ],
  },
  {
    id: 'H05-imou-ranger2',
    target: { productName: 'دوربین چرخان ایمو مدل Ranger 2 IPC-A22EP', sku: 'IPC-A22EP', anchorPriceToman: 1900000 },
    cands: [
      ['دوربین ایمو مدل IPC-A22EP Ranger 2 2MP', 1950000, 14, S],
      ['Imou Ranger 2 IPC-A22EP 1080P Wi-Fi Camera', 1900000, 5, S],
      ['دوربین ایمو مدل IPC-A42P Ranger 2 4MP', 2700000, 8, D],
      ['دوربین ایمو مدل IPC-K22AP Cue 2', 1500000, 11, D],
      ['دوربین ایمو مدل IPC-GS2DP Ranger Pro', 3300000, 6, D],
    ],
  },
  {
    id: 'H06-generic-adapter-12v',
    target: { productName: 'آداپتور 12 ولت 5 آمپر دوربین مداربسته', sku: null, anchorPriceToman: 280000 },
    cands: [
      ['آداپتور 12 ولت 5 آمپر مخصوص دوربین مداربسته', 270000, 12, A],
      ['آداپتور 12 ولت 2 آمپر دوربین مداربسته', 140000, 18, D],
      ['آداپتور 12 ولت 10 آمپر دوربین مداربسته', 520000, 9, D],
      ['منبع تغذیه فلزی 12 ولت 5 آمپر 8 کانال', 650000, 7, D],
    ],
  },
  {
    id: 'H07-legrand-cat6-roll',
    target: { productName: 'کابل شبکه Cat6 UTP لگراند حلقه 305 متری', sku: 'KY-0050001', anchorPriceToman: 7800000 },
    cands: [
      ['کابل شبکه لگراند Cat6 UTP رول 305 متری', 7900000, 13, A],
      ['کابل شبکه لگراند Cat6 UTP 100 متری', 2800000, 10, D],
      ['کابل شبکه لگراند Cat5e UTP حلقه 305 متری', 5200000, 9, D],
      ['کابل شبکه دی لینک Cat6 UTP حلقه 305 متر', 7400000, 6, D],
      ['کانکتور RJ45 Cat6 لگراند بسته 100 عددی', 450000, 8, D],
    ],
  },
  {
    id: 'H08-seagate-skyhawk-2tb',
    target: { productName: 'هارد دیسک اینترنال سیگیت مدل SkyHawk ST2000VX017 ظرفیت 2 ترابایت', sku: 'ST2000VX017', anchorPriceToman: 5200000 },
    cands: [
      ['هارد اینترنال سیگیت SkyHawk ST2000VX017 2TB', 5250000, 27, S],
      ['Seagate SkyHawk 2TB ST2000VX017 Surveillance Internal Hard Drive', 5200000, 6, S],
      ['هارد دیسک اینترنال سیگیت مدل SkyHawk ST2000VX015 ظرفیت 2 ترابایت', 5000000, 12, D],
      ['هارد دیسک اینترنال سیگیت مدل SkyHawk ST4000VX016 ظرفیت 4 ترابایت', 8300000, 17, D],
      ['هارد اینترنال سیگیت BarraCuda ST2000DM008 ظرفیت 2 ترابایت', 4300000, 21, D],
      ['هارد دیسک اینترنال وسترن دیجیتال Purple WD22PURZ ظرفیت 2 ترابایت', 5100000, 15, D],
      ['هارد اینترنال سیگیت SkyHawk ST2000VX017 ظرفیت 2 ترابایت کارکرده', 2600000, 3, D],
    ],
  },
  {
    id: 'H09-apc-ups-1100',
    target: { productName: 'یو پی اس 1100 ولت آمپر ای پی سی مدل BX1100LI-MS', sku: 'BX1100LI-MS', anchorPriceToman: 14500000 },
    cands: [
      ['یو پی اس ای پی سی APC مدل BX1100LI-MS 1100VA', 14700000, 16, S],
      ['APC Back-UPS BX1100LI-MS 1100VA UPS', 14500000, 5, S],
      ['یو پی اس ای پی سی مدل BX1400UI 1400VA', 18500000, 12, D],
      ['یو پی اس ای پی سی مدل BX1100LI-GR 1100VA', 14900000, 9, D],
      ['باتری یو پی اس ای پی سی مدل RBC17', 5200000, 7, D],
      ['یو پی اس 1100VA پاورکام مدل BNT-1100AP', 9800000, 10, D],
    ],
  },
  {
    id: 'H10-xiaomi-router-ax3000',
    target: { productName: 'روتر بی سیم شیائومی مدل AX3000', sku: null, anchorPriceToman: 3900000 },
    cands: [
      ['روتر شیائومی مدل Mi Router AX3000', 3950000, 11, S],
      ['روتر بی سیم شیائومی مدل AX1800', 2900000, 13, D],
      ['روتر بی سیم شیائومی مدل AX6000', 6900000, 7, D],
      ['روتر بی سیم شیائومی Redmi مدل AX5400', 4800000, 8, D],
      ['اکستندر وای فای شیائومی مدل AC1200', 1500000, 9, D],
    ],
  },
  {
    id: 'H11-tapo-c200',
    target: { productName: 'دوربین امنیتی وای فای تی پی لینک مدل Tapo C200', sku: 'Tapo C200', anchorPriceToman: 1650000 },
    cands: [
      ['دوربین تی پی لینک Tapo C200 Pan/Tilt Home Security Wi-Fi Camera', 1700000, 22, S],
      ['دوربین نظارتی چرخشی تی پی لینک مدل Tapo C200', 1650000, 30, S],
      ['دوربین تی پی لینک مدل Tapo C210', 2000000, 19, D],
      ['دوربین تی پی لینک مدل Tapo C100', 1250000, 24, D],
      ['دوربین تی پی لینک مدل Tapo C220', 2500000, 12, D],
      ['پک دو عددی دوربین تی پی لینک مدل Tapo C200', 3300000, 4, D],
    ],
  },
  {
    id: 'H12-hilook-bullet',
    target: { productName: 'دوربین مداربسته بولت هایلوک مدل THC-B120-C', sku: 'THC-B120-C', anchorPriceToman: 1050000 },
    cands: [
      ['دوربین هایلوک THC-B120-C 2MP بولت', 1080000, 20, S],
      ['دوربین مداربسته بولت HiLook THC-B120-C', 1050000, 9, S],
      ['دوربین مداربسته بولت هایلوک مدل THC-B120-MC', 1150000, 14, D],
      ['دوربین مداربسته دام هایلوک مدل THC-T120-C', 1000000, 17, D],
      ['دوربین مداربسته بولت هایلوک مدل THC-B140-M 4MP', 1500000, 11, D],
    ],
  },
  {
    id: 'H13-provision-lens-digits',
    target: { productName: 'دوربین مداربسته دام پروویژن مدل DI-390AHD36', sku: null, anchorPriceToman: 1300000 },
    cands: [
      ['دوربین دام پروویژن Provision-ISR مدل DI-390AHD36', 1320000, 8, S],
      ['دوربین مداربسته پروویژن مدل DI-390AHD28', 1300000, 6, D],
      ['دوربین مداربسته پروویژن مدل DI-380AHD36', 1150000, 7, D],
      ['دوربین مداربسته بولت پروویژن مدل I3-390AHD36', 1400000, 9, D],
    ],
  },
  {
    id: 'H14-bundle-4-camera-kit',
    target: { productName: 'پکیج کامل ۴ دوربین مداربسته داهوا 2 مگاپیکسل به همراه دستگاه DVR و هارد 1 ترابایت', sku: 'KY-9001', anchorPriceToman: 12000000 },
    cands: [
      ['پکیج 4 دوربین مداربسته داهوا 2 مگاپیکسل با دستگاه DVR داهوا و هارد 1 ترابایت', 12300000, 5, A],
      ['دوربین مداربسته بولت داهوا مدل DH-HAC-HFW1200CP', 1350000, 18, D],
      ['پکیج 8 دوربین مداربسته داهوا 2 مگاپیکسل با دستگاه DVR و هارد 2 ترابایت', 22000000, 4, D],
      ['دستگاه DVR داهوا مدل XVR4104HS-I', 3500000, 14, D],
    ],
  },
  {
    id: 'H15-samsung-870evo',
    target: { productName: 'حافظه SSD اینترنال سامسونگ مدل 870 EVO ظرفیت 500 گیگابایت', sku: 'MZ-77E500BW', anchorPriceToman: 3300000 },
    cands: [
      ['اس اس دی اینترنال سامسونگ مدل 870 EVO ظرفیت 500 گیگابایت', 3350000, 31, S],
      ['اس اس دی اینترنال سامسونگ MZ-77E500BW 870 EVO 500GB', 3300000, 8, S],
      ['اس اس دی اینترنال سامسونگ مدل 870 EVO ظرفیت 1 ترابایت', 5600000, 29, D],
      ['اس اس دی اینترنال سامسونگ مدل 980 PRO ظرفیت 500 گیگابایت', 4900000, 15, D],
      ['SSD سامسونگ 870 EVO 250GB', 2100000, 12, D],
      ['اس اس دی اینترنال کینگستون مدل A400 ظرفیت 480 گیگابایت', 2300000, 25, D],
    ],
  },
  {
    id: 'H16-hik-5mp-spaces-hyphens',
    target: { productName: 'دوربین مداربسته بولت هایک ویژن مدل DS-2CE16H0T-ITPF ۵ مگاپیکسل', sku: null, anchorPriceToman: 1650000 },
    cands: [
      ['دوربین بولت هایک ویژن DS 2CE16H0T ITPF 5MP', 1680000, 7, S],
      ['دوربین مداربسته بولت هایک ویژن DS2CE16H0T-ITPF', 1650000, 10, S],
      ['دوربین مداربسته بولت هایک ویژن DS-2CE16H0T-IT3F', 1700000, 12, D],
      ['دوربین مداربسته بولت هایک ویژن DS-2CE16D0T-ITPF 2MP', 1250000, 19, D],
    ],
  },
  {
    id: 'H17-dahua-fullcolor-led',
    target: { productName: 'دوربین مداربسته بولت داهوا مدل DH-HAC-HFW1239TLM-A-LED', sku: 'DH-HAC-HFW1239TLM-A-LED', anchorPriceToman: 2350000 },
    cands: [
      ['دوربین داهوا HFW1239TLM-A-LED 2MP Full-color', 2400000, 9, S],
      ['دوربین بولت داهوا DH-HAC-HFW1239TP-A-LED', 2250000, 6, D],
      ['دوربین بولت داهوا DH-HAC-HFW1509TLM-A-LED 5MP', 3300000, 8, D],
      ['دوربین بولت داهوا DH-HAC-HFW1239TLM-A-LED پایه دیواری', 150000, 3, D],
    ],
  },
  {
    id: 'H18-dahua-xvr',
    target: { productName: 'دستگاه ضبط ویدیو XVR داهوا مدل XVR5108HS-I3 ۸ کانال', sku: 'XVR5108HS-I3', anchorPriceToman: 5600000 },
    cands: [
      ['دستگاه XVR داهوا XVR5108HS-I3 8 کانال', 5650000, 13, S],
      ['دستگاه ضبط ویدیو داهوا مدل XVR5108HS-4KL-I3', 6700000, 9, D],
      ['دستگاه ضبط ویدیو داهوا مدل XVR5104HS-I3 4 کانال', 4300000, 14, D],
      ['دستگاه ضبط ویدیو داهوا مدل XVR5116HS-I3 16 کانال', 9500000, 8, D],
      ['دستگاه ضبط ویدیو داهوا مدل XVR4108HS-I', 4200000, 15, D],
    ],
  },
  {
    id: 'H19-logitech-m185',
    target: { productName: 'ماوس بی سیم لاجیتک مدل M185', sku: 'M185', anchorPriceToman: 450000 },
    cands: [
      ['ماوس بی سیم لاجیتک مدل M185', 460000, 40, S],
      ['Logitech M185 Wireless Mouse', 450000, 9, S],
      ['ماوس بی سیم لاجیتک مدل M170', 400000, 33, D],
      ['ماوس بی سیم لاجیتک مدل M590', 1400000, 21, D],
      ['ماوس بی سیم لاجیتک مدل M187', 500000, 12, D],
    ],
  },
  {
    id: 'H20-redmi-note-variants',
    target: { productName: 'گوشی موبایل شیائومی مدل Redmi Note 12 ظرفیت 128 گیگابایت رم 6 گیگابایت', sku: null, anchorPriceToman: 9500000 },
    cands: [
      ['گوشی موبایل شیائومی مدل Redmi Note 12 دو سیم کارت ظرفیت 128 گیگابایت و رم 6 گیگابایت', 9600000, 35, S],
      ['گوشی موبایل شیائومی مدل Redmi Note 12 دو سیم کارت ظرفیت 256 گیگابایت و رم 8 گیگابایت', 11800000, 28, D],
      ['گوشی موبایل شیائومی مدل Redmi Note 12 Pro دو سیم کارت ظرفیت 128 گیگابایت و رم 6 گیگابایت', 13500000, 22, D],
      ['گوشی موبایل شیائومی مدل Redmi Note 12S ظرفیت 128 گیگابایت و رم 6 گیگابایت', 10200000, 17, D],
      ['گوشی موبایل شیائومی مدل Redmi Note 12 ظرفیت 64 گیگابایت رم 4 گیگابایت', 7900000, 24, D],
      ['قاب گوشی موبایل شیائومی Redmi Note 12', 150000, 20, D],
    ],
  },
  {
    id: 'H21-hik-colorvu-ip',
    target: { productName: 'دوربین مداربسته بولت تحت شبکه هایک ویژن مدل DS-2CD2047G2-L ColorVu 4MP', sku: 'DS-2CD2047G2-L', anchorPriceToman: 6900000 },
    cands: [
      ['دوربین تحت شبکه هایک ویژن DS-2CD2047G2-L لنز 2.8 ColorVu', 6950000, 11, S],
      ['دوربین تحت شبکه هایک ویژن DS-2CD2047G2-LU', 7600000, 8, D],
      ['دوربین تحت شبکه هایک ویژن DS-2CD2087G2-L 8MP', 9800000, 7, D],
      ['دوربین تحت شبکه هایک ویژن DS-2CD2T47G2-L دید در شب رنگی', 7300000, 9, D],
    ],
  },
  {
    id: 'H22-hdmi-cable-length',
    target: { productName: 'کابل HDMI ونتولینک 5 متر', sku: null, anchorPriceToman: 190000 },
    cands: [
      ['کابل HDMI ونتولینک طول 5 متر', 185000, 16, A],
      ['کابل HDMI ونتولینک طول 3 متر', 130000, 19, D],
      ['کابل HDMI ونتولینک طول 10 متر', 320000, 11, D],
      ['کابل HDMI وی نت مدل V-HDMI 5 متر', 170000, 9, D],
      ['کابل تبدیل HDMI به VGA ونتولینک', 160000, 14, D],
    ],
  },
  {
    id: 'H23-tplink-adsl-modem',
    target: { productName: 'مودم روتر ADSL2 plus تی پی لینک مدل TD-W8961N', sku: 'TD-W8961N', anchorPriceToman: 1350000 },
    cands: [
      ['مودم روتر ADSL2+ بی سیم تی پی لینک مدل TD-W8961N', 1380000, 24, S],
      ['TP-Link TD-W8961N 300Mbps Wireless N ADSL2+ Modem Router', 1350000, 6, S],
      ['مودم روتر ADSL2+ بی سیم تی پی لینک مدل TD-W8960N', 1250000, 18, D],
      ['مودم روتر VDSL/ADSL تی پی لینک مدل VR400', 2900000, 14, D],
      ['مودم روتر ADSL2+ تی پی لینک مدل TD-W8901N', 1000000, 12, D],
      ['مودم روتر ADSL2+ بی سیم تی پی لینک مدل TD-W8961N دست دوم', 600000, 3, D],
    ],
  },
  {
    id: 'H24-wd-purple-1tb',
    target: { productName: 'هارد دیسک اینترنال 1 ترابایت وسترن دیجیتال Purple مدل WD11PURZ', sku: 'WD11PURZ', anchorPriceToman: 3400000 },
    cands: [
      ['هارد اینترنال وسترن دیجیتال Purple WD11PURZ 1TB', 3450000, 23, S],
      ['هارد اینترنال وسترن دیجیتال Purple WD10PURZ 1TB', 3300000, 10, D],
      ['هارد اینترنال وسترن دیجیتال Purple WD23PURZ 2TB', 5500000, 14, D],
      ['هارد اینترنال وسترن دیجیتال Blue WD10EZEX 1TB', 2600000, 21, D],
    ],
  },
  {
    id: 'H25-tplink-poe-switch',
    target: { productName: 'سوئیچ PoE ۸ پورت تی پی لینک مدل TL-SF1008P', sku: 'TL-SF1008P', anchorPriceToman: 2300000 },
    cands: [
      ['سوئیچ 8 پورت PoE تی پی لینک مدل TL-SF1008P', 2350000, 19, S],
      ['سوئیچ 8 پورت PoE+ گیگابیت تی پی لینک مدل TL-SG1008P', 4300000, 12, D],
      ['سوئیچ 5 پورت PoE تی پی لینک مدل TL-SF1005P', 1800000, 10, D],
      ['سوئیچ 16 پورت PoE تی پی لینک مدل TL-SF1016PE', 6400000, 8, D],
      ['سوئیچ 8 پورت 10/100 تی پی لینک مدل TL-SF1008D', 700000, 26, D],
    ],
  },
  {
    id: 'H26-english-only-store-title',
    target: { productName: 'Hikvision DS-2CD2143G2-I 4MP AcuSense Dome', sku: 'DS-2CD2143G2-I', anchorPriceToman: 5400000 },
    cands: [
      ['دوربین مداربسته دام تحت شبکه هایک ویژن مدل DS-2CD2143G2-I', 5450000, 15, S],
      ['دوربین دام هایک ویژن DS2CD2143G2-I (4MP AcuSense)', 5400000, 4, S],
      ['دوربین مداربسته دام هایک ویژن مدل DS-2CD2143G2-IS', 5900000, 9, D],
      ['دوربین مداربسته دام هایک ویژن مدل DS-2CD2123G2-I 2MP', 4200000, 13, D],
      ['دوربین مداربسته دام هایک ویژن مدل DS-2CD2183G2-I 8MP', 7800000, 10, D],
      ['Hikvision DS-2CD2143G2-IU', 6100000, 6, D],
    ],
  },
  {
    id: 'H27-dahua-s1-vs-s',
    target: { productName: 'دوربین مداربسته بولت داهوا مدل DH-IPC-HFW1230S1-S5', sku: 'DH-IPC-HFW1230S1-S5', anchorPriceToman: 2700000 },
    cands: [
      ['دوربین بولت داهوا DH-IPC-HFW1230S1-S5 2MP', 2750000, 14, S],
      ['دوربین مداربسته بولت داهوا مدل DH-IPC-HFW1230S-S5', 2600000, 10, D],
      ['دوربین مداربسته بولت داهوا مدل DH-IPC-HFW1530S-S6 5MP', 3300000, 12, D],
      ['دوربین مداربسته بولت داهوا مدل DH-IPC-HFW1230S1P-S5', 2650000, 7, D],
    ],
  },
  {
    id: 'H28-no-brand-analog-dome',
    target: { productName: 'دوربین مداربسته دام آنالوگ بدون برند 1080P فلزی', sku: 'KY-9100', anchorPriceToman: 400000 },
    cands: [
      ['دوربین مداربسته دام آنالوگ فلزی 1080P 2 مگاپیکسل', 420000, 9, A],
      ['دوربین مداربسته بولت آنالوگ فلزی 1080P', 430000, 8, D],
      ['دوربین مداربسته دام آنالوگ هایک ویژن مدل DS-2CE56D0T-IRPF', 1300000, 20, D],
    ],
  },
  {
    id: 'H29-dual-code-store-title',
    target: { productName: 'دوربین مداربسته هایک ویژن مدل DS-2CE56D0T-IRPF / DS-2CE56D0T-IRMF', sku: null, anchorPriceToman: 1250000 },
    cands: [
      ['دوربین دام هایک ویژن DS-2CE56D0T-IRPF', 1250000, 21, A],
      ['دوربین دام هایک ویژن DS-2CE56D0T-IRMF', 1330000, 17, A],
      ['دوربین دام هایک ویژن DS-2CE56D0T-ITPF', 1400000, 9, D],
    ],
  },
  {
    id: 'H30-extra-words-store-title',
    target: { productName: 'دوربین مداربسته بولت هایک ویژن مدل DS-2CE16D0T-IT3F 2 مگاپیکسل اورجینال گارانتی ۱۸ ماهه', sku: null, anchorPriceToman: 1550000 },
    cands: [
      ['دوربین هایک ویژن DS-2CE16D0T-IT3F', 1560000, 16, S],
      ['دوربین بولت Hikvision DS-2CE16D0T-IT3F Turbo HD 2MP لنز 3.6 میلی‌متر', 1550000, 8, S],
      ['دوربین هایک ویژن DS-2CE16D0T-IT5F', 1800000, 10, D],
      ['دوربین هایک ویژن DS-2CE16D0T-IT1F', 1400000, 9, D],
      ['دوربین هایک ویژن DS-2CE16D0T-IT3F پک ۴ عددی', 6000000, 3, D],
      ['پایه دوربین هایک ویژن DS-2CE16D0T-IT3F', 90000, 4, D],
    ],
  },
  {
    id: 'H31-arabic-letters-zwnj',
    target: { productName: 'دوربین مداربسته هایک ویژن مدل DS-2CE56D0T-IRPF', sku: null, anchorPriceToman: 1250000 },
    cands: [
      ['دوربين مداربسته هايك ويژن مدل DS-2CE56D0T-IRPF', 1260000, 11, S],
      ['دوربین مداربسته هایک‌ویژن مدل DS-2CE56D0T-IRPF', 1250000, 14, S],
      ['دوربین مداربسته هایک ویژن مدل DS-2CE56D0T-IRMF', 1330000, 17, D],
    ],
  },
  {
    id: 'H32-samsung-buds',
    target: { productName: 'هدفون بی سیم سامسونگ مدل Galaxy Buds2 Pro', sku: 'SM-R510', anchorPriceToman: 7200000 },
    cands: [
      ['هدفون بلوتوثی سامسونگ مدل Galaxy Buds2 Pro SM-R510', 7300000, 18, S],
      ['هدفون بی سیم سامسونگ مدل Galaxy Buds2', 4300000, 22, D],
      ['هدفون بی سیم سامسونگ مدل Galaxy Buds FE', 3900000, 15, D],
      ['هدفون بی سیم سامسونگ مدل Galaxy Buds Live', 4700000, 9, D],
      ['کاور سیلیکونی هدفون سامسونگ Galaxy Buds2 Pro', 150000, 12, D],
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
  console.log(`\nمجموعهٔ تازهٔ held-out — ${CASES.length} کیس ، ${r.pairs} جفت — root=${path.basename(root)}`)
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
