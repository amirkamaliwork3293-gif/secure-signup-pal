/**
 * lens.ts — انتخاب لنز عقب مناسب برای بارکد. خالص و تست‌شده.
 *
 * مشکل: روی گوشی‌های چنددوربینه `facingMode: "environment"` گاهی لنز فوق‌عریض
 * (۰.۶×، بدون فوکوس خودکار) یا تله را باز می‌کند. تصویر زنده است، بارکد هم دیده
 * می‌شود، ولی ریز و تار است و هرگز خوانده نمی‌شود.
 *
 * قواعد رتبه‌بندی بر اساس برچسب دستگاه (بعد از گرفتن مجوز در دسترس است):
 *   - دوربین جلو حذف می‌شود.
 *   - «ultra/wide-angle/0.5/0.6»، «tele»، «macro»، «depth»، «infrared» عقب می‌روند.
 *   - اندروید: «camera2 0» تقریباً همیشه دوربین اصلی عقب است؛ شمارهٔ کمتر بهتر.
 *   - iOS: «Back Camera» ساده (لنز اصلی) بهترین است.
 */

export type LensInfo = { deviceId: string; label: string };

const FRONT = /\b(front|user|selfie|facing front|face ?time)\b|جلو/i;
const BACK = /\b(back|rear|environment|world|facing back)\b|عقب/i;
const DEMOTE: Array<[RegExp, number]> = [
  [/ultra|wide[- ]?angle|\b0[.,][56]x?\b|超广角/i, 60],
  [/tele|zoom|\b[2-9]x\b/i, 50],
  [/macro/i, 70],
  [/depth|tof|infrared|\bir\b|mono/i, 90],
  [/virtual|obs|snap|manycam|droidcam/i, 30],
];

export function isFrontLens(label: string): boolean {
  return FRONT.test(label) && !BACK.test(label);
}

/** امتیاز یک لنز؛ کمتر بهتر. لنز جلو `Infinity`. */
export function lensPenalty(label: string): number {
  if (!label) return 500;
  if (isFrontLens(label)) return Number.POSITIVE_INFINITY;
  let score = BACK.test(label) ? 0 : 200;
  for (const [re, p] of DEMOTE) if (re.test(label)) score += p;
  // iOS: «Back Dual Camera»/«Back Triple Camera» دوربین مجازی‌اند؛ لنز ساده ترجیح دارد.
  if (/dual|triple/i.test(label)) score += 10;
  const camera2 = /camera2?\s*(\d+)/i.exec(label);
  if (camera2) score += Math.min(Number(camera2[1]) || 0, 20);
  return score;
}

/** لنزهای عقب به ترتیب ترجیح. لنزهای جلو حذف می‌شوند. */
export function rankRearLenses(lenses: readonly LensInfo[]): LensInfo[] {
  return lenses
    .map((l, index) => ({ l, index, score: lensPenalty(l.label) }))
    .filter((x) => Number.isFinite(x.score))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((x) => x.l);
}

/** آیا برچسب‌ها آن‌قدر اطلاعات دارند که رتبه‌بندی قابل اعتماد باشد؟ */
export function labelsAreInformative(lenses: readonly LensInfo[]): boolean {
  return lenses.length > 1 && lenses.every((l) => l.label.trim().length > 0);
}

/** زوم شروع: کمی بزرگ‌نمایی تا گوشی در فاصلهٔ فوکوس‌پذیر، بارکد کوچک را درشت ببیند. */
export function initialZoom(range: { min: number; max: number } | null): number | null {
  if (!range || !(range.max > range.min)) return null;
  // فقط وقتی دوربین زوم واقعی دارد (حداقل ۲×). وب‌کم‌ها اغلب زوم دیجیتال کم‌کیفیت دارند.
  if (range.max < 2) return null;
  return Math.min(Math.max(1.5, range.min), range.max);
}

/** پله‌های زوم پیشنهادی برای دکمه‌ها، محدود به بازهٔ دوربین. */
export function zoomSteps(range: { min: number; max: number } | null): number[] {
  if (!range || !(range.max > range.min)) return [];
  const steps = [1, 1.5, 2, 3, 5].filter((z) => z >= range.min - 1e-6 && z <= range.max + 1e-6);
  if (steps.length === 0 || Math.abs(steps[0] - range.min) > 0.05) steps.unshift(range.min);
  return Array.from(new Set(steps.map((z) => Math.round(z * 100) / 100)));
}
