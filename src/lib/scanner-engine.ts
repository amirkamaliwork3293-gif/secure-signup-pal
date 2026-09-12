/**
 * scanner-engine.ts — هندسهٔ کادر اسکن و اندازهٔ دیکود (بدون DOM).
 *
 * باگ قبلی: کادر عریض بارکد روی کانواس ۴:۳ کش می‌آمد و میله‌های EAN/Code128
 * باریک می‌شدند. اندازه باید نسبت تصویر کادر را حفظ کند.
 */

export type ScanCrop = { x: number; y: number; w: number; h: number };

export function cropSourceRect(
  videoW: number,
  videoH: number,
  crop: ScanCrop,
): { sx: number; sy: number; sw: number; sh: number } {
  const vw = Math.max(1, videoW | 0);
  const vh = Math.max(1, videoH | 0);
  let sx = Math.round(vw * crop.x);
  let sy = Math.round(vh * crop.y);
  let sw = Math.round(vw * crop.w);
  let sh = Math.round(vh * crop.h);
  if (sx < 0) sx = 0;
  if (sy < 0) sy = 0;
  if (sx >= vw) sx = vw - 1;
  if (sy >= vh) sy = vh - 1;
  if (sx + sw > vw) sw = vw - sx;
  if (sy + sh > vh) sh = vh - sy;
  return { sx, sy, sw: Math.max(1, sw), sh: Math.max(1, sh) };
}

/** کوچک‌کردن بدون اعوجاج تا داخل بودجه جا شود (هرگز بزرگ‌نمایی نمی‌کند). */
export function fitDecodeSize(
  srcW: number,
  srcH: number,
  maxW: number,
  maxH: number,
): { dw: number; dh: number } {
  const w = Math.max(1, srcW);
  const h = Math.max(1, srcH);
  const scale = Math.min(1, maxW / w, maxH / h);
  return {
    dw: Math.max(1, Math.round(w * scale)),
    dh: Math.max(1, Math.round(h * scale)),
  };
}

/** واریانس نمونه‌ای — فریم کاملاً یکنواخت ارزش دیکود ندارد. */
export function sampledLuminanceVariance(lum: Uint8ClampedArray, step = 17): number {
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
