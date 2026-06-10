// ============================================================
// registerSW.ts — با محافظ برای محیط پیش‌نمایش لاوابل
// ============================================================

function isPreviewOrDev(): boolean {
  if (typeof window === "undefined") return true;
  // فقط در build production ثبت شود
  if (!import.meta.env.PROD) return true;
  // داخل iframe پیش‌نمایش ثبت نشود
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
  if (new URL(window.location.href).searchParams.get("sw") === "off") {
    return true;
  }
  return false;
}

async function unregisterAppSW(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      regs
        .filter((r) => {
          const url = r.active?.scriptURL || r.installing?.scriptURL || r.waiting?.scriptURL || "";
          return url.endsWith("/sw.js");
        })
        .map((r) => r.unregister())
    );
  } catch {
    /* noop */
  }
}

export function registerServiceWorker(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

  if (isPreviewOrDev()) {
    // در محیط پیش‌نمایش/توسعه ثبت نکن و SW قبلی را پاک کن
    void unregisterAppSW();
    return;
  }

  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
      });
      setInterval(() => registration.update(), 60 * 60 * 1000);
      console.log("[SW] ثبت شد:", registration.scope);
    } catch (error) {
      console.warn("[SW] ثبت ناموفق:", error);
    }
  });
}
