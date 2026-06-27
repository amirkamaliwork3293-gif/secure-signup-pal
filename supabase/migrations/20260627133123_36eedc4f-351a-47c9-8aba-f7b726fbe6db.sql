
CREATE TABLE public.store_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  shop_name text,
  address text,
  phones text[] DEFAULT '{}'::text[],
  hours text,
  socials jsonb DEFAULT '{}'::jsonb,
  description text,
  logo_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.store_profiles TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_profiles TO authenticated;
GRANT ALL ON public.store_profiles TO service_role;

ALTER TABLE public.store_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "store_profiles public read" ON public.store_profiles
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "owner insert" ON public.store_profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "owner update" ON public.store_profiles
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "owner delete" ON public.store_profiles
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER store_profiles_touch
  BEFORE UPDATE ON public.store_profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Storage policies on store-assets bucket
CREATE POLICY "store-assets read all" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'store-assets');

CREATE POLICY "store-assets owner upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'store-assets'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "store-assets owner update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'store-assets'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "store-assets owner delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'store-assets'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
