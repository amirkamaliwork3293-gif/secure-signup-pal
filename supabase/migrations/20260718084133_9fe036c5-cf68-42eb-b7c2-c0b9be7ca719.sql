
CREATE TABLE IF NOT EXISTS public.landing_content (
  id integer PRIMARY KEY DEFAULT 1,
  brand_name text NOT NULL DEFAULT 'KAMIX',
  headline text NOT NULL DEFAULT 'KAMIX',
  subheadline text NOT NULL DEFAULT 'حسابداری موبایل، ساده و سریع',
  description text NOT NULL DEFAULT '',
  media jsonb NOT NULL DEFAULT '[]'::jsonb,
  features jsonb NOT NULL DEFAULT '[]'::jsonb,
  contact jsonb NOT NULL DEFAULT '{}'::jsonb,
  stories jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT landing_content_singleton CHECK (id = 1)
);

ALTER TABLE public.landing_content ADD COLUMN IF NOT EXISTS contact jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.landing_content ADD COLUMN IF NOT EXISTS stories jsonb NOT NULL DEFAULT '[]'::jsonb;

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
