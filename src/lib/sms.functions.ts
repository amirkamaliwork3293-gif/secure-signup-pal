/**
 * Server functions مربوط به پیامک:
 *  - فراموشی رمز با کد ۴ رقمی (درخواست کد / تایید کد / تنظیم رمز جدید)
 *  - ارسال پیامک دلخواه توسط ادمین
 *  - اجرای دستی یادآوری انقضا از پنل ادمین
 *
 * توجه: این فایل به باندل کلاینت می‌رود، پس supabaseAdmin و ماژول sms.server
 * فقط با import پویا داخل هندلرها بارگذاری می‌شوند.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 3;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const RESET_TOKEN_TTL_MS = 10 * 60 * 1000;

async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomDigits(n: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return [...bytes].map((b) => (b % 10).toString()).join("");
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// کد هرگز خام ذخیره/لاگ نمی‌شود؛ فقط هش آن با نمک یوزرنیم.
// ponytail: هش ساده‌ی SHA-256 روی فضای ۱۰هزارتایی ۴ رقم ضعیف است اگر مهاجم به DB
// دسترسی داشته باشد — دفاع اصلی محدودیت ۳ تلاش و انقضای ۵ دقیقه‌ای است.
// اگر روزی نیاز شد، به bcrypt/HMAC با کلید سرور ارتقا دهید.
const hashCode = (username: string, code: string) => sha256(`${username}:${code}`);

/**
 * جدول password_reset_otps در types.ts تولیدشده وجود ندارد (آن فایل خودکار است و
 * دستی ویرایش نمی‌شود) — پس دسترسی به آن بدون تایپ انجام می‌گیرد.
 */
const otpTable = (admin: unknown) => (admin as any).from("password_reset_otps");

// ─── مرحله ۱: درخواست کد ─────────────────────────────────────────────────────
export const requestPasswordOtp = createServerFn({ method: "POST" })
  .inputValidator((d: { username: string }) => {
    if (!d?.username?.trim()) throw new Error("یوزرنیم را وارد کنید.");
    return { username: d.username.trim().toLowerCase() };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendSms, smsTemplates, maskPhone, phoneMapByUsername } = await import("@/lib/sms.server");

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, username")
      .eq("username", data.username)
      .maybeSingle();
    if (!profile) throw new Error("کاربری با این یوزرنیم یافت نشد.");

    const phone = (await phoneMapByUsername(supabaseAdmin))[data.username];
    if (!phone) throw new Error("برای این حساب شماره موبایلی ثبت نشده است. لطفاً با پشتیبانی تماس بگیرید.");

    // جلوگیری از ارسال پشت‌سرهم
    const { data: last } = await otpTable(supabaseAdmin)
      .select("created_at")
      .eq("username", data.username)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (last && Date.now() - new Date((last as any).created_at).getTime() < OTP_RESEND_COOLDOWN_MS) {
      throw new Error("لطفاً یک دقیقه صبر کنید و دوباره تلاش کنید.");
    }

    // کدهای قبلی همین کاربر بی‌اعتبار شوند
    await otpTable(supabaseAdmin).delete().eq("username", data.username);

    const code = randomDigits(4);
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    const { error: insErr } = await otpTable(supabaseAdmin).insert({
      username: data.username,
      phone,
      code_hash: await hashCode(data.username, code),
      expires_at: expiresAt.toISOString(),
    } as any);
    if (insErr) throw new Error(insErr.message);

    const res = await sendSms([phone], smsTemplates.otp(code));
    if (!res.ok) throw new Error("ارسال پیامک ناموفق بود. کمی بعد دوباره تلاش کنید.");

    return { phone_hint: maskPhone(phone), expires_in: Math.floor(OTP_TTL_MS / 1000) };
  });

// ─── مرحله ۲: تایید کد ───────────────────────────────────────────────────────
export const verifyPasswordOtp = createServerFn({ method: "POST" })
  .inputValidator((d: { username: string; code: string }) => {
    if (!d?.username?.trim()) throw new Error("یوزرنیم را وارد کنید.");
    if (!/^\d{4}$/.test(d?.code?.trim() || "")) throw new Error("کد تایید باید ۴ رقم باشد.");
    return { username: d.username.trim().toLowerCase(), code: d.code.trim() };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: row } = await otpTable(supabaseAdmin)
      .select("*")
      .eq("username", data.username)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const otp = row as any;
    if (!otp || otp.used_at) throw new Error("کد معتبری یافت نشد. دوباره درخواست دهید.");
    if (new Date(otp.expires_at).getTime() < Date.now()) throw new Error("کد منقضی شده است. دوباره درخواست دهید.");
    if (otp.attempts >= OTP_MAX_ATTEMPTS) throw new Error("تعداد تلاش‌ها بیش از حد مجاز است. دوباره درخواست دهید.");

    if (otp.code_hash !== (await hashCode(data.username, data.code))) {
      const attempts = otp.attempts + 1;
      await otpTable(supabaseAdmin).update({ attempts } as any).eq("id", otp.id);
      const left = OTP_MAX_ATTEMPTS - attempts;
      throw new Error(left > 0 ? `کد اشتباه است. ${left} تلاش باقی مانده.` : "کد اشتباه است. دوباره درخواست دهید.");
    }

    const token = randomToken();
    const { error } = await otpTable(supabaseAdmin)
      .update({ verified_at: new Date().toISOString(), reset_token: token })
      .eq("id", otp.id);
    if (error) throw new Error(error.message);

    return { reset_token: token };
  });

// ─── مرحله ۳: تنظیم رمز جدید ─────────────────────────────────────────────────
export const resetPasswordWithOtp = createServerFn({ method: "POST" })
  .inputValidator((d: { username: string; reset_token: string; new_password: string }) => {
    if (!d?.username?.trim()) throw new Error("یوزرنیم را وارد کنید.");
    if (!d?.reset_token) throw new Error("توکن نامعتبر است. دوباره از ابتدا تلاش کنید.");
    if (!d?.new_password || d.new_password.length < 6) throw new Error("رمز عبور باید حداقل ۶ کاراکتر باشد.");
    return { username: d.username.trim().toLowerCase(), reset_token: d.reset_token, new_password: d.new_password };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: row } = await otpTable(supabaseAdmin)
      .select("*")
      .eq("username", data.username)
      .eq("reset_token", data.reset_token)
      .maybeSingle();

    const otp = row as any;
    if (!otp || otp.used_at || !otp.verified_at) throw new Error("درخواست معتبری یافت نشد. دوباره از ابتدا تلاش کنید.");
    if (Date.now() - new Date(otp.verified_at).getTime() > RESET_TOKEN_TTL_MS) {
      throw new Error("مهلت تنظیم رمز تمام شد. دوباره از ابتدا تلاش کنید.");
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("username", data.username)
      .maybeSingle();
    if (!profile) throw new Error("کاربر یافت نشد.");

    const { error } = await supabaseAdmin.auth.admin.updateUserById(profile.id, { password: data.new_password });
    if (error) throw new Error(error.message);

    // یک‌بارمصرف: توکن سوزانده شود
    await otpTable(supabaseAdmin)
      .update({ used_at: new Date().toISOString(), reset_token: null })
      .eq("id", otp.id);

    return { success: true };
  });

// ─── ادمین: پیامک دلخواه به کاربران ──────────────────────────────────────────
async function assertAdmin(supabase: any, userId: string) {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("دسترسی ادمین لازم است.");
}

export const adminSendCustomSms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { user_ids: string[]; text: string }) => {
    const text = (d?.text || "").trim();
    if (!text) throw new Error("متن پیامک نمی‌تواند خالی باشد.");
    if (text.length > 280) throw new Error("متن پیامک نباید بیشتر از ۲۸۰ کاراکتر باشد.");
    if (!Array.isArray(d?.user_ids) || d.user_ids.length === 0) throw new Error("حداقل یک گیرنده انتخاب کنید.");
    return { user_ids: d.user_ids, text };
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendSms, phoneMapByUsername } = await import("@/lib/sms.server");

    // فقط کاربران تاییدشده/فعال — مطابق خواسته‌ی «ارسال به کاربران تایید شده»
    const { data: rows, error } = await supabaseAdmin
      .from("profiles")
      .select("id, username, status")
      .in("id", data.user_ids)
      .eq("status", "active");
    if (error) throw new Error(error.message);

    const phones = await phoneMapByUsername(supabaseAdmin);
    const targets = (rows ?? [])
      .map((r: any) => phones[String(r.username).toLowerCase()])
      .filter(Boolean) as string[];

    const missing = (rows?.length ?? 0) - targets.length;
    const notActive = data.user_ids.length - (rows?.length ?? 0);

    if (!targets.length) throw new Error("هیچ‌کدام از کاربران انتخاب‌شده شماره موبایل ثبت‌شده ندارند.");

    const res = await sendSms(targets, data.text);
    return {
      ok: res.ok,
      sent: res.sent,
      failed: res.failed,
      no_phone: missing,
      not_active: notActive,
      error: res.error ?? null,
    };
  });

// ─── ادمین: اجرای دستی یادآوری انقضا ─────────────────────────────────────────
export const adminRunExpiryReminders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { runExpiryReminders } = await import("@/lib/sms.server");
    return await runExpiryReminders();
  });
