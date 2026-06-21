-- پروفایل عمومی فروشگاه — اطلاعاتی که فروشنده برای صفحه‌ی عمومی /store/[id] وارد می‌کند.
-- این جدول «عمومی خواندنی» است (هرکس با لینک می‌تواند ببیند) اما فقط صاحب حساب
-- می‌تواند ردیف خودش را بنویسد/به‌روزرسانی کند. هیچ داده‌ی حساسی (مشتری، فاکتور،
-- مالی) اینجا ذخیره نمی‌شود — فقط اطلاعات معرفی فروشگاه که کاربر صراحتاً وارد کرده.
CREATE TABLE IF NOT EXISTS public.store_profiles (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  shop_name   text,
  address     text,
  phones      jsonb NOT NULL DEFAULT '[]'::jsonb,
  hours       text,
  socials     jsonb NOT NULL DEFAULT '{}'::jsonb,
  description text,
  logo_url    text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.store_profiles TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.store_profiles TO authenticated;
GRANT ALL ON public.store_profiles TO service_role;

ALTER TABLE public.store_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anyone_read_store_profiles" ON public.store_profiles;
CREATE POLICY "anyone_read_store_profiles" ON public.store_profiles
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "owner_insert_store_profile" ON public.store_profiles;
CREATE POLICY "owner_insert_store_profile" ON public.store_profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "owner_update_store_profile" ON public.store_profiles;
CREATE POLICY "owner_update_store_profile" ON public.store_profiles
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "owner_delete_store_profile" ON public.store_profiles;
CREATE POLICY "owner_delete_store_profile" ON public.store_profiles
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- باکت عمومی برای لوگو/تصویر فروشگاه. مسیر فایل: «<user_id>/logo.<ext>».
INSERT INTO storage.buckets (id, name, public)
VALUES ('store-assets', 'store-assets', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "public_read_store_assets" ON storage.objects;
CREATE POLICY "public_read_store_assets" ON storage.objects
  FOR SELECT TO anon, authenticated USING (bucket_id = 'store-assets');

DROP POLICY IF EXISTS "owner_insert_store_assets" ON storage.objects;
CREATE POLICY "owner_insert_store_assets" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'store-assets' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "owner_update_store_assets" ON storage.objects;
CREATE POLICY "owner_update_store_assets" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'store-assets' AND (storage.foldername(name))[1] = auth.uid()::text);
