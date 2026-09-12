/**
 * zxing-decode.ts — دیکود پیکسل (مشترک بین Worker و تست).
 * بدون DOM؛ فقط آرایهٔ RGBA یا روشنایی.
 */
import {
  BarcodeFormat,
  DecodeHintType,
  RGBLuminanceSource,
  BinaryBitmap,
  HybridBinarizer,
  GlobalHistogramBinarizer,
  MultiFormatReader,
} from "@zxing/library";

export const FAST_HINTS = new Map<DecodeHintType, unknown>([
  [DecodeHintType.TRY_HARDER, false],
  [DecodeHintType.CHARACTER_SET, "UTF-8"],
  [
    DecodeHintType.POSSIBLE_FORMATS,
    [
      BarcodeFormat.QR_CODE,
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
      BarcodeFormat.CODE_128,
    ],
  ],
]);

export const EXTRA_HINTS = new Map<DecodeHintType, unknown>([
  [DecodeHintType.TRY_HARDER, false],
  [DecodeHintType.CHARACTER_SET, "UTF-8"],
  [
    DecodeHintType.POSSIBLE_FORMATS,
    [
      BarcodeFormat.QR_CODE,
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
    ],
  ],
]);

const reader = new MultiFormatReader();

export function rgbaToLuminance(data: Uint8ClampedArray, size: number): Uint8ClampedArray {
  const lum = new Uint8ClampedArray(size);
  for (let i = 0, j = 0; j < size; i += 4, j++) {
    lum[j] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
  }
  return lum;
}

export function invertLuminance(lum: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(lum.length);
  for (let i = 0; i < lum.length; i++) out[i] = 255 - lum[i];
  return out;
}

export function sampledLumaVariance(lum: Uint8ClampedArray, step = 17): number {
  let n = 0,
    sum = 0,
    sum2 = 0;
  const stride = Math.max(1, step | 0);
  for (let i = 0; i < lum.length; i += stride) {
    const v = lum[i];
    sum += v;
    sum2 += v * v;
    n++;
  }
  if (n < 8) return 0;
  const mean = sum / n;
  return sum2 / n - mean * mean;
}

function decodeLum(
  lum: Uint8ClampedArray,
  width: number,
  height: number,
  hints: Map<DecodeHintType, unknown>,
): string | null {
  reader.setHints(hints);
  const src = new RGBLuminanceSource(lum, width, height);
  try {
    return reader.decode(new BinaryBitmap(new GlobalHistogramBinarizer(src))).getText();
  } catch {
    try {
      return reader.decode(new BinaryBitmap(new HybridBinarizer(src))).getText();
    } catch {
      return null;
    }
  } finally {
    reader.reset();
  }
}

/** دیکود RGBA مثل فریم دوربین. واریانس خیلی پایین = فریم خالی. */
export function decodeRgba(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  extra = false,
): string | null {
  if (width < 8 || height < 8) return null;
  const lum = rgbaToLuminance(data, width * height);
  if (sampledLumaVariance(lum) < 18) return null;
  const hints = extra ? EXTRA_HINTS : FAST_HINTS;
  const hit = decodeLum(lum, width, height, hints);
  if (hit) return hit;
  return decodeLum(invertLuminance(lum), width, height, hints);
}
