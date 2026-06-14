-- شماره موبایل اختیاری در درخواست‌های ثبت‌نام
ALTER TABLE public.signup_requests
  ADD COLUMN IF NOT EXISTS phone text;
