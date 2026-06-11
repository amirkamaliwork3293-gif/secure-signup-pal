-- بخش مشتریان/بدهکاران: ستون جدید برای همگام‌سازی ابری داده مشتریان هر کاربر.
-- (اگر این مهاجرت هنوز اعمال نشده باشد، کلاینت به‌صورت امن فقط محلی ذخیره می‌کند.)
ALTER TABLE public.user_data
  ADD COLUMN IF NOT EXISTS customers jsonb NOT NULL DEFAULT '[]'::jsonb;
