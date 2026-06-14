// ============================================================
// registerSW.ts — ثبت سرویس‌ورکر PWA برای حالت آفلاین
// با گاردهای کامل برای جلوگیری از ثبت در preview/dev/iframe لاو‌ابل.
// ============================================================

const SW_URL = "/sw.js";
let ran = false;

function isRefusedContext(): boolean {
  if (typeof window === "undefined") return true;
  // فقط در حالت production فعال شود
  if (!import.meta.env.PROD) return true;
  // اگر داخل iframe است (preview لاو‌ابل)
  try {
    if (window.self !== window.top) return true;
  } catch {
    return true;
  }
  const host = window.location.hostname;
  if (
    host.startsWith("id-preview--") ||
    host.startsWith("preview--") ||
    host === "lovableproject.com" ||
    host.endsWith(".lovableproject.com") ||
    host === "lovableproject-dev.com" ||
    host.endsWith(".lovableproject-dev.com") ||
    host === "beta.lovable.dev" ||
    host.endsWith(".beta.lovable.dev")
  ) {
    return true;
  }
  // کلید سوییچ خاموش‌سازی: ?sw=off
  if (new URLSearchParams(window.location.search).get("sw") === "off") return true;
  return false;
}

async function unregisterMatching(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const r of regs) {
      const url = r.active?.scriptURL || r.installing?.scriptURL || r.waiting?.scriptURL || "";
      if (url.endsWith(SW_URL)) {
        await r.unregister();
      }
    }
  } catch {
    /* noop */
  }
}

export function registerServiceWorker(): void {
  if (typeof window === "undefined" || ran) return;
  ran = true;

  if (isRefusedContext()) {
    // در preview/dev/iframe: ثبت‌های قبلی همین SW را پاک کن
    void unregisterMatching();
    return;
  }

  if (!("serviceWorker" in navigator)) return;

  // ثبت بعد از load برای جلوگیری از تأخیر در رندر اولیه
  const start = () => {
    navigator.serviceWorker.register(SW_URL, { scope: "/" }).catch(() => {
      /* noop */
    });
  };
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
}

// نام قبلی برای سازگاری با کد فعلی
export const disableServiceWorker = registerServiceWorker;
