'use strict'
/**
 * مجموعهٔ «دست‌نویس واقع‌گرایانه» — مستقل از ژنراتور: عنوان‌ها با دست و به سبک واقعی ترب/فروشگاه‌های ایرانی نوشته شده‌اند
 * (عنوان بلند و کوتاه، انگلیسی‌محض، کد ناقص، تایپوی «بالت»، پایه/کاور/پک/استوک و …).
 * برچسب‌ها پیش از اجرای هر موتور نوشته شده‌اند:
 *   same : همان کالا (انتظار: تایید خودکار؛ review هم «خطای سلامت» نیست ولی پوشش را کم می‌کند)
 *   diff : کالای دیگر (هرگز نباید خودکار تایید شود)
 *   amb  : از روی عنوان فروشگاه قابل‌تشخیص قطعی نیست (هرگز نباید خودکار تایید شود؛ ریویو مطلوب است)
 * نشانهٔ کاربرد: node eval/matching/realistic.cjs --root DIR [--verbose]
 */
const path = require('path')

const S = 'same'
const D = 'diff'
const A = 'amb'

const CASES = [
  {
    id: 'R01-hik-ip-bullet',
    target: { productName: 'دوربین مداربسته تحت شبکه هایک ویژن مدل DS-2CD1023G0E-I', sku: 'KY-0010231', anchorPriceToman: 3300000 },
    cands: [
      ['دوربین مداربسته هایک ویژن مدل DS-2CD1023G0E-I', 3400000, 22, S],
      ['دوربین بولت تحت شبکه هایک ویژن 2 مگاپیکسل مدل DS-2CD1023G0E-I (لنز 2.8mm)', 3350000, 15, S],
      ['دوربین تحت شبکه Hikvision 2CD1023G0E-I', 3300000, 4, S],
      ['دوربین مداربسته هایک ویژن مدل DS-2CD1023G0E-IF', 3550000, 9, D],
      ['دوربین مداربسته هایک ویژن مدل DS-2CD1043G0-I 4 مگاپیکسل', 4400000, 18, D],
      ['پایه دیواری دوربین هایک ویژن DS-2CD1023G0E-I', 180000, 6, D],
      ['پک 4 عددی دوربین مداربسته هایک ویژن DS-2CD1023G0E-I', 12800000, 3, D],
      ['دوربین مداربسته هایک ویژن مدل DS-2CD1023G0E-I استوک', 1800000, 2, D],
      ['کاور محافظ ضد آب دوربین مداربسته هایک ویژن DS-2CD1023G0E-I', 95000, 5, D],
      ['دوربین مداربسته تحت شبکه داهوا مدل DH-IPC-HFW1230S-S5', 3100000, 14, D],
      ['دوربین مداربسته هایک ویژن مدل DS-2CD1023G0E', 3200000, 3, A],
    ],
  },
  {
    id: 'R02-dahua-short-store-title',
    target: { productName: 'دوربین داهوا 1200TP', sku: '1012', anchorPriceToman: 1350000 },
    cands: [
      ['دوربین مداربسته بولت داهوا مدل DH-HAC-HFW1200TP', 1400000, 12, A],
      ['دوربین مداربسته دام داهوا مدل DH-HAC-HDW1200TP', 1450000, 5, A],
      ['دوربین مداربسته بولت داهوا مدل DH-HAC-HFW1500TLM-IL-A', 3100000, 9, D],
      ['دوربین مداربسته بولت داهوا مدل DH-HAC-HFW1200CP', 1350000, 11, D],
      ['کابل دوربین مداربسته 20 متری', 150000, 4, D],
    ],
  },
  {
    id: 'R03-wd-purple-4tb',
    target: { productName: 'هارد دیسک اینترنال وسترن دیجیتال مدل Purple WD40PURZ ظرفیت 4 ترابایت', sku: 'WD40PURZ', anchorPriceToman: 8400000 },
    cands: [
      ['هارد اینترنال وسترن دیجیتال Purple WD40PURZ 4TB', 8500000, 30, S],
      ['Western Digital WD40PURZ 4TB Purple Surveillance Internal Hard Drive', 8450000, 6, S],
      ['هارد دیسک اینترنال وسترن دیجیتال مدل Purple WD42PURZ ظرفیت 4 ترابایت', 8700000, 17, D],
      ['هارد اکسترنال وسترن دیجیتال مدل Elements 4TB', 6900000, 25, D],
      ['کیس هارد اکسترنال 3.5 اینچ USB3.0', 450000, 12, D],
      ['هارد اینترنال سیگیت SkyHawk ST4000VX016 ظرفیت 4 ترابایت', 8300000, 14, D],
      ['هارد اینترنال وسترن دیجیتال Purple WD40PURZ 4TB دست دوم', 4200000, 2, D],
      ['هارد دیسک اینترنال وسترن دیجیتال مدل Purple WD20PURZ ظرفیت 2 ترابایت', 5000000, 20, D],
    ],
  },
  {
    id: 'R04-wd-purple-codeless-title',
    target: { productName: 'هارد WD Purple 4TB', sku: 'KY-0044001', anchorPriceToman: 8400000 },
    cands: [
      ['هارد دیسک اینترنال وسترن دیجیتال مدل Purple WD40PURZ ظرفیت 4 ترابایت', 8500000, 30, A],
      ['هارد دیسک اینترنال وسترن دیجیتال مدل Purple WD43PURZ ظرفیت 4 ترابایت', 8900000, 11, A],
      ['هارد دیسک اینترنال وسترن دیجیتال مدل Purple WD20PURZ ظرفیت 2 ترابایت', 5000000, 20, D],
      ['هارد اکسترنال وسترن دیجیتال مدل Elements 4TB', 6900000, 25, D],
    ],
  },
  {
    id: 'R05-sandisk-ultra-codeless',
    target: { productName: 'کارت حافظه microSDXC سن دیسک مدل Ultra A1 ظرفیت 128 گیگابایت', sku: null, anchorPriceToman: 2600000 },
    cands: [
      ['کارت حافظه microSDXC سن دیسک مدل Ultra A1 کلاس 10 سرعت 120MBps ظرفیت 128 گیگابایت', 2650000, 21, S],
      ['کارت حافظه microSDXC سن دیسک مدل Extreme A2 ظرفیت 128 گیگابایت', 3600000, 19, D],
      ['کارت حافظه microSDXC سن دیسک مدل Ultra A1 ظرفیت 64 گیگابایت', 1500000, 22, D],
      ['ریدر کارت حافظه microSD سن دیسک', 150000, 8, D],
      ['کارت حافظه microSDXC سامسونگ مدل EVO Plus ظرفیت 128 گیگابایت', 2800000, 20, D],
    ],
  },
  {
    id: 'R06-tplink-switch',
    target: { productName: 'سوئیچ 8 پورت گیگابیت تی پی لینک مدل TL-SG108', sku: 'TL-SG108', anchorPriceToman: 1550000 },
    cands: [
      ['سوئیچ شبکه 8 پورت گیگابیت تی پی لینک مدل TL-SG108', 1580000, 40, S],
      ['TP-Link SG108 8-Port Gigabit Desktop Switch', 1600000, 7, S],
      ['سوئیچ 8 پورت گیگابیت مدیریتی تی پی لینک مدل TL-SG108E', 1950000, 28, D],
      ['سوئیچ 8 پورت گیگابیت PoE تی پی لینک مدل TL-SG108PE', 4800000, 10, D],
      ['سوئیچ 8 پورت گیگابیت تندا مدل SG108', 1300000, 16, D],
      ['سوئیچ 5 پورت گیگابیت تی پی لینک مدل TL-SG105', 1000000, 33, D],
      ['سوئیچ 8 پورت 10/100 تی پی لینک مدل TL-SF1008D', 700000, 25, D],
    ],
  },
  {
    id: 'R07-tenda-switch-short-code',
    target: { productName: 'سوئیچ 8 پورت گیگابیت تندا SG108', sku: null, anchorPriceToman: 1300000 },
    cands: [
      ['Tenda SG108 8-Port Gigabit Switch', 1320000, 9, S],
      ['سوئیچ 8 پورت گیگابیت تندا مدل SG108', 1300000, 14, S],
      ['سوئیچ شبکه 8 پورت گیگابیت تی پی لینک مدل TL-SG108', 1550000, 40, D],
    ],
  },
  {
    id: 'R08-router-archer',
    target: { productName: 'روتر بی سیم تی پی لینک مدل Archer C6 AC1200', sku: null, anchorPriceToman: 2900000 },
    cands: [
      ['روتر بی سیم تی پی لینک مدل Archer C6 AC1200 Gigabit', 2950000, 26, S],
      ['TP-Link Archer C6 V3.2 AC1200 Wireless MU-MIMO Gigabit Router', 2900000, 8, S],
      ['روتر بی سیم تی پی لینک مدل Archer C60 AC1350', 2700000, 12, D],
      ['روتر بی سیم تی پی لینک مدل Archer C80 AC1900', 2600000, 19, D],
      ['روتر بی سیم تی پی لینک مدل Archer AX23', 3600000, 15, D],
      ['روتر تندا مدل AC6', 2300000, 23, D],
    ],
  },
  {
    id: 'R09-hik-nvr-poe',
    target: { productName: 'دستگاه ضبط ویدیو NVR هایک ویژن مدل DS-7108NI-Q1/8P/M ۸ کانال', sku: 'DS-7108NI-Q1/8P/M', anchorPriceToman: 5200000 },
    cands: [
      ['ان وی آر هایک ویژن DS-7108NI-Q1/8P/M 8CH PoE', 5300000, 11, S],
      ['دستگاه NVR هایک ویژن مدل DS-7108NI-Q1/8P/M 8 کانال 4K', 5250000, 20, S],
      ['دستگاه NVR هایک ویژن مدل DS-7108NI-Q1/M 8 کانال', 3900000, 8, D],
      ['دستگاه NVR هایک ویژن مدل DS-7104NI-Q1/4P/M 4 کانال', 3900000, 14, D],
      ['دستگاه DVR هایک ویژن مدل DS-7108HGHI-K1 8 کانال', 2800000, 17, D],
      ['براکت هارد دستگاه ضبط هایک ویژن', 120000, 3, D],
    ],
  },
  {
    id: 'R10-accessory-target',
    target: { productName: 'براکت نصب دوربین هایک ویژن DS-1273ZJ-130B', sku: null, anchorPriceToman: 450000 },
    cands: [
      ['پایه دیواری دوربین هایک ویژن مدل DS-1273ZJ-130B', 470000, 9, S],
      ['پایه دیواری دوربین هایک ویژن مدل DS-1259ZJ', 350000, 12, D],
      ['دوربین مداربسته هایک ویژن مدل DS-2CD1023G0E-I', 3300000, 22, D],
      ['جعبه تقسیم دوربین هایک ویژن DS-1280ZJ-S', 700000, 6, D],
    ],
  },
  {
    id: 'R11-cat6-cable',
    target: { productName: 'کابل شبکه Cat6 UTP دی نت 305 متری', sku: null, anchorPriceToman: 6900000 },
    cands: [
      ['کابل شبکه دی-نت Cat6 UTP 305 متر (رول)', 7000000, 14, S],
      ['کابل شبکه Cat6 FTP دی نت 305 متری', 8600000, 10, D],
      ['کابل شبکه Cat5e UTP دی نت 305 متری', 4700000, 12, D],
      ['پچ کورد Cat6 دی نت 1 متری', 60000, 30, D],
      ['کابل شبکه Cat6 UTP لگراند 305 متری', 9800000, 7, D],
      ['کابل شبکه Cat6 UTP دی نت 100 متری', 2600000, 15, D],
    ],
  },
  {
    id: 'R12-psu-12v5a',
    target: { productName: 'منبع تغذیه 12 ولت 5 آمپر', sku: null, anchorPriceToman: 420000 },
    cands: [
      ['منبع تغذیه دوربین مداربسته 12 ولت 5 آمپر', 430000, 18, S],
      ['منبع تغذیه 12V 5A فلزی', 410000, 9, S],
      ['منبع تغذیه 12 ولت 10 آمپر', 760000, 11, D],
      ['منبع تغذیه 24 ولت 5 آمپر', 520000, 6, D],
      ['کابل برق منبع تغذیه 1.5 متری', 40000, 20, D],
    ],
  },
  {
    id: 'R13-bnc-connector',
    target: { productName: 'فیش BNC پیچی', sku: '7', anchorPriceToman: 25000 },
    cands: [
      ['فیش BNC پیچی دوربین مداربسته', 26000, 12, S],
      ['فیش BNC فشاری دوربین مداربسته', 22000, 10, D],
      ['سوکت RJ45 Cat6', 8000, 25, D],
      ['دوربین مداربسته بولت BNC', 1500000, 9, D],
    ],
  },
  {
    id: 'R14-remote-codeless',
    target: { productName: 'ریموت نایس flor', sku: '3', anchorPriceToman: 450000 },
    cands: [
      ['ریموت کنترل درب اتوماتیک نایس مدل Flor', 460000, 5, S],
      ['ریموت کنترل نایس مدل Flo2R-S 2 کانال', 520000, 6, A],
      ['ریموت کنترل نایس Era Mini', 480000, 4, D],
      ['باتری ریموت 12 ولت 23A', 20000, 22, D],
    ],
  },
  {
    id: 'R15-bare-code-title',
    target: { productName: 'دوربین DS-2CE56D0T-IRPF', sku: null, anchorPriceToman: 1550000 },
    cands: [
      ['دوربین مداربسته دام هایک ویژن DS-2CE56D0T-IRPF 2MP', 1600000, 25, S],
      ['دوربین مداربسته بولت هایک ویژن DS-2CE16D0T-IRPF 2MP', 1650000, 21, D],
      ['دوربین مداربسته دام هایک ویژن DS-2CE56D0T-IRMMF', 1900000, 13, D],
    ],
  },
  {
    id: 'R16-xvr-stem',
    target: { productName: 'دستگاه XVR5104 داهوا', sku: null, anchorPriceToman: 3000000 },
    cands: [
      ['دستگاه ضبط ویدیو XVR داهوا مدل DH-XVR5104HS-I3', 3100000, 12, A],
      ['دستگاه ضبط ویدیو XVR داهوا مدل DH-XVR5104H-I2', 2900000, 7, A],
      ['دستگاه ضبط ویدیو XVR داهوا مدل DH-XVR5108HS-I3', 5900000, 10, D],
      ['دستگاه ضبط ویدیو DVR داهوا مدل DH-XVR1B04-I', 2000000, 15, D],
    ],
  },
  {
    id: 'R17-dahua-pack-and-used',
    target: { productName: 'دوربین مداربسته بولت داهوا DH-HAC-HFW1200CP', sku: 'DH-HAC-HFW1200CP', anchorPriceToman: 1350000 },
    cands: [
      ['دوربین مداربسته داهوا HAC-HFW1200CP آنالوگ 2MP', 1380000, 17, S],
      ['پکیج 4 دوربین مداربسته داهوا HFW1200CP به همراه دستگاه ضبط و هارد 1 ترابایت', 9800000, 3, D],
      ['دو عددی دوربین داهوا DH-HAC-HFW1200CP', 2700000, 4, D],
      ['دوربین مداربسته بولت داهوا DH-HAC-HFW1200CP کارکرده', 700000, 2, D],
      ['دوربین مداربسته داهوا DH-HAC-HFW1200RP', 1300000, 10, D],
    ],
  },
  {
    id: 'R18-english-only-torob',
    target: { productName: 'دوربین مداربسته دام هایک ویژن DS-2CD2143G2-I', sku: null, anchorPriceToman: 8200000 },
    cands: [
      ['Hikvision DS-2CD2143G2-I 4MP AcuSense Fixed Dome Network Camera', 8300000, 6, S],
      ['Hikvision DS-2CD2043G2-I 4MP AcuSense Fixed Bullet Network Camera', 7800000, 9, D],
      ['Hikvision DS-2CD2143G2-I Wall Mount Bracket DS-1272ZJ-120B', 400000, 3, D],
    ],
  },
  {
    id: 'R19-bolt-typo-short',
    target: { productName: 'دوربین بالت داهوا HFW1230S-S5 دو مگاپیکسل', sku: null, anchorPriceToman: 3100000 },
    cands: [
      ['دوربین مداربسته تحت شبکه بولت داهوا مدل DH-IPC-HFW1230S-S5 رزولوشن 2 مگاپیکسل', 3150000, 14, S],
      ['دوربین مداربسته تحت شبکه بولت داهوا مدل DH-IPC-HFW1230S1-S5 رزولوشن 2 مگاپیکسل', 3250000, 11, D],
      ['دوربین مداربسته تحت شبکه بولت داهوا مدل DH-IPC-HFW1430S-S5 رزولوشن 4 مگاپیکسل', 4000000, 12, D],
      ['دوربین مداربسته تحت شبکه بولت داهوا مدل DH-IPC-HFW1230S-S5 2MP', 3050000, 1, S],
    ],
  },
  {
    id: 'R20-sdcard-coded',
    target: { productName: 'کارت حافظه microSDXC سامسونگ مدل EVO Plus MB-MC128KA ظرفیت 128 گیگابایت', sku: 'MB-MC128KA', anchorPriceToman: 2800000 },
    cands: [
      ['Samsung EVO Plus microSDXC MB-MC128KA 128GB', 2850000, 18, S],
      ['کارت حافظه microSDXC سامسونگ مدل EVO Plus MB-MC64KA ظرفیت 64 گیگابایت', 1600000, 20, D],
      ['کارت حافظه microSDXC سامسونگ مدل EVO Plus MB-MC256KA ظرفیت 256 گیگابایت', 5200000, 15, D],
      ['آداپتور microSD به SD سامسونگ', 60000, 6, D],
    ],
  },
  {
    id: 'R21-tplink-eap',
    target: { productName: 'اکسس پوینت سقفی تی پی لینک EAP225', sku: null, anchorPriceToman: 4300000 },
    cands: [
      ['اکسس پوینت سقفی تی پی لینک مدل EAP225 AC1350', 4350000, 13, S],
      ['TP-Link EAP225 AC1350 Wireless MU-MIMO Gigabit Ceiling Mount Access Point', 4300000, 5, S],
      ['اکسس پوینت سقفی تی پی لینک مدل EAP245 AC1750', 6500000, 10, D],
      ['اکسس پوینت تی پی لینک مدل EAP110', 3100000, 14, D],
      ['براکت اکسس پوینت تی پی لینک', 150000, 3, D],
    ],
  },
  {
    id: 'R22-seagate-skyhawk',
    target: { productName: 'هارد سیگیت SkyHawk ST2000VX017 2 ترابایت', sku: null, anchorPriceToman: 4900000 },
    cands: [
      ['هارد دیسک اینترنال سیگیت مدل SkyHawk ST2000VX017 ظرفیت 2 ترابایت', 4950000, 21, S],
      ['هارد دیسک اینترنال سیگیت مدل SkyHawk ST2000VX015 ظرفیت 2 ترابایت', 4700000, 9, D],
      ['هارد دیسک اینترنال سیگیت مدل Barracuda ST2000DM008 ظرفیت 2 ترابایت', 4600000, 24, D],
      ['هارد دیسک اینترنال وسترن دیجیتال مدل Purple WD20PURZ ظرفیت 2 ترابایت', 5000000, 20, D],
    ],
  },
  {
    id: 'R23-hdmi-cable',
    target: { productName: 'کابل HDMI 5 متری', sku: null, anchorPriceToman: 240000 },
    cands: [
      ['کابل اچ دی ام آی 5 متری', 250000, 15, S],
      ['کابل HDMI نسخه 2.0 به طول 5 متر', 260000, 8, S],
      ['کابل HDMI 10 متری', 520000, 14, D],
      ['کابل شبکه Cat6 5 متری', 90000, 17, D],
      ['مبدل HDMI به VGA', 300000, 12, D],
    ],
  },
  {
    id: 'R24-dahua-nvr-prefixless',
    target: { productName: 'دستگاه NVR داهوا NVR1108HS-S3 هشت کانال', sku: null, anchorPriceToman: 3400000 },
    cands: [
      ['دستگاه ضبط ویدیو NVR داهوا مدل DHI-NVR1108HS-S3 8 کانال', 3450000, 16, S],
      ['دستگاه ضبط ویدیو NVR داهوا مدل DHI-NVR1104HS-S3 4 کانال', 2600000, 13, D],
      ['دستگاه ضبط ویدیو NVR داهوا مدل DHI-NVR4108HS-8P-4KS2 8 کانال', 9800000, 7, D],
    ],
  },
  {
    id: 'R25-mikrotik',
    target: { productName: 'روتر میکروتیک RB750Gr3', sku: null, anchorPriceToman: 3600000 },
    cands: [
      ['روتر میکروتیک مدل RB750Gr3 hEX', 3650000, 11, S],
      ['MikroTik RB750Gr3 hEX Router', 3600000, 4, S],
      ['روتر میکروتیک مدل RB951Ui-2HnD', 2900000, 9, D],
      ['روتر میکروتیک مدل RB4011iGS+RM', 23000000, 6, D],
    ],
  },
  {
    id: 'R26-ptz',
    target: { productName: 'دوربین مداربسته اسپید دام داهوا DH-SD49225XA-HNR', sku: null, anchorPriceToman: 36000000 },
    cands: [
      ['دوربین مداربسته چرخشی PTZ داهوا مدل DH-SD49225XA-HNR', 36500000, 5, S],
      ['دوربین مداربسته دام داهوا مدل DH-IPC-HDBW1230E-S5', 3200000, 11, D],
      ['پایه دیواری دوربین اسپید دام داهوا PFB303W', 1200000, 4, D],
    ],
  },
  {
    id: 'R27-generic-camera-title',
    target: { productName: 'دوربین مداربسته دام دید در شب', sku: 'KY-1020300', anchorPriceToman: 1500000 },
    cands: [
      ['دوربین مداربسته دام هایک ویژن مدل DS-2CE56D0T-IRMF دید در شب', 1480000, 9, A],
      ['دوربین مداربسته دام دید در شب 2 مگاپیکسل', 1450000, 3, A],
    ],
  },
  {
    id: 'R28-dvr-hybrid',
    target: { productName: 'دستگاه DVR هایک ویژن DS-7204HGHI-K1 چهار کانال', sku: null, anchorPriceToman: 2600000 },
    cands: [
      ['دستگاه ضبط ویدیو DVR هایک ویژن مدل DS-7204HGHI-K1 4 کانال', 2650000, 18, S],
      ['دستگاه ضبط ویدیو DVR هایک ویژن مدل DS-7104HGHI-K1 4 کانال', 1950000, 22, D],
      ['دستگاه ضبط ویدیو DVR هایک ویژن مدل DS-7208HQHI-K1 8 کانال', 4300000, 9, D],
      ['دستگاه ضبط ویدیو DVR هایک ویژن مدل DS-7204HGHI-K1 4 کانال به همراه هارد 1 ترابایت', 5900000, 3, D],
    ],
  },
]

function arg(name, def) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 ? process.argv[i + 1] : def
}

function run(root, verbose, cases = CASES) {
  const { loadTsModule } = require(path.join(root, 'tests/helpers/ts-loader.cjs'))
  const M = loadTsModule('src/lib/pricing/matcher.ts')
  const out = { pairs: 0, same: { n: 0, approve: 0, review: 0, reject: 0 }, diff: { n: 0, approve: 0, review: 0, reject: 0 }, amb: { n: 0, approve: 0, review: 0, reject: 0 }, caseWrong: 0, caseCorrect: 0, caseReviewSame: 0, caseNoSame: 0, fails: [], misses: [] }
  for (const c of cases) {
    const cands = c.cands.map(([titleFa, priceToman, sellerCount], i) => ({ prk: `p${i}`, titleFa, priceToman, sellerCount, available: true }))
    const labels = c.cands.map((x) => x[3])
    const res = c.cands.map((_, i) => M.evaluateTorobCandidate(c.target, cands[i], 1))
    res.forEach((r, i) => {
      out.pairs++
      const L = labels[i]
      out[L].n++
      out[L][r.verdict]++
      if (L !== 'same' && r.verdict === 'approve') out.fails.push({ id: c.id, label: L, target: c.target.productName, cand: c.cands[i][0], score: r.score, notes: r.notes.slice(0, 3) })
      if (L === 'same' && r.verdict !== 'approve') out.misses.push({ id: c.id, target: c.target.productName, cand: c.cands[i][0], verdict: r.verdict, score: r.score, why: (r.rejectReason || (r.blockers || []).join(' | ') || r.notes.join(' | ')).slice(0, 140) })
    })
    const best = M.selectBestTorobSearchMatch(c.target, cands, 1)
    const hasSame = labels.includes('same')
    if (best.best && best.best.verdict === 'approve') {
      const li = Number(best.best.candidate.prk.slice(1))
      if (labels[li] === 'same') out.caseCorrect++
      else out.caseWrong++
    } else if (hasSame) out.caseReviewSame++
    else out.caseNoSame++
    if (verbose) {
      console.log(`\n== ${c.id}  «${c.target.productName}»`)
      res.forEach((r, i) => console.log(`  [${labels[i]}] ${String(r.score).padStart(3)} ${r.verdict.padEnd(7)} «${c.cands[i][0]}»${r.verdict !== 'approve' ? '  — ' + (r.rejectReason || (r.blockers || [])[0] || '').slice(0, 90) : ''}`))
    }
  }
  return out
}

module.exports = { CASES, run }

if (require.main === module) {
  const root = path.resolve(arg('root', path.join(__dirname, '..', '..')))
  const verbose = process.argv.includes('--verbose')
  const r = run(root, verbose)
  const pc = (a, b) => (b ? ((a / b) * 100).toFixed(1) + '%' : 'n/a')
  console.log(`\nمجموعهٔ دست‌نویس — ${CASES.length} کیس ، ${r.pairs} جفت — root=${path.basename(root)}`)
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
}
