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

/**
 * IP واقعی درخواست‌کننده. روی Cloudflare همیشه CF-Connecting-IP معتبر است و
 * توسط خود Cloudflare نوشته می‌شود (قابل جعل توسط کلاینت نیست).
 * x-forwarded-for فقط fallback است و اولین مقدار آن گرفته می‌شود.
 */
export function clientIp(): string {
  try {
    const h = getRequest()?.headers;
    if (!h) return "unknown";
    const cf = h.get("cf-connecting-ip");
    if (cf) return cf.trim();
    const xff = h.get("x-forwarded-for");
    if (xff) return xff.split(",")[0]!.trim();
    return h.get("x-real-ip")?.trim() || "unknown";
  } catch {
    return "unknown";
  }
}

// کلاینت service-role. تایپ تولیدشده‌ی Database توابع RPC تازه (check_rate_limit
// و…) را نمی‌شناسد، به همین دلیل — مثل بقیه‌ی helperهای همین پروژه — any است.
type Admin = any;

/**
 * یک واحد از سهمیه مصرف می‌کند. اگر از حد بگذرد خطا پرتاب می‌کند.
 *
 * نکته‌ی امنیتی: اگر خود دیتابیس در دسترس نباشد، **درخواست رد می‌شود** (fail
 * closed). باز گذاشتن مسیر هنگام خطا یعنی مهاجم فقط کافی است دیتابیس را از
 * کار بیندازد تا محدودیت‌ها برداشته شوند.
 */
export async function enforceRateLimit(
  admin: Admin,
  scope: string,
  identifier: string,
  max: number,
  windowSeconds: number,
  message = "تعداد درخواست‌ها بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.",
): Promise<void> {
  const bucket = `${scope}:${identifier}`.slice(0, 200);
  const { data, error } = await admin.rpc("check_rate_limit", {
    _bucket: bucket,
    _max: max,
    _window_seconds: windowSeconds,
  });
  if (error) {
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
    console.error("[rate-limit] lockout check failed, denying request", error);
    return true; // fail closed
  }
  return data === true;
}

/** پس از موفقیت (مثلاً ورود درست) شمارنده‌ی تلاش‌های ناموفق پاک می‌شود. */
export async function clearRateLimit(admin: Admin, scope: string, identifier: string): Promise<void> {
  const bucket = `${scope}:${identifier}`.slice(0, 200);
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
