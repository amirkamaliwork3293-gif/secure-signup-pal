-- Keep the database under the Free plan's 500 MB limit.
--
-- user_data_backups had grown to ~430 MB (70% of the database): one full
-- snapshot per user every 6 hours, 40 kept per user. Snapshots are now taken
-- at most once every 24 hours and only the 5 newest are kept, which still
-- covers ~5 days of history at roughly a quarter of the size.
--
-- Archive copies of deleted accounts (snapshot ? '_archived_reason') are never
-- pruned, same as before.

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

  IF last_at IS NULL OR last_at < now() - interval '24 hours' THEN
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
          LIMIT 5
       );
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.snapshot_user_data() FROM PUBLIC, anon, authenticated;

-- One-off prune of the existing backlog down to the 5 newest per user.
DELETE FROM public.user_data_backups b
 USING (
   SELECT id,
          row_number() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS rn
     FROM public.user_data_backups
    WHERE NOT (snapshot ? '_archived_reason')
 ) r
 WHERE b.id = r.id
   AND r.rn > 5;

-- Disk space is only returned after VACUUM FULL, which cannot run inside a
-- migration transaction. Run it separately in the SQL editor:
--   VACUUM FULL public.user_data_backups;
