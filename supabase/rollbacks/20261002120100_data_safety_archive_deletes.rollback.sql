-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20261002120100_data_safety_archive_deletes.sql
-- Safe to run live. Removes the archive-on-delete and delete-log triggers and
-- restores snapshot_user_data / cleanup_expired_trials to their previous bodies.
-- Kept on purpose (they contain user data): user_data_backups rows and the
-- user_data_delete_log table.
-- The 'cleanup-expired-trials' cron job is NOT rescheduled: it permanently
-- deletes expired trial accounts. Only re-enable it deliberately:
--   SELECT cron.schedule('cleanup-expired-trials', '*/5 * * * *',
--                        $c$ SELECT public.cleanup_expired_trials(); $c$);
-- ════════════════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS user_data_archive_on_delete ON public.user_data;
DROP FUNCTION IF EXISTS public.kamix_archive_user_data_on_delete();

DROP TRIGGER IF EXISTS user_data_log_deletes ON public.user_data;
DROP FUNCTION IF EXISTS public.log_user_data_deletes();
DROP FUNCTION IF EXISTS public.kamix_find_user_data_row(jsonb, text, text);

CREATE OR REPLACE FUNCTION public.snapshot_user_data()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  last_at timestamptz;
BEGIN
  SELECT created_at INTO last_at
    FROM public.user_data_backups
   WHERE user_id = OLD.user_id
   ORDER BY created_at DESC
   LIMIT 1;

  IF last_at IS NULL OR last_at < now() - interval '6 hours' THEN
    INSERT INTO public.user_data_backups (user_id, snapshot)
    VALUES (OLD.user_id, to_jsonb(OLD));

    DELETE FROM public.user_data_backups b
     WHERE b.user_id = OLD.user_id
       AND b.id NOT IN (
         SELECT id FROM public.user_data_backups
          WHERE user_id = OLD.user_id
          ORDER BY created_at DESC
          LIMIT 40
       );
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.snapshot_user_data() FROM PUBLIC, anon, authenticated;

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
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_trials() FROM PUBLIC, anon, authenticated;
