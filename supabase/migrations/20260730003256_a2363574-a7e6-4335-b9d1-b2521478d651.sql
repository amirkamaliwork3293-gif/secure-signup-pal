CREATE TABLE IF NOT EXISTS public.gold_rate_cache (
  id TEXT PRIMARY KEY DEFAULT 'latest',
  payload JSONB NOT NULL,
  source TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.gold_rate_cache TO service_role;
ALTER TABLE public.gold_rate_cache ENABLE ROW LEVEL SECURITY;