/**
 * مسیر جایگزین برای وقتی دستگاه کاربر به supabase.co نمی‌رسد.
 *
 * اینترنت بین‌الملل ایران گاهی قطع/کند می‌شود یا دامنهٔ supabase.co در دسترس
 * نیست، در حالی که kamixapp.ir باز است. نتیجه: «Failed to fetch» هنگام ورود و
 * فاکتورهایی که به سرور نمی‌رسند.
 *
 * رفتار:
 *   ۱) همیشه اول مستقیم به supabase.co (سریع‌تر، بدون هزینهٔ سرور).
 *   ۲) اگر شبکه خطا داد یا DIRECT_TIMEOUT_MS جوابی نیامد، همان درخواست از
 *      kamixapp.ir/sb/… فرستاده می‌شود (src/server.ts آن را به سوپابیس می‌رساند).
 *   ۳) بعد از یک‌بار شکست، PROXY_STICKY_MS مستقیم امتحان نمی‌شود تا هر درخواست
 *      منتظر مهلت نماند؛ بعد دوباره مسیر مستقیم امتحان می‌شود.
 *
 * آدرس پروژه در کلاینت عوض نمی‌شود، پس کلید نشست ذخیره‌شده (sb-<ref>-auth-token)
 * هم عوض نمی‌شود و کسی از حسابش بیرون نمی‌افتد.
 */

export const SUPABASE_PROXY_PATH = "/sb";
export const PROXY_STICKY_MS = 30 * 60_000;
export const DIRECT_TIMEOUT_MS = 15_000;
export const PROXY_UNTIL_KEY = "kamix.sbProxyUntil.v1";

type FetchFn = typeof fetch;

type KeyValueStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type FallbackFetchOptions = {
  supabaseUrl: string;
  /** مثلاً https://kamixapp.ir/sb — null یعنی مسیر جایگزین نداریم (سرور/تست) */
  proxyBase: () => string | null;
  baseFetch?: FetchFn;
  storage?: KeyValueStore | null;
  now?: () => number;
  directTimeoutMs?: number;
};

function isReplayableBody(body: BodyInit | null | undefined): boolean {
  if (body == null) return true;
  if (typeof body === "string") return true;
  if (typeof Blob !== "undefined" && body instanceof Blob) return true;
  if (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer) return true;
  if (ArrayBuffer.isView(body)) return true;
  if (typeof FormData !== "undefined" && body instanceof FormData) return true;
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) return true;
  return false; // ReadableStream — یک‌بار خواندنی است
}

export function createFallbackFetch(opts: FallbackFetchOptions): FetchFn {
  const supabaseUrl = opts.supabaseUrl.replace(/\/+$/, "");
  const baseFetch: FetchFn = opts.baseFetch ?? ((...args) => fetch(...args));
  const now = opts.now ?? (() => Date.now());
  const directTimeoutMs = opts.directTimeoutMs ?? DIRECT_TIMEOUT_MS;
  let memoryUntil = 0;

  function proxyUntil(): number {
    try {
      const raw = opts.storage?.getItem(PROXY_UNTIL_KEY);
      if (raw) return Math.max(memoryUntil, Number(raw) || 0);
    } catch {
      /* حافظه در دسترس نیست */
    }
    return memoryUntil;
  }

  function useProxyForAWhile() {
    memoryUntil = now() + PROXY_STICKY_MS;
    try {
      opts.storage?.setItem(PROXY_UNTIL_KEY, String(memoryUntil));
    } catch {
      /* noop */
    }
  }

  function backToDirect() {
    memoryUntil = 0;
    try {
      opts.storage?.removeItem(PROXY_UNTIL_KEY);
    } catch {
      /* noop */
    }
  }

  async function direct(url: string, init: RequestInit | undefined): Promise<Response> {
    const ctrl = new AbortController();
    const callerSignal = init?.signal;
    const onAbort = () => ctrl.abort(callerSignal?.reason);
    if (callerSignal) {
      if (callerSignal.aborted) ctrl.abort(callerSignal.reason);
      else callerSignal.addEventListener("abort", onAbort, { once: true });
    }
    // مهلت فقط تا رسیدن سرآیند پاسخ؛ خواندن بدنه را قطع نمی‌کند.
    const timer = setTimeout(
      () => ctrl.abort(new Error("supabase-direct-timeout")),
      directTimeoutMs,
    );
    try {
      return await baseFetch(url, { ...init, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onAbort);
    }
  }

  return async (input, init) => {
    // supabase-js همیشه رشتهٔ آدرس می‌فرستد؛ Request را دست نمی‌زنیم.
    if (typeof input !== "string" && !(input instanceof URL)) return baseFetch(input, init);
    const url = typeof input === "string" ? input : input.href;
    const proxyBase = opts.proxyBase();
    if (!proxyBase || !url.startsWith(supabaseUrl + "/") || !isReplayableBody(init?.body)) {
      return baseFetch(input, init);
    }
    const viaProxy = proxyBase.replace(/\/+$/, "") + url.slice(supabaseUrl.length);

    if (proxyUntil() > now()) {
      try {
        return await baseFetch(viaProxy, init);
      } catch (proxyError) {
        if (init?.signal?.aborted) throw proxyError;
        // شاید خود سایت در دسترس نیست ولی سوپابیس هست
        const res = await baseFetch(url, init).catch(() => {
          throw proxyError;
        });
        backToDirect();
        return res;
      }
    }

    try {
      return await direct(url, init);
    } catch (directError) {
      if (init?.signal?.aborted) throw directError;
      try {
        const res = await baseFetch(viaProxy, init);
        useProxyForAWhile();
        return res;
      } catch {
        throw directError; // واقعاً آفلاین — همان خطای اصلی
      }
    }
  };
}

/** مسیر جایگزین فقط در مرورگر/اپ و روی سایت خودمان (https یا localhost). */
export function browserProxyBase(): string | null {
  if (typeof window === "undefined" || !window.location) return null;
  const { protocol, origin } = window.location;
  if (protocol !== "https:" && protocol !== "http:") return null;
  return origin + SUPABASE_PROXY_PATH;
}

export function browserStorage(): KeyValueStore | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}
