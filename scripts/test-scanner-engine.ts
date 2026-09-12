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
import { cropSourceRect, fitDecodeSize } from "../src/lib/scanner-engine.ts";
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
  const overflow = cropSourceRect(100, 100, { x: 0.9, y: 0.9, w: 0.5, h: 0.5 });
  assert.equal(overflow.sx + overflow.sw <= 100, true);
  assert.equal(overflow.sy + overflow.sh <= 100, true);
}

{
  assert.deepEqual(decodeBudget("low"), { maxW: 512, maxH: 240 });
  const sized = decodeCanvasSize("mid");
  assert.equal(sized.dw / sized.dh > 1.5, true, "budget is wide, not 4:3");
  assert.equal(classifyDeviceTier({ deviceMemory: 2, hardwareConcurrency: 8 }), "mid");
}

console.log("scanner-engine: ok");
