// ============================================================
// registerSW.ts
// مرورگر وب: سرویس‌ورکر و کش‌های قدیمی PWA پاک می‌شوند (رفتار قبلی).
// اپ Capacitor: فقط capacitor-sw.js با استراتژی Network First ثبت می‌شود.
// ============================================================

import { isCapacitor } from "@/lib/isWebView";

export const CAPACITOR_SW_URL = "/capacitor-sw.js";
export const CAPACITOR_SW_CACHE_PREFIX = "kamix-capacitor-shell-";

let ran = false;

export function shouldRegisterCapacitorShellWorker(native: boolean): boolean {
  return native === true;
}

async function disableLegacyWorkersAndCaches(): Promise<void> {
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
}

function scriptUrlOf(reg: ServiceWorkerRegistration): string {
  return reg.active?.scriptURL || reg.waiting?.scriptURL || reg.installing?.scriptURL || "";
}

async function registerCapacitorShellWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      regs.filter((r) => !scriptUrlOf(r).includes("capacitor-sw.js")).map((r) => r.unregister()),
    );
  } catch {
    /* noop */
  }

  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => !k.startsWith(CAPACITOR_SW_CACHE_PREFIX)).map((k) => caches.delete(k)),
      );
    }
  } catch {
    /* noop */
  }

  try {
    const registration = await navigator.serviceWorker.register(CAPACITOR_SW_URL, {
      scope: "/",
      updateViaCache: "none",
    });
    // هر بار باز شدن اپ، نسخهٔ جدید SW را از شبکه بخواه — نه از HTTP cache
    void registration.update();
    setInterval(
      () => {
        void registration.update();
      },
      60 * 60 * 1000,
    );
  } catch {
    /* WebView قدیمی یا SW غیرفعال — اپ آنلاین همچنان کار می‌کند */
  }
}

/** نقطهٔ ورود واحد: وب = پاک‌سازی؛ Capacitor = ثبت پوستهٔ Network-First */
export function initServiceWorker(): void {
  if (typeof window === "undefined" || ran) return;
  ran = true;

  if (shouldRegisterCapacitorShellWorker(isCapacitor())) {
    void registerCapacitorShellWorker();
    return;
  }
  void disableLegacyWorkersAndCaches();
}

/** سازگاری با نام قبلی — در وب همان پاک‌سازی است. */
export function disableServiceWorker(): void {
  initServiceWorker();
}
