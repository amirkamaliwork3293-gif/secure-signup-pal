ALTER TABLE public.user_data
  ADD COLUMN IF NOT EXISTS expenses jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS customers jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS purchases jsonb NOT NULL DEFAULT '[]'::jsonb;