
ALTER TABLE public.signup_requests
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS request_type text NOT NULL DEFAULT 'signup',
  ADD COLUMN IF NOT EXISTS target_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.menu_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.menu_categories TO authenticated;
GRANT SELECT ON public.menu_categories TO anon;
GRANT ALL ON public.menu_categories TO service_role;
ALTER TABLE public.menu_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone_view_menu_categories" ON public.menu_categories
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "owner_insert_menu_categories" ON public.menu_categories
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "owner_update_menu_categories" ON public.menu_categories
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "owner_delete_menu_categories" ON public.menu_categories
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS menu_categories_user_idx ON public.menu_categories(user_id, sort_order);

CREATE TRIGGER menu_categories_touch BEFORE UPDATE ON public.menu_categories
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.menu_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category_id uuid REFERENCES public.menu_categories(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text,
  price numeric NOT NULL DEFAULT 0,
  image_url text,
  sort_order int NOT NULL DEFAULT 0,
  is_available boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.menu_items TO authenticated;
GRANT SELECT ON public.menu_items TO anon;
GRANT ALL ON public.menu_items TO service_role;
ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone_view_menu_items" ON public.menu_items
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "owner_insert_menu_items" ON public.menu_items
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "owner_update_menu_items" ON public.menu_items
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "owner_delete_menu_items" ON public.menu_items
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS menu_items_user_idx ON public.menu_items(user_id, sort_order);
CREATE INDEX IF NOT EXISTS menu_items_category_idx ON public.menu_items(category_id);

CREATE TRIGGER menu_items_touch BEFORE UPDATE ON public.menu_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
