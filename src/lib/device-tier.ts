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

/** اندازهٔ کانواس دیکود — mid/high برای بارکد ریز جزئیات کافی دارند. */
export function decodeCanvasSize(tier: DeviceTier): { dw: number; dh: number } {
  if (tier === "low") return { dw: 416, dh: 312 };
  if (tier === "mid") return { dw: 640, dh: 480 };
  return { dw: 800, dh: 600 };
}
