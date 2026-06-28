ALTER TABLE public.store_profiles
  ADD COLUMN IF NOT EXISTS portfolio_images jsonb NOT NULL DEFAULT '[]'::jsonb;