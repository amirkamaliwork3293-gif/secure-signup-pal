-- اطمینان از وجود ستون متن رسید (کد پیگیری + تاریخ و ساعت واریز).
-- اگر این ستون در دیتابیس نباشد، متن رسید ثبت‌نام/تمدید در پنل مدیر دیده نمی‌شود.
-- فقط افزودنی و idempotent است: اگر ستون وجود دارد هیچ کاری نمی‌کند و هیچ داده‌ای حذف نمی‌شود.
ALTER TABLE public.signup_requests
  ADD COLUMN IF NOT EXISTS receipt_note text;

-- PostgREST کش schema را تازه کند تا ستون فوراً قابل استفاده باشد.
NOTIFY pgrst, 'reload schema';
