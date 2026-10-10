/**
 * prefs.ts — تنها جایی که اسکنر در حافظهٔ مرورگر می‌نویسد.
 *
 * فقط دو کلید، هر دو تنظیم دستگاه و بی‌ربط به دادهٔ کاربر/فروشگاه:
 *   kamix_scanner_lens   — شناسهٔ لنزی که روی این دستگاه واقعاً بارکد خوانده.
 *   kamix_scanner_sound  — "0" یعنی صدای بیپ خاموش (پیش‌فرض روشن).
 *
 * هر دسترسی داخل try/catch است تا حالت ناشناس یا حافظهٔ مسدود چیزی را نشکند.
 */

const LENS_KEY = "kamix_scanner_lens";
const SOUND_KEY = "kamix_scanner_sound";

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function read(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    const s = storage();
    if (!s) return;
    if (value === null) s.removeItem(key);
    else s.setItem(key, value);
  } catch {
    /* حافظه پر یا مسدود؛ بی‌اهمیت */
  }
}

export function recallLens(): string | null {
  const v = read(LENS_KEY);
  return v && v.length <= 512 ? v : null;
}

export function rememberLens(deviceId: string | null): void {
  if (deviceId && deviceId.length <= 512) write(LENS_KEY, deviceId);
}

export function forgetLens(): void {
  write(LENS_KEY, null);
}

export function soundEnabled(): boolean {
  return read(SOUND_KEY) !== "0";
}

export function setSoundEnabled(on: boolean): void {
  write(SOUND_KEY, on ? null : "0");
}
