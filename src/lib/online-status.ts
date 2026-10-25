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

async function runProbe(): Promise<void> {
  if (!isCapacitor()) return;
  if (currentNavigatorOnLine() === false) {
    probeOk = false;
    publish();
    return;
  }
  const wasOffline = getOnlineKind() === "offline";
  const ok = await probeReachability();
  probeOk = ok;
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
    publish();
  });
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
