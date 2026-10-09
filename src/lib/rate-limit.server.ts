/**
 * محدودسازی نرخ درخواست — زیرساخت مشترک همه‌ی endpointهای عمومی.
 *
 * چرا دیتابیس و نه حافظه؟ اپ روی Cloudflare Workers اجرا می‌شود؛ هر درخواست
 * ممکن است به نمونه‌ی دیگری برسد، پس شمارنده‌ی درون‌حافظه‌ای عملاً بی‌اثر است.
 * شمارش در Postgres (تابع اتمیک check_rate_limit) بین همه‌ی نمونه‌ها مشترک است.
 *
 * ⚠️ این فایل .server.ts است — هرگز در باندل کلاینت قرار نمی‌گیرد.
 */
import { getRequest } from "@tanstack/react-start/server";
import {
  GENERIC_RATE_MESSAGE,
  isRateLimitInfraMissing,
} from "@/lib/rate-limit-utils";

/**
 * IP واقعی درخواست‌کننده. روی Cloudflare همیشه CF-Connecting-IP معتبر است و
 * توسط خود Cloudflare نوشته می‌شود (قابل جعل توسط کلاینت نیست).
 * x-forwarded-for فقط fallback است و اولین مقدار آن گرفته می‌شود.
 *
 * اگر هیچ IPای در کار نباشد، به‌جای یک کلید مشترک «unknown» (که همه‌ی کاربران
 * بدون IP را در یک سطل می‌گذارد و بعد از چند ثبت‌نام کل سایت را قفل می‌کند)
 * از اثرانگشت ضعیف UA استفاده می‌شود. سقف سراسری (signup-global) همچنان
 * جلوی سیل را می‌گیرد.
 */
export function clientIp(): string {
  try {
    const h = getRequest()?.headers;
    if (!h) return "unknown";
    const cf = h.get("cf-connecting-ip");
    if (cf?.trim()) return cf.trim();
    const xff = h.get("x-forwarded-for");
    if (xff) {
      const first = xff.split(",")[0]!.trim();
      if (first && first.toLowerCase() !== "unknown") return first;
    }
    const real = h.get("x-real-ip")?.trim();
    if (real && real.toLowerCase() !== "unknown") return real;
    return `ua:${uaFingerprint(h)}`;
  } catch {
    return "unknown";
  }
}

function uaFingerprint(h: Headers): string {
  const s = `${h.get("user-agent") || ""}|${h.get("accept-language") || ""}`;
  let n = 2166136261;
  for (let i = 0; i < s.length; i++) {
    n ^= s.charCodeAt(i);
    n = Math.imul(n, 16777619);
  }
  return (n >>> 0).toString(36);
}

// کلاینت service-role. تایپ تولیدشده‌ی Database توابع RPC تازه (check_rate_limit
// و…) را نمی‌شناسد، به همین دلیل — مثل بقیه‌ی helperهای همین پروژه — any است.
type Admin = any;

type MemBucket = { count: number; windowStart: number };
const memBuckets = new Map<string, MemBucket>();
const MEM_MAX = 4000;

function memoryConsume(bucket: string, max: number, windowSeconds: number): boolean {
  const now = Date.now();
  const windowMs = Math.max(1, windowSeconds) * 1000;
  if (memBuckets.size > MEM_MAX) {
    for (const [k, v] of memBuckets) {
      if (now - v.windowStart > 24 * 60 * 60 * 1000) memBuckets.delete(k);
    }
    if (memBuckets.size > MEM_MAX) memBuckets.clear();
  }
  const cur = memBuckets.get(bucket);
  if (!cur || now - cur.windowStart >= windowMs) {
    memBuckets.set(bucket, { count: 1, windowStart: now });
    return true;
  }
  cur.count += 1;
  return cur.count <= max;
}

function memoryPeekLocked(bucket: string, max: number, windowSeconds: number): boolean {
  const cur = memBuckets.get(bucket);
  if (!cur) return false;
  if (Date.now() - cur.windowStart >= Math.max(1, windowSeconds) * 1000) return false;
  return cur.count >= max;
}

/**
 * یک واحد از سهمیه مصرف می‌کند. اگر از حد بگذرد خطا پرتاب می‌کند.
 *
 * fail-closed برای خطای واقعی دیتابیس (اتصال قطع، timeout): درخواست رد می‌شود
 * تا مهاجم با ازکار انداختن دیتابیس سقف‌ها را برندارد.
 *
 * اما اگر خود تابع/جدول هنوز مهاجرت نشده باشد (PGRST202 / 42883)، رد کردن
 * همه‌ی ثبت‌نام‌ها با پیام «تعداد درخواست بیش از حد» اشتباه است — دقیقاً
 * مشکلی که بعد از سخت‌سازی اول پیش آمد. در آن حالت به شمارنده‌ی حافظه‌ی
 * همان isolate برمی‌گردیم (بهتر از قفل کامل سایت؛ ضعیف‌تر از Postgres مشترک).
 */
export async function enforceRateLimit(
  admin: Admin,
  scope: string,
  identifier: string,
  max: number,
  windowSeconds: number,
  message = GENERIC_RATE_MESSAGE,
): Promise<void> {
  const bucket = `${scope}:${identifier}`.slice(0, 200);
  const args = { _bucket: bucket, _max: max, _window_seconds: windowSeconds };
  let { data, error } = await admin.rpc("check_rate_limit", args);
  // یک قطعی لحظه‌ای دیتابیس نباید به کاربر عادی پیام «سقف پر شده» نشان دهد —
  // یک بار دیگر تلاش می‌شود. اگر باز هم خطا بود، مثل قبل fail-closed است.
  if (error && !isRateLimitInfraMissing(error)) {
    ({ data, error } = await admin.rpc("check_rate_limit", args));
  }
  if (error) {
    if (isRateLimitInfraMissing(error)) {
      console.error("[rate-limit] RPC missing — using in-memory fallback", error);
      if (!memoryConsume(bucket, max, windowSeconds)) throw new Error(message);
      return;
    }
    console.error("[rate-limit] check failed, denying request", error);
    throw new Error(message);
  }
  if (data === false) throw new Error(message);
}

/** آیا این کلید در حال حاضر قفل است؟ (بدون مصرف سهمیه) */
export async function isLockedOut(
  admin: Admin,
  scope: string,
  identifier: string,
  max: number,
  windowSeconds: number,
): Promise<boolean> {
  const bucket = `${scope}:${identifier}`.slice(0, 200);
  const { data, error } = await admin.rpc("is_locked_out", {
    _bucket: bucket,
    _max: max,
    _window_seconds: windowSeconds,
  });
  if (error) {
    if (isRateLimitInfraMissing(error)) {
      console.error("[rate-limit] lockout RPC missing — using in-memory fallback", error);
      return memoryPeekLocked(bucket, max, windowSeconds);
    }
    console.error("[rate-limit] lockout check failed, denying", error);
    return true; // fail closed on real outage
  }
  return data === true;
}

/** پس از موفقیت (مثلاً ورود درست) شمارنده‌ی تلاش‌های ناموفق پاک می‌شود. */
export async function clearRateLimit(admin: Admin, scope: string, identifier: string): Promise<void> {
  const bucket = `${scope}:${identifier}`.slice(0, 200);
  memBuckets.delete(bucket);
  try {
    await admin.rpc("clear_rate_limit", { _bucket: bucket });
  } catch {
    /* پاک نشدن شمارنده خطر امنیتی ندارد */
  }
}

/** ثبت عملیات حساس ادمین در گزارش تغییرناپذیر. هرگز throw نمی‌کند. */
export async function auditLog(
  admin: Admin,
  entry: { actor_id: string | null; action: string; target?: string | null; detail?: Record<string, unknown> },
): Promise<void> {
  try {
    await admin.from("admin_audit_log").insert({
      actor_id: entry.actor_id,
      action: entry.action,
      target: entry.target ?? null,
      detail: entry.detail ?? {},
      ip: clientIp(),
    });
  } catch (e) {
    console.error("[audit] failed to write audit entry", e);
  }
}

/**
 * فقط کاربران با اشتراک فعال (یا ادمین) اجازه‌ی استفاده از سرویس‌های پولی
 * بیرونی (رونویسی صدا و مدل زبانی) را دارند.
 *
 * چرا لازم است؟ میان‌افزار requireSupabaseAuth فقط معتبر بودن توکن را بررسی
 * می‌کند — نه اشتراک را. یعنی یک حساب آزمایشیِ رایگان (که ساختنش هیچ هزینه‌ای
 * ندارد) می‌توانست بی‌نهایت درخواست به کلیدهای ANTHROPIC/OPENAI بزند و
 * هزینه‌ی آن روی صاحب سرویس بیفتد.
 */
export async function requireActiveSubscription(
  supabase: Admin,
  userId: string,
): Promise<void> {
  const { data, error } = await supabase.rpc("is_subscription_active", { _user_id: userId });
  if (error) {
    console.error("[guard] subscription check failed, denying", error);
    throw new Error("امکان بررسی اشتراک وجود ندارد. کمی بعد دوباره تلاش کنید.");
  }
  if (data !== true) throw new Error("این قابلیت به اشتراک فعال نیاز دارد.");
}

/**
 * مثل enforceRateLimit یک واحد از سهمیه مصرف می‌کند، ولی به‌جای پرتاب خطا
 * فقط true/false برمی‌گرداند. برای تصمیم‌های «نرم» (مثلاً فعال‌سازی خودکار)
 * که رد شدنشان نباید جریان کاربر را بشکند. هر خطایی = false (سمت امن).
 */
export async function tryConsumeRateLimit(
  admin: Admin,
  scope: string,
  identifier: string,
  max: number,
  windowSeconds: number,
): Promise<boolean> {
  try {
    await enforceRateLimit(admin, scope, identifier, max, windowSeconds);
    return true;
  } catch {
    return false;
  }
}

/**
 * آیا پرداخت این حساب هنوز توسط مدیر تایید نشده است؟
 *
 * فقط حساب‌هایی که با «فعال‌سازی خودکار» ساخته شده‌اند پرچم
 * app_metadata.payment_pending دارند (app_metadata را خود کاربر نمی‌تواند
 * تغییر دهد). برای بقیه‌ی کاربران هیچ کوئری اضافه‌ای اجرا نمی‌شود. اگر توکن
 * پرچم را دارد، وضعیت زنده از سرور خوانده می‌شود تا کاربری که همین الان تایید
 * شده، منتظر تازه شدن توکن نماند. خطا در خواندن = در انتظار (سمت امن).
 */
export async function isPaymentPending(
  admin: Admin,
  userId: string,
  claims: unknown,
): Promise<boolean> {
  const flag = (claims as { app_metadata?: { payment_pending?: unknown } } | null)?.app_metadata
    ?.payment_pending;
  if (flag !== true) return false;
  try {
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error || !data?.user) return true;
    return data.user.app_metadata?.payment_pending === true;
  } catch {
    return true;
  }
}

export const PAYMENT_PENDING_FEATURE_MESSAGE =
  "این قابلیت پس از تایید پرداخت توسط مدیر فعال می‌شود. بقیه‌ی امکانات برنامه همین حالا در دسترس شماست.";
