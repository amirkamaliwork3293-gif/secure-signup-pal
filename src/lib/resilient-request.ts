/**
 * ارسال مقاوم در برابر قطعی لحظه‌ای اینترنت — برای فرم‌های ثبت‌نام و تمدید.
 *
 * اینترنت موبایل گاهی چند ثانیه قطع/کند می‌شود و fetch با «Failed to fetch» یا
 * timeout شکست می‌خورد؛ کاربر پیام «ارتباط با سرور برقرار نشد» می‌گرفت و باید
 * همه‌چیز را از نو می‌فرستاد. اینجا فقط خطاهای **شبکه‌ای** چند بار با فاصله
 * دوباره امتحان می‌شوند. خطاهای واقعی سرور (مثلاً «یوزرنیم تکراری») هرگز تکرار
 * نمی‌شوند. سمت سرور، ارسال دوباره‌ی همان ثبت‌نام بی‌خطر است (idempotent).
 */

function errorText(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message?: unknown }).message ?? "");
  }
  return String(e ?? "");
}

const NETWORK_RE =
  /failed to fetch|networkerror|network error|network request failed|load failed|fetch failed|err_network|err_internet|err_connection|timeout|timed out|aborted|econnreset|socket hang up|bad gateway|service unavailable|gateway time|\b50[234]\b|unexpected token|is not valid json|unexpected end of json/i;

/** آیا خطا از قطعی/کندی شبکه یا در دسترس نبودن موقت سرور است؟ */
export function isTransientNetworkError(e: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return NETWORK_RE.test(errorText(e));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * اجرای fn؛ اگر خطای شبکه‌ای بود، تا `delays.length` بار دیگر با فاصله تلاش می‌کند.
 * اگر مرورگر آفلاین است، قبل از تلاش بعدی کمی بیشتر صبر می‌کند تا اتصال برگردد.
 */
export async function withNetworkRetry<T>(
  fn: () => Promise<T>,
  delays: number[] = [1200, 2500, 4000],
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt === delays.length || !isTransientNetworkError(e)) throw e;
      await sleep(delays[attempt]!);
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        await waitForOnline(8000);
      }
    }
  }
  throw lastErr;
}

function waitForOnline(maxMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve();
    const done = () => {
      window.removeEventListener("online", done);
      clearTimeout(t);
      resolve();
    };
    const t = setTimeout(done, maxMs);
    window.addEventListener("online", done);
  });
}

/** فایل → base64 خالص (بدون پیشوند data:) */
export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result ?? "");
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    reader.onerror = () => reject(reader.error ?? new Error("خواندن فایل رسید ممکن نشد."));
    reader.readAsDataURL(file);
  });
}

/**
 * آپلود رسید: اول مسیر مستقیم (سریع‌تر، از دامنه‌ی استوریج)، و اگر به هر دلیلی
 * شکست خورد، از طریق سرور خود سایت. فقط اگر هر دو مسیر شکست بخورند خطا می‌دهد.
 */
export async function uploadReceiptResilient(opts: {
  direct: () => Promise<string>;
  viaServer: () => Promise<string>;
}): Promise<string> {
  try {
    return await opts.direct();
  } catch (directErr) {
    console.warn("[receipt] direct upload failed, using server fallback", directErr);
    return await withNetworkRetry(opts.viaServer);
  }
}

/** پیام نهایی خطا برای کاربر — فقط وقتی همه‌ی تلاش‌ها تمام شده است. */
export function friendlySubmitError(e: unknown, fallback: string): string {
  if (isTransientNetworkError(e)) {
    return "اینترنت شما ناپایدار است و درخواست به سرور نرسید. اطلاعات فرم حفظ شده است؛ چند لحظه بعد فقط دوباره روی دکمه بزنید.";
  }
  return errorText(e) || fallback;
}
