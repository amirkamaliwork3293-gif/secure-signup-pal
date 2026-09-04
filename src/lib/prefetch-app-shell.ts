/**
 * گرم‌کردن پوستهٔ اپ Capacitor وقتی آنلاین است:
 * اسکریپت/استایل همین صفحه + قطعه‌های lazy خانه/ورود.
 * مسیرهای SSR جداگانه fetch نمی‌شوند (حجم سایت وب نباید بالا برود).
 */
import { isCapacitor } from "@/lib/isWebView";

let warmed = false;

function sameOriginAssetUrls(): string[] {
  if (typeof document === "undefined") return [];
  const origin = location.origin;
  const urls = new Set<string>([
    origin + "/",
    origin + "/capacitor-sw.js",
    origin + "/favicon.ico",
  ]);
  document.querySelectorAll("script[src], link[href]").forEach((el) => {
    const href = el.getAttribute("src") || el.getAttribute("href");
    if (!href) return;
    try {
      const u = new URL(href, origin);
      if (u.origin === origin) urls.add(u.href);
    } catch {
      /* noop */
    }
  });
  return [...urls];
}

export function warmCapacitorAppShell(): void {
  if (typeof window === "undefined" || warmed) return;
  if (!isCapacitor()) return;
  warmed = true;

  void import("@/components/InvoiceWorkspace").catch(() => {});
  void import("@/routes/login").catch(() => {});

  if (typeof navigator !== "undefined" && navigator.onLine === false) return;

  for (const url of sameOriginAssetUrls()) {
    void fetch(url, { credentials: "same-origin" }).catch(() => {});
  }
}
