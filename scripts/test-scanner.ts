/**
 * تست اسکنر بارکد — هندسه، دروازهٔ پذیرش، رتبه‌بندی لنز، و دیکود واقعی.
 * اجرا: npx --yes tsx --tsconfig tsconfig.json scripts/test-scanner.ts
 *
 * دیکود با همان تابع پروداکشن (`decodePixels`) و همان تنظیمات (`READER_OPTIONS`)
 * انجام می‌شود. بارکدها اینجا ساخته و به پیکسل خام RGBA تبدیل می‌شوند — همان
 * شکل ورودی که در مرورگر از `ImageData` می‌آید. هیچ دادهٔ کاربری خوانده یا
 * نوشته نمی‌شود.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import bwipjs from "bwip-js/node";
import QRCode from "qrcode";
import { prepareZXingModule } from "zxing-wasm/reader";

import {
  BASE_RETICLE,
  MAX_DECODE_PIXELS,
  cropSourceRect,
  fitDecodeSize,
  reticleRect,
} from "../src/features/scanner/geometry.ts";
import { needsConfirmation, READER_FORMATS } from "../src/features/scanner/formats.ts";
import {
  CONFIRM_WINDOW_MS,
  REPEAT_SUPPRESS_MS,
  acceptScan,
  initialAcceptState,
} from "../src/features/scanner/accept.ts";
import { looksLikeFrontCamera, rankRearCameras } from "../src/features/scanner/camera-select.ts";
import { decodePixels, type Pixels } from "../src/features/scanner/decoder/zxing.ts";
import {
  findProductByCode,
  normalizeScannedCode,
  scannedCodeCandidates,
  scannedCodesMatch,
} from "../src/lib/barcode-match.ts";

// wasm را از فایل محلی می‌دهیم تا تست به شبکه/CDN وابسته نباشد.
prepareZXingModule({
  overrides: { wasmBinary: readFileSync("node_modules/zxing-wasm/dist/reader/zxing_reader.wasm") },
  fireImmediately: false,
});

/* --------------------------------------------------------------- هندسه */

{
  const r = reticleRect(1);
  assert.equal(r.w, BASE_RETICLE.w);
  assert.ok(Math.abs(r.x * 2 + r.w - 1) < 1e-9, "کادر باید افقی وسط باشد");
  assert.ok(Math.abs(r.y * 2 + r.h - 1) < 1e-9, "کادر باید عمودی وسط باشد");

  // ضریب‌های افراطی نباید از فریم بیرون بزنند.
  for (const scale of [0.01, 0.4, 1, 1.4, 99]) {
    const q = reticleRect(scale);
    assert.ok(q.x >= 0 && q.y >= 0, `x/y منفی در scale=${scale}`);
    assert.ok(q.x + q.w <= 1 + 1e-9, `عرض از فریم بیرون زد در scale=${scale}`);
    assert.ok(q.y + q.h <= 1 + 1e-9, `ارتفاع از فریم بیرون زد در scale=${scale}`);
  }

  // مستطیل منبع همیشه داخل مرز ویدیو می‌ماند.
  for (const [vw, vh] of [
    [1920, 1080],
    [1280, 720],
    [640, 480],
    [1, 1],
  ]) {
    const c = cropSourceRect(vw, vh, reticleRect(1.4));
    assert.ok(c.sx >= 0 && c.sy >= 0, "مبدأ منفی");
    assert.ok(c.sx + c.sw <= vw, `sw از ${vw} بیرون زد`);
    assert.ok(c.sy + c.sh <= vh, `sh از ${vh} بیرون زد`);
    assert.ok(c.sw >= 1 && c.sh >= 1, "اندازهٔ صفر");
  }

  // نسبت تصویر باید حفظ شود — باگ اصلی نسخهٔ قبل همین بود.
  const big = fitDecodeSize(1497, 497);
  assert.ok(big.dw * big.dh <= MAX_DECODE_PIXELS, "از سقف پیکسل رد شد");
  assert.ok(Math.abs(big.dw / big.dh - 1497 / 497) < 0.02, "نسبت تصویر کشیده شد");

  // هرگز بزرگ‌نمایی نمی‌کند.
  const small = fitDecodeSize(320, 120);
  assert.deepEqual(small, { dw: 320, dh: 120 });

  console.log("  ok - هندسهٔ کادر");
}

/* ------------------------------------------------ فرمت‌ها و دروازهٔ پذیرش */

{
  assert.ok(READER_FORMATS.includes("Code128"), "CODE-128 لازم است (کد تولیدی اپ)");
  assert.ok(READER_FORMATS.includes("EAN-13"), "EAN-13 لازم است");

  // خروجی zxing خط تیره ندارد: EAN13 نه EAN-13.
  for (const f of ["QRCode", "DataMatrix", "EAN13", "EAN8", "UPCA", "UPCE", "Code128"]) {
    assert.equal(needsConfirmation(f), false, `${f} باید فوری پذیرفته شود`);
  }
  for (const f of ["Code39", "ITF", "Codabar", ""]) {
    assert.equal(needsConfirmation(f), true, `${f} باید تأیید دوم بخواهد`);
  }

  // فرمت خودتأییدشونده: یک خوانش کافی است.
  const a = acceptScan(initialAcceptState, "6260001234567", "EAN13", 1000);
  assert.equal(a.emit, "6260001234567");

  // همان کد بلافاصله بعدش emit نمی‌شود...
  const b = acceptScan(a.state, "6260001234567", "EAN13", 1000 + REPEAT_SUPPRESS_MS - 1);
  assert.equal(b.emit, null, "تکرار در پنجرهٔ سرکوب نباید emit شود");
  // ...ولی بعد از پنجره دوباره می‌شود (کاربر می‌خواهد دو عدد از یک کالا بزند).
  const c = acceptScan(b.state, "6260001234567", "EAN13", 1000 + REPEAT_SUPPRESS_MS + 1);
  assert.equal(c.emit, "6260001234567");

  // کد متفاوت فوراً رد نمی‌شود.
  const d = acceptScan(a.state, "PABC234XYZ", "Code128", 1010);
  assert.equal(d.emit, "PABC234XYZ");

  // CODE-39: خوانش اول فقط pending می‌شود، خوانش دومِ یکسان پذیرفته می‌شود.
  const e1 = acceptScan(initialAcceptState, "ABC-123", "Code39", 2000);
  assert.equal(e1.emit, null, "خوانش اول CODE-39 نباید پذیرفته شود");
  const e2 = acceptScan(e1.state, "ABC-123", "Code39", 2100);
  assert.equal(e2.emit, "ABC-123", "خوانش دوم یکسان باید پذیرفته شود");

  // تأییدِ بیات نباید بپذیرد.
  const f1 = acceptScan(initialAcceptState, "ABC-123", "Code39", 3000);
  const f2 = acceptScan(f1.state, "ABC-123", "Code39", 3000 + CONFIRM_WINDOW_MS + 1);
  assert.equal(f2.emit, null, "تأیید بعد از پنجره نباید پذیرفته شود");

  // دو خوانش متفاوت پشت سر هم نباید همدیگر را تأیید کنند.
  const g1 = acceptScan(initialAcceptState, "ABC-123", "Code39", 4000);
  const g2 = acceptScan(g1.state, "XYZ-999", "Code39", 4050);
  assert.equal(g2.emit, null, "خوانش متناقض نباید پذیرفته شود");

  // UPC-A و همان کد با صفر پیشوند یک کالا هستند (منطق مشترک barcode-match).
  const h1 = acceptScan(initialAcceptState, "0012345678905", "EAN13", 5000);
  assert.equal(h1.emit, "0012345678905");
  const h2 = acceptScan(h1.state, "012345678905", "EAN13", 5100);
  assert.equal(h2.emit, null, "UPC-A با/بدون صفر پیشوند باید یکی شمرده شود");

  // ورودی خالی یا فقط کاراکتر کنترلی هیچ‌وقت emit نمی‌شود.
  for (const junk of ["", "   ", String.fromCharCode(0, 1, 31)]) {
    assert.equal(acceptScan(initialAcceptState, junk, "QRCode", 6000).emit, null);
  }

  console.log("  ok - فرمت‌ها و دروازهٔ پذیرش");
}

/* ------------------------------------------------ تطبیق کد با محصول ذخیره‌شده */

// `barcode-match.ts` با `store.ts` مشترک است و در این بازنویسی **تغییر نکرده**.
// این پوشش از `scripts/test-scanner-engine.ts` حذف‌شده منتقل شده تا با رفتن آن
// فایل، لایهٔ جست‌وجوی محصول بی‌تست نماند.
{
  assert.equal(normalizeScannedCode("  6261234567890  "), "6261234567890");
  assert.equal(normalizeScannedCode("]C1626123"), "626123", "پیشوند AIM باید حذف شود");
  assert.equal(
    normalizeScannedCode("A" + String.fromCharCode(29) + "B"),
    "AB",
    "کاراکتر کنترلی باید حذف شود",
  );

  const upc = scannedCodeCandidates("123456789012");
  assert.ok(upc.includes("123456789012"));
  assert.ok(upc.includes("0123456789012"), "UPC-A باید معادل EAN-13 با صفر پیشوند باشد");
  assert.ok(
    scannedCodeCandidates("0123456789012").includes("123456789012"),
    "EAN-13 با صفر باید UPC-A را هم پیدا کند",
  );

  assert.equal(scannedCodesMatch("0123456789012", "123456789012"), true);
  assert.equal(scannedCodesMatch("PABC123", "PABC123"), true);
  assert.equal(scannedCodesMatch("PABC123", "PABC124"), false);

  const list = [
    { id: "1", code: "PXYZ23456" },
    { id: "2", code: "6261234567890" },
    { id: "3", code: "123456789012" },
  ];
  assert.equal(findProductByCode(list, "PXYZ23456")?.id, "1");
  assert.equal(findProductByCode(list, "6261234567890")?.id, "2");
  assert.equal(
    findProductByCode(list, "0123456789012")?.id,
    "3",
    "EAN-13 با صفر → UPC-A ذخیره‌شده",
  );
  assert.equal(findProductByCode(list, "  626-1234567890")?.id, "2");
  assert.equal(findProductByCode(list, ""), undefined);
  assert.equal(findProductByCode(list, "no-such"), undefined);

  console.log("  ok - تطبیق کد با محصول ذخیره‌شده");
}

/* ----------------------------------------------------- رتبه‌بندی لنز عقب */

{
  const vi = (deviceId: string, label: string) => ({ deviceId, label, kind: "videoinput" });

  // الگوی رایج اندروید.
  assert.deepEqual(
    rankRearCameras([vi("f", "camera2 1, facing front"), vi("b", "camera2 0, facing back")]),
    ["b", "f"],
    "دوربین عقب باید اول باشد",
  );

  // الگوی گوشی چنددوربینه — لنز اصلی عقب باید بر ultra-wide و macro مقدم شود.
  const multi = rankRearCameras([
    vi("uw", "Back Ultra Wide Camera"),
    vi("main", "Back Camera"),
    vi("tele", "Back Telephoto Camera"),
    vi("front", "Front Camera"),
    vi("depth", "Back Depth Camera"),
  ]);
  assert.equal(multi[0], "main", "لنز اصلی عقب باید اول باشد");
  assert.ok(multi.indexOf("uw") < multi.indexOf("front"), "ultra-wide بهتر از دوربین جلو است");
  assert.equal(multi[multi.length - 1], "front", "دوربین جلو باید آخر باشد");
  assert.ok(multi.indexOf("depth") < multi.indexOf("front"), "depth هنوز عقب است");

  // میکروفون و ورودی غیرویدیویی نباید وارد فهرست شوند.
  assert.deepEqual(
    rankRearCameras([
      { deviceId: "mic", label: "Microphone", kind: "audioinput" },
      vi("cam", "camera2 0, facing back"),
    ]),
    ["cam"],
  );

  // لیبل خالی (WebView بدون مجوز): ترتیب شمارش حفظ می‌شود، ایندکس ۰ اول.
  assert.deepEqual(rankRearCameras([vi("a", ""), vi("b", ""), vi("c", "")]), ["a", "b", "c"]);

  // لیبل فارسی — گوشی‌های عرضه‌شده در بازار ایران (پوشش منتقل‌شده از تست قبلی).
  assert.equal(rankRearCameras([vi("f", "دوربین جلو"), vi("r", "دوربین پشت")])[0], "r");
  assert.equal(rankRearCameras([vi("f", "دوربین سلفی"), vi("r", "دوربین خلفی")])[0], "r");
  assert.equal(rankRearCameras([vi("f", "دوربین جلو"), vi("r", "دوربین عقب")])[0], "r");

  // فهرست خالی نباید بترکاند.
  assert.deepEqual(rankRearCameras([]), []);

  // facingMode مقدم بر لیبل است.
  assert.equal(looksLikeFrontCamera("user", "Back Camera"), true);
  assert.equal(looksLikeFrontCamera("environment", "Front Camera"), false);
  assert.equal(looksLikeFrontCamera(undefined, "Front Camera"), true);
  assert.equal(looksLikeFrontCamera(undefined, "camera2 0, facing back"), false);

  console.log("  ok - رتبه‌بندی لنز عقب");
}

/* ----------------------------------------------- دیکود واقعی، رفت‌وبرگشت */

/** میله‌های یک بارکد خطی را به پیکسل خام RGBA تبدیل می‌کند. */
function rasterizeLinear(sbs: number[], { scale = 3, height = 90, quiet = 30 } = {}): Pixels {
  const modules = sbs.reduce((a, b) => a + b, 0);
  const width = modules * scale + quiet * 2;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  let x = quiet;
  let dark = true;
  for (const run of sbs) {
    const w = run * scale;
    if (dark) {
      for (let px = x; px < x + w; px++) {
        for (let y = 0; y < height; y++) {
          const o = (y * width + px) * 4;
          data[o] = data[o + 1] = data[o + 2] = 0;
        }
      }
    }
    x += w;
    dark = !dark;
  }
  return { data, width, height };
}

function rasterizeQr(text: string, { scale = 4, quiet = 16 } = {}): Pixels {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const bits = qr.modules.data;
  const width = n * scale + quiet * 2;
  const height = width;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!bits[r * n + c]) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const o = ((quiet + r * scale + dy) * width + (quiet + c * scale + dx)) * 4;
          data[o] = data[o + 1] = data[o + 2] = 0;
        }
      }
    }
  }
  return { data, width, height };
}

function linear(bcid: string, text: string, opts?: { scale?: number; height?: number }): Pixels {
  const [{ sbs }] = bwipjs.raw({ bcid, text, includetext: false }) as Array<{ sbs: number[] }>;
  return rasterizeLinear(sbs, opts);
}

{
  // هر فرمتی که کاربران واقعی به آن تکیه دارند. `expect` شکلی است که zxing
  // برمی‌گرداند — تطبیق با کد ذخیره‌شده کار `barcode-match.ts` است.
  const cases: Array<{ name: string; px: Pixels; expect: string; format: string }> = [
    // کدِ تولیدی خودِ اپ: generateUniqueCode → "P" + ۹ کاراکتر، چاپ‌شده به CODE-128.
    {
      name: "CODE-128 (کد اپ)",
      px: linear("code128", "PABC234XYZ"),
      expect: "PABC234XYZ",
      format: "Code128",
    },
    {
      name: "CODE-128 (عددی)",
      px: linear("code128", "123456789012"),
      expect: "123456789012",
      format: "Code128",
    },
    {
      name: "EAN-13",
      px: linear("ean13", "6260001234567"),
      expect: "6260001234567",
      format: "EAN13",
    },
    { name: "EAN-8", px: linear("ean8", "20886509"), expect: "20886509", format: "EAN8" },
    // zxing برای UPC-A مقدار ۱۳رقمی با صفر پیشوند می‌دهد.
    { name: "UPC-A", px: linear("upca", "012345678905"), expect: "0012345678905", format: "EAN13" },
    { name: "UPC-E", px: linear("upce", "04252614"), expect: "0042100005264", format: "UPCE" },
    { name: "CODE-39", px: linear("code39", "ABC-123"), expect: "ABC-123", format: "Code39" },
    {
      name: "ITF",
      px: linear("interleaved2of5", "1234567895"),
      expect: "1234567895",
      format: "ITF",
    },
    { name: "QR (کد اپ)", px: rasterizeQr("PABC234XYZ"), expect: "PABC234XYZ", format: "QRCode" },
    {
      name: "QR (فارسی)",
      px: rasterizeQr("کالای شماره ۱۲۳"),
      expect: "کالای شماره ۱۲۳",
      format: "QRCode",
    },
  ];

  for (const c of cases) {
    const hit = await decodePixels(c.px);
    assert.ok(hit, `${c.name} خوانده نشد`);
    assert.equal(hit.text, c.expect, `${c.name}: متن اشتباه`);
    assert.equal(hit.format, c.format, `${c.name}: فرمت اشتباه`);
    console.log(`  ok - ${c.name} -> ${hit.text} (${hit.format})`);
  }
}

/* ---------------------------------------- نبودِ خوانش اشتباه (false read) */

{
  const blank: Pixels = {
    data: new Uint8ClampedArray(800 * 300 * 4).fill(255),
    width: 800,
    height: 300,
  };
  assert.equal(await decodePixels(blank), null, "فریم سفید نباید چیزی بخواند");

  // نویز قطعی (بدون Math.random تا تست پایدار بماند).
  const noise: Pixels = { data: new Uint8ClampedArray(800 * 300 * 4), width: 800, height: 300 };
  let seed = 12345;
  for (let i = 0; i < noise.data.length; i += 4) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const v = (seed >> 16) & 0xff;
    noise.data[i] = noise.data[i + 1] = noise.data[i + 2] = v;
    noise.data[i + 3] = 255;
  }
  assert.equal(await decodePixels(noise), null, "فریم نویز نباید چیزی بخواند");

  // فریم خیلی کوچک باید بدون صدا زدن wasm رد شود.
  assert.equal(
    await decodePixels({ data: new Uint8ClampedArray(8 * 8 * 4), width: 8, height: 8 }),
    null,
  );

  console.log("  ok - فریم سفید/نویز/خیلی‌کوچک هیچ خوانشی تولید نمی‌کند");
}

console.log("scanner: ok");
