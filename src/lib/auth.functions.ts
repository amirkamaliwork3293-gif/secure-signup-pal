/**
 * Server functions for auth, signup requests, admin approvals, and settings.
 * All admin-only operations execute with the service role and verify caller role.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DEFAULT_PLANS, normalizePlans, type PlansConfig } from "@/lib/plans";
import {
  auditLog,
  clearRateLimit,
  clientIp,
  enforceRateLimit,
  isLockedOut,
} from "@/lib/rate-limit.server";
import {
  SIGNUP_RATE_MESSAGE,
  passwordResetRateCaps,
  signupRateCaps,
  trialRateCaps,
} from "@/lib/rate-limit-utils";
import {
  getTurnstileSiteKey,
  assertTurnstileToken,
  isTurnstileConfigured,
} from "@/lib/turnstile.server";
import {
  SIGNUP_RETRY_LATER,
  publicSignupCreateUserError,
  publicSignupProfileError,
  shouldRetrySignupWithoutOptionalColumns,
} from "@/lib/signup-errors";

const PLAN_DURATION_MS = {
  trial: 60 * 60 * 1000,
  "1month": 30 * 24 * 60 * 60 * 1000,
  "3month": 90 * 24 * 60 * 60 * 1000,
  "6month": 180 * 24 * 60 * 60 * 1000,
  "12month": 365 * 24 * 60 * 60 * 1000,
} as const;
type Plan = keyof typeof PLAN_DURATION_MS;
const VALID_PLANS: Plan[] = ["trial", "1month", "3month", "6month", "12month"];
const PAID_PLANS: Plan[] = ["1month", "3month", "6month", "12month"];

// Admin credentials live in server-only env vars (ADMIN_USERNAME, ADMIN_PASSWORD).
// We only retain the canonical email here as a non-secret identifier.
const ADMIN_EMAIL = "amirkamali@kamali.local";

// getPublicSettings روی هر بازدید صفحه‌ی معرفی/ثبت‌نام/تمدید صدا زده می‌شود؛ در
// روزهای وایرال یعنی هزاران کوئری تکراری روی همان یک ردیف app_settings. نتیجه ۶۰
// ثانیه در حافظه‌ی همان نمونه‌ی سرور کش می‌شود تا فشار روی دیتابیس (Compute/Egress)
// پایین بماند. هر تغییر ادمین در تنظیمات، کش را فوراً باطل می‌کند.
let publicSettingsCache: { at: number; value: PublicSettings } | null = null;
const PUBLIC_SETTINGS_TTL_MS = 60_000;
type PublicSettings = {
  card_number: string;
  card_holder: string;
  bank_name: string;
  plans: PlansConfig;
};
function invalidatePublicSettings() {
  publicSettingsCache = null;
}

function getAdminUsername(): string {
  return (process.env.ADMIN_USERNAME || "").trim();
}
function getAdminPassword(): string {
  return process.env.ADMIN_PASSWORD || "";
}
/**
 * مقایسه‌ی زمان‌ثابت واقعی.
 *
 * نسخه‌ی قبلی با `if (a.length !== b.length) return false` شروع می‌شد و در
 * نتیجه **طول رمز ادمین** را از طریق زمان پاسخ لو می‌داد. اینجا ابتدا هر دو
 * طرف SHA-256 می‌شوند تا همیشه دو رشته‌ی ۳۲ بایتی هم‌طول مقایسه شوند؛ طول
 * ورودی هیچ اثری روی زمان اجرا ندارد.
 */
async function ctEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let r = 0;
  for (let i = 0; i < va.length; i++) r |= va[i]! ^ vb[i]!;
  return r === 0;
}

function toEmail(username: string) {
  return `${username.trim().toLowerCase()}@kamali.local`;
}

// ─── اعتبارسنجی مشترک ورودی‌های عمومی ───────────────────────────────────────
// هر رشته‌ای که از اینترنت می‌آید سقف طول دارد. بدون سقف، یک مهاجم می‌تواند
// با فیلدهای چندمگابایتی هم دیتابیس را پر کند و هم هزینه‌ی egress بسازد.
const MAX_NAME = 60;
const MAX_PHONE = 20;
const MAX_NOTE = 500;
const MAX_PASSWORD = 200;

function cleanText(v: unknown, max: number): string {
  // حذف کاراکترهای کنترلی (C0 و DEL) — فاصله و خط تیره دست‌نخورده می‌مانند
  let out = "";
  for (const ch of String(v ?? "")) {
    const c = ch.codePointAt(0)!;
    if (c >= 32 && c !== 127) out += ch;
  }
  return out.trim().slice(0, max);
}

function requireName(v: unknown, field: string): string {
  const s = cleanText(v, MAX_NAME);
  if (!s) throw new Error(`${field} الزامی است.`);
  return s;
}

/**
 * سیاست رمز عبور: حداقل ۸ کاراکتر و ترکیبی از حروف و عدد.
 * (قبلاً فقط ۶ کاراکتر بدون هیچ شرطی — رمزهایی مثل «123456» مجاز بودند.)
 */
function validatePassword(p: unknown): string {
  const s = String(p ?? "");
  if (s.length < 8) throw new Error("رمز عبور باید حداقل ۸ کاراکتر باشد.");
  if (s.length > MAX_PASSWORD) throw new Error("رمز عبور بیش از حد طولانی است.");
  if (!/[a-zA-Z؀-ۿ]/.test(s) || !/\d/.test(s)) {
    throw new Error("رمز عبور باید هم حرف و هم عدد داشته باشد.");
  }
  return s;
}

/** رمز تصادفی ۳۲ بایتی — هرگز به مرورگر فرستاده نمی‌شود. */
function randomSecret(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * ورود سمت سرور با کلید عمومی (anon) — خروجی، نشست آماده برای کلاینت است.
 * کلاینت دیگر رمز ادمین را به Supabase نمی‌فرستد؛ فقط نشست را set می‌کند.
 */
async function serverSignIn(email: string, password: string) {
  const { createClient } = await import("@supabase/supabase-js");
  const { resolveSupabasePublishableKey, resolveSupabaseUrl } = await import(
    "@/integrations/supabase/public-config"
  );
  const url = resolveSupabaseUrl();
  const anon = resolveSupabasePublishableKey();
  if (!url || !anon) throw new Error("پیکربندی Supabase ناقص است.");
  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(error?.message || "ورود ناموفق بود.");
  return data.session;
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/**
 * یافتن حساب auth ادمین.
 *
 * نسخه‌ی قبلی فقط `listUsers({ page: 1, perPage: 200 })` را می‌گشت. اگر تعداد
 * کاربران از ۲۰۰ بیشتر می‌شد (مثلاً با سیل ثبت‌نام خودکار) ممکن بود ادمین در
 * آن صفحه نباشد و مسیر «ساخت ادمین» اجرا شود که با خطای «ایمیل تکراری» ورود
 * ادمین را کاملاً از کار می‌انداخت. اینجا id از روی profiles خوانده می‌شود
 * (O(1)) و پیمایش فقط fallback است.
 */
async function findAdminAuthUser(supabaseAdmin: any, expectedUser: string) {
  const { data: prof } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("username", expectedUser.toLowerCase())
    .maybeSingle();
  if (prof?.id) {
    const { data } = await supabaseAdmin.auth.admin.getUserById(prof.id);
    if (data?.user?.email === ADMIN_EMAIL) return data.user;
  }
  for (let page = 1; page <= 20; page++) {
    const { data } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    const users = data?.users ?? [];
    const hit = users.find((u: any) => u.email === ADMIN_EMAIL);
    if (hit) return hit;
    if (users.length < 200) break;
  }
  return null;
}

// یوزرنیم مبنای ایمیل داخلی ورود کاربر است (username@kamali.local)، بنابراین
// باید یک شناسه‌ی امن برای ایمیل باشد: فقط حروف/عدد انگلیسی و _ . - در وسط،
// بدون فاصله/@ و بدون حروف فارسی/یونیکد (تا ورود همیشه قابل‌اعتماد کار کند).
// در غیر این محدودیت فنی، کاربر می‌تواند هر یوزرنیمی که دوست دارد انتخاب کند —
// تنها محدودیت واقعی، تکراری نبودن آن است (پیام خطای اختصاصی جدا کنترل می‌شود).
const USERNAME_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9_.-]{0,38}[a-zA-Z0-9])?$/;
const USERNAME_HINT =
  "یوزرنیم باید ۲ تا ۴۰ کاراکتر انگلیسی باشد (حروف، عدد، نقطه، خط تیره یا زیرخط — بدون فاصله).";

async function loadPlansConfig(admin: any): Promise<PlansConfig> {
  const { data } = await admin.from("app_settings").select("plans").eq("id", 1).maybeSingle();
  return normalizePlans((data as any)?.plans);
}

function planDurationMs(cfg: PlansConfig, plan: Plan): number {
  const minutes = cfg[plan]?.duration_minutes ?? DEFAULT_PLANS[plan].duration_minutes;
  return Math.max(1, Math.floor(minutes)) * 60 * 1000;
}

// ─── Public: submit signup request ───────────────────────────────────────────
// جریان جدید: کاربر همان ابتدا یوزرنیم و رمز عبور انتخاب می‌کند. حساب با وضعیت
// «در انتظار تایید» ساخته می‌شود و بلافاصله پس از تایید مدیر، ورود ممکن است —
// بدون هیچ مرحله «تنظیم رمز» اضافه.
export const submitSignupRequest = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      first_name: string;
      last_name: string;
      username: string;
      password: string;
      plan: Plan;
      payment_confirmed: boolean;
      receipt_url?: string | null;
      /** جایگزین متنی رسید (کد پیگیری + تاریخ واریز) وقتی کاربر عکس آپلود نمی‌کند */
      receipt_note?: string | null;
      phone?: string;
      /** فیلد تله — باید خالی بماند. ربات‌ها معمولاً پرش می‌کنند. */
      website?: string | null;
      /** زمان شروع پر کردن فرم (Date.now سمت کلاینت) */
      form_started_at?: number | null;
      /** توکن Cloudflare Turnstile — سرور با کلید محرمانه تایید می‌کند */
      turnstile_token?: string | null;
    }) => {
      // تله را قبل از هر کار سنگین چک می‌کنیم تا ربات سهمیه را نسوزاند.
      if (String(d.website ?? "").trim()) {
        throw new Error("امکان ثبت درخواست الان وجود ندارد. کمی بعد دوباره تلاش کنید.");
      }
      const startedRaw = d.form_started_at;
      if (startedRaw != null && startedRaw !== 0) {
        const started = Number(startedRaw);
        const now = Date.now();
        if (!Number.isFinite(started) || started > now + 120_000 || started < now - 6 * 60 * 60 * 1000) {
          throw new Error("لطفاً صفحه را تازه کنید و فرم را دوباره پر کنید.");
        }
        if (now - started < 1500) {
          throw new Error("لطفاً چند ثانیه صبر کنید و دوباره ارسال کنید.");
        }
      }
      const first_name = requireName(d.first_name, "نام");
      const last_name = requireName(d.last_name, "نام خانوادگی");
      if (!d.username?.trim() || !USERNAME_RE.test(d.username)) {
        throw new Error(USERNAME_HINT);
      }
      const password = validatePassword(d.password);
      if (!VALID_PLANS.includes(d.plan)) throw new Error("پلن نامعتبر است.");
      if (d.plan === "trial") throw new Error("برای نسخه تست از فرم اختصاصی استفاده کنید.");
      if (!d.payment_confirmed) throw new Error("لطفاً تایید کنید که پرداخت انجام شده است.");
      // یا عکس رسید، یا اطلاعات متنی واریز — یکی از این دو الزامی است
      const receipt_note = cleanText(d.receipt_note ?? "", MAX_NOTE);
      const receipt_url = d.receipt_url ? cleanText(d.receipt_url, 300) : null;
      if (!receipt_url && !receipt_note) {
        throw new Error("لطفاً عکس رسید پرداخت را آپلود کنید یا کد پیگیری و تاریخ واریز را بنویسید.");
      }
      return {
        first_name,
        last_name,
        username: d.username.trim().toLowerCase(),
        password,
        plan: d.plan,
        payment_confirmed: d.payment_confirmed,
        receipt_url,
        receipt_note,
        phone: cleanText(d.phone ?? "", MAX_PHONE),
        turnstile_token: d.turnstile_token ?? null,
      };
    },
  )
  .handler(async ({ data }) => {
    await assertTurnstileToken(data.turnstile_token);
    const supabaseAdmin = await admin();
    const username = data.username;
    const ip = clientIp();
    const caps = signupRateCaps(isTurnstileConfigured());

    // دو لایه سقف: هر IP (شبکه‌های ایران اغلب CGNAT هستند پس سقف را کمی باز
    // می‌گذاریم) + سقف سراسری که جلوی سیل ۳۰۰تایی از IPهای مختلف را می‌گیرد.
    // اگر TURNSTILE_SECRET_KEY نباشد بررسی کپچا fail-open است؛ در آن حالت
    // سقف‌ها سخت‌تر می‌شوند تا همان سیل ثبت‌نام قبلی بدون کپچا تکرار نشود.
    await enforceRateLimit(
      supabaseAdmin,
      "signup-ip",
      ip,
      caps.ipMax,
      caps.ipWindow,
      SIGNUP_RATE_MESSAGE,
    );
    await enforceRateLimit(
      supabaseAdmin,
      "signup-global",
      "all",
      caps.globalMax,
      caps.globalWindow,
      SIGNUP_RATE_MESSAGE,
    );

    // یوزرنیم ادمین رزرو است — اما پیام خطا باید **دقیقاً** همان پیام «تکراری»
    // باشد. پیام اختصاصی قبلی («این یوزرنیم رزرو شده است») به هر مهاجم ناشناسی
    // اجازه می‌داد یوزرنیم ادمین را با آزمون‌وخطا پیدا کند.
    const TAKEN = "این یوزرنیم قبلاً ثبت شده است.";
    const adminUser = getAdminUsername().toLowerCase();
    if (adminUser && username === adminUser) throw new Error(TAKEN);

    // Enforce plan enabled flag (admins can disable plans for new signups)
    const plansCfg = await loadPlansConfig(supabaseAdmin);
    if (!plansCfg[data.plan]?.enabled) throw new Error("این پلن در حال حاضر غیرفعال است.");

    // Check username not already taken (profile or pending request)
    const { data: existingProfile } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("username", username)
      .maybeSingle();
    if (existingProfile) throw new Error("این یوزرنیم قبلاً ثبت شده است.");

    const { data: existingReq } = await supabaseAdmin
      .from("signup_requests")
      .select("id, status")
      .eq("username", username)
      .in("status", ["pending", "approved"])
      .maybeSingle();
    if (existingReq) {
      throw new Error(
        existingReq.status === "pending"
          ? "درخواست شما قبلاً ثبت شده و در انتظار تایید است."
          : "این یوزرنیم قبلاً تایید شده — لطفاً وارد شوید.",
      );
    }

    // Create the auth user up front with the chosen password (profile stays pending)
    const phone = data.phone?.trim() || null;

    if (phone) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count, error: phoneErr } = await supabaseAdmin
        .from("signup_requests")
        .select("id", { count: "exact", head: true })
        .eq("phone", phone)
        .eq("status", "pending")
        .gte("created_at", since);
      if (!phoneErr && (count ?? 0) >= 3) {
        throw new Error("با این شماره موبایل درخواست‌های زیادی در انتظار است. لطفاً کمی بعد تلاش کنید.");
      }
    }

    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: toEmail(username),
      password: data.password,
      email_confirm: true,
      // Store phone in user_metadata so it's always accessible without a schema change
      user_metadata: { username, first_name: data.first_name.trim(), last_name: data.last_name.trim(), phone },
    });
    // حساب موجود را هرگز با رمز فرم جدید بازنویسی نکن — بعد از نفوذ، رمز کاربران
    // نباید خودکار عوض شود. اگر یوزرنیم تکراری است فقط همان پیام را بده.
    if (createErr || !created.user) throw new Error(publicSignupCreateUserError(createErr?.message));

    const { error: profileErr } = await supabaseAdmin.from("profiles").insert({
      id: created.user.id,
      username,
      first_name: data.first_name.trim(),
      last_name: data.last_name.trim(),
      plan: data.plan,
      status: "pending",
    });
    if (profileErr) {
      // cleanup so the username isn't burned by a half-created account
      await supabaseAdmin.auth.admin.deleteUser(created.user.id).catch(() => {});
      throw new Error(publicSignupProfileError(profileErr.message));
    }

    await supabaseAdmin.from("user_roles").insert({ user_id: created.user.id, role: "user" }).catch(() => {});

    // Try inserting with the optional columns; if one doesn't exist yet (migration
    // pending), fall back to inserting without them so registration never fails.
    const requestBase = {
      first_name: data.first_name.trim(),
      last_name: data.last_name.trim(),
      username,
      plan: data.plan,
      payment_confirmed: data.payment_confirmed,
      receipt_url: data.receipt_url ?? null,
      password_set: true,
    };

    // رمز کاربر **هرگز** ذخیره نمی‌شود. ستون temp_password حذف شده است: رمز را
    // خود کاربر انتخاب کرده و می‌داند؛ نگه‌داشتن متن ساده‌ی آن فقط یعنی هرکس به
    // پنل ادمین نفوذ کند رمز همه‌ی کاربران در انتظار را یکجا برمی‌دارد.
    const optional: Record<string, unknown> = {};
    if (phone) optional.phone = phone;
    if (data.receipt_note) optional.receipt_note = data.receipt_note;
    if (ip && ip !== "unknown") optional.client_ip = ip.slice(0, 80);

    let result = await supabaseAdmin
      .from("signup_requests")
      .insert({ ...requestBase, ...optional } as any)
      .select("id")
      .single();

    if (shouldRetrySignupWithoutOptionalColumns(result.error?.message)) {
      // Column not yet migrated — retry with the base columns only
      result = await supabaseAdmin
        .from("signup_requests")
        .insert(requestBase)
        .select("id")
        .single();
    }
    if (result.error) {
      await supabaseAdmin.from("profiles").delete().eq("id", created.user.id).catch(() => {});
      await supabaseAdmin.from("user_roles").delete().eq("user_id", created.user.id).catch(() => {});
      await supabaseAdmin.auth.admin.deleteUser(created.user.id).catch(() => {});
      throw new Error(SIGNUP_RETRY_LATER);
    }

    return { id: result.data.id };
  });

// ─── Public: check request status (for set-password page) ────────────────────
export const checkRequestStatus = createServerFn({ method: "POST" })
  .inputValidator((d: { username: string }) => {
    if (!d.username?.trim() || !USERNAME_RE.test(d.username.trim())) {
      throw new Error("یوزرنیم الزامی است.");
    }
    return { username: d.username.trim().toLowerCase() };
  })
  .handler(async ({ data }) => {
    const supabaseAdmin = await admin();
    // این تابع نام و نام خانوادگی صاحب یوزرنیم را برمی‌گرداند (برای پیام
    // خوش‌آمد در صفحه‌ی تنظیم رمز). بدون سقف نرخ، می‌شد با پیمایش یوزرنیم‌ها
    // فهرست کاملی از نام واقعی کاربران استخراج کرد.
    await enforceRateLimit(supabaseAdmin, "check-status", clientIp(), 10, 3600);
    const { data: req } = await supabaseAdmin
      .from("signup_requests")
      .select("status, password_set, first_name, last_name, plan")
      .eq("username", data.username.trim().toLowerCase())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!req) return { exists: false as const };
    return { exists: true as const, ...req };
  });

// ─── Public: set password after admin approval ───────────────────────────────
export const setPasswordAfterApproval = createServerFn({ method: "POST" })
  .inputValidator((d: { username: string; password: string; turnstile_token?: string | null }) => {
    if (!d.username?.trim() || !USERNAME_RE.test(d.username.trim())) {
      throw new Error("یوزرنیم الزامی است.");
    }
    return {
      username: d.username.trim().toLowerCase(),
      password: validatePassword(d.password),
      turnstile_token: d.turnstile_token ?? null,
    };
  })
  .handler(async ({ data }) => {
    await assertTurnstileToken(data.turnstile_token);
    const supabaseAdmin = await admin();
    const username = data.username;
    const setPassMax = isTurnstileConfigured() ? 10 : 4;
    await enforceRateLimit(supabaseAdmin, "set-password", clientIp(), setPassMax, 3600);

    const { data: req } = await supabaseAdmin
      .from("signup_requests")
      .select("id, status, password_set, first_name, last_name, plan")
      .eq("username", username)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!req) throw new Error("درخواست ثبت‌نام یافت نشد.");
    if (req.status === "pending") throw new Error("درخواست شما هنوز توسط مدیر تایید نشده است.");
    if (req.status === "rejected") throw new Error("درخواست شما توسط مدیر رد شده است.");
    if (req.password_set) throw new Error("رمز عبور قبلاً تنظیم شده — لطفاً وارد شوید.");

    const email = toEmail(username);
    const plan = req.plan as Plan;
    const plansCfg = await loadPlansConfig(supabaseAdmin);
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + planDurationMs(plansCfg, plan));

    // Create auth user
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.password,
      email_confirm: true,
      user_metadata: { username, first_name: req.first_name, last_name: req.last_name },
    });
    if (createErr || !created.user) throw new Error(publicSignupCreateUserError(createErr?.message));

    // Create profile
    const { error: profileErr } = await supabaseAdmin.from("profiles").insert({
      id: created.user.id,
      username,
      first_name: req.first_name,
      last_name: req.last_name,
      plan,
      status: "active",
      start_date: startDate.toISOString(),
      end_date: endDate.toISOString(),
    });
    if (profileErr) throw new Error(profileErr.message);

    await supabaseAdmin.from("user_roles").insert({ user_id: created.user.id, role: "user" });

    await supabaseAdmin
      .from("signup_requests")
      .update({ password_set: true })
      .eq("id", req.id);

    return { success: true, email };
  });

// ─── Admin login: validate credentials server-side and ensure account ────────
// The previous flow exposed the admin password to the browser bundle and let any
// anonymous caller invoke `ensureAdminAccount` to (re)create the admin user with
// the hardcoded credentials. Both issues are fixed here: credentials live only in
// server env vars, the comparison happens on the server, and the function only
// returns the admin email (the user-supplied password is reused for sign-in).
export const verifyAdminLogin = createServerFn({ method: "POST" })
  .inputValidator((d: { username: string; password: string }) => {
    if (!d?.username?.trim() || !d?.password) {
      throw new Error("یوزرنیم و رمز عبور لازم است.");
    }
    return { username: d.username.trim(), password: d.password };
  })
  .handler(async ({ data }) => {
    const expectedUser = getAdminUsername();
    const expectedPass = getAdminPassword();
    const supabaseAdmin = await admin();
    const ip = clientIp();
    const GENERIC = "یوزرنیم یا رمز عبور ادمین اشتباه است.";

    // ─── قفل پس از تلاش‌های ناموفق ───────────────────────────────────────────
    // این endpoint ناشناس است و مستقیماً رمز ادمین را می‌سنجد؛ بدون قفل، یک
    // اسکریپت می‌تواند بی‌نهایت رمز امتحان کند. دو سطح قفل داریم:
    //   • per-IP  : ۵ تلاش ناموفق در ۱۵ دقیقه
    //   • سراسری  : ۲۰ تلاش ناموفق در ۱۵ دقیقه (جلوی حمله‌ی توزیع‌شده از چند IP)
    const ipKey = ip;
    const GLOBAL = "all";
    if (
      (await isLockedOut(supabaseAdmin, "admin-login-fail", ipKey, 5, 900)) ||
      (await isLockedOut(supabaseAdmin, "admin-login-fail", GLOBAL, 20, 900))
    ) {
      await auditLog(supabaseAdmin, {
        actor_id: null,
        action: "admin_login_blocked",
        detail: { reason: "locked_out" },
      });
      throw new Error("به دلیل تلاش‌های ناموفق، ورود موقتاً قفل شده است. بعداً دوباره تلاش کنید.");
    }

    if (!expectedUser || !expectedPass) {
      // پیام عمومی — نبودِ پیکربندی نباید به مهاجم اطلاعاتی بدهد
      console.error("[admin-login] ADMIN_USERNAME/ADMIN_PASSWORD not configured");
      throw new Error(GENERIC);
    }

    // مقایسه‌ی زمان‌ثابت؛ هر دو طرف همیشه سنجیده می‌شوند تا زمان پاسخ
    // نشان ندهد کدام‌یک غلط بوده است.
    const [userOk, passOk] = await Promise.all([
      ctEqual(data.username.toLowerCase(), expectedUser.toLowerCase()),
      ctEqual(data.password, expectedPass),
    ]);
    if (!userOk || !passOk) {
      // شمارنده‌ی تلاش ناموفق فقط در همین شاخه بالا می‌رود
      await enforceRateLimit(supabaseAdmin, "admin-login-fail", ipKey, 5, 900, GENERIC).catch(() => {});
      await enforceRateLimit(supabaseAdmin, "admin-login-fail", GLOBAL, 20, 900, GENERIC).catch(() => {});
      await auditLog(supabaseAdmin, {
        actor_id: null,
        action: "admin_login_failed",
        detail: { username_matched: userOk },
      });
      throw new Error(GENERIC);
    }

    // ─── یافتن حساب ادمین ────────────────────────────────────────────────────
    // نسخه‌ی قبلی فقط صفحه‌ی اول ۲۰۰ کاربر را می‌گشت؛ با رشد تعداد کاربران
    // ممکن بود ادمین پیدا نشود و مسیر «ساخت ادمین» اجرا شود. اینجا از روی
    // profiles (که id ادمین را نگه می‌دارد) مستقیم پیدا می‌شود.
    const sessionPass = randomSecret();
    let adminUser = await findAdminAuthUser(supabaseAdmin, expectedUser);

    if (!adminUser) {
      const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
        email: ADMIN_EMAIL,
        password: sessionPass,
        email_confirm: true,
        user_metadata: { username: expectedUser },
      });
      if (error || !created.user) throw new Error(error?.message || "خطا در ساخت ادمین.");
      adminUser = created.user;
    } else {
      // ⚠️ رمز حساب Supabase عمداً **برابر ADMIN_PASSWORD نیست**.
      //
      // احراز هویت واقعی را GoTrue انجام می‌دهد و endpoint آن برای همه باز
      // است. اگر رمز حساب همان ADMIN_PASSWORD می‌بود، هرکس آن را می‌دانست
      // می‌توانست مستقیماً signInWithPassword بزند و قفل/سقف نرخ این تابع را
      // کامل دور بزند. به‌جای آن، در هر ورود موفق یک رمز تصادفی ۳۲ بایتی
      // روی حساب گذاشته می‌شود که هیچ‌کس (حتی مرورگر ادمین) آن را نمی‌بیند.
      const { error: pwErr } = await supabaseAdmin.auth.admin.updateUserById(adminUser.id, {
        password: sessionPass,
      });
      if (pwErr) throw new Error(pwErr.message);
    }
    const admin_ = adminUser;

    await clearRateLimit(supabaseAdmin, "admin-login-fail", ipKey);
    await auditLog(supabaseAdmin, {
      actor_id: admin_.id,
      action: "admin_login_success",
      detail: {},
    });

    await supabaseAdmin
      .from("profiles")
      .upsert(
        {
          id: admin_.id,
          username: expectedUser.toLowerCase(),
          first_name: "Amir",
          last_name: "Kamali",
          status: "active" as const,
        },
        { onConflict: "id" },
      );

    await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: admin_.id, role: "admin" }, { onConflict: "user_id,role" });

    // نشست آماده تحویل کلاینت — رمز هرگز از مرورگر به GoTrue نمی‌رود.
    const session = await serverSignIn(ADMIN_EMAIL, sessionPass);
    return {
      email: ADMIN_EMAIL,
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    };
  });

// ─── Admin: approve a signup request ─────────────────────────────────────────
async function assertAdmin(supabase: any, userId: string) {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("دسترسی ادمین لازم است.");
}

// حذف فایل رسید از استوریج + پاک‌کردن ستون receipt_url
// (بعد از تایید/رد درخواست فراخوانی می‌شود تا فضای هاست الکی پر نشود)
async function purgeReceipt(supabaseAdmin: any, requestId: string) {
  try {
    const { data: row } = await supabaseAdmin
      .from("signup_requests")
      .select("receipt_url")
      .eq("id", requestId)
      .maybeSingle();
    const path = row?.receipt_url as string | null | undefined;
    if (!path) return;
    const { error: rmErr } = await supabaseAdmin.storage.from("receipts").remove([path]);
    if (rmErr) console.warn("[purgeReceipt] storage remove failed:", path, rmErr.message);
    // ستون مسیر فایل پاک می‌شود ولی خود رکورد (و متن رسید) برای تاریخچه می‌ماند
    await supabaseAdmin
      .from("signup_requests")
      .update({ receipt_url: null })
      .eq("id", requestId);
  } catch (e) {
    // حذف رسید بحرانی نیست؛ اگر شکست خورد جریان تایید/رد را قطع نکن
    console.warn("[purgeReceipt] cleanup failed for request", requestId, e);
  }
}

// رمز موقت (که فقط برای پیامک خوش‌آمدگویی نگه داشته شده) پاک می‌شود.
// اگر مهاجرت هنوز اعمال نشده باشد، بی‌صدا رد می‌شود.
/**
 * ستون temp_password در مهاجرت ۲۰۲۶-۰۸-۲۷ حذف شد — رمز کاربر دیگر هرگز ذخیره
 * نمی‌شود. این تابع فقط برای سازگاری با فراخوانی‌های موجود باقی مانده و کاری
 * انجام نمی‌دهد. (حذف کامل نیاز به تغییر UI ادمین دارد؛ عمداً به بعد موکول شده.)
 */
async function clearTempPassword(_supabaseAdmin: unknown, _requestId: string) {
  // ponytail: no-op after temp_password removal; drop with the admin UI cleanup
}

export const approveSignupRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => {
    if (!d.id) throw new Error("شناسه درخواست لازم است.");
    return d;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: req, error: reqErr } = await supabaseAdmin
      .from("signup_requests")
      .select("id, username, plan, password_set, request_type, target_user_id")
      .eq("id", data.id)
      .maybeSingle();
    if (reqErr || !req) throw new Error(reqErr?.message || "درخواست یافت نشد.");

    const { error } = await supabaseAdmin
      .from("signup_requests")
      .update({ status: "approved", reviewed_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    // ── جریان «تمدید طرح»: حساب از قبل وجود دارد؛ فقط پروفایل را تمدید کن
    if ((req as any).request_type === "renewal") {
      const targetId = (req as any).target_user_id as string | null;
      if (!targetId) throw new Error("شناسه کاربر مقصد در درخواست تمدید یافت نشد.");
      const plansCfg = await loadPlansConfig(supabaseAdmin);
      const plan = req.plan as Plan;
      // اگر هنوز از اشتراک قبلی زمان باقی مانده، مدت جدید روی همان باقی‌مانده
      // اضافه می‌شود (مثلاً ۱۵ روز مانده + ۱ ماه = ۴۵ روز).
      const { data: targetProfile } = await supabaseAdmin
        .from("profiles")
        .select("end_date, start_date")
        .eq("id", targetId)
        .maybeSingle();
      const now = Date.now();
      const prevEnd = (targetProfile as any)?.end_date
        ? new Date((targetProfile as any).end_date).getTime()
        : 0;
      const base = new Date(Math.max(now, isFinite(prevEnd) ? prevEnd : 0));
      const start = new Date(now);
      const end = new Date(base.getTime() + planDurationMs(plansCfg, plan));
      const { error: renErr } = await supabaseAdmin
        .from("profiles")
        .update({ plan, status: "active", start_date: start.toISOString(), end_date: end.toISOString() })
        .eq("id", targetId);
      if (renErr) throw new Error(renErr.message);
      await clearTempPassword(supabaseAdmin, data.id);
      await purgeReceipt(supabaseAdmin, data.id);
      return { success: true };
    }

    // جریان جدید: حساب از قبل (با رمز انتخابی کاربر) ساخته شده — همینجا فعال
    // می‌شود تا کاربر بلافاصله بتواند وارد شود. (درخواست‌های قدیمی بدون حساب،
    // مثل سابق از مسیر «تنظیم رمز» فعال می‌شوند.)
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, status")
      .eq("username", req.username)
      .maybeSingle();

    if (profile && profile.status === "pending") {
      const plansCfg = await loadPlansConfig(supabaseAdmin);
      const plan = req.plan as Plan;
      const start = new Date();
      const end = new Date(start.getTime() + planDurationMs(plansCfg, plan));
      const { error: actErr } = await supabaseAdmin
        .from("profiles")
        .update({
          plan,
          status: "active",
          start_date: start.toISOString(),
          end_date: end.toISOString(),
        })
        .eq("id", profile.id);
      if (actErr) throw new Error(actErr.message);
    }

    // نکته: رمز موقت اینجا پاک نمی‌شود — تا ادمین بتواند از تب «درخواست‌ها» پیام
    // خوش‌آمدگویی را هم به‌صورت نیمه‌دستی (پیامک/واتساپ) بفرستد. با فراخوانی
    // adminClearSignupTempPassword (بعد از ارسال دستی) یا با رد یک درخواست پاک می‌شود.

    // رسید پس از تایید دیگر لازم نیست — از استوریج حذف شود
    await purgeReceipt(supabaseAdmin, data.id);

    await auditLog(supabaseAdmin, {
      actor_id: context.userId, action: "signup_approved", target: data.id,
      detail: { username: req.username, plan: req.plan },
    });
    return { success: true };
  });

export const rejectSignupRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => {
    if (!d.id) throw new Error("شناسه درخواست لازم است.");
    return d;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: req } = await supabaseAdmin
      .from("signup_requests")
      .select("id, username")
      .eq("id", data.id)
      .maybeSingle();

    const { error } = await supabaseAdmin
      .from("signup_requests")
      .update({ status: "rejected", reviewed_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    // اگر حساب در انتظار از قبل ساخته شده، رد هم بشود
    if (req?.username) {
      await supabaseAdmin
        .from("profiles")
        .update({ status: "rejected" })
        .eq("username", req.username)
        .eq("status", "pending");
    }

    // رسید و رمز موقت پس از رد هم لازم نیستند
    await clearTempPassword(supabaseAdmin, data.id);
    await purgeReceipt(supabaseAdmin, data.id);

    await auditLog(supabaseAdmin, {
      actor_id: context.userId, action: "signup_rejected", target: data.id,
      detail: { username: req?.username ?? null },
    });
    return { success: true };
  });

export const updateCardSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { card_number: string; card_holder: string; bank_name: string }) => {
    if (!d.card_number?.trim()) throw new Error("شماره کارت لازم است.");
    return d;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("app_settings")
      .update({
        card_number: data.card_number.trim(),
        card_holder: data.card_holder.trim(),
        bank_name: data.bank_name.trim(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);
    if (error) throw new Error(error.message);
    invalidatePublicSettings();
    return { success: true };
  });

export const extendUserSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { user_id: string; plan: Plan }) => {
    if (!d.user_id) throw new Error("شناسه کاربر لازم است.");
    if (!PAID_PLANS.includes(d.plan)) throw new Error("پلن نامعتبر است.");
    return d;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const plansCfg = await loadPlansConfig(supabaseAdmin);
    const start = new Date();
    const end = new Date(start.getTime() + planDurationMs(plansCfg, data.plan));
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({
        plan: data.plan,
        status: "active",
        start_date: start.toISOString(),
        end_date: end.toISOString(),
      })
      .eq("id", data.user_id);
    if (error) throw new Error(error.message);
    await auditLog(supabaseAdmin, {
      actor_id: context.userId, action: "subscription_extended", target: data.user_id,
      detail: { plan: data.plan },
    });
    return { success: true };
  });

async function requireAdminPassword(password: string): Promise<void> {
  const expected = getAdminPassword();
  if (!expected) throw new Error("پیکربندی ادمین ناقص است.");
  const ok = await ctEqual(String(password ?? ""), expected);
  if (!ok) throw new Error("رمز ادمین نادرست است.");
}

export const deleteUserAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { user_id: string; confirm_username: string; admin_password: string }) => {
    if (!d.user_id) throw new Error("شناسه کاربر لازم است.");
    if (!d.confirm_username?.trim()) throw new Error("برای حذف، یوزرنیم کاربر را تایپ کنید.");
    if (!d.admin_password) throw new Error("رمز ادمین لازم است.");
    return {
      user_id: d.user_id,
      confirm_username: d.confirm_username.trim().toLowerCase(),
      admin_password: d.admin_password,
    };
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    if (data.user_id === context.userId) throw new Error("نمی‌توانید حساب خود را حذف کنید.");
    const supabaseAdmin = await admin();

    // حتی با نشست ادمین دزدیده‌شده، بدون رمز ادمین نمی‌توان کاربر را پاک کرد.
    await requireAdminPassword(data.admin_password);

    // سقف سخت: حداکثر ۳ حذف در ۳۰ دقیقه. در حادثه‌ی نفوذ، مهاجم همه‌ی کاربران
    // را در چند ثانیه پاک کرد؛ با این سقف حتی اگر وارد پنل شود نمی‌تواند سایت
    // را خالی کند.
    await enforceRateLimit(
      supabaseAdmin,
      "admin-delete",
      context.userId,
      3,
      1800,
      "حذف کاربران موقتاً قفل است (حداکثر ۳ حذف در ۳۰ دقیقه). کمی بعد دوباره تلاش کنید.",
    );

    const { data: target } = await supabaseAdmin
      .from("profiles")
      .select("id, username")
      .eq("id", data.user_id)
      .maybeSingle();
    if (!target) throw new Error("کاربر یافت نشد.");
    if ((target.username || "").toLowerCase() !== data.confirm_username) {
      throw new Error("یوزرنیم واردشده با این کاربر مطابقت ندارد.");
    }

    // هیچ ادمینی نمی‌تواند ادمین دیگری را حذف کند. در حادثه‌ی نفوذ، مهاجم با
    // همین مسیر کاربران را پاک کرد؛ حساب‌های ادمین باید فقط از کنسول Supabase
    // قابل حذف باشند.
    const { data: targetRole } = await supabaseAdmin
      .from("user_roles").select("role").eq("user_id", data.user_id).eq("role", "admin").maybeSingle();
    if (targetRole) throw new Error("حذف حساب ادمین از این مسیر مجاز نیست.");

    // آخرین وضعیت داده‌های کاربر پیش از حذف در user_data_backups نگه داشته
    // می‌شود (این جدول FK ندارد، پس با حذف حساب cascade نمی‌شود).
    const { data: live } = await supabaseAdmin
      .from("user_data").select("*").eq("user_id", data.user_id).maybeSingle();
    if (live) {
      await supabaseAdmin.from("user_data_backups")
        .insert({ user_id: data.user_id, snapshot: live }).then(() => {}, () => {});
    }

    await auditLog(supabaseAdmin, {
      actor_id: context.userId, action: "user_deleted", target: data.user_id,
      detail: { had_backup: !!live, username: target.username },
    });
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (error) throw new Error(error.message);
    return { success: true };
  });

// ─── Admin: update plan prices ───────────────────────────────────────────────
export const updatePlanPrices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { price_1month: number; price_3month: number; price_6month: number; price_12month: number }) => {
    for (const v of [d.price_1month, d.price_3month, d.price_6month, d.price_12month]) {
      if (!Number.isFinite(v) || v < 0 || v > 1_000_000_000) throw new Error("قیمت نامعتبر است.");
    }
    return d;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("app_settings")
      .update({
        price_1month: data.price_1month,
        price_3month: data.price_3month,
        price_6month: data.price_6month,
        price_12month: data.price_12month,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);
    if (error) throw new Error(error.message);
    invalidatePublicSettings();
    return { success: true };
  });

// ─── Public: create a 1-hour trial account (no admin approval) ───────────────
export const createTrialAccount = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      first_name: string;
      last_name: string;
      username: string;
      password: string;
      turnstile_token?: string | null;
    }) => {
    const first_name = requireName(d.first_name, "نام");
    const last_name = requireName(d.last_name, "نام خانوادگی");
    if (!d.username?.trim() || !USERNAME_RE.test(d.username)) {
      throw new Error(USERNAME_HINT);
    }
    return {
      first_name,
      last_name,
      username: d.username.trim().toLowerCase(),
      password: validatePassword(d.password),
      turnstile_token: d.turnstile_token ?? null,
    };
  })
  .handler(async ({ data }) => {
    await assertTurnstileToken(data.turnstile_token);
    const supabaseAdmin = await admin();
    const username = data.username;
    const trialCaps = trialRateCaps(isTurnstileConfigured());

    // ⚠️ این endpoint بدون تایید مدیر و بدون پرداخت، حساب واقعی می‌سازد.
    // سخت‌ترین سقف نرخ کل سامانه اینجاست. اگر کپچا پیکربندی نشده باشد سقف
    // سخت‌تر می‌شود (۱/روز·IP و ۶/ساعت سراسری).
    await enforceRateLimit(
      supabaseAdmin,
      "trial",
      clientIp(),
      trialCaps.ipMax,
      trialCaps.ipWindow,
    );
    await enforceRateLimit(
      supabaseAdmin,
      "trial-global",
      "all",
      trialCaps.globalMax,
      trialCaps.globalWindow,
    );

    const TAKEN = "این یوزرنیم قبلاً ثبت شده است.";
    const adminUser = getAdminUsername().toLowerCase();
    if (adminUser && username === adminUser) throw new Error(TAKEN);

    const plansCfg = await loadPlansConfig(supabaseAdmin);
    if (!plansCfg.trial?.enabled) throw new Error("نسخه تست در حال حاضر غیرفعال است.");

    const { data: existingProfile } = await supabaseAdmin
      .from("profiles").select("id").eq("username", username).maybeSingle();
    if (existingProfile) throw new Error("این یوزرنیم قبلاً ثبت شده است.");

    const { data: existingReq } = await supabaseAdmin
      .from("signup_requests").select("id").eq("username", username)
      .in("status", ["pending", "approved"]).maybeSingle();
    if (existingReq) throw new Error("این یوزرنیم قبلاً درخواست داده است.");

    const email = toEmail(username);
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + planDurationMs(plansCfg, "trial"));

    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.password,
      email_confirm: true,
      user_metadata: { username, first_name: data.first_name, last_name: data.last_name, trial: true },
    });
    if (createErr || !created.user) throw new Error(publicSignupCreateUserError(createErr?.message));

    const { error: profileErr } = await supabaseAdmin.from("profiles").insert({
      id: created.user.id,
      username,
      first_name: data.first_name.trim(),
      last_name: data.last_name.trim(),
      plan: "trial",
      status: "active",
      start_date: startDate.toISOString(),
      end_date: endDate.toISOString(),
    });
    if (profileErr) {
      await supabaseAdmin.auth.admin.deleteUser(created.user.id).catch(() => {});
      throw new Error(publicSignupProfileError(profileErr.message));
    }

    await supabaseAdmin.from("user_roles").insert({ user_id: created.user.id, role: "user" });

    // Track trial request for audit; mark password_set so it can't be re-approved later
    await supabaseAdmin.from("signup_requests").insert({
      first_name: data.first_name.trim(),
      last_name: data.last_name.trim(),
      username,
      plan: "trial",
      payment_confirmed: true,
      status: "approved",
      password_set: true,
      reviewed_at: new Date().toISOString(),
    });

    return { success: true, email };
  });

// ─── Admin: signed URL for receipt image ─────────────────────────────────────
export const getReceiptSignedUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { path: string }) => {
    const path = String(d?.path ?? "");
    // مسیر را خود سرور موقع آپلود ساخته: `<user>/<timestamp>-<rand>.<ext>`.
    // این الگو جلوی path traversal و خواندن اشیای دلخواه باکت را می‌گیرد.
    if (!/^[a-z0-9_.-]{1,60}\/[a-zA-Z0-9._-]{1,80}$/.test(path) || path.includes("..")) {
      throw new Error("مسیر فایل نامعتبر است.");
    }
    return { path };
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await admin();

    // ─── تایید اینکه فایل واقعاً تصویر است ────────────────────────────────
    // نوع محتوا (content-type) هنگام آپلود توسط خود کلاینت تعیین می‌شود، پس
    // قابل اعتماد نیست: یک ثبت‌نام‌کننده‌ی ناشناس می‌توانست HTML آپلود کند و
    // اگر مدیر لینک را در تب باز می‌کرد، آن صفحه روی دامنه‌ی استوریج اجرا
    // می‌شد. اینجا بایت‌های ابتدایی فایل (magic number) بررسی می‌شود.
    const { data: blob, error: dlErr } = await supabaseAdmin.storage
      .from("receipts")
      .download(data.path);
    if (dlErr || !blob) throw new Error(dlErr?.message || "رسید یافت نشد.");
    const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    if (!isImageBytes(head)) {
      await auditLog(supabaseAdmin, {
        actor_id: context.userId,
        action: "receipt_rejected_not_image",
        target: data.path,
      });
      throw new Error("این فایل تصویر معتبری نیست و نمایش داده نمی‌شود.");
    }

    const { data: signed, error } = await supabaseAdmin
      .storage
      .from("receipts")
      .createSignedUrl(data.path, 3600);
    if (error) throw new Error(error.message);
    return { url: signed.signedUrl };
  });

/** تشخیص تصویر از روی بایت‌های ابتدایی — JPEG/PNG/GIF/WEBP/HEIC */
function isImageBytes(b: Uint8Array): boolean {
  if (b.length < 12) return false;
  const jpeg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  const png = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  const gif = b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38;
  const ascii = (i: number) => String.fromCharCode(b[i]!, b[i + 1]!, b[i + 2]!, b[i + 3]!);
  const webp = ascii(0) === "RIFF" && ascii(8) === "WEBP";
  // ftyp به‌تنهایی MP4/MOV را هم شامل می‌شود؛ فقط برندهای تصویر را بپذیر.
  const brand = ascii(8).toLowerCase();
  const heic =
    ascii(4) === "ftyp" &&
    ["heic", "heix", "heif", "hevc", "mif1", "msf1", "avif"].includes(brand);
  return jpeg || png || gif || webp || heic;
}

// ─── Admin: fetch signup requests enriched with phone from user_metadata ──────
// Works even before the phone column migration is applied — phone is always
// stored in auth user_metadata when a user registers.
export const adminGetRequestsWithPhone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: requests, error: reqErr }, { data: { users } }] = await Promise.all([
      supabaseAdmin.from("signup_requests").select("*").order("created_at", { ascending: false }),
      supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ]);
    if (reqErr) throw new Error(reqErr.message);

    // Build username → phone map from auth user_metadata (always present)
    const phoneMap: Record<string, string | null> = {};
    for (const u of users ?? []) {
      const uname = (u.user_metadata?.username as string | undefined)?.toLowerCase();
      if (uname && u.user_metadata?.phone) phoneMap[uname] = u.user_metadata.phone as string;
    }

    return (requests ?? []).map((r: Record<string, unknown>) => ({
      ...r,
      // Prefer DB phone column (after migration) over metadata
      phone: (r.phone as string | null) || phoneMap[(r.username as string)?.toLowerCase()] || null,
    }));
  });

// ─── Admin: reset a user's password ─────────────────────────────────────────
export const adminResetUserPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { user_id: string; new_password: string; admin_password: string }) => {
    if (!d.user_id) throw new Error("شناسه کاربر لازم است.");
    if (!d.admin_password) throw new Error("رمز ادمین لازم است.");
    return {
      user_id: d.user_id,
      new_password: validatePassword(d.new_password),
      admin_password: d.admin_password,
    };
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    if (data.user_id === context.userId) throw new Error("نمی‌توانید رمز خود را از اینجا تغییر دهید.");
    await requireAdminPassword(data.admin_password);
    const supabaseAdmin = await admin();
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, {
      password: data.new_password,
    });
    if (error) throw new Error(error.message);
    await auditLog(supabaseAdmin, {
      actor_id: context.userId, action: "user_password_reset", target: data.user_id,
    });
    return { success: true };
  });

// ─── Admin: fetch phone map (username → phone) for all users ─────────────────
// ─── Admin: clear a signup request's temp password after using it ────────────
// بعد از اینکه ادمین پیام خوش‌آمدگویی را (خودکار یا دستی) فرستاد، رمز موقت را
// از دیتابیس پاک می‌کند تا برای مدت طولانی به‌صورت متن ساده نگه داشته نشود.
export const adminClearSignupTempPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => {
    if (!d.id) throw new Error("شناسه درخواست لازم است.");
    return d;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await clearTempPassword(supabaseAdmin, data.id);
    return { success: true };
  });

export const adminGetUserPhones = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: { users } } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const map: Record<string, string | null> = {};
    for (const u of users ?? []) {
      const uname = (u.user_metadata?.username as string | undefined)?.toLowerCase();
      const phone = (u.user_metadata?.phone as string | undefined) || null;
      if (uname) map[uname] = phone;
    }
    return map;
  });

// ─── Admin: update full per-plan configuration (enabled/price/duration/discount) ──
export const updatePlanConfigs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { plans: PlansConfig }) => {
    if (!d?.plans || typeof d.plans !== "object") throw new Error("داده‌های پلن نامعتبر است.");
    return d;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const normalized = normalizePlans(data.plans);
    // Mirror paid-plan prices into legacy price_* columns so older readers stay in sync.
    const { error } = await supabaseAdmin
      .from("app_settings")
      .update({
        plans: normalized as any,
        price_1month: normalized["1month"].price,
        price_3month: normalized["3month"].price,
        price_6month: normalized["6month"].price,
        price_12month: normalized["12month"].price,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);
    if (error) throw new Error(error.message);
    invalidatePublicSettings();
    return { success: true };
  });

// ─── User: submit a renewal request (extends current account, no new signup) ──
export const submitRenewalRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { plan: Plan; receipt_url?: string | null; receipt_note?: string | null; payment_confirmed: boolean }) => {
      if (!PAID_PLANS.includes(d.plan)) throw new Error("پلن نامعتبر است.");
      // یا عکس رسید، یا اطلاعات متنی واریز — یکی از این دو الزامی است
      if (!d.receipt_url && !d.receipt_note?.trim()) {
        throw new Error("لطفاً عکس رسید پرداخت را آپلود کنید یا کد پیگیری و تاریخ واریز را بنویسید.");
      }
      if (!d.payment_confirmed) throw new Error("لطفاً تایید کنید که پرداخت انجام شده است.");
      return d;
    },
  )
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await admin();
    await enforceRateLimit(supabaseAdmin, "renewal", context.userId, 5, 3600);

    const plansCfg = await loadPlansConfig(supabaseAdmin);
    if (!plansCfg[data.plan]?.enabled) throw new Error("این پلن در حال حاضر غیرفعال است.");

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, username, first_name, last_name")
      .eq("id", context.userId)
      .maybeSingle();
    if (!profile) throw new Error("پروفایل یافت نشد.");

    // اگر درخواست تمدید فعال (در انتظار) از قبل دارد، اجازه ارسال دوباره نده
    const { data: existing } = await supabaseAdmin
      .from("signup_requests")
      .select("id")
      .eq("target_user_id", context.userId)
      .eq("request_type", "renewal")
      .eq("status", "pending")
      .maybeSingle();
    if (existing) throw new Error("درخواست تمدید قبلی شما هنوز در انتظار بررسی است.");

    const renewalBase = {
      first_name: profile.first_name || "",
      last_name: profile.last_name || "",
      username: profile.username,
      plan: data.plan,
      payment_confirmed: data.payment_confirmed,
      receipt_url: data.receipt_url ?? null,
      password_set: true,
      request_type: "renewal",
      target_user_id: context.userId,
    };
    const note = data.receipt_note?.trim().slice(0, 500);

    let result = await supabaseAdmin
      .from("signup_requests")
      .insert((note ? { ...renewalBase, receipt_note: note } : renewalBase) as any)
      .select("id")
      .single();

    // اگر ستون receipt_note هنوز مهاجرت نشده، بدون آن دوباره تلاش کن تا
    // درخواست تمدید کاربر هرگز به‌خاطر مهاجرت انجام‌نشده شکست نخورد.
    if (note && /receipt_note/i.test(result.error?.message || "")) {
      result = await supabaseAdmin
        .from("signup_requests")
        .insert(renewalBase as any)
        .select("id")
        .single();
    }
    if (result.error) throw new Error(result.error.message);
    return { id: result.data.id };
  });

// ─── Public: payment + plans info for signup/renew pages ─────────────────────
// Returns only safe payment display fields and the active plans config.
// Used by anon and authenticated users so we can keep the underlying table
// locked down behind admin-only RLS.
export const getPublicSettings = createServerFn({ method: "GET" }).handler(async () => {
  if (publicSettingsCache && Date.now() - publicSettingsCache.at < PUBLIC_SETTINGS_TTL_MS) {
    return { ...publicSettingsCache.value, turnstile_site_key: getTurnstileSiteKey() };
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("card_number, card_holder, bank_name, plans")
    .eq("id", 1)
    .maybeSingle();
  const value: PublicSettings = {
    card_number: (data as any)?.card_number ?? "",
    card_holder: (data as any)?.card_holder ?? "",
    bank_name: (data as any)?.bank_name ?? "",
    plans: normalizePlans((data as any)?.plans),
  };
  publicSettingsCache = { at: Date.now(), value };
  return { ...value, turnstile_site_key: getTurnstileSiteKey() };
});

function normalizeIranPhone(p: string): string {
  return p.replace(/\s+/g, "").replace(/^\+98/, "0").replace(/^98/, "0");
}

// ─── Public: submit password recovery request ────────────────────────────────
// فقط نام، نام خانوادگی و شماره ثبت می‌شود تا ادمین در پنل ببیند.
// عوض کردن رمز از همین‌جا انجام نمی‌شود — ادمین از تب کاربران رمز را دستی تغییر می‌دهد.
export const submitPasswordResetRequest = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      first_name: string;
      last_name: string;
      phone: string;
      turnstile_token?: string | null;
    }) => {
    const first_name = requireName(d.first_name, "نام");
    const last_name = requireName(d.last_name, "نام خانوادگی");
    const phone = normalizeIranPhone(d.phone || "");
    if (!/^09\d{9}$/.test(phone)) throw new Error("شماره موبایل را به‌صورت ۰۹xxxxxxxxx وارد کنید.");
    return { first_name, last_name, phone, turnstile_token: d.turnstile_token ?? null };
  })
  .handler(async ({ data }) => {
    await assertTurnstileToken(data.turnstile_token);
    const supabaseAdmin = await admin();
    const resetCaps = passwordResetRateCaps(isTurnstileConfigured());
    // بدون سقف، این فرم عمومی می‌تواند جدول را پر کند و پنل ادمین را
    // با درخواست‌های جعلی «بازیابی رمز» غرق کند.
    await enforceRateLimit(
      supabaseAdmin,
      "pwd-reset",
      clientIp(),
      resetCaps.ipMax,
      resetCaps.ipWindow,
    );

    const { data: recentRows } = await supabaseAdmin
      .from("password_reset_requests")
      .select("id")
      .eq("phone", data.phone)
      .eq("status", "pending")
      .gte("created_at", new Date(Date.now() - 30 * 60 * 1000).toISOString())
      .limit(1);
    const recent = recentRows?.[0];
    if (recent) {
      return { id: recent.id as string, alreadyPending: true };
    }

    const insert = await supabaseAdmin
      .from("password_reset_requests")
      .insert({
        first_name: data.first_name,
        last_name: data.last_name,
        phone: data.phone,
        status: "pending",
      })
      .select("id")
      .single();
    if (insert.error) throw new Error(insert.error.message);
    return { id: insert.data.id as string, alreadyPending: false };
  });

export type PasswordResetRequestRow = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  status: "pending" | "resolved" | "rejected";
  created_at: string;
  reviewed_at: string | null;
};

export const adminListPasswordResetRequests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("password_reset_requests")
      .select("id, first_name, last_name, phone, status, created_at, reviewed_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []) as PasswordResetRequestRow[];
  });

/** فقط وضعیت درخواست را «انجام شد» می‌کند — رمز را تغییر نمی‌دهد. */
export const adminAckPasswordReset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => {
    if (!d.id) throw new Error("شناسه درخواست لازم است.");
    return d;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("password_reset_requests")
      .update({
        status: "resolved",
        reviewed_at: new Date().toISOString(),
        resolved_by: context.userId,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { success: true };
  });

const USER_DATA_FIELDS = [
  "products",
  "categories",
  "invoices",
  "current_invoice",
  "settings",
  "customers",
  "students",
  "purchases",
  "expenses",
  "reminders",
  "accounts",
  "account_txs",
  "production",
  "manual_ledger",
] as const;

function previewFromRow(row: Record<string, unknown> | null | undefined) {
  const products = Array.isArray(row?.products) ? (row!.products as { name?: unknown }[]) : [];
  const invoices = Array.isArray(row?.invoices) ? (row!.invoices as unknown[]) : [];
  return {
    product_count: products.length,
    invoice_count: invoices.length,
    sample_names: products
      .slice(0, 10)
      .map((p) => String(p?.name ?? "").trim())
      .filter(Boolean),
  };
}

export type UserDataBackupPreview = {
  id: string;
  created_at: string;
  product_count: number;
  invoice_count: number;
  sample_names: string[];
};

export const adminListUserDataBackups = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { user_id: string }) => {
    if (!d.user_id) throw new Error("شناسه کاربر لازم است.");
    return { user_id: d.user_id };
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await admin();
    const [{ data: live }, { data: rows, error }] = await Promise.all([
      supabaseAdmin.from("user_data").select("*").eq("user_id", data.user_id).maybeSingle(),
      supabaseAdmin
        .from("user_data_backups")
        .select("id, created_at, snapshot")
        .eq("user_id", data.user_id)
        .order("created_at", { ascending: false })
        .limit(40),
    ]);
    if (error) throw new Error(error.message);
    const backups: UserDataBackupPreview[] = (rows ?? []).map((r: { id: string; created_at: string; snapshot: unknown }) => ({
      id: r.id,
      created_at: r.created_at,
      ...previewFromRow((r.snapshot || {}) as Record<string, unknown>),
    }));
    return {
      live: previewFromRow((live || {}) as Record<string, unknown>),
      backups,
    };
  });

export const adminRestoreUserDataBackup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { user_id: string; backup_id: string; admin_password: string }) => {
    if (!d.user_id) throw new Error("شناسه کاربر لازم است.");
    if (!d.backup_id) throw new Error("شناسه نسخه پشتیبان لازم است.");
    if (!d.admin_password) throw new Error("رمز ادمین لازم است.");
    return d;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    await requireAdminPassword(data.admin_password);
    const supabaseAdmin = await admin();
    await enforceRateLimit(
      supabaseAdmin,
      "admin-restore",
      context.userId,
      20,
      3600,
      "تعداد بازیابی در این ساعت به سقف رسیده است.",
    );

    const { data: backup, error: bErr } = await supabaseAdmin
      .from("user_data_backups")
      .select("id, user_id, snapshot, created_at")
      .eq("id", data.backup_id)
      .maybeSingle();
    if (bErr || !backup) throw new Error(bErr?.message || "نسخه پشتیبان یافت نشد.");
    if (backup.user_id !== data.user_id) throw new Error("این نسخه متعلق به این کاربر نیست.");

    const snap = (backup.snapshot || {}) as Record<string, unknown>;
    const { data: live } = await supabaseAdmin
      .from("user_data")
      .select("*")
      .eq("user_id", data.user_id)
      .maybeSingle();
    if (live) {
      await supabaseAdmin
        .from("user_data_backups")
        .insert({ user_id: data.user_id, snapshot: live })
        .then(() => {}, () => {});
    }

    const payload: Record<string, unknown> = {
      user_id: data.user_id,
      updated_at: new Date().toISOString(),
    };
    for (const field of USER_DATA_FIELDS) {
      if (field in snap) payload[field] = snap[field];
    }

    const { error: upErr } = await supabaseAdmin
      .from("user_data")
      .upsert(payload as never, { onConflict: "user_id" });
    if (upErr) throw new Error(upErr.message);

    await auditLog(supabaseAdmin, {
      actor_id: context.userId,
      action: "user_data_restored",
      target: data.user_id,
      detail: { backup_id: data.backup_id, backup_at: backup.created_at },
    });
    return { success: true, restored_at: backup.created_at as string };
  });

