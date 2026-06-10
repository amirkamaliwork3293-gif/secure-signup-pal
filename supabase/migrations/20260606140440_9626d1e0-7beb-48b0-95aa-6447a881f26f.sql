
-- 1. Extend enum
ALTER TYPE public.subscription_plan ADD VALUE IF NOT EXISTS 'trial';
ALTER TYPE public.subscription_plan ADD VALUE IF NOT EXISTS '12month';

-- 2. Add yearly price column
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS price_12month bigint NOT NULL DEFAULT 1500000;

-- 3. Cleanup function for expired trial accounts
CREATE OR REPLACE FUNCTION public.cleanup_expired_trials()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  victim_id uuid;
BEGIN
  FOR victim_id IN
    SELECT id FROM public.profiles
    WHERE plan = 'trial' AND end_date IS NOT NULL AND end_date < now()
  LOOP
    DELETE FROM public.user_data WHERE user_id = victim_id;
    DELETE FROM public.user_roles WHERE user_id = victim_id;
    DELETE FROM public.profiles WHERE id = victim_id;
    DELETE FROM public.signup_requests WHERE username = (
      SELECT username FROM public.profiles WHERE id = victim_id
    );
    DELETE FROM auth.users WHERE id = victim_id;
  END LOOP;
END;
$$;

-- 4. Schedule hourly cleanup via pg_cron
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-expired-trials') THEN
    PERFORM cron.unschedule('cleanup-expired-trials');
  END IF;
  PERFORM cron.schedule(
    'cleanup-expired-trials',
    '*/5 * * * *',
    $cron$ SELECT public.cleanup_expired_trials(); $cron$
  );
END;
$$;
