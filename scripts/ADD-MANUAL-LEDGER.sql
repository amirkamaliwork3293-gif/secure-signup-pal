-- اگر دکمه «ادغام امن همه نسخه‌ها» خطای schema cache برای manual_ledger داد،
-- این ۳ خط را در SQL Editor سوپابیس Run کنید، بعد دوباره همان دکمه را بزنید.
-- این کار دادهٔ کاربران را پاک نمی‌کند؛ فقط ستون دفتر دستی را اگر نباشد می‌سازد.

ALTER TABLE public.user_data
  ADD COLUMN IF NOT EXISTS manual_ledger jsonb NOT NULL DEFAULT '[]'::jsonb;

NOTIFY pgrst, 'reload schema';
