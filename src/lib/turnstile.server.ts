import process from "node:process";
import { clientIp } from "@/lib/rate-limit.server";
import {
  isTurnstileHostnameAllowed,
  normalizeTurnstileToken,
  TURNSTILE_FAILED_ERROR,
  TURNSTILE_REQUIRED_ERROR,
  TURNSTILE_UNAVAILABLE_ERROR,
} from "@/lib/turnstile";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const VERIFY_TIMEOUT_MS = 6_000;

export function getTurnstileSiteKey(): string {
  return (
    (process.env.TURNSTILE_SITE_KEY || "").trim() ||
    (process.env.VITE_TURNSTILE_SITE_KEY || "").trim()
  );
}

function getTurnstileSecretKey(): string {
  return (process.env.TURNSTILE_SECRET_KEY || "").trim();
}

/** آیا تایید سمت سرور واقعاً فعال است؟ (کلید محرمانه در env هاست) */
export function isTurnstileConfigured(): boolean {
  return getTurnstileSecretKey().length > 0;
}

/**
 * اگر کلید محرمانه تنظیم نشده، بررسی را رد می‌کند تا قبل از چسباندن کلیدها
 * ثبت‌نام سایت نخوابد. به‌محض گذاشتن TURNSTILE_SECRET_KEY در Vercel،
 * هر درخواست بدون توکن معتبر رد می‌شود.
 *
 * این fail-open است؛ فراخوان‌کننده باید وقتی `isTurnstileConfigured()` غلط
 * است سقف نرخ سخت‌تری بگذارد تا سیل ثبت‌نام بدون کپچا برنگردد.
 */
export async function assertTurnstileToken(token: unknown): Promise<void> {
  const secret = getTurnstileSecretKey();
  if (!secret) return;

  const response = normalizeTurnstileToken(token);
  if (!response) throw new Error(TURNSTILE_REQUIRED_ERROR);

  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", response);
  const ip = clientIp();
  if (ip && ip !== "unknown" && !ip.startsWith("ua:")) {
    body.set("remoteip", ip);
  }

  // idempotency_key اجازه می‌دهد همان توکن یک‌بارمصرف دوباره بررسی شود؛ اگر
  // پاسخ کلادفلر در راه گم شود، تلاش دوم به‌جای «توکن تکراری» همان نتیجه‌ی
  // اول را می‌گیرد. قطعی لحظه‌ای شبکه دیگر ثبت‌نام کاربر را خراب نمی‌کند.
  body.set("idempotency_key", crypto.randomUUID());

  let json: { success?: boolean; hostname?: string } | null = null;
  for (let attempt = 0; attempt < 2 && !json; attempt++) {
    try {
      const res = await fetch(VERIFY_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
      });
      if (res.status >= 500) continue;
      json = (await res.json()) as { success?: boolean; hostname?: string };
    } catch {
      // timeout / خطای شبکه — یک بار دیگر تلاش می‌شود
    }
  }
  if (!json) throw new Error(TURNSTILE_UNAVAILABLE_ERROR);

  if (!json?.success) throw new Error(TURNSTILE_FAILED_ERROR);
  if (json.hostname && !isTurnstileHostnameAllowed(json.hostname)) {
    throw new Error(TURNSTILE_FAILED_ERROR);
  }
}
