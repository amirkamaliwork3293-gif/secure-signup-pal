ALTER TABLE public.user_data
  ADD COLUMN IF NOT EXISTS reminders jsonb NOT NULL DEFAULT '[]'::jsonb;
