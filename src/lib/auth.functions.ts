/**
 * Server functions for auth, signup requests, admin approvals, and settings.
 * All admin-only operations execute with the service role and verify caller role.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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

const ADMIN_USERNAME = "Amirkamali";
const ADMIN_PASSWORD = "Amir8413293";
const ADMIN_EMAIL = "amirkamali@kamali.local";

function toEmail(username: string) {
  return `${username.trim().toLowerCase()}@kamali.local`;
}

// ─── Public: submit signup request ───────────────────────────────────────────
export const submitSignupRequest = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      first_name: string;
      last_name: string;
      username: string;
      plan: Plan;
      payment_confirmed: boolean;
      receipt_url?: string | null;
    }) => {
      if (!d.first_name?.trim() || !d.last_name?.trim()) throw new Error("نام و نام خانوادگی الزامی است.");
      if (!d.username?.trim() || !/^[a-zA-Z0-9_-]{3,32}$/.test(d.username)) {
        throw new Error("یوزرنیم باید ۳ تا ۳۲ کاراکتر و فقط شامل حروف انگلیسی، عدد، _ و - باشد.");
      }
      if (!VALID_PLANS.includes(d.plan)) throw new Error("پلن نامعتبر است.");
      if (d.plan === "trial") throw new Error("برای نسخه تست از فرم اختصاصی استفاده کنید.");
      if (!d.payment_confirmed) throw new Error("لطفاً تایید کنید که پرداخت انجام شده است.");
      if (!d.receipt_url) throw new Error("لطفاً عکس رسید پرداخت را آپلود کنید.");
      if (d.username.toLowerCase() === ADMIN_USERNAME.toLowerCase()) {
        throw new Error("این یوزرنیم رزرو شده است.");
      }
      return d;
    },
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Check username not already taken (profile or pending request)
    const { data: existingProfile } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("username", data.username.toLowerCase())
      .maybeSingle();
    if (existingProfile) throw new Error("این یوزرنیم قبلاً ثبت شده است.");

    const { data: existingReq } = await supabaseAdmin
      .from("signup_requests")
      .select("id, status")
      .eq("username", data.username.toLowerCase())
      .in("status", ["pending", "approved"])
      .maybeSingle();
    if (existingReq) {
      throw new Error(
        existingReq.status === "pending"
          ? "درخواست شما قبلاً ثبت شده و در انتظار تایید است."
          : "این یوزرنیم تایید شده — لطفاً وارد شوید یا رمز عبور را تنظیم کنید.",
      );
    }

    const { data: inserted, error } = await supabaseAdmin
      .from("signup_requests")
      .insert({
        first_name: data.first_name.trim(),
        last_name: data.last_name.trim(),
        username: data.username.trim().toLowerCase(),
        plan: data.plan,
        payment_confirmed: data.payment_confirmed,
        receipt_url: data.receipt_url ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    return { id: inserted.id };
  });

// ─── Public: check request status (for set-password page) ────────────────────
export const checkRequestStatus = createServerFn({ method: "POST" })
  .inputValidator((d: { username: string }) => {
    if (!d.username?.trim()) throw new Error("یوزرنیم الزامی است.");
    return d;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
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
  .inputValidator((d: { username: string; password: string }) => {
    if (!d.username?.trim()) throw new Error("یوزرنیم الزامی است.");
    if (!d.password || d.password.length < 6) throw new Error("رمز عبور باید حداقل ۶ کاراکتر باشد.");
    return d;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const username = data.username.trim().toLowerCase();

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
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + PLAN_DURATION_MS[plan]);

    // Create auth user
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.password,
      email_confirm: true,
      user_metadata: { username, first_name: req.first_name, last_name: req.last_name },
    });
    if (createErr || !created.user) throw new Error(createErr?.message || "خطا در ایجاد حساب.");

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

// ─── Admin bootstrap: ensure the hardcoded admin user exists ─────────────────
export const ensureAdminAccount = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Try sign in via listUsers
  const { data: existingList } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
  let admin = existingList?.users.find((u) => u.email === ADMIN_EMAIL);

  if (!admin) {
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      email_confirm: true,
      user_metadata: { username: ADMIN_USERNAME },
    });
    if (error || !created.user) throw new Error(error?.message || "خطا در ساخت ادمین.");
    admin = created.user;
  } else {
    // Force password to canonical value (hardcoded)
    await supabaseAdmin.auth.admin.updateUserById(admin.id, { password: ADMIN_PASSWORD });
  }

  // Ensure profile row
  await supabaseAdmin
    .from("profiles")
    .upsert(
      {
        id: admin.id,
        username: ADMIN_USERNAME.toLowerCase(),
        first_name: "Amir",
        last_name: "Kamali",
        status: "active" as const,
      },
      { onConflict: "id" },
    );

  // Ensure admin role
  await supabaseAdmin
    .from("user_roles")
    .upsert({ user_id: admin.id, role: "admin" }, { onConflict: "user_id,role" });

  return { email: ADMIN_EMAIL };
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

export const approveSignupRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => {
    if (!d.id) throw new Error("شناسه درخواست لازم است.");
    return d;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("signup_requests")
      .update({ status: "approved", reviewed_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
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
    const { error } = await supabaseAdmin
      .from("signup_requests")
      .update({ status: "rejected", reviewed_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
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
    const start = new Date();
    const end = new Date(start.getTime() + PLAN_DURATION_MS[data.plan]);
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
    return { success: true };
  });

export const deleteUserAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { user_id: string }) => {
    if (!d.user_id) throw new Error("شناسه کاربر لازم است.");
    return d;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    if (data.user_id === context.userId) throw new Error("نمی‌توانید حساب خود را حذف کنید.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.auth.admin.deleteUser(data.user_id);
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
    return { success: true };
  });

// ─── Public: create a 1-hour trial account (no admin approval) ───────────────
export const createTrialAccount = createServerFn({ method: "POST" })
  .inputValidator((d: { first_name: string; last_name: string; username: string; password: string }) => {
    if (!d.first_name?.trim() || !d.last_name?.trim()) throw new Error("نام و نام خانوادگی الزامی است.");
    if (!d.username?.trim() || !/^[a-zA-Z0-9_-]{3,32}$/.test(d.username)) {
      throw new Error("یوزرنیم باید ۳ تا ۳۲ کاراکتر و فقط شامل حروف انگلیسی، عدد، _ و - باشد.");
    }
    if (!d.password || d.password.length < 6) throw new Error("رمز عبور باید حداقل ۶ کاراکتر باشد.");
    if (d.username.toLowerCase() === ADMIN_USERNAME.toLowerCase()) throw new Error("این یوزرنیم رزرو شده است.");
    return d;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const username = data.username.trim().toLowerCase();

    const { data: existingProfile } = await supabaseAdmin
      .from("profiles").select("id").eq("username", username).maybeSingle();
    if (existingProfile) throw new Error("این یوزرنیم قبلاً ثبت شده است.");

    const { data: existingReq } = await supabaseAdmin
      .from("signup_requests").select("id").eq("username", username)
      .in("status", ["pending", "approved"]).maybeSingle();
    if (existingReq) throw new Error("این یوزرنیم قبلاً درخواست داده است.");

    const email = toEmail(username);
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + PLAN_DURATION_MS.trial);

    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.password,
      email_confirm: true,
      user_metadata: { username, first_name: data.first_name, last_name: data.last_name, trial: true },
    });
    if (createErr || !created.user) throw new Error(createErr?.message || "خطا در ایجاد حساب.");

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
    if (profileErr) throw new Error(profileErr.message);

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
    if (!d.path) throw new Error("مسیر فایل لازم است.");
    return d;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error } = await supabaseAdmin
      .storage
      .from("receipts")
      .createSignedUrl(data.path, 3600);
    if (error) throw new Error(error.message);
    return { url: signed.signedUrl };
  });
