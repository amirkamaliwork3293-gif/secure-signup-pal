/**
 * منطق خالص آنلاین/آفلاین — بدون React تا در تست Node قابل اجرا باشد.
 */

export const OFFLINE_WRITE_MESSAGE = "برای این کار باید آنلاین باشید";
export const OFFLINE_WRITE_BLOCKED_EVENT = "kamix-offline-write-blocked";
export const ONLINE_CONFIRMED_EVENT = "kamix-online";

export const HEALTH_CHECK_PATH = "/favicon.ico";
export const HEALTH_CHECK_PARAM = "kamix-health";
export const HEALTH_TIMEOUT_MS = 2500;

export type OnlineKind = "online" | "offline" | "checking";

export function decideOnlineKind(input: {
  navigatorOnLine: boolean | undefined;
  probeOk: boolean | null;
}): OnlineKind {
  if (input.navigatorOnLine === false) return "offline";
  if (input.probeOk === false) return "offline";
  if (input.probeOk === true) return "online";
  return "checking";
}

export function shouldBlockCapacitorWrites(input: {
  isCapacitor: boolean;
  kind: OnlineKind;
}): boolean {
  return input.isCapacitor && input.kind === "offline";
}

export function healthCheckUrl(origin = ""): string {
  const path = `${HEALTH_CHECK_PATH}?${HEALTH_CHECK_PARAM}=1`;
  return origin ? `${origin}${path}` : path;
}

export async function probeReachability(opts?: {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  href?: string;
}): Promise<boolean> {
  const timeoutMs = opts?.timeoutMs ?? HEALTH_TIMEOUT_MS;
  const fetchImpl = opts?.fetchImpl ?? (typeof fetch === "function" ? fetch.bind(globalThis) : null);
  if (!fetchImpl) return false;
  const url = opts?.href ?? healthCheckUrl();
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = setTimeout(() => {
    try {
      ctrl?.abort();
    } catch {
      /* noop */
    }
  }, timeoutMs);
  try {
    await fetchImpl(url, { method: "GET", cache: "no-store", signal: ctrl?.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
