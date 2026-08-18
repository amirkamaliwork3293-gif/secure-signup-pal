-- درخواست بازیابی رمز عبور (ارسال از فرم عمومی، بررسی فقط توسط ادمین)
CREATE TABLE IF NOT EXISTS public.password_reset_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  last_name text NOT NULL,
  phone text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'resolved', 'rejected')),
  matched_user_id uuid,
  matched_username text,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  resolved_by uuid
);

ALTER TABLE public.password_reset_requests ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.password_reset_requests TO service_role;
GRANT SELECT ON public.password_reset_requests TO authenticated;

DROP POLICY IF EXISTS "admins_read_password_reset_requests" ON public.password_reset_requests;
CREATE POLICY "admins_read_password_reset_requests"
ON public.password_reset_requests
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS password_reset_requests_status_idx
  ON public.password_reset_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS password_reset_requests_phone_idx
  ON public.password_reset_requests (phone);

-- لاگ تولید/فرمول ساخت محصول (همگام با localStorage کاربر)
ALTER TABLE public.user_data
  ADD COLUMN IF NOT EXISTS production jsonb NOT NULL DEFAULT '[]'::jsonb;
