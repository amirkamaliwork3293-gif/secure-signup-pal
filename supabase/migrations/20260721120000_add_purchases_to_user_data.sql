-- بخش فاکتور خرید: ستون جدید برای همگام‌سازی ابری داده‌ی فاکتورهای خرید هر کاربر.
-- (اگر این مهاجرت هنوز اعمال نشده باشد، کلاینت به‌صورت امن فقط محلی ذخیره می‌کند.)
ALTER TABLE public.user_data
  ADD COLUMN IF NOT EXISTS purchases jsonb NOT NULL DEFAULT '[]'::jsonb;
