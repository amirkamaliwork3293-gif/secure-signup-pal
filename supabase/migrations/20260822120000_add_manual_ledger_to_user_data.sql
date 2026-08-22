-- دفتر فروش/سود دستی روزانه (بدون نیاز به فاکتور)
ALTER TABLE public.user_data
  ADD COLUMN IF NOT EXISTS manual_ledger jsonb NOT NULL DEFAULT '[]'::jsonb;
