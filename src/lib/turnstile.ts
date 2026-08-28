/**
 * منطق مشترک Turnstile که هم در مرورگر و هم در تست‌ها قابل استفاده است.
 * کلید محرمانه اینجا نیست — فقط در turnstile.server.ts خوانده می‌شود.
 */

export const TURNSTILE_SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export const TURNSTILE_REQUIRED_ERROR = "لطفاً کادر «من ربات نیستم» را تکمیل کنید.";
export const TURNSTILE_FAILED_ERROR =
  "تأیید امنیتی ناموفق بود. صفحه را تازه کنید و دوباره تلاش کنید.";
export const TURNSTILE_UNAVAILABLE_ERROR =
  "بررسی امنیتی الان در دسترس نیست. کمی بعد دوباره تلاش کنید.";

const MAX_TOKEN = 2048;

export function normalizeTurnstileToken(raw: unknown): string {
  return String(raw ?? "").trim().slice(0, MAX_TOKEN);
}

/** دامنه‌هایی که ویجت Turnstile روی آن‌ها مجاز است. */
export function isTurnstileHostnameAllowed(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  if (!h) return true;
  if (h === "localhost" || h === "127.0.0.1") return true;
  if (h === "kamixapp.ir" || h === "www.kamixapp.ir") return true;
  if (h.endsWith(".vercel.app")) return true;
  if (h.endsWith(".lovable.app") || h.endsWith(".lovable.dev")) return true;
  return false;
}

/** کلید عمومی ویجت — اگر در بیلد Vite باشد؛ در غیر این صورت از سرور می‌آید. */
export function clientTurnstileSiteKey(): string {
  try {
    const value = import.meta.env.VITE_TURNSTILE_SITE_KEY;
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}
