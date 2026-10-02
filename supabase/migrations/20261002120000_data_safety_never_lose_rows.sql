-- ════════════════════════════════════════════════════════════════════════════
-- Data safety 1/3 — the server never loses a row, whatever a device sends.
--
-- Safe to run live. Additive and idempotent: no table, column, row or policy is
-- removed; running it twice is harmless. Rollback:
--   supabase/rollbacks/20261002120000_data_safety_never_lose_rows.rollback.sql
--
-- Why: every device uploads whole JSON arrays per column (products, invoices,
-- customers, ...). A device holding an older copy used to overwrite the column
-- and drop rows another device had just added. 20260902120000 protected 6
-- columns; students / reminders / accounts / account_txs / production /
-- manual_ledger were still overwritten, and a customer's ledger (txs) could
-- lose a payment when two devices edited the same customer.
--
-- What this does (BEFORE UPDATE trigger user_data_protect_catalog):
--   1) Every array column is union-merged by row id: a row that is on the
--      server but missing from the upload is kept. The uploaded version of a row
--      wins (as before). Rows the user deleted are hidden on devices by
--      settings.catalogTombstones and stay on the server (soft delete) so they
--      can be recovered.
--   2) customers[].txs and students[].payments are union-merged by id inside
--      each row; a tx the user deleted is listed in
--      settings.catalogTombstones["customers.txs"] and is not brought back.
--   3) settings.catalogTombstones is union-merged, so a device can never
--      "forget" a delete made on another device.
--   4) updated_at is set by the server and strictly increases on every write.
--      Devices use it for compare-and-swap uploads, so it must change on every
--      write and must not depend on a phone's clock.
--   The vandalism guards from earlier migrations are kept unchanged.
--
-- Maintenance escape hatch (service role / SQL editor only, never the app):
--   SET LOCAL kamix.allow_row_removal = 'on';  -- inside a transaction
-- skips 1-3 for that transaction.
-- ════════════════════════════════════════════════════════════════════════════

-- Make sure every column the trigger touches exists (metadata-only, instant).
ALTER TABLE public.user_data
  ADD COLUMN IF NOT EXISTS customers     jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS students      jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS purchases     jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS expenses      jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS reminders     jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS accounts      jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS account_txs   jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS production    jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS manual_ledger jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Helpers from earlier migrations; recreated so this file also works on its own.
CREATE OR REPLACE FUNCTION public.kamix_json_looks_vandalized(j jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT j IS NOT NULL AND (
    j::text ~ 'جنده'
    OR j::text ~ 'کسکش'
    OR j::text ~ 'کیر'
    OR j::text ~ 'کص'
    OR j::text ~ 'گایید'
    OR j::text ~ 'حرومزاده'
    OR j::text ~ 'لاشی'
    OR j::text ~ '[一-鿿ぁ-ゟァ-ヿ]'
  );
$$;

-- Union by id: uploaded rows first (uploaded version wins, duplicates by id
-- collapse to the first), then server rows whose id is not in the upload.
-- Set-based (hash anti-join) instead of the previous O(n²) loop, so large
-- invoice histories stay fast. Same signature and semantics as before.
CREATE OR REPLACE FUNCTION public.kamix_jsonb_union_by_id(live jsonb, incoming jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN jsonb_typeof(COALESCE(live, 'null'::jsonb)) IS DISTINCT FROM 'array'
     AND jsonb_typeof(COALESCE(incoming, 'null'::jsonb)) IS DISTINCT FROM 'array'
      THEN COALESCE(incoming, live)
    ELSE (
      WITH inc AS (
        SELECT t.x, t.ord, NULLIF(t.x ->> 'id', '') AS id
          FROM jsonb_array_elements(
                 CASE WHEN jsonb_typeof(incoming) = 'array' THEN incoming ELSE '[]'::jsonb END
               ) WITH ORDINALITY AS t(x, ord)
      ),
      inc_keep AS (
        SELECT s.x, s.ord
          FROM (SELECT inc.*, row_number() OVER (PARTITION BY inc.id ORDER BY inc.ord) AS rn
                  FROM inc) s
         WHERE s.id IS NULL OR s.rn = 1
      ),
      liv AS (
        SELECT t.x, t.ord, NULLIF(t.x ->> 'id', '') AS id
          FROM jsonb_array_elements(
                 CASE WHEN jsonb_typeof(live) = 'array' THEN live ELSE '[]'::jsonb END
               ) WITH ORDINALITY AS t(x, ord)
      ),
      liv_keep AS (
        SELECT s.x, s.ord
          FROM (SELECT liv.*, row_number() OVER (PARTITION BY liv.id ORDER BY liv.ord) AS rn
                  FROM liv) s
         WHERE (s.id IS NOT NULL AND s.rn = 1
                AND NOT EXISTS (SELECT 1 FROM inc WHERE inc.id = s.id))
            OR (s.id IS NULL
                AND NOT EXISTS (SELECT 1 FROM inc WHERE inc.x = s.x))
      )
      SELECT COALESCE(jsonb_agg(u.x ORDER BY u.grp, u.ord), '[]'::jsonb)
        FROM (SELECT x, 1 AS grp, ord FROM inc_keep
              UNION ALL
              SELECT x, 2 AS grp, ord FROM liv_keep) u
    )
  END;
$$;

-- Inside each uploaded row, add back nested ledger entries (customer txs,
-- student payments) that the server has and the upload lacks, unless their id
-- is in `tombstoned` (a JSON array of ids the user explicitly deleted).
CREATE OR REPLACE FUNCTION public.kamix_merge_nested_ledger(
  live jsonb,
  incoming jsonb,
  nested_key text,
  tombstoned jsonb
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN jsonb_typeof(incoming) IS DISTINCT FROM 'array'
      OR jsonb_typeof(live) IS DISTINCT FROM 'array'
      THEN incoming
    ELSE (
      WITH liv AS (
        SELECT DISTINCT ON (x ->> 'id') x ->> 'id' AS id, x
          FROM jsonb_array_elements(live) AS t(x)
         WHERE COALESCE(x ->> 'id', '') <> ''
         ORDER BY x ->> 'id'
      )
      SELECT COALESCE(jsonb_agg(
        CASE
          WHEN l.x IS NULL
            OR jsonb_typeof(n.x -> nested_key) IS DISTINCT FROM 'array'
            OR jsonb_typeof(l.x -> nested_key) IS DISTINCT FROM 'array'
            OR (n.x -> nested_key) = (l.x -> nested_key)
            THEN n.x
          ELSE jsonb_set(
            n.x,
            ARRAY[nested_key],
            (n.x -> nested_key) || COALESCE((
              SELECT jsonb_agg(lt.v ORDER BY lt.o)
                FROM jsonb_array_elements(l.x -> nested_key) WITH ORDINALITY AS lt(v, o)
               WHERE COALESCE(lt.v ->> 'id', '') <> ''
                 AND NOT EXISTS (
                   SELECT 1 FROM jsonb_array_elements(n.x -> nested_key) AS nt(v)
                    WHERE nt.v ->> 'id' = lt.v ->> 'id')
                 AND NOT (
                   CASE WHEN jsonb_typeof(tombstoned) = 'array' THEN tombstoned
                        ELSE '[]'::jsonb END ? (lt.v ->> 'id'))
            ), '[]'::jsonb)
          )
        END
        ORDER BY n.ord), '[]'::jsonb)
        FROM jsonb_array_elements(incoming) WITH ORDINALITY AS n(x, ord)
        LEFT JOIN liv l ON l.id = n.x ->> 'id' AND COALESCE(n.x ->> 'id', '') <> ''
    )
  END;
$$;

-- Union of two tombstone maps {field: [ids]} → ids de-duplicated and sorted the
-- way the app sorts them (byte order), so devices see an identical value.
-- Returns NULL when both are empty.
CREATE OR REPLACE FUNCTION public.kamix_union_tombstones(a jsonb, b jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_object_agg(k, ids)
    FROM (
      SELECT e.k, to_jsonb(array_agg(DISTINCT e.id COLLATE "C" ORDER BY e.id COLLATE "C")) AS ids
        FROM (
          SELECT m.key AS k, v.id
            FROM (SELECT * FROM jsonb_each(CASE WHEN jsonb_typeof(a) = 'object' THEN a ELSE '{}'::jsonb END)
                  UNION ALL
                  SELECT * FROM jsonb_each(CASE WHEN jsonb_typeof(b) = 'object' THEN b ELSE '{}'::jsonb END)) m
            CROSS JOIN LATERAL jsonb_array_elements_text(
              CASE WHEN jsonb_typeof(m.value) = 'array' THEN m.value ELSE '[]'::jsonb END) AS v(id)
           WHERE v.id <> ''
        ) e
       GROUP BY e.k
    ) g;
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

  -- ── Vandalism guards (unchanged from 20260828/20260902) ──
  IF public.kamix_json_looks_vandalized(NEW.products)
     AND NOT public.kamix_json_looks_vandalized(OLD.products) THEN
    NEW.products := OLD.products;
  END IF;
  IF public.kamix_json_looks_vandalized(NEW.invoices)
     AND NOT public.kamix_json_looks_vandalized(OLD.invoices) THEN
    NEW.invoices := OLD.invoices;
  END IF;
  IF public.kamix_json_looks_vandalized(NEW.categories)
     AND NOT public.kamix_json_looks_vandalized(OLD.categories) THEN
    NEW.categories := OLD.categories;
  END IF;
  IF public.kamix_json_looks_vandalized(NEW.customers)
     AND NOT public.kamix_json_looks_vandalized(OLD.customers) THEN
    NEW.customers := OLD.customers;
  END IF;
  IF public.kamix_json_looks_vandalized(NEW.current_invoice)
     AND NOT public.kamix_json_looks_vandalized(OLD.current_invoice) THEN
    NEW.current_invoice := OLD.current_invoice;
  END IF;
  IF public.kamix_json_looks_vandalized(NEW.settings)
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

-- 4) Server-owned, strictly increasing updated_at.
CREATE OR REPLACE FUNCTION public.kamix_user_data_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  candidate timestamptz := clock_timestamp();
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.updated_at IS NOT NULL
     AND candidate <= OLD.updated_at
     -- an old client wrote a timestamp from a phone whose clock ran ahead:
     -- only keep counting from it if it is less than a minute ahead.
     AND OLD.updated_at < candidate + interval '1 minute' THEN
    candidate := OLD.updated_at + interval '1 microsecond';
  END IF;
  NEW.updated_at := candidate;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.kamix_json_looks_vandalized(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kamix_jsonb_union_by_id(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kamix_merge_nested_ledger(jsonb, jsonb, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kamix_union_tombstones(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_user_data_catalog() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kamix_user_data_touch() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS user_data_protect_catalog ON public.user_data;
CREATE TRIGGER user_data_protect_catalog
  BEFORE UPDATE ON public.user_data
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_user_data_catalog();

-- Fires after user_data_protect_catalog and user_data_snapshot (alphabetical).
DROP TRIGGER IF EXISTS user_data_touch_updated_at ON public.user_data;
CREATE TRIGGER user_data_touch_updated_at
  BEFORE INSERT OR UPDATE ON public.user_data
  FOR EACH ROW
  EXECUTE FUNCTION public.kamix_user_data_touch();

GRANT SELECT, INSERT, UPDATE ON public.user_data TO authenticated;
GRANT ALL ON public.user_data TO service_role;
