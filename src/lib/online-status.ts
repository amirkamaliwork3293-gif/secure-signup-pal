/**
 * تشخیص آنلاین/آفلاین برای اپ Capacitor.
 * در مرورگر وب هیچ پروب شبکه‌ای اضافه نمی‌شود تا رفتار/حجم سایت عوض نشود.
 */
import { useEffect, useState } from "react";
import { isCapacitor } from "@/lib/isWebView";
import { readCloudReadAt } from "@/lib/offline-cache";
import {
  decideOnlineKind,
  shouldBlockCapacitorWrites,
  probeReachability,
  OFFLINE_WRITE_BLOCKED_EVENT,
  OFFLINE_WRITE_MESSAGE,
  ONLINE_CONFIRMED_EVENT,
  OfflineWriteError,
  type OnlineKind,
} from "@/lib/online-status-core";

export {
  decideOnlineKind,
  shouldBlockCapacitorWrites,
  probeReachability,
  healthCheckUrl,
  OFFLINE_WRITE_MESSAGE,
  OFFLINE_WRITE_BLOCKED_EVENT,
  ONLINE_CONFIRMED_EVENT,
  OfflineWriteError,
  HEALTH_CHECK_PATH,
  HEALTH_CHECK_PARAM,
  HEALTH_TIMEOUT_MS,
  type OnlineKind,
} from "@/lib/online-status-core";

export type OnlineSnapshot = {
  isOnline: boolean;
  kind: OnlineKind;
  lastSyncedAt: number | null;
  isCapacitorApp: boolean;
};

let started = false;
let kind: OnlineKind = "checking";
let probeOk: boolean | null = null;
let listenersBound = false;
/** تست‌های اتصالِ ناموفقِ پشت سر هم */
let probeFailures = 0;
let probing: Promise<void> | null = null;
let reprobeTimer: ReturnType<typeof setTimeout> | null = null;
/** با یک بار جواب ندادن (اینترنت کند) دستگاه «آفلاین» حساب نمی‌شود */
const FAILURES_BEFORE_OFFLINE = 2;
const REPROBE_MIN_MS = 2000;
const REPROBE_MAX_MS = 15000;

function currentNavigatorOnLine(): boolean | undefined {
  if (typeof navigator === "undefined") return undefined;
  return navigator.onLine;
}

function currentUserId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const scope = localStorage.getItem("kamali.auth.scope.v1");
    if (scope && scope !== "anon") return scope;
  } catch {
    /* noop */
  }
  return null;
}

function currentKind(): OnlineKind {
  return decideOnlineKind({ navigatorOnLine: currentNavigatorOnLine(), probeOk });
}

export function getOnlineKind(): OnlineKind {
  kind = currentKind();
  return kind;
}

export function isCapacitorOfflineReadOnly(): boolean {
  return shouldBlockCapacitorWrites({ isCapacitor: isCapacitor(), kind: getOnlineKind() });
}

export function requireOnlineWrite(): boolean {
  if (!isCapacitorOfflineReadOnly()) return true;
  notifyOfflineWriteBlocked();
  return false;
}

export function notifyOfflineWriteBlocked(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OFFLINE_WRITE_BLOCKED_EVENT));
  // شاید اینترنت برگشته و هنوز خبر نداریم: همین حالا دوباره بررسی کن
  void runProbe();
}

/** قبل از هر نوشتن مستقیم به سرور (منو، پروفایل فروشگاه، آپلود). */
export function assertOnlineServerWrite(): void {
  if (!isCapacitorOfflineReadOnly()) return;
  notifyOfflineWriteBlocked();
  throw new OfflineWriteError();
}

function publish(): void {
  kind = currentKind();
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("kamix-online-status", { detail: snapshot() }));
}

function snapshot(): OnlineSnapshot {
  const k = getOnlineKind();
  const uid = currentUserId();
  return {
    isOnline: k !== "offline",
    kind: k,
    lastSyncedAt: uid ? readCloudReadAt(uid) : null,
    isCapacitorApp: isCapacitor(),
  };
}

/**
 * قبلاً اتصال فقط یک بار هنگام باز شدن برنامه (با مهلت ۲٫۵ ثانیه) و بعد فقط با رویداد
 * online مرورگر بررسی می‌شد. روی اینترنت کند همان یک بررسی ناموفق می‌شد و برنامه تا
 * بسته شدن «آفلاین» می‌ماند: نه داده‌ای از سرور می‌گرفت، نه چیزی می‌فرستاد، در حالی که
 * اینترنت وصل بود — «اطلاعاتی که با سیستم ثبت کردم روی گوشی نیامد».
 * حالا: یک بار جواب ندادن کافی نیست، و تا وقتی وضعیت «آنلاین» تأیید نشده بررسی با
 * فاصلهٔ کوتاه تکرار می‌شود (و با برگشتن به برنامه هم دوباره انجام می‌شود).
 */
function scheduleReprobe(): void {
  if (reprobeTimer || typeof window === "undefined") return;
  const delay = Math.min(REPROBE_MAX_MS, REPROBE_MIN_MS * 2 ** Math.max(0, probeFailures - 1));
  reprobeTimer = setTimeout(() => {
    reprobeTimer = null;
    // برنامه در پس‌زمینه است: با برگشتن کاربر (visibilitychange) بررسی می‌شود
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    void runProbe();
  }, delay);
}

function runProbe(): Promise<void> {
  if (!isCapacitor()) return Promise.resolve();
  if (probing) return probing;
  const run = probeOnce()
    .catch(() => {})
    .finally(() => {
      if (probing === run) probing = null;
    });
  probing = run;
  return run;
}

async function probeOnce(): Promise<void> {
  if (currentNavigatorOnLine() === false) {
    probeOk = false;
    probeFailures = Math.max(probeFailures, FAILURES_BEFORE_OFFLINE);
    publish();
    // بعضی WebViewها رویداد online را دیر یا اصلاً نمی‌فرستند
    scheduleReprobe();
    return;
  }
  const wasOffline = getOnlineKind() === "offline";
  const ok = await probeReachability();
  if (ok) {
    probeFailures = 0;
    probeOk = true;
    if (reprobeTimer) {
      clearTimeout(reprobeTimer);
      reprobeTimer = null;
    }
  } else {
    probeFailures += 1;
    if (probeFailures >= FAILURES_BEFORE_OFFLINE) probeOk = false;
    scheduleReprobe();
  }
  publish();
  if (ok && wasOffline && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(ONLINE_CONFIRMED_EVENT));
  }
}

function bindWriteAlert(): void {
  if (typeof window === "undefined" || listenersBound) return;
  listenersBound = true;
  window.addEventListener(OFFLINE_WRITE_BLOCKED_EVENT, () => {
    try {
      window.alert(OFFLINE_WRITE_MESSAGE);
    } catch {
      /* noop */
    }
  });
}

/** فقط در Capacitor پروب می‌زند. در وب پروب اضافه نمی‌شود. */
export function initOnlineMonitoring(): void {
  if (typeof window === "undefined" || started) return;
  started = true;
  bindWriteAlert();
  if (!isCapacitor()) {
    probeOk = currentNavigatorOnLine() === false ? false : true;
    kind = currentKind();
    return;
  }
  probeOk = currentNavigatorOnLine() === false ? false : null;
  kind = currentKind();
  publish();
  void runProbe();
  window.addEventListener("online", () => {
    void runProbe();
  });
  window.addEventListener("offline", () => {
    probeOk = false;
    probeFailures = FAILURES_BEFORE_OFFLINE;
    publish();
    scheduleReprobe();
  });
  // برگشتن به برنامه: اگر هنوز «آنلاین» تأیید نشده، همین حالا دوباره بررسی کن
  const recheck = () => {
    if (probeOk !== true) void runProbe();
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") recheck();
  });
  window.addEventListener("focus", recheck);
  window.addEventListener("pageshow", recheck);
}

export function useOnlineStatus(): OnlineSnapshot {
  const [state, setState] = useState<OnlineSnapshot>(() => {
    const navOnline = typeof navigator === "undefined" ? true : navigator.onLine;
    const native = typeof window !== "undefined" && isCapacitor();
    const k = decideOnlineKind({
      navigatorOnLine: navOnline,
      probeOk: native ? (navOnline ? null : false) : navOnline ? true : false,
    });
    return {
      isOnline: k !== "offline",
      kind: k,
      lastSyncedAt: null,
      isCapacitorApp: native,
    };
  });

  useEffect(() => {
    initOnlineMonitoring();
    const onStatus = (e: Event) => {
      const detail = (e as CustomEvent<OnlineSnapshot>).detail;
      if (detail) setState(detail);
      else setState(snapshot());
    };
    window.addEventListener("kamix-online-status", onStatus);
    if (!isCapacitor()) {
      const on = () => setState((s) => ({ ...s, isOnline: true, kind: "online" }));
      const off = () => setState((s) => ({ ...s, isOnline: false, kind: "offline" }));
      window.addEventListener("online", on);
      window.addEventListener("offline", off);
      return () => {
        window.removeEventListener("kamix-online-status", onStatus);
        window.removeEventListener("online", on);
        window.removeEventListener("offline", off);
      };
    }
    setState(snapshot());
    return () => window.removeEventListener("kamix-online-status", onStatus);
  }, []);

  return state;
}
