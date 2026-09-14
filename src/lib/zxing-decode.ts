/**
 * zxing-decode.ts — دیکود پیکسل (مشترک بین Worker و تست).
 * بدون DOM؛ فقط آرایهٔ RGBA یا روشنایی.
 *
 * پروفایل v5 (فرضیهٔ ۲ + یافتهٔ جدید):
 *   MultiFormatReader.decode(bitmap) بدون آرگومان دوم hints را null می‌کند
 *   (`if (this.hints !== hints) setHints(undefined)` در @zxing/library@0.23).
 *   نتیجه: هر miss همهٔ فرمت‌ها (MicroQR/DataMatrix/Aztec/PDF417/MaxiCode) را
 *   امتحان می‌کرد — فریم خالیِ noisy حدود ۱۵۷ms، چهار ترکیب Binarizer×invert.
 *   decode(bitmap, hints) همان Map پایدار را نگه می‌دارد → حدود ۱۱ms برای یک
 *   GlobalHistogram روی همان فریم.
 *
 *   کلید TRY_HARDER را اصلاً نباید در Map گذاشت: setHints مقدار false را هم
 *   «موجود» می‌بیند (`undefined !== hints.get(TRY_HARDER)`) و خواننده‌های ۱بعدی
 *   را به انتهای صف می‌برد.
 *
 *   روی مسیر fast بعد از تأیید hints: GlobalHistogram سپس Hybrid (بارکد کوچک
 *   وسط کادر بزرگ با آستانهٔ سراسری غالباً از دست می‌رود؛ Hybrid بلوکی است).
 *   invert و CODE-39 روی extra می‌مانند تا فریم خالی ۴× نشود.
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

const CORE_FORMATS = [
  BarcodeFormat.QR_CODE,
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
];

export const FAST_HINTS = new Map<DecodeHintType, unknown>([
  [DecodeHintType.CHARACTER_SET, "UTF-8"],
  [DecodeHintType.POSSIBLE_FORMATS, CORE_FORMATS],
]);

export const EXTRA_HINTS = new Map<DecodeHintType, unknown>([
  [DecodeHintType.CHARACTER_SET, "UTF-8"],
  [DecodeHintType.POSSIBLE_FORMATS, [...CORE_FORMATS, BarcodeFormat.CODE_39]],
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

function decodeWith(
  lum: Uint8ClampedArray,
  width: number,
  height: number,
  hints: Map<DecodeHintType, unknown>,
  hybrid: boolean,
): string | null {
  const src = new RGBLuminanceSource(lum, width, height);
  const bin = hybrid ? new HybridBinarizer(src) : new GlobalHistogramBinarizer(src);
  try {
    // آرگومان دوم الزامی است — بدون آن 0.23 همهٔ فرمت‌ها را دوباره می‌سازد.
    return reader.decode(new BinaryBitmap(bin), hints).getText();
  } catch {
    return null;
  } finally {
    reader.reset();
  }
}

function decodeLum(
  lum: Uint8ClampedArray,
  width: number,
  height: number,
  hints: Map<DecodeHintType, unknown>,
): string | null {
  return (
    decodeWith(lum, width, height, hints, false) || decodeWith(lum, width, height, hints, true)
  );
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
  if (!extra) return null;
  return decodeLum(invertLuminance(lum), width, height, hints);
}
