/**
 * Round-trip: bwip-js لیبل می‌سازد، همان دیکودر Worker باید بخواند.
 * اجرا: npx --yes tsx --tsconfig tsconfig.json scripts/test-zxing-decode.ts
 */
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import bwipjs from "bwip-js/node";
import { decodeRgba } from "../src/lib/zxing-decode.ts";
import { fitDecodeSize } from "../src/lib/scanner-engine.ts";
import { scannedCodesMatch, findProductByCode } from "../src/lib/barcode-match.ts";

async function render(
  bcid: string,
  text: string,
): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const png = await bwipjs.toBuffer({
    bcid,
    text,
    scale: 3,
    height: 14,
    includetext: false,
    paddingwidth: 12,
    paddingheight: 10,
    backgroundcolor: "FFFFFF",
  });
  const img = PNG.sync.read(png);
  return {
    data: new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.byteLength),
    width: img.width,
    height: img.height,
  };
}

function downscale(
  src: { data: Uint8ClampedArray; width: number; height: number },
  maxW: number,
  maxH: number,
) {
  const { dw, dh } = fitDecodeSize(src.width, src.height, maxW, maxH);
  if (dw === src.width && dh === src.height) return src;
  const out = new Uint8ClampedArray(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(src.height - 1, Math.floor((y * src.height) / dh));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x * src.width) / dw));
      const si = (sy * src.width + sx) * 4;
      const di = (y * dw + x) * 4;
      out[di] = src.data[si];
      out[di + 1] = src.data[si + 1];
      out[di + 2] = src.data[si + 2];
      out[di + 3] = 255;
    }
  }
  return { data: out, width: dw, height: dh };
}

{
  const img = await render("ean13", "5901234123457");
  const text = decodeRgba(img.data, img.width, img.height);
  assert.equal(text, "5901234123457", `EAN-13 full-res got ${text}`);
}

{
  const img = await render("ean13", "5901234123457");
  const small = downscale(img, 512, 240);
  const text = decodeRgba(small.data, small.width, small.height);
  assert.equal(text, "5901234123457", `EAN-13 budget-scale got ${text}`);
}

{
  const img = await render("code128", "P7K3M9N2Q4");
  const text = decodeRgba(img.data, img.width, img.height);
  assert.equal(text, "P7K3M9N2Q4", `Code128 product code got ${text}`);
}

{
  const img = await render("qrcode", "https://kamix.example/p/1");
  const text = decodeRgba(img.data, img.width, img.height);
  assert.equal(text, "https://kamix.example/p/1", `QR got ${text}`);
}

{
  const img = await render("upca", "036000291452");
  const text = decodeRgba(img.data, img.width, img.height);
  assert.ok(text && scannedCodesMatch(text, "036000291452"), `UPC-A got ${text}`);
  const product = findProductByCode([{ id: "u", code: "0036000291452" }], text!);
  assert.equal(product?.id, "u");
}

console.log("zxing-decode round-trip: ok");
