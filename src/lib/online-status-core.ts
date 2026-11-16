/**
 * منطق خالص آنلاین/آفلاین — بدون React تا در تست Node قابل اجرا باشد.
 */

export const OFFLINE_WRITE_MESSAGE = "برای این کار باید آنلاین باشید";

export class OfflineWriteError extends Error {
  constructor() {
    super(OFFLINE_WRITE_MESSAGE);
    this.name = "OfflineWriteError";
  }
}
export const OFFLINE_WRITE_BLOCKED_EVENT = "kamix-offline-write-blocked";
export const ONLINE_CONFIRMED_EVENT = "kamix-online";
/** یک درخواست واقعی به سرور داده جواب گرفت (از کلاینت سوپابیس) */
export const NETWORK_OK_EVENT = "kamix-network-ok";

export const HEALTH_CHECK_PATH = "/favicon.ico";
export const HEALTH_CHECK_PARAM = "kamix-health";
/**
 * مهلت هر تست اتصال. قبلاً ۲٫۵ ثانیه بود؛ روی اینترنت ایران رسیدن به سرور خارجی
 * گاهی بیشتر طول می‌کشد و همین برای «آفلاین» نشان دادن کل برنامه کافی بود.
 */
export const HEALTH_TIMEOUT_MS = 6000;

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

/**
 * آیا دست‌کم یکی از مقصدها جواب می‌دهد؟ هر پاسخ HTTP (حتی 403/404) یعنی شبکه هست؛
 * فقط خطای شبکه یا تمام شدن مهلت «نرسیدن» حساب می‌شود.
 * چند مقصد هم‌زمان امتحان می‌شوند (سایت برنامه و سرور داده): اگر یکی از ایران در
 * دسترس نباشد ولی دیگری باشد، دستگاه آفلاین نیست.
 */
export async function probeReachability(opts?: {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  href?: string;
  /** چند مقصد؛ اگر داده شود به‌جای href استفاده می‌شود */
  hrefs?: string[];
}): Promise<boolean> {
  const timeoutMs = opts?.timeoutMs ?? HEALTH_TIMEOUT_MS;
  const fetchImpl =
    opts?.fetchImpl ?? (typeof fetch === "function" ? fetch.bind(globalThis) : null);
  if (!fetchImpl) return false;
  const urls = opts?.hrefs?.length ? opts.hrefs : [opts?.href ?? healthCheckUrl()];
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = setTimeout(() => {
    try {
      ctrl?.abort();
    } catch {
      /* noop */
    }
  }, timeoutMs);
  try {
    return await new Promise<boolean>((resolve) => {
      let pending = urls.length;
      for (const url of urls) {
        const sameOrigin = url.startsWith("/");
        Promise.resolve()
          .then(() =>
            fetchImpl(url, {
              method: "GET",
              cache: "no-store",
              signal: ctrl?.signal,
              // مقصد دیگر (سرور داده) هدر CORS نمی‌دهد؛ پاسخ opaque هم یعنی شبکه هست
              ...(sameOrigin ? {} : { mode: "no-cors" as RequestMode, credentials: "omit" as const }),
            }),
          )
          .then(
            () => resolve(true),
            () => {
              pending -= 1;
              if (pending === 0) resolve(false);
            },
          );
      }
    });
  } finally {
    clearTimeout(timer);
    try {
      ctrl?.abort(); // بقیهٔ درخواست‌ها لازم نیستند
    } catch {
      /* noop */
    }
  }
}
