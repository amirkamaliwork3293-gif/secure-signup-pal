/**
 * تشخیص خطای «زیرساخت محدودیت نرخ هنوز ساخته نشده».
 *
 * جدا از فایل .server.ts تا بدون وابستگی به Cloudflare/TanStack در تست Node
 * قابل اجرا باشد.
 *
 * PostgREST وقتی RPC در schema cache نباشد کد PGRST202 می‌دهد؛ Postgres هم
 * 42883 (undefined_function). هر دو یعنی مهاجرت هنوز اعمال نشده — نه اینکه
 * درخواست‌کننده از سهمیه رد شده باشد.
 */
export function isRateLimitInfraMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };
  const code = String(e.code ?? "");
  if (code === "PGRST202" || code === "42883" || code === "42P01") return true;
  const blob = `${e.message ?? ""} ${e.details ?? ""} ${e.hint ?? ""}`.toLowerCase();
  return (
    blob.includes("schema cache") ||
    blob.includes("could not find the function") ||
    blob.includes("does not exist") ||
    blob.includes("check_rate_limit") ||
    blob.includes("is_locked_out") ||
    blob.includes("rate_limits")
  );
}

export const SIGNUP_RATE_MESSAGE =
  "در این ساعت تعداد ثبت‌نام از این شبکه به سقف رسیده است. حدود یک ساعت دیگر دوباره تلاش کنید.";

export const GENERIC_RATE_MESSAGE =
  "تعداد درخواست‌ها بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.";
