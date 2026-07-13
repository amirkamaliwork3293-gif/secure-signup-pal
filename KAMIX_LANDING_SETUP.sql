-- ═══════════════════════════════════════════════════════════════════════════
-- KAMIX — راه‌اندازی صفحه‌ی معرفی (Landing)
-- این SQL را یک‌بار در پروژه‌ی Supabase خودتان (SQL Editor) اجرا کنید تا:
--   ۱) جدول محتوای صفحه‌ی معرفی ساخته شود (قابل‌خواندن برای عموم، ویرایش فقط ادمین)
--   ۲) باکت عمومی برای آپلود ویدیو/عکس معرفی ساخته شود
-- بدون اجرای این SQL هم صفحه‌ی معرفی با محتوای پیش‌فرض نمایش داده می‌شود،
-- اما برای ذخیره‌ی تغییرات و آپلود رسانه از پنل ادمین، اجرای آن لازم است.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.landing_content (
  id integer PRIMARY KEY DEFAULT 1,
  brand_name text NOT NULL DEFAULT 'KAMIX',
  headline text NOT NULL DEFAULT 'KAMIX',
  subheadline text NOT NULL DEFAULT 'حسابداری موبایل، ساده و سریع',
  description text NOT NULL DEFAULT '',
  media jsonb NOT NULL DEFAULT '[]'::jsonb,       -- [{ type: 'video'|'image', url, caption }]
  features jsonb NOT NULL DEFAULT '[]'::jsonb,    -- [{ title, description }]
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT landing_content_singleton CHECK (id = 1)
);

-- شماره تلفن و شبکه‌های اجتماعی (اگر جدول از قبل وجود دارد، این خط ستون را اضافه می‌کند)
ALTER TABLE public.landing_content
  ADD COLUMN IF NOT EXISTS contact jsonb NOT NULL DEFAULT '{}'::jsonb;

GRANT SELECT ON public.landing_content TO anon;
GRANT SELECT, INSERT, UPDATE ON public.landing_content TO authenticated;
GRANT ALL ON public.landing_content TO service_role;

ALTER TABLE public.landing_content ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "landing_content public read" ON public.landing_content;
CREATE POLICY "landing_content public read"
  ON public.landing_content FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "landing_content admin insert" ON public.landing_content;
CREATE POLICY "landing_content admin insert"
  ON public.landing_content FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "landing_content admin update" ON public.landing_content;
CREATE POLICY "landing_content admin update"
  ON public.landing_content FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.landing_content (id, description, features)
VALUES (
  1,
  'با KAMIX کل حسابداری فروشگاه‌تان را از روی گوشی مدیریت کنید: فاکتور سریع، اسکن بارکد با دوربین، انبار، مشتریان و گزارش سود — همه در یک برنامه ساده فارسی.',
  '[
    {"title":"فاکتور فوری","description":"صدور فاکتور فروش تنها در چند ثانیه با اسکن بارکد یا جستجوی کالا."},
    {"title":"اسکن با دوربین","description":"بارکد و QR کالاها را مستقیم با دوربین موبایل بخوانید."},
    {"title":"انبار و مشتریان","description":"موجودی کالا، بدهکاران و حساب مشتریان همیشه دقیق و به‌روز."},
    {"title":"گزارش سود","description":"درآمد، سود و عملکرد فروشگاه را لحظه‌ای ببینید."}
  ]'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- باکت عمومی برای رسانه‌ی صفحه‌ی معرفی
INSERT INTO storage.buckets (id, name, public)
VALUES ('landing-media', 'landing-media', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "landing-media public read" ON storage.objects;
CREATE POLICY "landing-media public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'landing-media');

DROP POLICY IF EXISTS "landing-media admin insert" ON storage.objects;
CREATE POLICY "landing-media admin insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'landing-media' AND public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "landing-media admin update" ON storage.objects;
CREATE POLICY "landing-media admin update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'landing-media' AND public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "landing-media admin delete" ON storage.objects;
CREATE POLICY "landing-media admin delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'landing-media' AND public.has_role(auth.uid(), 'admin'));
