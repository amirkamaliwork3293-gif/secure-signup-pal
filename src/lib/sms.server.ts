/**
 * تنها نقطه‌ی ارسال پیامک در کل پروژه (ملی‌پیامک — console.melipayamak.com).
 * هر چهار قابلیت پیامکی (خوش‌آمدگویی، کد فراموشی رمز، یادآوری انقضا، پیامک دلخواه ادمین)
 * از همین یک ماژول استفاده می‌کنند.
 *
 * server-only است: کلید API از process.env خوانده می‌شود و فقط داخل هندلرهای سرور
 * (با import پویا) بارگذاری می‌شود — چون *.functions.ts و route فایل‌ها به باندل کلاینت می‌روند.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const ENDPOINT = "https://console.melipayamak.com/api/send/advanced";

/** هر پیامک فارسی ۷۰ کاراکتر است؛ سقف را روی ۴ پیامک می‌گذاریم. */
export const SMS_MAX_LEN = 280;

/** ملی‌پیامک در هر درخواست تعداد محدودی گیرنده می‌پذیرد. */
const CHUNK = 100;

export type SmsResult = {
  ok: boolean;
  /** تعداد شماره‌های معتبری که واقعاً ارسال شد */
  sent: number;
  /** تعداد شماره‌هایی که ارسالشان شکست خورد */
  failed: number;
  error?: string;
};

/**
 * نرمال‌سازی شماره‌ی ایران به فرم 09xxxxxxxxx.
 * ورودی‌های +989…، 989…، 9…، و شماره‌های دارای فاصله/خط تیره را می‌پذیرد.
 */
export function normalizePhone(raw?: string | null): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d]/g, "");
  const m = digits.match(/(?:98|0)?(9\d{9})$/);
  return m ? `0${m[1]}` : null;
}

/** ۰۹۱۲***۴۵۶۷ برای نمایش به کاربر بدون افشای کامل شماره */
export function maskPhone(phone: string): string {
  return phone.length >= 11 ? `${phone.slice(0, 4)}***${phone.slice(-4)}` : "***";
}

/**
 * ارسال یک متن به یک یا چند شماره.
 * هرگز throw نمی‌کند — شکست پیامک نباید جریان اصلی (مثل تایید کاربر) را قطع کند.
 */
export async function sendSms(to: (string | null | undefined)[], text: string): Promise<SmsResult> {
  const apiKey = (process.env.MELIPAYAMAK_API_KEY || "").trim();
  const from = (process.env.MELIPAYAMAK_SENDER || "").trim();

  const recipients = [...new Set(to.map(normalizePhone).filter((p): p is string => !!p))];
  if (!recipients.length) return { ok: false, sent: 0, failed: 0, error: "شماره معتبری برای ارسال وجود ندارد." };

  if (!apiKey || !from) {
    console.error("[sms] MELIPAYAMAK_API_KEY / MELIPAYAMAK_SENDER تنظیم نشده است.");
    return { ok: false, sent: 0, failed: recipients.length, error: "پیکربندی پیامک روی سرور انجام نشده است." };
  }

  let sent = 0;
  let failed = 0;
  let firstError: string | undefined;

  for (let i = 0; i < recipients.length; i += CHUNK) {
    const batch = recipients.slice(i, i + CHUNK);
    // نکته: با fetch نیازی به ست کردن دستی Content-Length نیست — رانتایم خودش طول
    // را بر حسب بایت‌های UTF-8 حساب می‌کند. باگ نمونه‌کد اصلی (data.length به‌جای
    // Buffer.byteLength) فقط در نسخه‌ی مبتنی بر ماژول http نود رخ می‌داد و متن فارسی
    // را نصفه می‌فرستاد؛ اینجا اصلاً پیش نمی‌آید.
    const body = JSON.stringify({ from, to: batch, text, udh: "" });

    try {
      const res = await fetch(`${ENDPOINT}/${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body,
      });
      const raw = await res.text();
      let parsed: any;
      try { parsed = JSON.parse(raw); } catch { parsed = null; }

      // پاسخ موفق: { value: <recId غیر صفر>, status: "..." }
      const okBatch = res.ok && !!parsed?.value && String(parsed.value) !== "0";
      if (okBatch) {
        sent += batch.length;
      } else {
        failed += batch.length;
        firstError ??= parsed?.status || `HTTP ${res.status}`;
        // متن پیام لاگ نمی‌شود (ممکن است حاوی رمز/کد باشد) — فقط پاسخ سرویس و تعداد گیرنده.
        console.error("[sms] ارسال ناموفق", { status: res.status, response: raw.slice(0, 300), recipients: batch.length });
      }
    } catch (e: any) {
      failed += batch.length;
      firstError ??= e?.message || "خطای شبکه";
      console.error("[sms] خطای شبکه در ارسال", { error: e?.message, recipients: batch.length });
    }
  }

  return { ok: failed === 0 && sent > 0, sent, failed, error: firstError };
}

// ─── متن‌های آماده (کوتاه، فارسی) ─────────────────────────────────────────────

export const smsTemplates = {
  welcome: (username: string, password: string) =>
    `کاربر گرامی ${username}، خوش آمدید.\nرمز عبور شما: ${password}\nkamixapp.ir`,

  otp: (code: string) => `کد تایید شما: ${code}\nاین کد تا ۵ دقیقه معتبر است.`,

  expiry: (daysLeft: number, link: string) =>
    `اشتراک شما ${daysLeft} روز دیگر به اتمام می‌رسد. برای تمدید کلیک کنید:\n${link}`,
};

// ─── یادآوری انقضای اشتراک ────────────────────────────────────────────────────

const RENEW_LINK = "https://kamixapp.ir/renew";

/** چند روز مانده به انقضا یادآوری فرستاده شود (قابل تنظیم با SMS_REMINDER_DAYS). */
function reminderDays(): number {
  const n = Number(process.env.SMS_REMINDER_DAYS);
  return Number.isFinite(n) && n > 0 && n <= 30 ? Math.floor(n) : 3;
}

export type ReminderRun = { checked: number; sent: number; failed: number; skipped: number };

/**
 * کاربران فعالی که اشتراکشان تا N روز دیگر تمام می‌شود را پیدا می‌کند و یک پیامک
 * یادآوری می‌فرستد. برای هر دوره‌ی انقضا فقط یک بار — با ثبت end_date در
 * profiles.reminder_sent_for. بعد از تمدید، end_date عوض می‌شود و یادآوری دوره‌ی
 * بعد دوباره مجاز می‌شود.
 */
export async function runExpiryReminders(): Promise<ReminderRun> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // ستون reminder_sent_for در types.ts تولیدشده نیست (فایل خودکار است) — دسترسی بدون تایپ.
  const db = supabaseAdmin as any;
  const days = reminderDays();
  const now = new Date();
  const until = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  const { data: rows, error } = await db
    .from("profiles")
    .select("id, username, end_date, reminder_sent_for")
    .eq("status", "active")
    .not("end_date", "is", null)
    .gt("end_date", now.toISOString())
    .lte("end_date", until.toISOString());
  if (error) throw new Error(error.message);

  const candidates = (rows ?? []).filter(
    (r: any) => !r.reminder_sent_for || new Date(r.reminder_sent_for).getTime() !== new Date(r.end_date).getTime(),
  );
  const result: ReminderRun = { checked: rows?.length ?? 0, sent: 0, failed: 0, skipped: (rows?.length ?? 0) - candidates.length };
  if (!candidates.length) return result;

  const phones = await phoneMapByUsername(supabaseAdmin);

  for (const row of candidates as any[]) {
    const phone = phones[String(row.username).toLowerCase()];
    if (!phone) { result.skipped++; continue; }

    const left = Math.max(1, Math.ceil((new Date(row.end_date).getTime() - now.getTime()) / 86_400_000));
    const res = await sendSms([phone], smsTemplates.expiry(left, RENEW_LINK));
    if (res.ok) {
      result.sent++;
      await db.from("profiles").update({ reminder_sent_for: row.end_date }).eq("id", row.id);
    } else {
      result.failed++;
      // پرچم را ست نمی‌کنیم تا اجرای بعدی دوباره تلاش کند.
    }
  }

  return result;
}

/**
 * نگاشت username → phone از user_metadata کاربران Auth.
 * شماره‌ی تلفن در این پروژه فقط در auth user_metadata و signup_requests.phone هست،
 * نه در جدول profiles — پس همان الگوی adminGetUserPhones را دنبال می‌کنیم.
 */
export async function phoneMapByUsername(admin: SupabaseClient<any>): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  for (const u of data?.users ?? []) {
    const uname = (u.user_metadata?.username as string | undefined)?.toLowerCase();
    const phone = normalizePhone(u.user_metadata?.phone as string | undefined);
    if (uname && phone) map[uname] = phone;
  }
  return map;
}
