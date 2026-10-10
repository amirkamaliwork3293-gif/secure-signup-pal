/**
 * تست اسکنر بارکد — منطق خالص + شبیه‌سازی کامل پایپ‌لاین روی فریم دوربین مصنوعی.
 * اجرا: npx --yes tsx --tsconfig tsconfig.json scripts/test-scanner.ts
 *
 * بخش شبیه‌سازی دقیقاً همان کد پروداکشن را اجرا می‌کند: `planCrop` و `PASS_CYCLE`
 * (کدام ناحیه با چه اندازه‌ای)، `decodePixels` و `READER_OPTIONS` (zxing)، و
 * `Consensus` (پذیرش). فقط «دوربین» مصنوعی است: بارکد با bwip-js/qrcode ساخته و
 * با اندازه، چرخش، معکوس و تاری مختلف روی یک فریم ۱۰۸۰p نویزدار گذاشته می‌شود.
 * هیچ دادهٔ کاربری خوانده یا نوشته نمی‌شود.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import bwipjs from "bwip-js/node";
import { PNG } from "pngjs";
import QRCode from "qrcode";
import { prepareZXingModule } from "zxing-wasm/reader";

import {
  Consensus,
  CONFIRM_WINDOW_MS,
  EXCLUSIVE_MS,
  MIN_REPEAT_MS,
  REARM_GAP_MS,
  identityKey,
  needsConfirmation,
} from "../src/features/barcode-scanner/consensus.ts";
import {
  expandUpcE,
  fromNativeFormat,
  fromZxingFormat,
  isPlausible,
  isValidGtin,
} from "../src/features/barcode-scanner/formats.ts";
import {
  PASS_CYCLE,
  clampRect,
  insideAimZone,
  outputPointToVideo,
  outputSize,
  planCrop,
  videoPointToView,
  visibleVideoRect,
  type CropPlan,
} from "../src/features/barcode-scanner/geometry.ts";
import {
  initialZoom,
  isFrontLens,
  labelsAreInformative,
  rankRearLenses,
  zoomSteps,
} from "../src/features/barcode-scanner/lens.ts";
import { WedgeBuffer, keyToChar } from "../src/features/barcode-scanner/keyboard-wedge.ts";
import { pickNativeHit, withTimeout } from "../src/features/barcode-scanner/engines/native.ts";
import {
  isBlankFrame,
  sampledLumaVariance,
} from "../src/features/barcode-scanner/frame-grabber.ts";
import { decodePixels, type Pixels } from "../src/features/barcode-scanner/engines/zxing-core.ts";
import { findProductByCode } from "../src/lib/barcode-match.ts";

prepareZXingModule({
  overrides: { wasmBinary: readFileSync("node_modules/zxing-wasm/dist/reader/zxing_reader.wasm") },
  fireImmediately: false,
});

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log("\nفرمت‌ها");

await test("رقم کنترلی GTIN", () => {
  assert.ok(isValidGtin("5901234123457"));
  assert.ok(isValidGtin("96385074"));
  assert.ok(isValidGtin("012345678905"));
  assert.ok(!isValidGtin("5901234123458"));
  assert.ok(!isValidGtin("59012341234"));
  assert.ok(!isValidGtin("abc"));
});

await test("بسط UPC-E", () => {
  assert.equal(expandUpcE("01234565"), "012345000065");
  assert.ok(isPlausible("upce", "01234565"));
  assert.ok(isPlausible("upce", "0012345000065"));
  assert.ok(!isPlausible("upce", "01234564"));
});

await test("نگاشت نام فرمت دو موتور", () => {
  assert.equal(fromZxingFormat("EAN13"), "ean13");
  assert.equal(fromZxingFormat("Code128"), "code128");
  assert.equal(fromZxingFormat("QRCode"), "qr");
  assert.equal(fromZxingFormat("Nope"), "unknown");
  assert.equal(fromNativeFormat("ean_13"), "ean13");
  assert.equal(fromNativeFormat("qr_code"), "qr");
  assert.equal(fromNativeFormat("itf"), "itf");
});

await test("خوانش نامعقول رد می‌شود", () => {
  assert.ok(!isPlausible("ean13", "5901234123458"), "رقم کنترلی غلط");
  assert.ok(!isPlausible("itf", "12345"), "ITF طول فرد");
  assert.ok(!isPlausible("code39", "A"), "CODE-39 خیلی کوتاه");
  assert.ok(!isPlausible("qr", ""), "خالی");
  assert.ok(isPlausible("code128", "PABC234XYZ"));
});

console.log("\nدروازهٔ پذیرش");

await test("فرمت قوی با یک خوانش؛ تکرار تا وقتی در دید است رد می‌شود", () => {
  const c = new Consensus();
  const r = { text: "5901234123457", format: "ean13" as const, source: "native" as const };
  assert.equal(c.offer(r, 0).kind, "accept");
  // بارکد جلوی دوربین مانده: هر ۳۳ms دوباره خوانده می‌شود، حتی تا ۵ ثانیه.
  for (let t = 33; t < 5000; t += 33) assert.equal(c.offer(r, t).kind, "repeat", `t=${t}`);
  // از دید خارج شد و برگشت → دوباره پذیرفته می‌شود (اسکن کالای دوم از همان نوع).
  assert.equal(c.offer(r, 5000 + REARM_GAP_MS).kind, "accept");
});

await test("دو بار سریع پشت‌سرهم پذیرفته نمی‌شود", () => {
  const c = new Consensus();
  const r = { text: "5901234123457", format: "ean13" as const, source: "native" as const };
  assert.equal(c.offer(r, 0).kind, "accept");
  // حتی اگر از دید رفته باشد، قبل از MIN_REPEAT_MS نه.
  assert.equal(c.offer(r, MIN_REPEAT_MS - 50).kind, "repeat");
});

await test("کد متفاوت به محض خروج کد قبلی از دید پذیرفته می‌شود", () => {
  const c = new Consensus();
  assert.equal(
    c.offer({ text: "5901234123457", format: "ean13", source: "zxing", lineCount: 3 }, 0).kind,
    "accept",
  );
  assert.equal(
    c.offer({ text: "96385074", format: "ean8", source: "zxing", lineCount: 3 }, EXCLUSIVE_MS).kind,
    "accept",
  );
});

await test("فرمت ضعیف دو خوانش یکسان در پنجره لازم دارد", () => {
  const c = new Consensus();
  const r = { text: "ABC-123", format: "code39" as const, source: "zxing" as const, lineCount: 5 };
  assert.equal(c.offer(r, 0).kind, "pending");
  assert.equal(c.offer({ ...r, text: "ABC-128" }, 30).kind, "pending", "متن متفاوت تأیید نمی‌کند");
  assert.equal(c.offer(r, 60).kind, "accept");

  const late = new Consensus();
  assert.equal(late.offer(r, 0).kind, "pending");
  assert.equal(late.offer(r, CONFIRM_WINDOW_MS + 1).kind, "pending", "خارج از پنجره، شمارش از نو");
  assert.equal(late.offer(r, CONFIRM_WINDOW_MS + 30).kind, "accept");
});

await test("خوانش تک‌خطی zxing تأیید دوم لازم دارد؛ موتور دیگر هم تأیید می‌کند", () => {
  assert.ok(needsConfirmation({ text: "x", format: "ean13", source: "zxing", lineCount: 1 }));
  assert.ok(!needsConfirmation({ text: "x", format: "ean13", source: "zxing", lineCount: 2 }));
  assert.ok(!needsConfirmation({ text: "x", format: "qr", source: "zxing", lineCount: 0 }));
  const c = new Consensus();
  assert.equal(
    c.offer({ text: "5901234123457", format: "ean13", source: "zxing", lineCount: 1 }, 0).kind,
    "pending",
  );
  assert.equal(
    c.offer({ text: "5901234123457", format: "ean13", source: "native" }, 20).kind,
    "accept",
  );
});

await test("دو بارکد هم‌زمان در دید: هرکدام حداکثر یک بار، نه تناوب بی‌پایان", () => {
  const c = new Consensus();
  const a = { text: "4006381333931", format: "ean13" as const, source: "native" as const };
  const b = {
    text: "5901234123457",
    format: "ean13" as const,
    source: "zxing" as const,
    lineCount: 3,
  };
  let accepted = 0;
  // دو موتور یکی در میان دو کد متفاوت را می‌بینند، ۱۰ ثانیه.
  for (let t = 0; t < 10_000; t += 33) {
    if (c.offer((t / 33) % 2 === 0 ? a : b, t).kind === "accept") accepted++;
  }
  assert.equal(accepted, 1, "تا وقتی کد اول در دید است، کد دوم پذیرفته نمی‌شود");
});

await test("کالای بعدی بعد از خارج شدن کالای قبلی از دید پذیرفته می‌شود", () => {
  const c = new Consensus();
  const a = { text: "4006381333931", format: "ean13" as const, source: "native" as const };
  const b = { text: "5901234123457", format: "ean13" as const, source: "native" as const };
  assert.equal(c.offer(a, 0).kind, "accept");
  assert.equal(c.offer(a, 100).kind, "repeat");
  assert.equal(c.offer(b, 150).kind, "busy", "a هنوز در دید است");
  assert.equal(c.offer(b, 100 + EXCLUSIVE_MS).kind, "accept");
  // برگشت به a بعد از خروج b از دید.
  assert.equal(c.offer(a, 100 + EXCLUSIVE_MS + REARM_GAP_MS + 400).kind, "accept");
});

await test("UPC-A دوازده‌رقمی و سیزده‌رقمی یک کالا هستند", () => {
  assert.equal(identityKey("upca", "012345678905"), identityKey("ean13", "0012345678905"));
  const c = new Consensus();
  assert.equal(
    c.offer({ text: "012345678905", format: "upca", source: "native" }, 0).kind,
    "accept",
  );
  assert.equal(
    c.offer({ text: "0012345678905", format: "ean13", source: "zxing", lineCount: 4 }, 30).kind,
    "repeat",
  );
});

await test("بارکدخوان سخت‌افزاری: هر اسکن پذیرفته می‌شود حتی تکراری", () => {
  const c = new Consensus();
  const r = { text: "PABC234XYZ", format: "unknown" as const, source: "keyboard" as const };
  assert.equal(c.offer(r, 0).kind, "accept");
  assert.equal(c.offer(r, 10).kind, "accept");
});

await test("کاراکترهای کنترلی و پیشوند symbology حذف می‌شوند", () => {
  const c = new Consensus();
  const v = c.offer({ text: "]C1PABC\x1d234", format: "code128", source: "native" }, 0);
  assert.equal(v.kind, "accept");
  assert.equal(v.kind === "accept" && v.code, "PABC234");
});

console.log("\nهندسه");

await test("ناحیهٔ دیده‌شده با object-fit: cover", () => {
  const v = visibleVideoRect({ width: 1920, height: 1080 }, { width: 400, height: 300 });
  assert.equal(v.height, 1080);
  assert.equal(v.width, 1440);
  assert.equal(v.x, 240);
  const p = visibleVideoRect({ width: 1080, height: 1920 }, { width: 400, height: 300 });
  assert.equal(p.width, 1080);
  assert.equal(p.height, 810);
});

await test("برش‌ها همیشه داخل فریم‌اند و نسبت ابعاد حفظ می‌شود", () => {
  for (const video of [
    { width: 1920, height: 1080 },
    { width: 1080, height: 1920 },
    { width: 640, height: 480 },
    { width: 4032, height: 3024 },
  ]) {
    for (const pass of ["focus", "wide", "micro"] as const) {
      for (const main of [false, true]) {
        const plan = planCrop(pass, video, { width: 360, height: 270 }, main)!;
        const s = plan.source;
        assert.ok(
          s.x >= 0 && s.y >= 0 && s.x + s.width <= video.width && s.y + s.height <= video.height,
        );
        const ratioIn = s.width / s.height;
        const ratioOut = plan.output.width / plan.output.height;
        assert.ok(Math.abs(ratioIn - ratioOut) / ratioIn < 0.02, `${pass} نسبت کشیده شد`);
        assert.ok(Math.max(plan.output.width, plan.output.height) <= (main ? 720 : 1280));
      }
    }
  }
  assert.equal(planCrop("focus", { width: 0, height: 0 }, { width: 1, height: 1 }, false), null);
  assert.deepEqual(clampRect({ x: -5, y: -5, width: 20, height: 20 }, { width: 10, height: 10 }), {
    x: 0,
    y: 0,
    width: 10,
    height: 10,
  });
  assert.deepEqual(outputSize({ width: 200, height: 100 }, 1000, 1), { width: 200, height: 100 });
  assert.deepEqual(outputSize({ width: 200, height: 100 }, 1000, 2), { width: 400, height: 200 });
});

await test("نگاشت نقطه: خروجی برش → ویدیو → صفحه", () => {
  const video = { width: 1920, height: 1080 };
  const view = { width: 400, height: 300 };
  const plan = planCrop("focus", video, view, false)!;
  const center = outputPointToVideo({ x: plan.output.width / 2, y: plan.output.height / 2 }, plan);
  const onScreen = videoPointToView(center, video, view);
  assert.ok(Math.abs(onScreen.x - 0.5) < 0.01 && Math.abs(onScreen.y - 0.5) < 0.01);
});

await test("ناحیهٔ هدف: بارکد بیرون از کادر نادیده گرفته می‌شود", () => {
  assert.ok(insideAimZone([]));
  assert.ok(
    insideAimZone([
      { x: 0.4, y: 0.45 },
      { x: 0.6, y: 0.55 },
    ]),
  );
  assert.ok(
    insideAimZone([
      { x: -0.2, y: 0.3 },
      { x: 1.2, y: 0.7 },
    ]),
    "بارکد بزرگ بیرون‌زده، مرکزش داخل",
  );
  assert.ok(
    !insideAimZone([
      { x: 0.4, y: 0.02 },
      { x: 0.6, y: 0.1 },
    ]),
    "کالای بالای کادر",
  );
  assert.ok(
    !insideAimZone([
      { x: 0.0, y: 0.5 },
      { x: 0.01, y: 0.55 },
    ]),
    "لبهٔ چپ تصویر",
  );
});

console.log("\nانتخاب لنز و زوم");

await test("لنز اصلی عقب اول؛ جلو حذف؛ فوق‌عریض/تله عقب", () => {
  const android = [
    { deviceId: "f", label: "camera2 1, facing front" },
    { deviceId: "uw", label: "camera2 2, facing back" },
    { deviceId: "main", label: "camera2 0, facing back" },
  ];
  assert.equal(rankRearLenses(android)[0].deviceId, "main");
  assert.ok(!rankRearLenses(android).some((l) => l.deviceId === "f"));
  const ios = [
    { deviceId: "uw", label: "Back Ultra Wide Camera" },
    { deviceId: "tele", label: "Back Telephoto Camera" },
    { deviceId: "main", label: "Back Camera" },
    { deviceId: "front", label: "Front Camera" },
    { deviceId: "triple", label: "Back Triple Camera" },
  ];
  const ranked = rankRearLenses(ios).map((l) => l.deviceId);
  assert.equal(ranked[0], "main");
  assert.ok(ranked.indexOf("uw") > ranked.indexOf("triple"));
  assert.ok(isFrontLens("Front Camera") && !isFrontLens("Back Camera"));
  assert.ok(
    !labelsAreInformative([
      { deviceId: "a", label: "" },
      { deviceId: "b", label: "" },
    ]),
  );
});

await test("زوم شروع و پله‌ها", () => {
  assert.equal(initialZoom(null), null);
  assert.equal(initialZoom({ min: 1, max: 1.5 }), null, "وب‌کم با زوم کم دست نمی‌خورد");
  assert.equal(initialZoom({ min: 1, max: 8 }), 1.5);
  assert.deepEqual(zoomSteps({ min: 1, max: 4 }), [1, 1.5, 2, 3]);
  assert.deepEqual(zoomSteps({ min: 0.6, max: 2 }), [0.6, 1, 1.5, 2]);
  assert.deepEqual(zoomSteps(null), []);
});

console.log("\nبارکدخوان سخت‌افزاری");

await test("کیبورد فارسی: کاراکتر از کلید فیزیکی بازسازی می‌شود", () => {
  assert.equal(keyToChar({ key: "ش", code: "KeyA", shiftKey: false }), "a");
  assert.equal(keyToChar({ key: "ؤ", code: "KeyA", shiftKey: true }), "A");
  assert.equal(keyToChar({ key: "۵", code: "Digit5" }), "5");
  assert.equal(keyToChar({ key: "٣", code: "" }), "3");
  assert.equal(keyToChar({ key: "7", code: "Numpad7" }), "7");
  assert.equal(keyToChar({ key: "-", code: "Minus" }), "-");
  assert.equal(keyToChar({ key: "Shift", code: "ShiftLeft" }), null);
  assert.equal(keyToChar({ key: "c", code: "KeyC", ctrlKey: true }), null);
});

await test("تایپ ماشینی پذیرفته، تایپ انسانی رد می‌شود", () => {
  const fast = new WedgeBuffer();
  "5901234123457".split("").forEach((ch, i) => fast.push(ch, i * 8));
  assert.deepEqual(fast.terminate(13 * 8), { code: "5901234123457" });

  const human = new WedgeBuffer();
  "123456".split("").forEach((ch, i) => human.push(ch, i * 140));
  assert.equal(human.terminate(6 * 140), null);

  const noEnter = new WedgeBuffer();
  "PABC234XYZ".split("").forEach((ch, i) => noEnter.push(ch, i * 10));
  assert.deepEqual(noEnter.flushIdle(), { code: "PABC234XYZ" });

  const shortNoEnter = new WedgeBuffer();
  "12".split("").forEach((ch, i) => shortNoEnter.push(ch, i * 10));
  assert.equal(shortNoEnter.flushIdle(), null);
});

console.log("\nموتور بومی و فریم");

await test("pickNativeHit و withTimeout", async () => {
  assert.equal(pickNativeHit(null), null);
  assert.equal(pickNativeHit([{ rawValue: "", format: "qr_code" }]), null);
  const hit = pickNativeHit([
    { rawValue: "5901234123457", format: "ean_13", cornerPoints: [{ x: 1, y: 2 }] },
  ]);
  assert.deepEqual(hit, { text: "5901234123457", format: "ean13", corners: [{ x: 1, y: 2 }] });
  assert.equal(await withTimeout(new Promise(() => {}), 10), "timeout");
  assert.equal(await withTimeout(Promise.resolve(5), 1000), 5);
});

await test("تشخیص فریم سیاه (باگ کپی canvas سامسونگ)", () => {
  const black = new Uint8ClampedArray(640 * 480 * 4);
  assert.ok(isBlankFrame(black));
  const noisy = new Uint8ClampedArray(640 * 480 * 4).map((_, i) => (i * 2654435761) % 251);
  assert.ok(!isBlankFrame(noisy));
  assert.ok(sampledLumaVariance(noisy) > 100);
});

/* ─────────────────────── شبیه‌سازی پایپ‌لاین روی فریم مصنوعی ─────────────────────── */

type Rgba = { data: Uint8ClampedArray; width: number; height: number };

function pngToRgba(buf: Buffer): Rgba {
  const png = PNG.sync.read(buf);
  return { data: new Uint8ClampedArray(png.data), width: png.width, height: png.height };
}

async function barcode(
  bcid: string,
  text: string,
  scale: number,
  extra: Record<string, unknown> = {},
) {
  const opts: Record<string, unknown> = {
    bcid,
    text,
    scale,
    height: 14,
    paddingwidth: 6,
    paddingheight: 4,
    backgroundcolor: "FFFFFF",
    includetext: false,
    ...extra,
  };
  // `undefined` یعنی «پیش‌فرض bwip» (کدهای دوبعدی ارتفاع ثابت ندارند).
  for (const k of Object.keys(opts)) if (opts[k] === undefined) delete opts[k];
  const png = await bwipjs.toBuffer(opts as Parameters<typeof bwipjs.toBuffer>[0]);
  return pngToRgba(png);
}

async function qr(text: string, moduleSize: number): Promise<Rgba> {
  const buf = await QRCode.toBuffer(text, {
    scale: moduleSize,
    margin: 2,
    errorCorrectionLevel: "M",
  });
  return pngToRgba(buf);
}

function rotate90(img: Rgba): Rgba {
  const out = new Uint8ClampedArray(img.data.length);
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      const src = (y * img.width + x) * 4;
      const dst = (x * img.height + (img.height - 1 - y)) * 4;
      out.set(img.data.subarray(src, src + 4), dst);
    }
  return { data: out, width: img.height, height: img.width };
}

function invert(img: Rgba): Rgba {
  const out = new Uint8ClampedArray(img.data);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = 255 - out[i];
    out[i + 1] = 255 - out[i + 1];
    out[i + 2] = 255 - out[i + 2];
  }
  return { ...img, data: out };
}

/** تاری جعبه‌ای افقی/عمودی؛ شبیه‌سازی فوکوس ناقص یا لرزش دست. */
function blur(img: Rgba, radius: number): Rgba {
  let cur = img.data;
  for (const horizontal of [true, false]) {
    const out = new Uint8ClampedArray(cur.length);
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < img.width; x++)
        for (let c = 0; c < 3; c++) {
          let sum = 0;
          let n = 0;
          for (let k = -radius; k <= radius; k++) {
            const xx = horizontal ? x + k : x;
            const yy = horizontal ? y : y + k;
            if (xx < 0 || yy < 0 || xx >= img.width || yy >= img.height) continue;
            sum += cur[(yy * img.width + xx) * 4 + c];
            n++;
          }
          out[(y * img.width + x) * 4 + c] = sum / n;
        }
    for (let i = 3; i < out.length; i += 4) out[i] = 255;
    cur = out;
  }
  return { ...img, data: cur };
}

/** فریم ۱۰۸۰p با زمینهٔ نویزدار (شبیه سطح میز/قفسه) و بارکد در موقعیت داده‌شده. */
function cameraFrame(
  sticker: Rgba,
  cx = 0.5,
  cy = 0.5,
  video = { width: 1920, height: 1080 },
): Rgba {
  const { width, height } = video;
  const data = new Uint8ClampedArray(width * height * 4);
  let seed = 12345;
  for (let i = 0; i < data.length; i += 4) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const v = 105 + (seed % 40);
    data[i] = v;
    data[i + 1] = v - 6;
    data[i + 2] = v - 12;
    data[i + 3] = 255;
  }
  const ox = Math.round(cx * width - sticker.width / 2);
  const oy = Math.round(cy * height - sticker.height / 2);
  for (let y = 0; y < sticker.height; y++) {
    const fy = oy + y;
    if (fy < 0 || fy >= height) continue;
    for (let x = 0; x < sticker.width; x++) {
      const fx = ox + x;
      if (fx < 0 || fx >= width) continue;
      const s = (y * sticker.width + x) * 4;
      const d = (fy * width + fx) * 4;
      data[d] = sticker.data[s];
      data[d + 1] = sticker.data[s + 1];
      data[d + 2] = sticker.data[s + 2];
    }
  }
  return { data, width, height };
}

/** همان کاری که canvas.drawImage با imageSmoothing انجام می‌دهد (درون‌یابی دوخطی). */
function crop(frame: Rgba, plan: CropPlan): Pixels {
  const { source, output } = plan;
  const out = new Uint8ClampedArray(output.width * output.height * 4);
  const sx = source.width / output.width;
  const sy = source.height / output.height;
  for (let y = 0; y < output.height; y++) {
    const fy = Math.min(frame.height - 1.001, Math.max(0, source.y + (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    for (let x = 0; x < output.width; x++) {
      const fx = Math.min(frame.width - 1.001, Math.max(0, source.x + (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const i00 = (y0 * frame.width + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + frame.width * 4;
      const i11 = i01 + 4;
      const o = (y * output.width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const top = frame.data[i00 + c] * (1 - tx) + frame.data[i10 + c] * tx;
        const bottom = frame.data[i01 + c] * (1 - tx) + frame.data[i11 + c] * tx;
        out[o + c] = top * (1 - ty) + bottom * ty;
      }
      out[o + 3] = 255;
    }
  }
  return { data: out, width: output.width, height: output.height };
}

const VIEW = { width: 400, height: 300 };
const decodeTimes: number[] = [];

/**
 * یک «دوربین» ثابت را با همان چرخهٔ پاس پروداکشن اسکن می‌کند تا Consensus کد را
 * بپذیرد. تعداد فریم لازم را برمی‌گرداند (هر فریم ≈ ۳۳ms).
 */
async function scanUntilAccepted(frame: Rgba, maxFrames = 8) {
  const consensus = new Consensus();
  for (let i = 0; i < maxFrames; i++) {
    const pass = PASS_CYCLE[i % PASS_CYCLE.length];
    const plan = planCrop(pass, frame, VIEW, false);
    if (!plan) continue;
    const px = crop(frame, plan);
    const t0 = performance.now();
    const hit = await decodePixels(px, plan.mode);
    decodeTimes.push(performance.now() - t0);
    if (!hit) continue;
    const verdict = consensus.offer(
      { text: hit.text, format: hit.format, source: "zxing", lineCount: hit.lineCount },
      i * 33,
    );
    if (verdict.kind === "accept")
      return { code: verdict.code, format: verdict.format, frames: i + 1, pass };
  }
  return null;
}

async function expectScan(
  name: string,
  sticker: Rgba,
  expected: string,
  opts: { cx?: number; cy?: number; maxFrames?: number } = {},
) {
  await test(name, async () => {
    const frame = cameraFrame(sticker, opts.cx, opts.cy);
    const res = await scanUntilAccepted(frame, opts.maxFrames ?? 8);
    assert.ok(res, `خوانده نشد (اندازهٔ بارکد ${sticker.width}×${sticker.height})`);
    assert.equal(res.code, expected);
    console.log(
      `      ${sticker.width}×${sticker.height}px → ${res.frames} فریم (پاس ${res.pass})`,
    );
  });
}

console.log("\nشبیه‌سازی پایپ‌لاین کامل (فریم ۱۰۸۰p، نمای ۴:۳)");

// اندازه‌ها از بسیار ریز (مدول ۱ پیکسل، بارکد دور) تا بسیار بزرگ (بیرون‌زده از کادر).
await expectScan(
  "EAN-13 بسیار ریز (مدول ۱px)",
  await barcode("ean13", "590123412345", 1),
  "5901234123457",
);
await expectScan(
  "EAN-13 ریز (مدول ۲px)",
  await barcode("ean13", "590123412345", 2),
  "5901234123457",
);
await expectScan("EAN-13 معمولی", await barcode("ean13", "626000000001", 5), "6260000000019");
await expectScan(
  "EAN-13 بسیار بزرگ (بیرون از کادر)",
  await barcode("ean13", "590123412345", 15),
  "5901234123457",
);
await expectScan(
  "EAN-13 عمودی (۹۰ درجه)",
  rotate90(await barcode("ean13", "590123412345", 4)),
  "5901234123457",
);
await expectScan("EAN-13 تار", blur(await barcode("ean13", "590123412345", 4), 2), "5901234123457");
await expectScan(
  "EAN-13 خارج از مرکز کادر",
  await barcode("ean13", "590123412345", 3),
  "5901234123457",
  {
    cx: 0.72,
    cy: 0.3,
  },
);
await expectScan("EAN-8", await barcode("ean8", "9638507", 3), "96385074");
await expectScan("UPC-A", await barcode("upca", "01234567890", 3), "0012345678905");
await expectScan(
  "CODE-128 کد تولیدی اپ (ریز)",
  await barcode("code128", "PABC234XYZ", 1),
  "PABC234XYZ",
);
await expectScan("CODE-128 کد تولیدی اپ", await barcode("code128", "PABC234XYZ", 3), "PABC234XYZ");
await expectScan(
  "CODE-128 لیبل معکوس (روشن روی تیره)",
  invert(await barcode("code128", "INV-0042", 3)),
  "INV-0042",
  {
    maxFrames: 16,
  },
);
await expectScan("CODE-39 (تأیید دوم)", await barcode("code39", "ABC-123", 3), "ABC-123");
// استاندارد ITF حاشیهٔ سفید ≥۱۰ مدول می‌خواهد؛ بدون آن هیچ خواننده‌ای نمی‌خواند.
await expectScan(
  "ITF (تأیید دوم)",
  await barcode("interleaved2of5", "12345678", 3, { paddingwidth: 12 }),
  "12345678",
);
await expectScan("QR ریز", await qr("PABC234XYZ", 2), "PABC234XYZ");
await expectScan("QR بزرگ", await qr("https://example.com/p/123", 18), "https://example.com/p/123");
await expectScan(
  "DataMatrix",
  await barcode("datamatrix", "DM-1234", 4, { height: undefined }),
  "DM-1234",
);
await expectScan(
  "PDF417",
  await barcode("pdf417", "PDF417-TEST", 2, { height: undefined }),
  "PDF417-TEST",
);

await test("فریم بدون بارکد: هیچ خوانش کاذبی پذیرفته نمی‌شود", async () => {
  const empty = cameraFrame({ data: new Uint8ClampedArray(4).fill(120), width: 1, height: 1 });
  assert.equal(await scanUntilAccepted(empty, 8), null);
});

await test("تطبیق کد اسکن‌شده با محصول ذخیره‌شده (بدون تغییر رفتار)", () => {
  const list = [
    { id: "a", code: "012345678905" },
    { id: "b", code: "PABC234XYZ" },
    { id: "c", code: "5901234123457" },
  ];
  assert.equal(findProductByCode(list, "0012345678905")?.id, "a", "UPC-A سیزده‌رقمی zxing");
  assert.equal(findProductByCode(list, "PABC234XYZ")?.id, "b");
  assert.equal(findProductByCode(list, "5901234123457")?.id, "c");
});

const sorted = [...decodeTimes].sort((a, b) => a - b);
const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
console.log(
  `\n${passed} تست موفق. زمان دیکود zxing (Node): میانه ${median.toFixed(1)}ms، p95 ${p95.toFixed(1)}ms`,
);
