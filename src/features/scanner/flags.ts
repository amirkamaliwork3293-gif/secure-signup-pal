/**
 * flags.ts — کلید خاموشی اسکنر و تنها جایی که رفتار غیرپیش‌فرض روشن/خاموش می‌شود.
 *
 * چرا لازم است: اسکنر روی گوشی‌های واقعیِ کاربرِ در حال فروش اجرا می‌شود. هر
 * تغییری باید بتواند **بدون انتشار نسخهٔ جدید** خاموش شود. دو راه:
 *
 *   1. `?scanner=legacy` روی همان آدرس — دقیقاً همان پایپ‌لاین قبل از تغییرات،
 *      بدون تشخیصی، بدون مسیر جدید. راه فرار فوری برای پشتیبانی تلفنی.
 *   2. ثابت‌های زیر — پیش‌فرضِ کامپایل‌شده. تغییرشان یک خط است.
 *
 * SSR: این فایل در سطح ماژول به `window` یا `localStorage` دست نمی‌زند. هر
 * خواندنی داخل تابع و پشت `typeof window` است.
 */

/** تنها کلید ذخیره‌سازی که اسکنر اجازهٔ استفاده از آن را دارد. */
export const SCANNER_STORAGE_KEY = "kamix_scanner_experimental";

/**
 * پیش‌فرض‌های کامپایل‌شده.
 *
 * - `DIAGNOSTICS`: پنل تشخیصی مخفی (۵ ضربه روی برچسب موتور). فقط خواندنی است و
 *   هیچ مسیری از دیکود را عوض نمی‌کند.
 * - `PHOTO_FALLBACK` و `RESCUE_MODE`: مرحلهٔ ۱. **هنوز هیچ‌جا مصرف نمی‌شوند**؛
 *   اینجا تعریف شده‌اند تا سطح خاموش‌کردن از همان اول کامل و ثابت باشد.
 * - `EXPERIMENTAL_TUNING`: مرحلهٔ ۲ (نردبان رزولوشن، زوم ۱×، کراپ و بودجهٔ پیکسل).
 *   پیش‌فرضش **خاموش** است و فقط با کلید ذخیره‌شدهٔ کاربر روشن می‌شود. حتی آن
 *   وقت هم اگر این ثابت `false` شود، هیچ‌وقت روشن نمی‌شود.
 */
export const SCANNER_FLAG_DEFAULTS = {
  DIAGNOSTICS: true,
  PHOTO_FALLBACK: true,
  RESCUE_MODE: true,
  EXPERIMENTAL_TUNING: true,
} as const;

export type ScannerOverride = "legacy" | null;

export type ScannerFlags = {
  /** پایپ‌لاین دقیقاً مثل قبل از سخت‌سازی. همهٔ فلگ‌های دیگر خاموش می‌شوند. */
  legacy: boolean;
  diagnostics: boolean;
  photoFallback: boolean;
  rescueMode: boolean;
  experimental: boolean;
};

export const LEGACY_SCANNER_FLAGS: ScannerFlags = {
  legacy: true,
  diagnostics: false,
  photoFallback: false,
  rescueMode: false,
  experimental: false,
};

/**
 * `?scanner=legacy` را از یک query string می‌خواند. هر مقدار دیگری (یا نبودش)
 * یعنی حالت عادی — یک پارامتر تایپی‌شده نباید چیزی را خاموش کند.
 */
export function parseScannerOverride(search: string | null | undefined): ScannerOverride {
  if (!search) return null;
  try {
    const value = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get(
      "scanner",
    );
    return value?.trim().toLowerCase() === "legacy" ? "legacy" : null;
  } catch {
    return null;
  }
}

/** ترکیب override آدرس با ترجیح ذخیره‌شدهٔ کاربر. خالص و قابل تست. */
export function resolveScannerFlags(input: {
  override: ScannerOverride;
  experimentalPreference: boolean;
}): ScannerFlags {
  if (input.override === "legacy") return { ...LEGACY_SCANNER_FLAGS };
  return {
    legacy: false,
    diagnostics: SCANNER_FLAG_DEFAULTS.DIAGNOSTICS,
    photoFallback: SCANNER_FLAG_DEFAULTS.PHOTO_FALLBACK,
    rescueMode: SCANNER_FLAG_DEFAULTS.RESCUE_MODE,
    experimental: SCANNER_FLAG_DEFAULTS.EXPERIMENTAL_TUNING && input.experimentalPreference,
  };
}

/** حداقل چیزی که از `localStorage` لازم داریم — تا تست بتواند جعلش کند. */
export type ScannerStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

function defaultStorage(): ScannerStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // حالت ناشناس/کوکی‌های مسدود: خواندن خودِ شیء هم throw می‌کند.
    return null;
  }
}

/** فقط `"1"` یعنی روشن. هر چیز دیگری، و هر خطایی، یعنی خاموش. */
export function readExperimentalPreference(storage = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(SCANNER_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** خاموش‌کردن کلید را پاک می‌کند تا چیزی از اسکنر در دستگاه کاربر نماند. */
export function writeExperimentalPreference(on: boolean, storage = defaultStorage()): void {
  if (!storage) return;
  try {
    if (on) storage.setItem(SCANNER_STORAGE_KEY, "1");
    else storage.removeItem(SCANNER_STORAGE_KEY);
  } catch {
    /* سهمیهٔ ذخیره‌سازی پر است یا ذخیره‌سازی مسدود — تنظیم فقط در همین نشست می‌ماند. */
  }
}

/** فلگ‌های مؤثر در مرورگر. روی سرور همیشه حالت عادی و بدون ترجیح ذخیره‌شده. */
export function getScannerFlags(): ScannerFlags {
  if (typeof window === "undefined") {
    return resolveScannerFlags({ override: null, experimentalPreference: false });
  }
  let search = "";
  try {
    search = window.location.search;
  } catch {
    /* بدون location (بعضی WebViewهای عجیب) — حالت عادی. */
  }
  return resolveScannerFlags({
    override: parseScannerOverride(search),
    experimentalPreference: readExperimentalPreference(),
  });
}
