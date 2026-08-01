ALTER TABLE public.user_data
  ADD COLUMN IF NOT EXISTS accounts jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS account_txs jsonb NOT NULL DEFAULT '[]'::jsonb;
