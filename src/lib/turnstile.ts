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
export const TURNSTILE_WIDGET_BLOCKED_ERROR =
  "کادر امنیتی کلادفلر روی این اینترنت یا مرورگر باز نشد. صفحه را در کروم یا فایرفاکس باز کنید (نه داخل تلگرام/اینستاگرام)، مسدودکنندهٔ تبلیغات را خاموش کنید، یا فیلترشکن را روشن کنید و دوباره تلاش کنید.";

export const TURNSTILE_LOAD_TIMEOUT_MS = 12_000;

export type TurnstileWidgetStatus = "loading" | "ready" | "blocked";

/** پیام مناسب وقتی توکن نیست — اگر کادر اصلاً نیامده، «تیک بزنید» گمراه‌کننده است. */
export function turnstileMissingTokenError(status: TurnstileWidgetStatus | undefined): string {
  if (status === "blocked") return TURNSTILE_WIDGET_BLOCKED_ERROR;
  if (status === "loading") return "کادر امنیتی هنوز آماده نشده. چند ثانیه صبر کنید و دوباره بزنید.";
  return TURNSTILE_REQUIRED_ERROR;
}

/** مرورگر داخل اپ دیگر معمولاً iframe کلادفلر را نشان نمی‌دهد. */
export function isRestrictedBrowserForTurnstile(userAgent: string): boolean {
  return /Instagram|FBAN|FBAV|FB_IAB|Line\/|WhatsApp|Telegram|Twitter|LinkedInApp|Snapchat|MicroMessenger|Bytedance|TikTok|Pinterest|;\s*wv\)/i.test(
    userAgent,
  );
}

export function turnstileScriptTimedOut(
  startedAtMs: number,
  nowMs: number,
  widgetReady: boolean,
  timeoutMs = TURNSTILE_LOAD_TIMEOUT_MS,
): boolean {
  return !widgetReady && nowMs - startedAtMs >= timeoutMs;
}

const MAX_TOKEN = 2048;

export function normalizeTurnstileToken(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .slice(0, MAX_TOKEN);
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
