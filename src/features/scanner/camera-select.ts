/**
 * camera-select.ts — رتبه‌بندی لنز عقب. خالص و قابل تست.
 *
 * علت وجود این فایل: `facingMode: "environment"` روی گوشی‌های چنددوربینه
 * (سامسونگ، شیائومی) اغلب به لنز ultra-wide یا macro/depth بسته می‌شود که در
 * فاصلهٔ بارکد فوکوس نمی‌کند. پیش‌نمایش سالم است ولی هیچ‌وقت چیزی خوانده نمی‌شود.
 * نسخهٔ قبل «آخرین videoinput» را حدس می‌زد.
 *
 * خروجی یک فهرست مرتب است، نه یک انتخاب قطعی: لایهٔ دوربین کاندیدای اول را باز
 * می‌کند و اگر فریم نیامد خودکار به بعدی می‌رود.
 */

export type VideoDeviceInfo = { deviceId: string; label: string; kind: string };

const REAR = /\b(back|rear|environment|world)\b|facing back|پشت|خلفی|عقب/i;
const FRONT = /\b(front|user|selfie|face)\b|facing front|جلو|سلفی/i;
/** لنزهایی که در فاصلهٔ بارکد بی‌فایده‌اند یا اصلاً تصویر معمولی نمی‌دهند. */
const UNUSABLE = /depth|mono(chrome)?|bokeh|infrared|\bir\b|tof/i;
const ULTRA_WIDE = /ultra|0\.5|wide angle|wide-angle/i;
const TELEPHOTO = /tele(photo)?|zoom|[2-9](\.\d)?x/i;
const MACRO = /macro/i;

function scoreLabel(label: string, index: number): number {
  const l = label || "";
  let score = 0;

  if (FRONT.test(l)) score -= 100;
  else if (REAR.test(l)) score += 100;

  if (UNUSABLE.test(l)) score -= 80;
  if (ULTRA_WIDE.test(l)) score -= 40;
  if (MACRO.test(l)) score -= 35;
  if (TELEPHOTO.test(l)) score -= 30;

  // اندروید دوربین‌ها را «camera2 <index>, facing back» نام‌گذاری می‌کند و
  // index صفر تقریباً همیشه سنسور اصلی عقب است.
  const camera2 = l.match(/camera2\s+(\d+)/i);
  if (camera2) score += Math.max(0, 10 - Number(camera2[1]) * 4);

  // تساوی امتیاز → ترتیب شمارش دستگاه حفظ شود (اندروید: ایندکس ۰ = عقبِ اصلی).
  return score - index * 0.01;
}

/** deviceId دوربین‌های ویدیویی، از محتمل‌ترین لنز عقبِ اصلی به کم‌محتمل‌ترین. */
export function rankRearCameras(devices: readonly VideoDeviceInfo[]): string[] {
  return devices
    .filter((d) => d.kind === "videoinput" && d.deviceId)
    .map((d, index) => ({ id: d.deviceId, score: scoreLabel(d.label, index) }))
    .sort((a, b) => b.score - a.score)
    .map((d) => d.id);
}

/** آیا این تراک به‌احتمال زیاد دوربین جلو است؟ (facingMode مقدم بر لیبل) */
export function looksLikeFrontCamera(facingMode: string | undefined, label: string): boolean {
  if (facingMode === "user") return true;
  if (facingMode === "environment") return false;
  return FRONT.test(label || "");
}
