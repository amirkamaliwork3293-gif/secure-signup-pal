-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20261115120000_sync_delta.sql
-- Safe to run live. Removes only what that migration added; none of it holds
-- user content (version numbers and row ids only). user_data itself and every
-- earlier trigger are untouched. Apps fall back to the previous whole-row sync
-- on their own (they detect that the functions are gone).
-- The realtime signal table and trigger (20261002120200) are kept and put back
-- exactly as that migration defines them.
-- ════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.kamix_sync_push(jsonb);
DROP FUNCTION IF EXISTS public.kamix_sync_pull(bigint);

DROP TRIGGER IF EXISTS user_data_sync_rows ON public.user_data;
DROP FUNCTION IF EXISTS public.kamix_sync_note_changes();
DROP FUNCTION IF EXISTS public.kamix_sync_note_rows(uuid, text, jsonb, jsonb, bigint);
DROP TABLE IF EXISTS public.user_data_row_seq;

DROP FUNCTION IF EXISTS public.kamix_sync_merge_rows(jsonb, jsonb, text, jsonb);
DROP FUNCTION IF EXISTS public.kamix_sync_merge_row(jsonb, jsonb, text, jsonb);
DROP FUNCTION IF EXISTS public.kamix_sync_union_tombstones(jsonb, jsonb);
DROP FUNCTION IF EXISTS public.kamix_row_ts(jsonb);
DROP FUNCTION IF EXISTS public.kamix_row_id(jsonb);

-- The signal function as in 20261002120200 (without the version number).
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
    RAISE WARNING 'kamix_signal_user_data_change failed: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.kamix_signal_user_data_change() FROM PUBLIC, anon, authenticated;
ALTER TABLE IF EXISTS public.user_data_sync_signal DROP COLUMN IF EXISTS seq;

DROP TRIGGER IF EXISTS user_data_sync_seq ON public.user_data;
DROP FUNCTION IF EXISTS public.kamix_sync_bump_seq();
ALTER TABLE public.user_data DROP COLUMN IF EXISTS sync_seq;
DROP SEQUENCE IF EXISTS public.user_data_sync_seq;
DROP TABLE IF EXISTS public.user_data_sync_meta;

NOTIFY pgrst, 'reload schema';
