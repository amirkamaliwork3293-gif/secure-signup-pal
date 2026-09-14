/**
 * تست هندسهٔ اسکنر + تطبیق بارکد (بدون نوشتن داده).
 * اجرا: npx --yes tsx --tsconfig tsconfig.json scripts/test-scanner-engine.ts
 */
import assert from "node:assert/strict";
import {
  normalizeScannedCode,
  scannedCodeCandidates,
  scannedCodesMatch,
  findProductByCode,
} from "../src/lib/barcode-match.ts";
import {
  cropSourceRect,
  fitDecodeSize,
  insetScanCrop,
  sampledLuminanceVariance,
} from "../src/lib/scanner-engine.ts";
import { readFileSync } from "node:fs";
import {
  cameraConstraintTries,
  grabFrameViaCanvas,
  NATIVE_DETECT_MS,
  NATIVE_HANG_LIMIT,
  NATIVE_WARMUP_CALLS,
  NATIVE_WARMUP_MS,
  nativeDetectBudgetMs,
  nextNativeHangState,
  pickRearCameraId,
  raceTimeout,
} from "../src/lib/scanner-capture.ts";
import { classifyDeviceTier, decodeBudget, decodeCanvasSize } from "../src/lib/device-tier.ts";

{
  assert.equal(normalizeScannedCode("  6261234567890  "), "6261234567890");
  assert.equal(normalizeScannedCode("]C1626123"), "626123");
  assert.equal(normalizeScannedCode("A\u001dB"), "AB");
}

{
  const c = scannedCodeCandidates("123456789012");
  assert.ok(c.includes("123456789012"));
  assert.ok(c.includes("0123456789012"), "UPC-A باید معادل EAN-13 با صفر پیشوند باشد");
}

{
  const c = scannedCodeCandidates("0123456789012");
  assert.ok(c.includes("123456789012"), "EAN-13 با صفر باید UPC-A را هم پیدا کند");
}

{
  assert.equal(scannedCodesMatch("0123456789012", "123456789012"), true);
  assert.equal(scannedCodesMatch("PABC123", "PABC123"), true);
  assert.equal(scannedCodesMatch("PABC123", "PABC124"), false);
}

{
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
    "EAN-13 leading-zero → stored UPC-A",
  );
  assert.equal(findProductByCode(list, "  626-1234567890")?.id, "2");
  assert.equal(findProductByCode(list, ""), undefined);
  assert.equal(findProductByCode(list, "no-such"), undefined);
}

{
  const r = cropSourceRect(1280, 720, { x: 0.11, y: 0.27, w: 0.78, h: 0.46 });
  assert.equal(r.sx + r.sw <= 1280, true);
  assert.equal(r.sy + r.sh <= 720, true);
  assert.equal(r.sw > 800, true);
  // نسبت کادر باید حدود 78/46 ≈ 1.70 برابر عرض به ارتفاع ویدیو باشد نه ۴:۳
  const cropAspect = r.sw / r.sh;
  assert.ok(cropAspect > 2.2 && cropAspect < 3.5, `crop aspect ${cropAspect}`);
}

{
  const fit = fitDecodeSize(998, 331, 720, 320);
  assert.equal(fit.dw, 720);
  assert.equal(fit.dh, 239);
  const inAspect = 998 / 331;
  const outAspect = fit.dw / fit.dh;
  assert.ok(Math.abs(inAspect - outAspect) < 0.02, `aspect preserved ${inAspect} vs ${outAspect}`);
}

{
  const noUpscale = fitDecodeSize(200, 80, 720, 320);
  assert.equal(noUpscale.dw, 200);
  assert.equal(noUpscale.dh, 80);
}

{
  const parent = { x: 0.11, y: 0.27, w: 0.78, h: 0.46 };
  const inner = insetScanCrop(parent, 0.62);
  assert.ok(inner.w < parent.w && inner.h < parent.h);
  assert.ok(Math.abs(inner.x + inner.w / 2 - (parent.x + parent.w / 2)) < 1e-9);
  assert.ok(inner.x >= parent.x - 1e-9);
  assert.ok(inner.x + inner.w <= parent.x + parent.w + 1e-9);
  const clamped = insetScanCrop(parent, 0.1);
  assert.ok(clamped.w / parent.w >= 0.3 - 1e-9);
}

{
  const overflow = cropSourceRect(100, 100, { x: 0.9, y: 0.9, w: 0.5, h: 0.5 });
  assert.equal(overflow.sx + overflow.sw <= 100, true);
  assert.equal(overflow.sy + overflow.sh <= 100, true);
}

{
  assert.deepEqual(decodeBudget("low"), { maxW: 720, maxH: 320 });
  const sized = decodeCanvasSize("mid");
  assert.equal(sized.dw / sized.dh > 1.5, true, "budget is wide, not 4:3");
  assert.equal(classifyDeviceTier({ deviceMemory: 2, hardwareConcurrency: 8 }), "mid");
}

{
  const rear = pickRearCameraId([
    { deviceId: "a", label: "Front Camera", kind: "videoinput" },
    { deviceId: "b", label: "Back Camera", kind: "videoinput" },
  ]);
  assert.equal(rear, "b");
  const persian = pickRearCameraId([
    { deviceId: "f", label: "دوربین جلو", kind: "videoinput" },
    { deviceId: "r", label: "دوربین پشت", kind: "videoinput" },
  ]);
  assert.equal(persian, "r");
  const khalfi = pickRearCameraId([
    { deviceId: "f", label: "دوربین سلفی", kind: "videoinput" },
    { deviceId: "r", label: "دوربین خلفی", kind: "videoinput" },
  ]);
  assert.equal(khalfi, "r");
  const androidHal = pickRearCameraId([
    { deviceId: "cam1", label: "camera2 1, facing front", kind: "videoinput" },
    { deviceId: "cam0", label: "camera2 0, facing back", kind: "videoinput" },
  ]);
  assert.equal(androidHal, "cam0", "لیبل HAL اندروید camera2 0 باید پشت باشد");
  const xiaomi = pickRearCameraId([
    { deviceId: "u", label: "Front Camera", kind: "videoinput" },
    { deviceId: "w", label: "camera2 0, world facing", kind: "videoinput" },
  ]);
  assert.equal(xiaomi, "w");
  const unlabeled = pickRearCameraId([
    { deviceId: "1", label: "", kind: "videoinput" },
    { deviceId: "2", label: "", kind: "videoinput" },
  ]);
  assert.equal(unlabeled, "2", "بدون لیبل، آخرین videoinput معمولاً پشت است");
  const skipFront = pickRearCameraId([
    { deviceId: "f", label: "Front Camera", kind: "videoinput" },
    { deviceId: "u", label: "", kind: "videoinput" },
  ]);
  assert.equal(skipFront, "u", "اگر فقط جلو لیبل دارد، دوربین دیگر پشت فرض می‌شود");
  const mixedKinds = pickRearCameraId([
    { deviceId: "mic", label: "Microphone", kind: "audioinput" },
    { deviceId: "front", label: "Front Camera", kind: "videoinput" },
    { deviceId: "rear", label: "Rear Camera", kind: "videoinput" },
  ]);
  assert.equal(mixedKinds, "rear");
  const onlyFront = pickRearCameraId([
    { deviceId: "only", label: "Front Camera", kind: "videoinput" },
  ]);
  assert.equal(onlyFront, "only", "اگر فقط جلو باشد همان را برمی‌گرداند تا اسکن صفر نشود");
  const none = pickRearCameraId([{ deviceId: "mic", label: "Mic", kind: "audioinput" }]);
  assert.equal(none, undefined);
  const empty = pickRearCameraId([]);
  assert.equal(empty, undefined);
}

{
  const high = cameraConstraintTries(false);
  const low = cameraConstraintTries(true);
  assert.equal(high.length, 5);
  assert.equal(low.length, 5);
  assert.equal(high[0].audio, false);
  const first = high[0].video;
  assert.equal(typeof first, "object");
  assert.ok(first && typeof first === "object" && "width" in first);
  const firstVideo = first as MediaTrackConstraints;
  assert.equal(
    (firstVideo.width as { ideal?: number }).ideal,
    1280,
    "اول قید ساده ۱۲۸۰ تا Overconstrained نشود",
  );
  assert.equal((firstVideo.height as { ideal?: number }).ideal, 720);
  assert.equal(firstVideo.facingMode, "environment");
  const last = high[high.length - 1];
  assert.equal(last.video, true);
  const fhdHigh = high[3].video as MediaTrackConstraints;
  const fhdLow = low[3].video as MediaTrackConstraints;
  assert.equal((fhdHigh.width as { ideal?: number }).ideal, 1920);
  assert.equal((fhdLow.width as { ideal?: number }).ideal, 1280);
}

{
  const fast = await raceTimeout(Promise.resolve("ok"), 200, "fallback");
  assert.equal(fast.value, "ok");
  assert.equal(fast.timedOut, false);
  const hung = await raceTimeout(new Promise<string>(() => {}), 30, "fallback");
  assert.equal(hung.value, "fallback");
  assert.equal(hung.timedOut, true);
  const rejected = await raceTimeout(Promise.reject(new Error("gum")), 200, "fallback");
  assert.equal(rejected.value, "fallback");
  assert.equal(rejected.timedOut, false, "reject نباید به‌عنوان تایم‌اوت Native شمرده شود");
  const late = new Promise<string>((resolve) => setTimeout(() => resolve("late"), 80));
  const raced = await raceTimeout(late, 20, "fallback");
  assert.equal(raced.value, "fallback");
  assert.equal(raced.timedOut, true);
}

{
  // رگرسیون v7: Vite فقط `new Worker(new URL("...", import.meta.url))` را در یک
  // عبارت باندل می‌کند. اگر URL به متغیر جدا شود، سورس خام .ts داخل data: URL می‌رود
  // و Worker در پروداکشن با SyntaxError می‌میرد — ZXing هیچ‌وقت دیکود نمی‌کند.
  const scannerSrc = readFileSync(
    new URL("../src/components/Scanner.tsx", import.meta.url),
    "utf8",
  );
  const inline = scannerSrc.match(
    /new Worker\(\s*new URL\(\s*["']\.\.\/lib\/zxing\.worker\.ts["']\s*,\s*import\.meta\.url\s*\)/g,
  );
  assert.ok(
    inline && inline.length >= 1,
    "Worker باید با new URL(..., import.meta.url) درجا ساخته شود",
  );
  const detached = scannerSrc.match(/new Worker\(\s*[A-Za-z_$][\w$]*\s*[,)]/g);
  assert.equal(detached, null, "new Worker(url) با متغیر، باندل Vite را می‌شکند");
}

{
  // اولین detect های ML Kit مدل را لود می‌کنند؛ تایم‌اوت کوتاه آن‌ها Native را می‌کشت.
  assert.equal(NATIVE_WARMUP_CALLS, 3);
  assert.equal(NATIVE_WARMUP_MS, 4000);
  assert.equal(NATIVE_DETECT_MS, 1000);
  assert.ok(nativeDetectBudgetMs(0) >= 3000, "اولین detect باید زمان لود مدل را داشته باشد");
  assert.equal(nativeDetectBudgetMs(0), NATIVE_WARMUP_MS);
  assert.equal(nativeDetectBudgetMs(NATIVE_WARMUP_CALLS - 1), NATIVE_WARMUP_MS);
  assert.equal(nativeDetectBudgetMs(NATIVE_WARMUP_CALLS), NATIVE_DETECT_MS);
  assert.equal(nativeDetectBudgetMs(500), NATIVE_DETECT_MS);
  assert.ok(
    nativeDetectBudgetMs(500) > 320,
    "۳۲۰ms قدیمی detect عادی روی میان‌رده را هم تایم‌اوت می‌کرد",
  );
}

{
  assert.equal(NATIVE_HANG_LIMIT, 2);
  const miss = nextNativeHangState(true, 0);
  assert.deepEqual(miss, { hangCount: 1, disable: false });
  const kill = nextNativeHangState(true, 1);
  assert.deepEqual(kill, { hangCount: 2, disable: true });
  const reset = nextNativeHangState(false, 1);
  assert.deepEqual(reset, { hangCount: 0, disable: false });
}

{
  const flat = sampledLuminanceVariance(new Uint8ClampedArray(32).fill(128));
  assert.equal(flat, 0);
  const tiny = sampledLuminanceVariance(new Uint8ClampedArray(4).fill(10));
  assert.equal(tiny, 0, "نمونهٔ خیلی کم نباید واریانس بدهد");
  const noisy = new Uint8ClampedArray(256);
  for (let i = 0; i < noisy.length; i++) noisy[i] = i % 2 === 0 ? 0 : 255;
  assert.ok(sampledLuminanceVariance(noisy) > 18);
}

{
  const blank = grabFrameViaCanvas(
    { videoWidth: 0, videoHeight: 0 } as HTMLVideoElement,
    { x: 0.11, y: 0.27, w: 0.78, h: 0.46 },
    720,
    320,
  );
  assert.equal(blank, null, "ویدیوی بدون فریم نباید کراپ بدهد");
  const noDom = grabFrameViaCanvas(
    { videoWidth: 1280, videoHeight: 720 } as HTMLVideoElement,
    { x: 0.11, y: 0.27, w: 0.78, h: 0.46 },
    720,
    320,
  );
  assert.equal(noDom, null, "بدون document (Node/WebWorker) canvas fallback باید null بماند");
}

{
  assert.equal(classifyDeviceTier({}), "mid", "بدون سیگنال نباید low شود");
  assert.equal(classifyDeviceTier({ hardwareConcurrency: 0 }), "mid");
}

console.log("scanner-engine: ok");
