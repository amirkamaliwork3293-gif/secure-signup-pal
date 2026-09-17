/**
 * geometry.ts — هندسهٔ کادر اسکن و اندازهٔ دیکود. بدون DOM، قابل تست.
 *
 * دو اشتباه نسخهٔ قبل که اینجا تکرار نمی‌شود:
 *   1. کشیدن کادر عریض روی کانواس ۴:۳ — میله‌های EAN/CODE-128 باریک و ناخوانا
 *      می‌شدند. اینجا نسبت تصویرِ کادر همیشه حفظ می‌شود.
 *   2. بودجهٔ پیکسل بر اساس حدسِ «قدرت دستگاه» از `deviceMemory`. آن حدس دو بار
 *      اشتباه از کار درآمد و رزولوشن را روی گوشی‌های سالم خراب کرد. حالا بودجه
 *      ثابت است و کوچک‌کردن بیشتر را به `tryDownscale` خودِ zxing می‌سپاریم.
 */

export type ScanRect = { x: number; y: number; w: number; h: number };

/** سقف پیکسل یک فریم دیکود. zxing-cpp این اندازه را در چند میلی‌ثانیه می‌خواند. */
export const MAX_DECODE_PIXELS = 400_000;

/** کادر پیش‌فرض: عریض و کم‌ارتفاع، چون بارکد خطی افقی است. */
export const BASE_RETICLE = { w: 0.78, h: 0.46 } as const;

/** کادر مرکزی با ضریب اندازهٔ کاربر، همیشه داخل فریم. */
export function reticleRect(scale: number): ScanRect {
  const w = clamp(BASE_RETICLE.w * scale, 0.22, 0.96);
  const h = clamp(BASE_RETICLE.h * scale, 0.16, 0.86);
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

/** تبدیل کادر نسبی به مستطیل پیکسلی داخل فریم ویدیو (همیشه داخل مرز می‌ماند). */
export function cropSourceRect(
  videoW: number,
  videoH: number,
  rect: ScanRect,
): { sx: number; sy: number; sw: number; sh: number } {
  const vw = Math.max(1, Math.floor(videoW));
  const vh = Math.max(1, Math.floor(videoH));
  const sx = clamp(Math.round(vw * rect.x), 0, vw - 1);
  const sy = clamp(Math.round(vh * rect.y), 0, vh - 1);
  const sw = clamp(Math.round(vw * rect.w), 1, vw - sx);
  const sh = clamp(Math.round(vh * rect.h), 1, vh - sy);
  return { sx, sy, sw, sh };
}

/**
 * ناحیهٔ واقعی تصویر که با `object-fit: cover` روی صفحه دیده می‌شود.
 * کادر اسکن روی این ناحیه است، نه روی کل فریم خام دوربین.
 */
export function objectFitCoverVisible(
  videoW: number,
  videoH: number,
  displayW: number,
  displayH: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const vw = Math.max(1, videoW);
  const vh = Math.max(1, videoH);
  const dw = Math.max(1, displayW);
  const dh = Math.max(1, displayH);
  const videoAspect = vw / vh;
  const displayAspect = dw / dh;
  if (videoAspect > displayAspect) {
    const sw = vh * displayAspect;
    return { sx: (vw - sw) / 2, sy: 0, sw, sh: vh };
  }
  const sh = vw / displayAspect;
  return { sx: 0, sy: (vh - sh) / 2, sw: vw, sh };
}

/**
 * کادر روی صفحه را به پیکسل‌های فریم خام نگاشت می‌کند.
 * اگر اندازهٔ نمایش صفر باشد (هنوز layout نشده)، همان `cropSourceRect` است.
 */
export function coverMappedRect(
  videoW: number,
  videoH: number,
  displayW: number,
  displayH: number,
  rect: ScanRect,
): { sx: number; sy: number; sw: number; sh: number } {
  if (!(displayW > 0) || !(displayH > 0)) return cropSourceRect(videoW, videoH, rect);
  const vis = objectFitCoverVisible(videoW, videoH, displayW, displayH);
  const mapped: ScanRect = {
    x: vis.sx / Math.max(1, videoW) + rect.x * (vis.sw / Math.max(1, videoW)),
    y: vis.sy / Math.max(1, videoH) + rect.y * (vis.sh / Math.max(1, videoH)),
    w: rect.w * (vis.sw / Math.max(1, videoW)),
    h: rect.h * (vis.sh / Math.max(1, videoH)),
  };
  return cropSourceRect(videoW, videoH, mapped);
}

/** کادر کوچک‌تر هم‌مرکز — زوم دیجیتال برای بارکد ریز، بدون عوض کردن لنز. */
export function insetScanCrop(rect: ScanRect, scale: number): ScanRect {
  const s = clamp(scale, 0.3, 1);
  const w = rect.w * s;
  const h = rect.h * s;
  return {
    x: rect.x + (rect.w - w) / 2,
    y: rect.y + (rect.h - h) / 2,
    w,
    h,
  };
}

/**
 * کوچک‌کردن متناسب تا زیر سقف پیکسل جا شود. هرگز بزرگ‌نمایی نمی‌کند —
 * بزرگ‌نمایی فقط پیکسل جعلی می‌سازد و دیکود را کند می‌کند.
 */
export function fitDecodeSize(
  srcW: number,
  srcH: number,
  maxPixels = MAX_DECODE_PIXELS,
): { dw: number; dh: number } {
  const w = Math.max(1, Math.floor(srcW));
  const h = Math.max(1, Math.floor(srcH));
  const scale = Math.min(1, Math.sqrt(Math.max(1, maxPixels) / (w * h)));
  return {
    dw: Math.max(1, Math.round(w * scale)),
    dh: Math.max(1, Math.round(h * scale)),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
