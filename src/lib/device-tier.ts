/**
 * طبقهٔ سخت‌افزار برای اسکنر — بدون بنچمارک مسدودکننده.
 *
 * navigator.deviceMemory در کروم به توان ۲ رُندِ پایین می‌شود:
 * گوشی ۳ گیگابایت مقدار ۲ و گوشی ۶ گیگابایت مقدار ۴ گزارش می‌کند.
 * الگوریتم dc14f20 (`mem <= 2` → low، `mem <= 4` → mid) گوشی‌های معمولی
 * بازار را اشتباه «ضعیف» می‌کرد و رزولوشن را تا ۴۱۶×۳۱۲ / ۴۸۰p پایین
 * می‌آورد — کندی حس‌شده بعد از آن commit از همین‌جا بود.
 *
 * پروفایل v5 (فرضیهٔ ۳):
 *   `hardwareConcurrency ?? 2` وقتی سیگنال غایب بود (Safari خصوصی، Fingerprinting)
 *   هسته را ۲ فرض می‌کرد و فوراً low می‌شد. بدون mem و بدون cores باید mid باشد
 *   تا بودجهٔ دیکود بی‌جهت به ۵۱۲×۲۴۰ سقوط نکند. گوشی ۲هسته‌ایِ واقعی هنوز low است.
 */

export type DeviceTier = "low" | "mid" | "high";

export type DeviceSignals = {
  deviceMemory?: number;
  hardwareConcurrency?: number;
};

export function classifyDeviceTier(signals: DeviceSignals): DeviceTier {
  const mem = Number(signals.deviceMemory || 0);
  const hasMem = mem > 0;
  const coresRaw = signals.hardwareConcurrency;
  const hasCores = typeof coresRaw === "number" && coresRaw > 0;

  // بدون هیچ سیگنالی mid امن‌تر از low است — عرض EAN/CODE128 را خراب نمی‌کند.
  if (!hasMem && !hasCores) return "mid";

  const cores = hasCores ? coresRaw : 4;

  if (cores <= 2) return "low";
  if (hasMem && mem <= 1) return "low";
  // ۲ یعنی حدود ۲–۳.۹ گیگ. چهار هسته یا کمتر → واقعاً ضعیف؛ هشت‌هسته‌ایِ ۳ گیگ → mid.
  if (mem === 2 && cores < 6) return "low";

  // ۴ یعنی حدود ۴–۷.۹ گیگ — رایج‌ترین گزارش اندروید. هشت هسته = high.
  if (cores >= 8 && (!hasMem || mem >= 4)) return "high";
  if (cores >= 6 && mem >= 8) return "high";
  if (cores >= 4) return "mid";
  return "mid";
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
 *
 * بودجهٔ قبلی (۵۱۲/۷۲۰/۹۶۰) کل کادر ۱۲۸۰ را downsample می‌کرد و بارکد کوچک
 * داخل کادر بزرگ خوانده نمی‌شد. عرض را بالا بردیم تا ماژول EAN (~۲px حداقل)
 * surviving بماند؛ زوم مرکز در Scanner جلوی downsample سنگین را می‌گیرد.
 */
export function decodeBudget(tier: DeviceTier): { maxW: number; maxH: number } {
  if (tier === "low") return { maxW: 720, maxH: 320 };
  if (tier === "mid") return { maxW: 1024, maxH: 400 };
  return { maxW: 1280, maxH: 480 };
}

/** سازگاری با کد قبلی؛ دیگر کانواس را به ۴:۳ نکش. */
export function decodeCanvasSize(tier: DeviceTier): { dw: number; dh: number } {
  const { maxW, maxH } = decodeBudget(tier);
  return { dw: maxW, dh: maxH };
}
