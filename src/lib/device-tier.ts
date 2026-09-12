/**
 * طبقهٔ سخت‌افزار برای اسکنر — بدون بنچمارک مسدودکننده.
 *
 * navigator.deviceMemory در کروم به توان ۲ رُندِ پایین می‌شود:
 * گوشی ۳ گیگابایت مقدار ۲ و گوشی ۶ گیگابایت مقدار ۴ گزارش می‌کند.
 * الگوریتم dc14f20 (`mem <= 2` → low، `mem <= 4` → mid) گوشی‌های معمولی
 * بازار را اشتباه «ضعیف» می‌کرد و رزولوشن را تا ۴۱۶×۳۱۲ / ۴۸۰p پایین
 * می‌آورد — کندی حس‌شده بعد از آن commit از همین‌جا بود.
 */

export type DeviceTier = "low" | "mid" | "high";

export type DeviceSignals = {
  deviceMemory?: number;
  hardwareConcurrency?: number;
};

export function classifyDeviceTier(signals: DeviceSignals): DeviceTier {
  const mem = Number(signals.deviceMemory || 0);
  const cores = signals.hardwareConcurrency ?? 2;

  if (cores <= 2) return "low";
  if (mem > 0 && mem <= 1) return "low";
  // ۲ یعنی حدود ۲–۳.۹ گیگ. چهار هسته یا کمتر → واقعاً ضعیف؛ هشت‌هسته‌ایِ ۳ گیگ → mid.
  if (mem === 2 && cores < 6) return "low";

  // ۴ یعنی حدود ۴–۷.۹ گیگ — رایج‌ترین گزارش اندروید. هشت هسته = high.
  if (cores >= 8 && (mem === 0 || mem >= 4)) return "high";
  if (cores >= 6 && mem >= 8) return "high";
  if (cores >= 4) return "mid";
  return "low";
}

export function detectDeviceTier(): DeviceTier {
  if (typeof navigator === "undefined") return "mid";
  const nav = navigator as Navigator & { deviceMemory?: number };
  return classifyDeviceTier({
    deviceMemory: nav.deviceMemory,
    hardwareConcurrency: nav.hardwareConcurrency,
  });
}

/**
 * سقف پیکسل دیکود (عرض × ارتفاع) — نسبت کادر اسکن جداگانه حفظ می‌شود.
 * ارتفاع کم برای بارکد ۱بعدی کافی است؛ عرض بالا میله‌های باریک را نگه می‌دارد.
 */
export function decodeBudget(tier: DeviceTier): { maxW: number; maxH: number } {
  if (tier === "low") return { maxW: 512, maxH: 240 };
  if (tier === "mid") return { maxW: 720, maxH: 320 };
  return { maxW: 960, maxH: 400 };
}

/** سازگاری با کد قبلی؛ دیگر کانواس را به ۴:۳ نکش. */
export function decodeCanvasSize(tier: DeviceTier): { dw: number; dh: number } {
  const { maxW, maxH } = decodeBudget(tier);
  return { dw: maxW, dh: maxH };
}
