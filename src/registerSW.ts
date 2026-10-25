// ============================================================
// registerSW.ts
// مرورگر وب: سرویس‌ورکر و کش‌های قدیمی PWA پاک می‌شوند (رفتار قبلی).
// اپ Capacitor: فقط capacitor-sw.js با استراتژی Network First ثبت می‌شود.
// ============================================================

import { isNativeApp } from "@/lib/isWebView";
import { ONLINE_CONFIRMED_EVENT } from "@/lib/online-status-core";

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

function warmControlledClient(): void {
  if (typeof document === "undefined") return;
  const urls = [location.origin + "/", location.href];
  document.querySelectorAll("script[src], link[href]").forEach((el) => {
    const href = el.getAttribute("src") || el.getAttribute("href");
    if (!href) return;
    try {
      urls.push(new URL(href, location.origin).href);
    } catch {
      /* noop */
    }
  });
  navigator.serviceWorker.controller?.postMessage({
    type: "KAMIX_WARM_SHELL",
    urls: [...new Set(urls)],
  });
}

/**
 * همهٔ فایل‌های برنامه (صفحه‌هایی که هنوز باز نشده‌اند، اسکنر، PDF، فونت) را
 * برای کار بدون اینترنت در کش SW می‌گذارد. فایل‌های موجود دوباره دانلود
 * نمی‌شوند؛ پس بعد از اولین بار فقط فایل‌های عوض‌شدهٔ هر نسخه دانلود می‌شوند.
 */
const WARM_ASSETS_DELAY_MS = 2_500;
/** اگر دانلود کامل نشد (شبکهٔ ضعیف)، هر این‌قدر دوباره — فقط فایل‌های باقی‌مانده */
const WARM_RETRY_MS = 45_000;
let warmTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleWarmOfflineAssets(delay = WARM_ASSETS_DELAY_MS): void {
  if (warmTimer) return;
  warmTimer = setTimeout(() => {
    warmTimer = null;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    navigator.serviceWorker.controller?.postMessage({ type: "KAMIX_WARM_ASSETS" });
  }, delay);
}

// ─── وضعیت آمادگی آفلاین (برای نمایش به کاربر) ───────────────────────────────
export type OfflineReadiness = {
  /** فهرست فایل‌ها هنوز بررسی نشده */
  known: boolean;
  done: number;
  total: number;
  /** همهٔ فایل‌های نسخهٔ فعلی روی گوشی است */
  complete: boolean;
  /** این گوشی دست‌کم یک‌بار کامل آماده شده (هر نسخه‌ای) */
  everReady: boolean;
};

export const OFFLINE_READY_KEY = "kamix.offline.ready.v1";
export const OFFLINE_PROGRESS_EVENT = "kamix-offline-progress";

function readEverReady(): boolean {
  try {
    return Boolean(localStorage.getItem(OFFLINE_READY_KEY));
  } catch {
    return false;
  }
}

let readiness: OfflineReadiness = {
  known: false,
  done: 0,
  total: 0,
  complete: false,
  everReady: false,
};

export function getOfflineReadiness(): OfflineReadiness {
  if (!readiness.known) readiness = { ...readiness, everReady: readEverReady() };
  return readiness;
}

function onWorkerMessage(event: MessageEvent): void {
  const data = event.data as {
    type?: string;
    version?: string;
    done?: number;
    total?: number;
    complete?: boolean;
    finished?: boolean;
  } | null;
  if (!data || data.type !== "KAMIX_OFFLINE_PROGRESS") return;
  const complete = Boolean(data.complete);
  if (complete) {
    try {
      localStorage.setItem(OFFLINE_READY_KEY, data.version || String(Date.now()));
    } catch {
      /* noop */
    }
  }
  readiness = {
    known: true,
    done: Number(data.done) || 0,
    total: Number(data.total) || 0,
    complete,
    everReady: complete || readEverReady(),
  };
  window.dispatchEvent(new CustomEvent(OFFLINE_PROGRESS_EVENT, { detail: readiness }));
  if (data.finished && !complete) scheduleWarmOfflineAssets(WARM_RETRY_MS);
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
    if (navigator.serviceWorker.controller) {
      warmControlledClient();
      scheduleWarmOfflineAssets();
    } else {
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        () => {
          warmControlledClient();
        },
        { once: true },
      );
    }
    navigator.serviceWorker.addEventListener("message", onWorkerMessage);
    // SW تازه (اولین نصب یا آپدیت) کنترل را گرفت → فهرست کامل را از همان بخواه
    navigator.serviceWorker.addEventListener("controllerchange", () => scheduleWarmOfflineAssets());
    window.addEventListener(ONLINE_CONFIRMED_EVENT, () => scheduleWarmOfflineAssets(3000));
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

  if (shouldRegisterCapacitorShellWorker(isNativeApp())) {
    void registerCapacitorShellWorker();
    return;
  }
  // پاک‌سازی فقط در مرورگر واقعی. اگر صفحه از سرویس‌ورکر اپ اندروید باز شده باشد
  // (یعنی همین worker کنترلش را دارد)، هرگز پاک نکن؛ وگرنه نسخهٔ آفلاین اپ از بین می‌رود.
  const controller = typeof navigator !== "undefined" ? navigator.serviceWorker?.controller : null;
  if (controller?.scriptURL?.includes("capacitor-sw.js")) {
    void registerCapacitorShellWorker();
    return;
  }
  void disableLegacyWorkersAndCaches();
}

/** سازگاری با نام قبلی — در وب همان پاک‌سازی است. */
export function disableServiceWorker(): void {
  initServiceWorker();
}
