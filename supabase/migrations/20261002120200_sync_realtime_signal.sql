-- ════════════════════════════════════════════════════════════════════════════
-- Data safety 3/3 — instant "your data changed" signal for the user's other devices.
--
-- Safe to run live. Additive and idempotent. Rollback:
--   supabase/rollbacks/20261002120200_sync_realtime_signal.rollback.sql
--
-- Devices used to notice another device's change only by polling every 40s
-- while visible (and the comparison never matched, so they re-downloaded the
-- whole row each time). Publishing user_data itself to Realtime would send the
-- full row (megabytes of JSON) to every device on every save, so instead a
-- one-row-per-user table carries only (user_id, updated_at). Each device
-- subscribes with a filter on its own user_id; RLS lets a user see only their
-- own row. On a signal the device reads updated_at and pulls only if it changed.
-- Apps that load before this migration simply keep polling.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.user_data_sync_signal (
  user_id    uuid PRIMARY KEY,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_data_sync_signal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_data_sync_signal FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_data_sync_signal TO authenticated;
GRANT ALL ON public.user_data_sync_signal TO service_role;

DROP POLICY IF EXISTS "users_read_own_sync_signal" ON public.user_data_sync_signal;
CREATE POLICY "users_read_own_sync_signal" ON public.user_data_sync_signal
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.kamix_signal_user_data_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  BEGIN
    INSERT INTO public.user_data_sync_signal (user_id, updated_at)
    VALUES (NEW.user_id, NEW.updated_at)
    ON CONFLICT (user_id) DO UPDATE SET updated_at = EXCLUDED.updated_at;
  EXCEPTION WHEN others THEN
    -- The signal is only a hint (devices also poll); never fail the save.
    RAISE WARNING 'kamix_signal_user_data_change failed: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.kamix_signal_user_data_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS user_data_sync_signal ON public.user_data;
CREATE TRIGGER user_data_sync_signal
  AFTER INSERT OR UPDATE ON public.user_data
  FOR EACH ROW
  EXECUTE FUNCTION public.kamix_signal_user_data_change();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'user_data_sync_signal') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_data_sync_signal;
  END IF;
END;
$$;
