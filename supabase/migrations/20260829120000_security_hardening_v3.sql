-- ════════════════════════════════════════════════════════════════════════════
-- سخت‌سازی تکمیلی — ممیزی پس از حادثه (additive / idempotent)
--
-- ۱) سقف نوع فایل روی باکت‌های آپلود (فقط تصویر؛ SVG عمداً نیست)
-- ۲) WITH CHECK صریح روی UPDATE منو تا user_id قابل تغییر نباشد
-- ۳) لغو GRANTهای پیش‌فرض روی جدول‌هایی که فقط service_role باید ببیند
-- ════════════════════════════════════════════════════════════════════════════

-- ─── ۱. نوع فایل مجاز روی استوریج ────────────────────────────────────────
-- محدودیت حجم از قبل هست؛ نوع محتوا اگر خالی بماند، کلاینت می‌تواند
-- HTML/SVG را با پسوند jpg آپلود کند و روی دامنهٔ استوریج میزبانی کند.
UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'
]
WHERE id = 'receipts';

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'
]
WHERE id IN ('store-assets', 'menu-images');

-- ─── ۲. جلوگیری از تغییر مالک ردیف منو ──────────────────────────────────
-- PostgreSQL اگر WITH CHECK نباشد همان USING را برای ردیف جدید هم به کار
-- می‌برد؛ این‌جا صریح می‌نویسیم تا بعداً کسی policy را شل نکند.
DROP POLICY IF EXISTS "owner_update_menu_categories" ON public.menu_categories;
CREATE POLICY "owner_update_menu_categories" ON public.menu_categories
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "owner_update_menu_items" ON public.menu_items;
CREATE POLICY "owner_update_menu_items" ON public.menu_items
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─── ۳. جدول‌های بدون policy که نباید GRANT عمومی داشته باشند ───────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'password_reset_otps'
  ) THEN
    REVOKE ALL ON public.password_reset_otps FROM PUBLIC, anon, authenticated;
    GRANT ALL ON public.password_reset_otps TO service_role;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'gold_rate_cache'
  ) THEN
    REVOKE ALL ON public.gold_rate_cache FROM PUBLIC, anon, authenticated;
    GRANT ALL ON public.gold_rate_cache TO service_role;
  END IF;
END $$;
