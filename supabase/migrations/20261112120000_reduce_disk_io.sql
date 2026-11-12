-- ════════════════════════════════════════════════════════════════════════════
-- Disk IO — same behaviour, much less work per save of user_data.
--
-- Safe to run live. Idempotent (CREATE OR REPLACE only). No table, column, row,
-- trigger, policy or grant is added or removed; no user data is read or changed.
-- Rollback (restores the previous function bodies exactly):
--   supabase/rollbacks/20261112120000_reduce_disk_io.rollback.sql
--
-- Why: Supabase warned that the project is running out of its Disk IO budget.
-- Every save of user_data ran these triggers, which did work proportional to
-- the size of the WHOLE row even when one small column changed:
--   1) kamix_json_looks_vandalized converted the jsonb to text 8 times (once per
--      pattern) and was called for NEW and OLD of 6 columns on every save, even
--      for columns the save did not touch. Now: one conversion, one regex with
--      the same 8 patterns, and only for a column whose value changed. A column
--      that did not change cannot become vandalized, so the result is identical.
--   2) log_user_data_deletes built to_jsonb(NEW) and to_jsonb(OLD) (the whole
--      row, every column, twice) before checking whether any tombstone was
--      added; almost every save returns at that check. Now the row JSON is
--      built only after the check. The inserted log rows are identical.
-- Everything else in both functions (union merge, nested ledgers, tombstones,
-- NOT NULL fallbacks, SECURITY DEFINER, search_path) is unchanged, copied from
-- 20261002120000 and 20261002120100.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.kamix_json_looks_vandalized(j jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  -- Same 8 patterns as before, one text conversion and one regex scan instead of 8.
  SELECT j IS NOT NULL AND j::text ~ '(جنده|کسکش|کیر|کص|گایید|حرومزاده|لاشی|[一-鿿ぁ-ゟァ-ヿ])';
$$;

CREATE OR REPLACE FUNCTION public.protect_user_data_catalog()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  bypass boolean := COALESCE(current_setting('kamix.allow_row_removal', true), '') = 'on';
  tomb   jsonb;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  -- ── Vandalism guards (same rule as 20260828/20260902) ──
  -- Only a column this save changes can become vandalized; an unchanged column is
  -- skipped instead of being converted to text and scanned on every save.
  IF NEW.products IS DISTINCT FROM OLD.products
     AND public.kamix_json_looks_vandalized(NEW.products)
     AND NOT public.kamix_json_looks_vandalized(OLD.products) THEN
    NEW.products := OLD.products;
  END IF;
  IF NEW.invoices IS DISTINCT FROM OLD.invoices
     AND public.kamix_json_looks_vandalized(NEW.invoices)
     AND NOT public.kamix_json_looks_vandalized(OLD.invoices) THEN
    NEW.invoices := OLD.invoices;
  END IF;
  IF NEW.categories IS DISTINCT FROM OLD.categories
     AND public.kamix_json_looks_vandalized(NEW.categories)
     AND NOT public.kamix_json_looks_vandalized(OLD.categories) THEN
    NEW.categories := OLD.categories;
  END IF;
  IF NEW.customers IS DISTINCT FROM OLD.customers
     AND public.kamix_json_looks_vandalized(NEW.customers)
     AND NOT public.kamix_json_looks_vandalized(OLD.customers) THEN
    NEW.customers := OLD.customers;
  END IF;
  IF NEW.current_invoice IS DISTINCT FROM OLD.current_invoice
     AND public.kamix_json_looks_vandalized(NEW.current_invoice)
     AND NOT public.kamix_json_looks_vandalized(OLD.current_invoice) THEN
    NEW.current_invoice := OLD.current_invoice;
  END IF;
  IF NEW.settings IS DISTINCT FROM OLD.settings
     AND public.kamix_json_looks_vandalized(NEW.settings)
     AND NOT public.kamix_json_looks_vandalized(OLD.settings) THEN
    NEW.settings := OLD.settings;
  END IF;

  IF bypass THEN
    RETURN NEW;
  END IF;

  -- ── 3) Deletes made on any device are never forgotten ──
  IF jsonb_typeof(NEW.settings) = 'object' AND NEW.settings IS DISTINCT FROM OLD.settings THEN
    tomb := public.kamix_union_tombstones(OLD.settings -> 'catalogTombstones',
                                          NEW.settings -> 'catalogTombstones');
    IF tomb IS NOT NULL AND tomb IS DISTINCT FROM (NEW.settings -> 'catalogTombstones') THEN
      NEW.settings := jsonb_set(NEW.settings, '{catalogTombstones}', tomb);
    END IF;
  END IF;
  tomb := CASE WHEN jsonb_typeof(NEW.settings -> 'catalogTombstones') = 'object'
               THEN NEW.settings -> 'catalogTombstones' ELSE '{}'::jsonb END;

  -- ── 1) No row disappears from the server ──
  IF NEW.products IS DISTINCT FROM OLD.products THEN
    NEW.products := public.kamix_jsonb_union_by_id(OLD.products, NEW.products);
  END IF;
  IF NEW.invoices IS DISTINCT FROM OLD.invoices THEN
    NEW.invoices := public.kamix_jsonb_union_by_id(OLD.invoices, NEW.invoices);
  END IF;
  IF NEW.categories IS DISTINCT FROM OLD.categories THEN
    NEW.categories := public.kamix_jsonb_union_by_id(OLD.categories, NEW.categories);
  END IF;
  IF NEW.customers IS DISTINCT FROM OLD.customers THEN
    -- 2) a customer's ledger keeps every tx the user did not delete
    NEW.customers := public.kamix_merge_nested_ledger(OLD.customers, NEW.customers, 'txs',
                                                      tomb -> 'customers.txs');
    NEW.customers := public.kamix_jsonb_union_by_id(OLD.customers, NEW.customers);
  END IF;
  IF NEW.students IS DISTINCT FROM OLD.students THEN
    NEW.students := public.kamix_merge_nested_ledger(OLD.students, NEW.students, 'payments',
                                                     tomb -> 'students.payments');
    NEW.students := public.kamix_jsonb_union_by_id(OLD.students, NEW.students);
  END IF;
  IF NEW.purchases IS DISTINCT FROM OLD.purchases THEN
    NEW.purchases := public.kamix_jsonb_union_by_id(OLD.purchases, NEW.purchases);
  END IF;
  IF NEW.expenses IS DISTINCT FROM OLD.expenses THEN
    NEW.expenses := public.kamix_jsonb_union_by_id(OLD.expenses, NEW.expenses);
  END IF;
  IF NEW.reminders IS DISTINCT FROM OLD.reminders THEN
    NEW.reminders := public.kamix_jsonb_union_by_id(OLD.reminders, NEW.reminders);
  END IF;
  IF NEW.accounts IS DISTINCT FROM OLD.accounts THEN
    NEW.accounts := public.kamix_jsonb_union_by_id(OLD.accounts, NEW.accounts);
  END IF;
  IF NEW.account_txs IS DISTINCT FROM OLD.account_txs THEN
    NEW.account_txs := public.kamix_jsonb_union_by_id(OLD.account_txs, NEW.account_txs);
  END IF;
  IF NEW.production IS DISTINCT FROM OLD.production THEN
    NEW.production := public.kamix_jsonb_union_by_id(OLD.production, NEW.production);
  END IF;
  IF NEW.manual_ledger IS DISTINCT FROM OLD.manual_ledger THEN
    NEW.manual_ledger := public.kamix_jsonb_union_by_id(OLD.manual_ledger, NEW.manual_ledger);
  END IF;

  -- NOT NULL columns: a null upload never wipes the server copy.
  NEW.products      := COALESCE(NEW.products, OLD.products, '[]'::jsonb);
  NEW.categories    := COALESCE(NEW.categories, OLD.categories, '[]'::jsonb);
  NEW.invoices      := COALESCE(NEW.invoices, OLD.invoices, '[]'::jsonb);
  NEW.settings      := COALESCE(NEW.settings, OLD.settings, '{}'::jsonb);

  RETURN NEW;
END;
$$;

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
  new_doc jsonb;
  old_doc jsonb := '{}'::jsonb;
  claims  jsonb := '{}'::jsonb;
  headers jsonb := '{}'::jsonb;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF jsonb_typeof(OLD.settings -> 'catalogTombstones') = 'object' THEN
      old_ts := OLD.settings -> 'catalogTombstones';
    END IF;
  END IF;
  IF new_ts = old_ts THEN
    RETURN NULL;
  END IF;

  -- Only now (a delete happened) build the whole-row JSON used to find the
  -- deleted rows' content. Before, this ran on every save.
  new_doc := to_jsonb(NEW);
  IF TG_OP = 'UPDATE' THEN
    old_doc := to_jsonb(OLD);
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

REVOKE ALL ON FUNCTION public.kamix_json_looks_vandalized(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_user_data_catalog() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_user_data_deletes() FROM PUBLIC, anon, authenticated;
