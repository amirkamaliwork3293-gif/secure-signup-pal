-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20261002120200_sync_realtime_signal.sql
-- Safe to run live. Devices fall back to polling. The signal table holds no
-- user data (only user_id + a timestamp), so it is dropped.
-- ════════════════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS user_data_sync_signal ON public.user_data;
DROP FUNCTION IF EXISTS public.kamix_signal_user_data_change();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'user_data_sync_signal') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.user_data_sync_signal;
  END IF;
END;
$$;

DROP TABLE IF EXISTS public.user_data_sync_signal;
