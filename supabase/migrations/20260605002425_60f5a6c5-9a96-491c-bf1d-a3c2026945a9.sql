
-- 1) Receipt image on signup requests
ALTER TABLE public.signup_requests
  ADD COLUMN IF NOT EXISTS receipt_url text;

-- 2) Plan prices on app_settings
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS price_1month bigint NOT NULL DEFAULT 100000,
  ADD COLUMN IF NOT EXISTS price_3month bigint NOT NULL DEFAULT 280000,
  ADD COLUMN IF NOT EXISTS price_6month bigint NOT NULL DEFAULT 500000;

-- Ensure single settings row exists
INSERT INTO public.app_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- 3) Per-user cloud-synced data (products, categories, invoices, settings)
CREATE TABLE IF NOT EXISTS public.user_data (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  products jsonb NOT NULL DEFAULT '[]'::jsonb,
  categories jsonb NOT NULL DEFAULT '[]'::jsonb,
  invoices jsonb NOT NULL DEFAULT '[]'::jsonb,
  current_invoice jsonb,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_data TO authenticated;
GRANT ALL ON public.user_data TO service_role;

ALTER TABLE public.user_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_select_own_data" ON public.user_data
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "users_insert_own_data" ON public.user_data
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users_update_own_data" ON public.user_data
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users_delete_own_data" ON public.user_data
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "admins_read_user_data" ON public.user_data
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
