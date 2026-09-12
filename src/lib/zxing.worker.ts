/**
 * zxing.worker.ts — دیکود بارکد خارج از ترد اصلی
 *
 * ImageBitmap از ترد اصلی منتقل می‌شود (بدون getImageData روی UI).
 * فقط فرمت‌های فروشگاهی روی مسیر سریع: QR / EAN / UPC / Code128.
 * TRY_HARDER و ITF/PDF417 از مسیر داغ حذف شده‌اند — روی فریم نویزی قفل می‌کردند.
 *
 * ورودی:  { id, bitmap: ImageBitmap, extra?: boolean }
 * خروجی: { id, text: string | null }
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

const FAST_HINTS = new Map<DecodeHintType, unknown>([
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

const EXTRA_HINTS = new Map<DecodeHintType, unknown>([
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
let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;

function ensureCanvas(w: number, h: number): OffscreenCanvasRenderingContext2D {
  if (!canvas || canvas.width !== w || canvas.height !== h) {
    canvas = new OffscreenCanvas(w, h);
    ctx = canvas.getContext("2d", { willReadFrequently: true, alpha: false });
  }
  if (!ctx) throw new Error("no-2d");
  return ctx;
}

function toLuminance(data: Uint8ClampedArray, size: number): Uint8ClampedArray {
  const lum = new Uint8ClampedArray(size);
  for (let i = 0, j = 0; j < size; i += 4, j++) {
    lum[j] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
  }
  return lum;
}

function invertLum(lum: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(lum.length);
  for (let i = 0; i < lum.length; i++) out[i] = 255 - lum[i];
  return out;
}

function sampledVariance(lum: Uint8ClampedArray): number {
  let n = 0,
    sum = 0,
    sum2 = 0;
  for (let i = 0; i < lum.length; i += 17) {
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

type DecodeRequest = {
  id: number;
  bitmap: ImageBitmap;
  extra?: boolean;
};

function decodeBitmap(bitmap: ImageBitmap, extra: boolean): string | null {
  const width = bitmap.width | 0;
  const height = bitmap.height | 0;
  if (width < 8 || height < 8) return null;

  const c = ensureCanvas(width, height);
  c.drawImage(bitmap, 0, 0, width, height);
  const imageData = c.getImageData(0, 0, width, height);
  const lum = toLuminance(imageData.data, width * height);
  if (sampledVariance(lum) < 18) return null;

  const hints = extra ? EXTRA_HINTS : FAST_HINTS;
  const hit = decodeLum(lum, width, height, hints);
  if (hit) return hit;
  return decodeLum(invertLum(lum), width, height, hints);
}

self.onmessage = (e: MessageEvent<DecodeRequest>) => {
  const { id, bitmap, extra } = e.data;
  let text: string | null = null;
  try {
    text = decodeBitmap(bitmap, !!extra);
  } catch {
    text = null;
  } finally {
    try {
      bitmap.close();
    } catch {
      /* already transferred / closed */
    }
    (self as unknown as Worker).postMessage({ id, text });
  }
};
