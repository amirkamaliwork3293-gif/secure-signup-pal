-- ماژول پیامک (ملی‌پیامک) — تغییرات همگی افزودنی‌اند و هیچ ستون/جدول موجودی را عوض نمی‌کنند.
--
-- ۱) temp_password: رمز انتخابی کاربر تا لحظه‌ی تایید مدیر نگه داشته می‌شود تا بتوان
--    آن را در پیامک خوش‌آمدگویی فرستاد، و بلافاصله بعد از ارسال NULL می‌شود.
-- ۲) reminder_sent_for: تاریخ انقضایی که برای آن یادآوری فرستاده شده (جلوگیری از پیامک تکراری).
-- ۳) password_reset_otps: کد ۴ رقمی «فراموشی رمز» — فقط سرویس‌رول دسترسی دارد.

ALTER TABLE public.signup_requests ADD COLUMN IF NOT EXISTS temp_password text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS reminder_sent_for timestamptz;

CREATE TABLE IF NOT EXISTS public.password_reset_otps (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username    text NOT NULL,
  phone       text NOT NULL,
  code_hash   text NOT NULL,
  expires_at  timestamptz NOT NULL,
  attempts    integer NOT NULL DEFAULT 0,
  verified_at timestamptz,
  reset_token text,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_otps_username
  ON public.password_reset_otps (username, created_at DESC);

-- RLS روشن و بدون هیچ policy ⇒ فقط service role (server function) می‌تواند بخواند/بنویسد.
ALTER TABLE public.password_reset_otps ENABLE ROW LEVEL SECURITY;
