/**
 * آدرس پروژهٔ سوپابیس محرمانه نیست.
 *
 * آدرس زندهٔ kamixapp.ir از هدر CSP سرور خوانده شده
 * (connect-src → https://rhyxwmeiayebfnmibuiv.supabase.co).
 * مقدار supabase/config.toml ممکن است پروژهٔ دیگری باشد؛ برای سایت از این
 * پیش‌فرض استفاده می‌شود تا نبودن VITE_SUPABASE_URL در بیلد Vite سایت را
 * نخواباند. اگر متغیر محیطی باشد، همان اولویت دارد.
 */
export const DEFAULT_SUPABASE_URL = "https://rhyxwmeiayebfnmibuiv.supabase.co";

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function fromProcess(...names: string[]): string {
  if (typeof process === "undefined" || !process.env) return "";
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function viteUrl(): string {
  try {
    const value = import.meta.env.VITE_SUPABASE_URL;
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

function vitePublishableKey(): string {
  try {
    const value =
      import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
      import.meta.env.VITE_SUPABASE_ANON_KEY;
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

export function resolveSupabaseUrl(): string {
  return trimSlash(
    viteUrl() ||
      fromProcess("VITE_SUPABASE_URL", "SUPABASE_URL") ||
      DEFAULT_SUPABASE_URL,
  );
}

export function resolveSupabasePublishableKey(): string {
  return (
    vitePublishableKey() ||
    fromProcess(
      "VITE_SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_PUBLISHABLE_KEY",
      "VITE_SUPABASE_ANON_KEY",
      "SUPABASE_ANON_KEY",
    )
  );
}
