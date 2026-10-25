/**
 * تشخیص آنلاین/آفلاین برای اپ Capacitor.
 * در مرورگر وب هیچ پروب شبکه‌ای اضافه نمی‌شود تا رفتار/حجم سایت عوض نشود.
 */
import { useEffect, useState } from "react";
import { isNativeApp } from "@/lib/isWebView";
import { readCloudReadAt } from "@/lib/offline-cache";
import { resolveSupabaseUrl } from "@/integrations/supabase/public-config";
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
  return shouldBlockCapacitorWrites({ isCapacitor: isNativeApp(), kind: getOnlineKind() });
}

/**
 * فقط برای کارهایی که مستقیم به سرور می‌نویسند (منو، پروفایل فروشگاه، آپلود).
 * ثبت‌های محلی (فاکتور، مشتری، کالا، …) این را صدا نمی‌زنند: در آفلاین روی
 * گوشی ذخیره و بعد از وصل شدن همگام می‌شوند.
 */
export function requireOnlineWrite(): boolean {
  if (!isCapacitorOfflineReadOnly()) return true;
  notifyOfflineWriteBlocked();
  return false;
}

export function notifyOfflineWriteBlocked(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OFFLINE_WRITE_BLOCKED_EVENT));
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
    isCapacitorApp: isNativeApp(),
  };
}

/** هر کدام از سایت یا سرور داده جواب بدهد یعنی اینترنت هست. */
async function probeAny(): Promise<boolean> {
  const targets = [probeReachability()];
  const supabaseUrl = resolveSupabaseUrl();
  if (supabaseUrl) targets.push(probeReachability({ href: `${supabaseUrl}/auth/v1/health`, mode: "no-cors" }));
  return new Promise<boolean>((resolve) => {
    let pending = targets.length;
    for (const t of targets) {
      void t.then((ok) => {
        if (ok) resolve(true);
        else if (--pending === 0) resolve(false);
      });
    }
  });
}

let probing: Promise<boolean> | null = null;

async function runProbe(force = false): Promise<boolean> {
  if (!isNativeApp()) return true;
  if (currentNavigatorOnLine() === false) {
    probeOk = false;
    publish();
    return false;
  }
  if (probing) return probing;
  probing = (async () => {
    const wasOffline = getOnlineKind() !== "online";
    const ok = await probeAny();
    probeOk = ok;
    publish();
    if (ok && (wasOffline || force) && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(ONLINE_CONFIRMED_EVENT));
    }
    return ok;
  })();
  try {
    return await probing;
  } finally {
    probing = null;
  }
}

/**
 * «همین الان بررسی و ارسال کن»: اگر اینترنت باشد رویداد اتصال فرستاده می‌شود تا
 * ورود و همگام‌سازی فوراً انجام شود (حتی اگر برنامه خودش را آنلاین می‌دانست).
 */
export async function checkConnectionNow(): Promise<boolean> {
  if (!isNativeApp()) {
    const ok = currentNavigatorOnLine() !== false;
    if (ok && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(ONLINE_CONFIRMED_EVENT));
      window.dispatchEvent(new Event("online"));
    }
    return ok;
  }
  return runProbe(true);
}

/** وقتی برنامه خودش را آفلاین می‌داند، هر چند ثانیه دوباره بررسی کن (شبکهٔ کند/تازه وصل‌شده). */
const REPROBE_OFFLINE_MS = 15_000;
/** در حالت آنلاین هم گاهی بررسی شود تا قطع بی‌صدا (Wi-Fi بدون اینترنت) دیده شود. */
const REPROBE_ONLINE_MS = 120_000;

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
  if (!isNativeApp()) {
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
  let lastProbeAt = Date.now();
  window.setInterval(() => {
    const k = getOnlineKind();
    const every = k === "online" ? REPROBE_ONLINE_MS : REPROBE_OFFLINE_MS;
    if (Date.now() - lastProbeAt < every) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    lastProbeAt = Date.now();
    void runProbe();
  }, 5_000);
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      lastProbeAt = Date.now();
      void runProbe();
    });
  }
  window.addEventListener("offline", () => {
    probeOk = false;
    publish();
  });
}

export function useOnlineStatus(): OnlineSnapshot {
  const [state, setState] = useState<OnlineSnapshot>(() => {
    const navOnline = typeof navigator === "undefined" ? true : navigator.onLine;
    const native = typeof window !== "undefined" && isNativeApp();
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
    if (!isNativeApp()) {
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
