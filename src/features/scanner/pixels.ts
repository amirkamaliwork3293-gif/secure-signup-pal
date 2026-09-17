/**
 * pixels.ts — تشخیص فریم مرده/سیاه. خالص، بدون DOM.
 *
 * روی بعضی سامسونگ‌ها (از جمله A55) `createImageBitmap(video)` یا حتی
 * `canvas.drawImage(video)` سایز درست برمی‌گرداند ولی پیکسل‌ها صفرند.
 * پیش‌نمایش زنده است چون Surface جداگانه کامپوزیت می‌شود. بدون این تست،
 * دیکودر برای همیشه روی فریم سیاه کار می‌کند و هیچ واکنشی دیده نمی‌شود.
 *
 * معیار «مرده» انرژی نزدیک به صفر است (سیاه/شفاف)، نه واریانس پایین —
 * دیوار سفید یا میله‌های بارکد واریانس کمی دارند ولی مرده نیستند.
 */

/** واریانس نمونه‌ای کانال روشنایی تقریب‌زده از RGBA. */
export function sampledRgbaVariance(data: Uint8ClampedArray, stepPixels = 17): number {
  const stride = Math.max(1, stepPixels | 0) * 4;
  let n = 0;
  let sum = 0;
  let sum2 = 0;
  for (let i = 0; i + 2 < data.length; i += stride) {
    const y = (data[i] * 3 + data[i + 1] * 4 + data[i + 2]) / 8;
    sum += y;
    sum2 += y * y;
    n++;
  }
  if (n < 8) return 0;
  const mean = sum / n;
  return sum2 / n - mean * mean;
}

/** سقف روشنایی برای فریم مردهٔ GPU (تقریباً سیاه). */
export const BLANK_LUMA_MAX = 12;

export function isBlankRgba(data: Uint8ClampedArray): boolean {
  if (data.length < 32) return true;
  const stride = 17 * 4;
  let n = 0;
  let max = 0;
  let sum = 0;
  for (let i = 0; i + 2 < data.length; i += stride) {
    const y = (data[i] * 3 + data[i + 1] * 4 + data[i + 2]) / 8;
    if (y > max) max = y;
    sum += y;
    n++;
  }
  if (n < 8) return true;
  return max < BLANK_LUMA_MAX && sum / n < 6;
}
