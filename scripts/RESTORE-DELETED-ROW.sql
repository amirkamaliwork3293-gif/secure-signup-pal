-- ════════════════════════════════════════════════════════════════════════════
-- Bring back something a user deleted by mistake (support / admin, SQL Editor).
-- Needs migration 20261002120100 (user_data_delete_log with row_data).
--
-- Step 1 — find the delete (read-only):
--   SELECT id, created_at, field, row_id, row_label, user_agent
--     FROM public.user_data_delete_log
--    WHERE user_id = '<USER-UUID>'
--    ORDER BY created_at DESC
--    LIMIT 50;
--
-- Step 2 — put its log id below and run the DO block.
--
-- The row comes back as a COPY with a new id (old id + "-r<timestamp>") and a
-- "restoredFrom" field. The old id stays deleted on purpose: every device
-- remembers that id as deleted, so re-adding the same id would be hidden again.
-- Customer txs ("customers.txs") are restored into the same customer.
-- Devices pick the change up on their next sync (instantly with Realtime).
-- Note: a restored invoice gets a new id, so a customer debt line that pointed
-- at the old invoice id still shows, but its link to the invoice is by the old id.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_log_id bigint := 0;            -- ← user_data_delete_log.id
  l        public.user_data_delete_log%ROWTYPE;
  v_now_ms bigint := (extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  v_row    jsonb;
  v_parent text;
  v_key    text;
  v_rows   integer;
BEGIN
  SELECT * INTO l FROM public.user_data_delete_log WHERE id = v_log_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'delete log row % not found', v_log_id;
  END IF;
  IF l.row_data IS NULL THEN
    RAISE EXCEPTION 'delete log row % has no saved content (deleted before the log stored it); use user_data_backups', v_log_id;
  END IF;

  v_row := (l.row_data - '_parentId')
           || jsonb_build_object('id', l.row_id || '-r' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS'),
                                 'restoredFrom', l.row_id,
                                 'updatedAt', v_now_ms);

  IF position('.' IN l.field) > 0 THEN
    v_parent := split_part(l.field, '.', 1);
    v_key    := split_part(l.field, '.', 2);
    IF (v_parent, v_key) NOT IN (('customers', 'txs'), ('students', 'payments')) THEN
      RAISE EXCEPTION 'unsupported field %', l.field;
    END IF;
    EXECUTE format(
      'UPDATE public.user_data
          SET %1$I = (SELECT jsonb_agg(CASE WHEN p ->> ''id'' = $2
                                            THEN jsonb_set(p, ARRAY[$3], COALESCE(p -> $3, ''[]''::jsonb) || jsonb_build_array($1))
                                                 || jsonb_build_object(''updatedAt'', $4)
                                            ELSE p END ORDER BY o)
                        FROM jsonb_array_elements(%1$I) WITH ORDINALITY AS t(p, o))
        WHERE user_id = $5', v_parent)
      USING v_row, l.row_data ->> '_parentId', v_key, v_now_ms, l.user_id;
  ELSE
    IF l.field NOT IN ('products', 'categories', 'invoices', 'customers', 'students', 'purchases',
                       'expenses', 'reminders', 'accounts', 'account_txs', 'production', 'manual_ledger') THEN
      RAISE EXCEPTION 'unsupported field %', l.field;
    END IF;
    EXECUTE format('UPDATE public.user_data SET %1$I = %1$I || jsonb_build_array($1) WHERE user_id = $2', l.field)
      USING v_row, l.user_id;
  END IF;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'user_data row for % not found', l.user_id;
  END IF;
  RAISE NOTICE 'restored % % as %', l.field, l.row_id, v_row ->> 'id';
END;
$$;
