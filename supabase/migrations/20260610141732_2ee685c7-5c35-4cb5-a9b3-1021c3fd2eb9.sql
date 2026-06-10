ALTER TYPE public.subscription_plan ADD VALUE IF NOT EXISTS 'trial';
ALTER TYPE public.subscription_plan ADD VALUE IF NOT EXISTS '12month';
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS price_12month bigint NOT NULL DEFAULT 1500000;