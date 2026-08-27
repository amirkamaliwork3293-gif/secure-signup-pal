-- ════════════════════════════════════════════════════════════════════════════
-- سخت‌سازی امنیتی مرحله ۲ — رفع قفل ثبت‌نام + دفاع در برابر حذف دسته‌جمعی
--
-- این فایل عمداً خودکفاست: اگر مهاجرت ۲۰۲۶۰۸۲۷ هنوز روی دیتابیس اعمال نشده
-- باشد، زیرساخت rate_limits همین‌جا ساخته می‌شود تا ثبت‌نام با پیام
-- «تعداد درخواست بیش از حد مجاز» قفل نماند.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── ۱. زیرساخت محدودیت نرخ (idempotent) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rate_limits (
  bucket       text PRIMARY KEY,
  count        integer NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rate_limits_window_idx ON public.rate_limits (window_start);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rate_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.rate_limits TO service_role;

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

  IF random() < 0.01 THEN
    DELETE FROM public.rate_limits WHERE window_start < now() - interval '24 hours';
  END IF;

  RETURN cur_count <= _max;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, integer, integer) TO service_role;

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

-- سطل‌های پرشده از سیل ثبت‌نام قبلی را خالی می‌کنیم تا کاربر واقعی بتواند
-- بلافاصله ثبت‌نام کند. سقف جدید سراسری جلوی تکرار حمله را می‌گیرد.
DELETE FROM public.rate_limits
 WHERE bucket LIKE 'signup%'
    OR bucket LIKE 'trial%'
    OR bucket LIKE 'receipt%'
    OR bucket LIKE 'pwd-reset%'
    OR bucket LIKE 'check-status%'
    OR bucket LIKE 'set-password%';

-- ─── ۲. سیاست‌های باقی‌مانده‌ی باز ──────────────────────────────────────
-- همه‌ی نوشتن‌ها از server function با service_role است.
DROP POLICY IF EXISTS "anyone_create_signup_request" ON public.signup_requests;
DROP POLICY IF EXISTS "anyone_read_own_request_by_username" ON public.signup_requests;
DROP POLICY IF EXISTS "anyone_upload_receipts" ON storage.objects;
DROP POLICY IF EXISTS anyone_upload_receipts ON storage.objects;

-- ادمین دیگر از کلاینت (JWT) پروفایل/تنظیمات را آپدیت نمی‌کند؛ اگر GRANT
-- اشتباهاً برگردد، این policy نباید مسیر میان‌بر بسازد.
DROP POLICY IF EXISTS "admins_update_profiles" ON public.profiles;
DROP POLICY IF EXISTS "admins_update_settings" ON public.app_settings;
DROP POLICY IF EXISTS "admins_update_requests" ON public.signup_requests;

REVOKE ALL ON public.signup_requests FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.signup_requests FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.profiles FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.app_settings FROM authenticated;
REVOKE SELECT ON public.app_settings FROM anon;

-- ادمین هنوز از کلاینت فهرست پروفایل‌ها را می‌خواند
GRANT SELECT ON public.profiles TO authenticated;
GRANT SELECT ON public.signup_requests TO authenticated;
GRANT SELECT ON public.app_settings TO authenticated;

-- ─── ۳. جلوگیری از ارتقای نقش به ادمین از سمت کلاینت ───────────────────
CREATE OR REPLACE FUNCTION public.guard_user_roles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.role = 'admin' AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'admin role can only be granted by service_role';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_user_roles_ins ON public.user_roles;
CREATE TRIGGER guard_user_roles_ins
  BEFORE INSERT OR UPDATE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.guard_user_roles();

REVOKE ALL ON public.user_roles FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.user_roles FROM authenticated;
GRANT SELECT ON public.user_roles TO authenticated;

-- ─── ۴. IP ثبت‌نام برای ردگیری سیل ──────────────────────────────────────
ALTER TABLE public.signup_requests ADD COLUMN IF NOT EXISTS client_ip text;
CREATE INDEX IF NOT EXISTS signup_requests_phone_created_idx
  ON public.signup_requests (phone, created_at DESC);

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id   uuid,
  action     text NOT NULL,
  target     text,
  detail     jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip         text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_audit_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.admin_audit_log TO service_role;
GRANT SELECT ON public.admin_audit_log TO authenticated;
DROP POLICY IF EXISTS "admins_read_audit_log" ON public.admin_audit_log;
CREATE POLICY "admins_read_audit_log" ON public.admin_audit_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ─── ۵. تثبیت search_path ───────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'has_role'
  ) THEN
    EXECUTE 'ALTER FUNCTION public.has_role(uuid, public.app_role) SET search_path = public, pg_temp';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_subscription_active'
  ) THEN
    EXECUTE 'ALTER FUNCTION public.is_subscription_active(uuid) SET search_path = public, pg_temp';
  END IF;
END $$;
