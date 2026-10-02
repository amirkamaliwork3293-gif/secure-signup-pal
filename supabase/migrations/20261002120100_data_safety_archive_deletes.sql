-- ════════════════════════════════════════════════════════════════════════════
-- Data safety 2/3 — nothing is hard-deleted without a recoverable copy.
--
-- Safe to run live. Additive and idempotent. Rollback:
--   supabase/rollbacks/20261002120100_data_safety_archive_deletes.rollback.sql
--
-- 1) cleanup_expired_trials (pg_cron, every 5 minutes) deleted user_data, the
--    profile and the auth user of every expired trial, with no backup: a user
--    who renewed a day late found an empty account. The job is unscheduled and
--    the function no longer deletes anything (expiry is already enforced by the
--    app, which shows the renew page).
-- 2) Any DELETE of a user_data row (admin "delete user", the ON DELETE CASCADE
--    from auth.users, a manual SQL delete, an authenticated client) first copies
--    the whole row into user_data_backups. That table has no FK, so the copy
--    survives the account deletion and can be restored.
-- 3) user_data_delete_log (first proposed in scripts/DELETE-LOG.sql): one row
--    per id a device tombstones, now including the deleted row's content
--    (row_data) and nested ledger entries (customers.txs), so any delete can be
--    audited and undone by support. Logging never blocks a save.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) Stop deleting expired trial accounts ──
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-expired-trials') THEN
      PERFORM cron.unschedule('cleanup-expired-trials');
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_expired_trials()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Intentionally does nothing. Expired trials keep their data so they can
  -- renew. See 20261002120100_data_safety_archive_deletes.sql.
  RETURN;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_trials() FROM PUBLIC, anon, authenticated;

-- ── 2) Archive a user_data row before it is deleted ──
CREATE TABLE IF NOT EXISTS public.user_data_backups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.kamix_archive_user_data_on_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.user_data_backups (user_id, snapshot)
  VALUES (OLD.user_id, to_jsonb(OLD) || jsonb_build_object('_archived_reason', 'row_deleted'));
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.kamix_archive_user_data_on_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS user_data_archive_on_delete ON public.user_data;
CREATE TRIGGER user_data_archive_on_delete
  BEFORE DELETE ON public.user_data
  FOR EACH ROW
  EXECUTE FUNCTION public.kamix_archive_user_data_on_delete();

-- user_data_snapshot keeps only the 40 newest backups per user; the archive
-- copy of a deleted account must never be pruned by that. Mark it so the prune
-- skips it.
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
     AND NOT (snapshot ? '_archived_reason')
   ORDER BY created_at DESC
   LIMIT 1;

  IF last_at IS NULL OR last_at < now() - interval '6 hours' THEN
    INSERT INTO public.user_data_backups (user_id, snapshot)
    VALUES (OLD.user_id, to_jsonb(OLD));

    DELETE FROM public.user_data_backups b
     WHERE b.user_id = OLD.user_id
       AND NOT (b.snapshot ? '_archived_reason')
       AND b.id NOT IN (
         SELECT id FROM public.user_data_backups
          WHERE user_id = OLD.user_id
            AND NOT (snapshot ? '_archived_reason')
          ORDER BY created_at DESC
          LIMIT 40
       );
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.snapshot_user_data() FROM PUBLIC, anon, authenticated;

-- ── 3) Delete log with the deleted content ──
CREATE TABLE IF NOT EXISTS public.user_data_delete_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid NOT NULL,
  field       text NOT NULL,
  row_id      text NOT NULL,
  row_label   text,
  actor_id    text,
  session_id  text,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_data_delete_log ADD COLUMN IF NOT EXISTS row_data jsonb;

CREATE INDEX IF NOT EXISTS user_data_delete_log_user_created_idx
  ON public.user_data_delete_log (user_id, created_at DESC);

ALTER TABLE public.user_data_delete_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_data_delete_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_data_delete_log TO authenticated;
GRANT ALL ON public.user_data_delete_log TO service_role;

DROP POLICY IF EXISTS "owner_or_admin_read_delete_log" ON public.user_data_delete_log;
CREATE POLICY "owner_or_admin_read_delete_log" ON public.user_data_delete_log
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));

-- Finds a row by id in a user_data row: "products" → products[], and
-- "customers.txs" → the tx inside customers[].txs (with _parentId added).
CREATE OR REPLACE FUNCTION public.kamix_find_user_data_row(doc jsonb, field text, row_id text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN position('.' IN field) > 0 THEN (
      SELECT e || jsonb_build_object('_parentId', p ->> 'id')
        FROM jsonb_array_elements(
               CASE WHEN jsonb_typeof(doc -> split_part(field, '.', 1)) = 'array'
                    THEN doc -> split_part(field, '.', 1) ELSE '[]'::jsonb END) AS p
        CROSS JOIN LATERAL jsonb_array_elements(
               CASE WHEN jsonb_typeof(p -> split_part(field, '.', 2)) = 'array'
                    THEN p -> split_part(field, '.', 2) ELSE '[]'::jsonb END) AS e
       WHERE e ->> 'id' = row_id
       LIMIT 1)
    ELSE (
      SELECT e
        FROM jsonb_array_elements(
               CASE WHEN jsonb_typeof(doc -> field) = 'array' THEN doc -> field ELSE '[]'::jsonb END) AS e
       WHERE e ->> 'id' = row_id
       LIMIT 1)
  END;
$$;
REVOKE ALL ON FUNCTION public.kamix_find_user_data_row(jsonb, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.log_user_data_deletes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  new_ts  jsonb := CASE WHEN jsonb_typeof(NEW.settings -> 'catalogTombstones') = 'object'
                        THEN NEW.settings -> 'catalogTombstones' ELSE '{}'::jsonb END;
  old_ts  jsonb := '{}'::jsonb;
  new_doc jsonb := to_jsonb(NEW);
  old_doc jsonb := '{}'::jsonb;
  claims  jsonb := '{}'::jsonb;
  headers jsonb := '{}'::jsonb;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    old_doc := to_jsonb(OLD);
    IF jsonb_typeof(OLD.settings -> 'catalogTombstones') = 'object' THEN
      old_ts := OLD.settings -> 'catalogTombstones';
    END IF;
  END IF;
  IF new_ts = old_ts THEN
    RETURN NULL;
  END IF;

  BEGIN
    claims  := COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
    headers := COALESCE(NULLIF(current_setting('request.headers', true), ''), '{}')::jsonb;
  EXCEPTION WHEN others THEN
    claims := '{}'::jsonb;
    headers := '{}'::jsonb;
  END;

  BEGIN
    INSERT INTO public.user_data_delete_log
      (user_id, field, row_id, row_label, row_data, actor_id, session_id, user_agent)
    SELECT NEW.user_id, d.field, d.id,
           COALESCE(d.row ->> 'name',
                    NULLIF(concat_ws(' ', d.row ->> 'firstName', d.row ->> 'lastName'), ''),
                    d.row ->> 'title',
                    d.row ->> 'note'),
           d.row,
           claims ->> 'sub',
           claims ->> 'session_id',
           left(headers ->> 'user-agent', 300)
      FROM (
        SELECT t.field, tid.id,
               COALESCE(public.kamix_find_user_data_row(new_doc, t.field, tid.id),
                        public.kamix_find_user_data_row(old_doc, t.field, tid.id)) AS row
          FROM jsonb_each(new_ts) AS t(field, ids)
          CROSS JOIN LATERAL jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(t.ids) = 'array' THEN t.ids ELSE '[]'::jsonb END) AS tid(id)
         WHERE t.field <> 'current_invoice'   -- closing a draft tab is not a delete
           AND NOT (CASE WHEN jsonb_typeof(old_ts -> t.field) = 'array'
                         THEN old_ts -> t.field ELSE '[]'::jsonb END ? tid.id)
      ) d;
  EXCEPTION WHEN others THEN
    -- The row content is still on the server (soft delete) and in the 6-hourly
    -- snapshots; a logging problem must never make the user's save fail.
    RAISE WARNING 'log_user_data_deletes failed: %', SQLERRM;
  END;

  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.log_user_data_deletes() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS user_data_log_deletes ON public.user_data;
CREATE TRIGGER user_data_log_deletes
  AFTER INSERT OR UPDATE ON public.user_data
  FOR EACH ROW
  EXECUTE FUNCTION public.log_user_data_deletes();
