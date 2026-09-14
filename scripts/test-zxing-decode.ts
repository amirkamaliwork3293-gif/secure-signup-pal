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

{
  // بارکد کوچک وسط کادر عریض دوربین — زوم مرکز قبل از downsample باید بخواند.
  const img = await render("ean13", "5901234123457");
  const fieldW = 998;
  const fieldH = 331;
  const field = new Uint8ClampedArray(fieldW * fieldH * 4);
  field.fill(255);
  const ox = Math.floor((fieldW - img.width) / 2);
  const oy = Math.floor((fieldH - img.height) / 2);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const si = (y * img.width + x) * 4;
      const di = ((oy + y) * fieldW + (ox + x)) * 4;
      field[di] = img.data[si];
      field[di + 1] = img.data[si + 1];
      field[di + 2] = img.data[si + 2];
      field[di + 3] = 255;
    }
  }
  const scale = 0.62;
  const zw = Math.round(fieldW * scale);
  const zh = Math.round(fieldH * scale);
  const zx = Math.floor((fieldW - zw) / 2);
  const zy = Math.floor((fieldH - zh) / 2);
  const zoom = new Uint8ClampedArray(zw * zh * 4);
  for (let y = 0; y < zh; y++) {
    for (let x = 0; x < zw; x++) {
      const si = ((zy + y) * fieldW + (zx + x)) * 4;
      const di = (y * zw + x) * 4;
      zoom[di] = field[si];
      zoom[di + 1] = field[si + 1];
      zoom[di + 2] = field[si + 2];
      zoom[di + 3] = 255;
    }
  }
  const text = decodeRgba(zoom, zw, zh);
  assert.equal(text, "5901234123457", `small EAN in wide crop via center zoom got ${text}`);
}

console.log("zxing-decode round-trip: ok");
