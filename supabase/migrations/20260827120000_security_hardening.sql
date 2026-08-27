-- ════════════════════════════════════════════════════════════════════════════
-- سخت‌سازی امنیتی — پس از حادثه‌ی نفوذ (۱۴۰۵/۰۶/۰۵ — 2026-08-27)
--
-- Security hardening after the admin-panel breach. Covers:
--   1. Server-side rate limiting primitive (shared by every public endpoint)
--   2. Removal of plaintext password storage (signup_requests.temp_password)
--   3. Revoking grants that no code path needs any more
--   4. Admin action audit log (so a future breach is visible, not silent)
--   5. Hardening SECURITY DEFINER functions against search_path hijacking
-- ════════════════════════════════════════════════════════════════════════════

-- ─── ۱. محدودسازی نرخ درخواست (Rate limiting) ───────────────────────────────
-- تنها زیرساخت مشترک برای همه‌ی endpointهای عمومی. کلید (bucket) ترکیبی از
-- نام عملیات و شناسه‌ی درخواست‌کننده (IP یا user id) است.
CREATE TABLE IF NOT EXISTS public.rate_limits (
  bucket       text PRIMARY KEY,
  count        integer NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rate_limits_window_idx ON public.rate_limits (window_start);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
-- بدون هیچ policy: فقط service_role (که RLS را دور می‌زند) دسترسی دارد.
REVOKE ALL ON public.rate_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.rate_limits TO service_role;

-- افزایش اتمیک شمارنده و بازگرداندن «آیا مجاز است؟».
-- کل عملیات در یک INSERT ... ON CONFLICT انجام می‌شود تا زیر بار همزمان
-- (۳۰۰ درخواست در یک لحظه) هیچ race conditionای شمارش را از دست ندهد.
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  _bucket text,
  _max integer,
  _window_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  cur_count integer;
BEGIN
  INSERT INTO public.rate_limits AS rl (bucket, count, window_start)
  VALUES (_bucket, 1, now())
  ON CONFLICT (bucket) DO UPDATE
    SET count = CASE
          WHEN rl.window_start < now() - make_interval(secs => _window_seconds) THEN 1
          ELSE rl.count + 1
        END,
        window_start = CASE
          WHEN rl.window_start < now() - make_interval(secs => _window_seconds) THEN now()
          ELSE rl.window_start
        END
  RETURNING rl.count INTO cur_count;

  -- پاک‌سازی فرصت‌طلبانه‌ی سطرهای کهنه تا جدول بی‌نهایت رشد نکند
  -- (۱٪ درخواست‌ها؛ ارزان‌تر از یک cron job جداگانه).
  IF random() < 0.01 THEN
    DELETE FROM public.rate_limits WHERE window_start < now() - interval '24 hours';
  END IF;

  RETURN cur_count <= _max;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, integer, integer) TO service_role;

-- قفل کامل (نه فقط شمارش) — برای ورود ادمین پس از چند تلاش ناموفق.
CREATE OR REPLACE FUNCTION public.is_locked_out(_bucket text, _max integer, _window_seconds integer)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.rate_limits
     WHERE bucket = _bucket
       AND count >= _max
       AND window_start > now() - make_interval(secs => _window_seconds)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_locked_out(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_locked_out(text, integer, integer) TO service_role;

-- پاک‌کردن شمارنده پس از ورود موفق
CREATE OR REPLACE FUNCTION public.clear_rate_limit(_bucket text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  DELETE FROM public.rate_limits WHERE bucket = _bucket;
$$;

REVOKE EXECUTE ON FUNCTION public.clear_rate_limit(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_rate_limit(text) TO service_role;

-- ─── ۲. حذف ذخیره‌سازی رمز به‌صورت متن ساده ─────────────────────────────────
-- رمز انتخابی کاربر در ستون temp_password ذخیره و در پنل ادمین نمایش داده
-- می‌شد. هرکس به پنل نفوذ کند رمز همه‌ی کاربران در انتظار را برمی‌دارد.
UPDATE public.signup_requests SET temp_password = NULL WHERE temp_password IS NOT NULL;
ALTER TABLE public.signup_requests DROP COLUMN IF EXISTS temp_password;

-- ─── ۳. لغو دسترسی‌هایی که هیچ مسیر کدی به آن‌ها نیاز ندارد ─────────────────
-- همه‌ی نوشتن‌ها روی این جدول‌ها از طریق server function با service role
-- انجام می‌شود. GRANT بدون policy عملاً بی‌اثر است، اما لغو آن یک لایه‌ی
-- دفاعی اضافه است: اگر روزی policy اشتباهی اضافه شود، GRANT جلوی آن را می‌گیرد.
REVOKE INSERT, SELECT ON public.signup_requests FROM anon;
REVOKE INSERT, UPDATE ON public.signup_requests FROM authenticated;
REVOKE INSERT, UPDATE ON public.profiles FROM authenticated;

-- app_settings شامل شماره کارت و پیکربندی پلن‌هاست؛ خواندن عمومی لازم نیست
-- (مقادیر عمومی از طریق server function getPublicSettings ارائه می‌شود).
REVOKE SELECT ON public.app_settings FROM anon;

-- ─── ۴. گزارش عملیات ادمین (Audit log) ──────────────────────────────────────
-- نفوذ قبلی هیچ ردی نگذاشت. از این پس هر عملیات حساس ادمین ثبت می‌شود.
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id   uuid,
  action     text NOT NULL,
  target     text,
  detail     jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip         text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_log_created_idx ON public.admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_actor_idx ON public.admin_audit_log (actor_id, created_at DESC);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_audit_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.admin_audit_log TO service_role;

-- ادمین می‌تواند گزارش را بخواند (اما نه تغییر دهد — حتی ادمین)
GRANT SELECT ON public.admin_audit_log TO authenticated;
DROP POLICY IF EXISTS "admins_read_audit_log" ON public.admin_audit_log;
CREATE POLICY "admins_read_audit_log" ON public.admin_audit_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ─── ۵. تثبیت search_path روی توابع SECURITY DEFINER ────────────────────────
-- بدون SET search_path، یک تابع SECURITY DEFINER می‌تواند با ساختن schema
-- جعلی توسط کاربر ربوده شود. has_role و is_subscription_active از قبل درست
-- بودند؛ اینجا فقط تضمین می‌کنیم که همچنان تنظیم باشند.
ALTER FUNCTION public.has_role(uuid, public.app_role) SET search_path = public, pg_temp;
ALTER FUNCTION public.is_subscription_active(uuid) SET search_path = public, pg_temp;

-- ─── ۶. ایندکس‌های لازم برای مسیرهای امنیتی پرتکرار ─────────────────────────
CREATE INDEX IF NOT EXISTS signup_requests_username_status_idx
  ON public.signup_requests (username, status);
CREATE INDEX IF NOT EXISTS signup_requests_created_idx
  ON public.signup_requests (created_at DESC);
