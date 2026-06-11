// ============================================================
// registerSW.ts — نسخه PWA حذف شده است.
// این ماژول فقط سرویس‌ورکرها و کش‌های قدیمی را پاک می‌کند تا
// کاربرانی که قبلاً PWA را باز کرده‌اند نسخه کهنه نبینند.
// ============================================================

let ran = false;

export function disableServiceWorker(): void {
  if (typeof window === "undefined" || ran) return;
  ran = true;

  void (async () => {
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch {
      /* noop */
    }
  })();
}
