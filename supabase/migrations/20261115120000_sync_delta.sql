-- ════════════════════════════════════════════════════════════════════════════
-- Delta sync — devices send and receive only the rows that changed.
--
-- Safe to run live. Additive and idempotent: no table, column, row, policy or
-- existing trigger is removed or altered; no user data is read or rewritten;
-- running it twice is harmless. Rollback:
--   supabase/rollbacks/20261115120000_sync_delta.rollback.sql
--
-- Why: user_data keeps one JSON array per entity. Until now a device uploaded
-- the WHOLE array on every change (megabytes for a busy shop) and downloaded
-- the WHOLE row whenever another device changed anything. On slow or filtered
-- networks those requests time out, so "what I add on the PC does not show on
-- the phone". With this migration:
--   • kamix_sync_push(p)   — the device sends only the rows it changed; the
--     server merges them into the arrays row by row (newest edit of a row wins,
--     customer/student ledgers are merged per entry, deletes are never forgotten).
--   • kamix_sync_pull(n)   — the device asks "what changed after version n?"
--     and receives only those rows (or just a tiny "nothing changed").
--   • user_data.sync_seq   — a version number that grows on every save.
--   • user_data_sync_meta  — one row: the first version of this installation.
--   • user_data_row_seq    — which row changed at which version (ids only, no
--     user content).
-- Old app versions keep working unchanged: they still read and write user_data
-- directly; the triggers below record what they changed so new devices receive
-- it as a delta too. A new app works without this migration as well (it falls
-- back to the previous whole-row sync).
-- ════════════════════════════════════════════════════════════════════════════

-- Columns the functions below read (metadata-only, instant; same list as
-- 20261002120000).
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

-- ── 1) Version number of each user's data ───────────────────────────────────
-- Versions start at "now in milliseconds" instead of 1. If this migration is
-- ever rolled back and applied again, the new versions are still larger than
-- any version a device remembers from before, and min_seq tells the server that
-- such a device must re-read everything (changes made in between were not logged).
CREATE TABLE IF NOT EXISTS public.user_data_sync_meta (
  one     boolean PRIMARY KEY DEFAULT true CHECK (one),
  min_seq bigint  NOT NULL
);
ALTER TABLE public.user_data_sync_meta ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_data_sync_meta FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_data_sync_meta TO authenticated;
GRANT ALL ON public.user_data_sync_meta TO service_role;
DROP POLICY IF EXISTS "authenticated_read_sync_meta" ON public.user_data_sync_meta;
CREATE POLICY "authenticated_read_sync_meta" ON public.user_data_sync_meta
  FOR SELECT TO authenticated
  USING (true);

DO $$
DECLARE
  t0 bigint := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'user_data'
                    AND column_name = 'sync_seq') THEN
    DELETE FROM public.user_data_sync_meta;
    INSERT INTO public.user_data_sync_meta (min_seq) VALUES (t0);
    -- Constant default: metadata-only, existing rows are NOT rewritten and no
    -- trigger fires. Every existing row simply reads as version t0.
    EXECUTE format('ALTER TABLE public.user_data ADD COLUMN sync_seq bigint NOT NULL DEFAULT %s', t0);
    DROP SEQUENCE IF EXISTS public.user_data_sync_seq;
    EXECUTE format('CREATE SEQUENCE public.user_data_sync_seq AS bigint START WITH %s', t0 + 1);
  ELSIF NOT EXISTS (SELECT 1 FROM public.user_data_sync_meta) THEN
    INSERT INTO public.user_data_sync_meta (min_seq)
    SELECT COALESCE(min(sync_seq), t0) FROM public.user_data;
  END IF;
END;
$$;
CREATE SEQUENCE IF NOT EXISTS public.user_data_sync_seq AS bigint;
REVOKE ALL ON SEQUENCE public.user_data_sync_seq FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.kamix_sync_bump_seq()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Server-owned: whatever a device sends is replaced.
  NEW.sync_seq := nextval('public.user_data_sync_seq');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.kamix_sync_bump_seq() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS user_data_sync_seq ON public.user_data;
CREATE TRIGGER user_data_sync_seq
  BEFORE INSERT OR UPDATE ON public.user_data
  FOR EACH ROW
  EXECUTE FUNCTION public.kamix_sync_bump_seq();

-- ── 2) Which row changed at which version ───────────────────────────────────
-- field   : column name ('products', …), 'settings', 'current_invoice',
--           'tomb:<field>' for a delete marker, or '*' = "re-read everything".
-- row_id  : the row's id, or '' = "the whole field changed".
CREATE TABLE IF NOT EXISTS public.user_data_row_seq (
  user_id uuid   NOT NULL,
  field   text   NOT NULL,
  row_id  text   NOT NULL,
  seq     bigint NOT NULL,
  PRIMARY KEY (user_id, field, row_id)
);
CREATE INDEX IF NOT EXISTS user_data_row_seq_user_seq_idx
  ON public.user_data_row_seq (user_id, seq);

ALTER TABLE public.user_data_row_seq ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_data_row_seq FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_data_row_seq TO authenticated;
GRANT ALL ON public.user_data_row_seq TO service_role;

DROP POLICY IF EXISTS "users_read_own_row_seq" ON public.user_data_row_seq;
CREATE POLICY "users_read_own_row_seq" ON public.user_data_row_seq
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- ── 3) Small pure helpers (no table access) ─────────────────────────────────
-- kamix_row_id / kamix_row_ts use only built-in operators and have no SET clause
-- on purpose: that lets PostgreSQL inline them (they run once per row).
-- A row's id exactly as the app sees it: a non-empty JSON string.
CREATE OR REPLACE FUNCTION public.kamix_row_id(x jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN jsonb_typeof(x) = 'object' AND jsonb_typeof(x -> 'id') = 'string'
              THEN NULLIF(x ->> 'id', '') END;
$$;

-- Time of the last edit of a row, the way the app decides which copy is newer.
CREATE OR REPLACE FUNCTION public.kamix_row_ts(x jsonb)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  -- CASE (not AND) so the cast only ever runs on a JSON number.
  SELECT COALESCE(
    NULLIF(GREATEST(CASE WHEN jsonb_typeof(x -> 'updatedAt') = 'number' THEN (x ->> 'updatedAt')::numeric END, 0), 0),
    NULLIF(GREATEST(CASE WHEN jsonb_typeof(x -> 'createdAt') = 'number' THEN (x ->> 'createdAt')::numeric END, 0), 0),
    NULLIF(GREATEST(CASE WHEN jsonb_typeof(x -> 'at') = 'number' THEN (x ->> 'at')::numeric END, 0), 0),
    NULLIF(GREATEST(CASE WHEN jsonb_typeof(x -> 'date') = 'number' THEN (x ->> 'date')::numeric END, 0), 0),
    NULLIF(GREATEST(CASE WHEN jsonb_typeof(x -> 'paidAt') = 'number' THEN (x ->> 'paidAt')::numeric END, 0), 0),
    0);
$$;

-- `winner` plus the nested ledger entries (customer txs / student payments)
-- that only `other` has. Entries whose id is in `gone` (deleted by the user)
-- are dropped. Same rules as mergeNestedLedger in the app.
CREATE OR REPLACE FUNCTION public.kamix_sync_merge_row(
  winner jsonb,
  other jsonb,
  nested_key text,
  gone jsonb
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN nested_key IS NULL
      OR jsonb_typeof(winner) IS DISTINCT FROM 'object'
      OR jsonb_typeof(winner -> nested_key) IS DISTINCT FROM 'array'
      THEN winner
    ELSE (
      WITH g AS (
        SELECT CASE WHEN jsonb_typeof(gone) = 'array' THEN gone ELSE '[]'::jsonb END AS ids
      ),
      mine AS (
        SELECT w.v, w.o, public.kamix_row_id(w.v) AS id
          FROM jsonb_array_elements(winner -> nested_key) WITH ORDINALITY AS w(v, o)
      ),
      kept AS (
        SELECT m.v, m.o FROM mine m, g
         WHERE m.id IS NULL OR NOT (g.ids ? m.id)
      ),
      extra AS (
        SELECT DISTINCT ON (public.kamix_row_id(t.v)) t.v, t.o
          FROM jsonb_array_elements(
                 CASE WHEN jsonb_typeof(other) = 'object'
                       AND jsonb_typeof(other -> nested_key) = 'array'
                      THEN other -> nested_key ELSE '[]'::jsonb END
               ) WITH ORDINALITY AS t(v, o), g
         WHERE public.kamix_row_id(t.v) IS NOT NULL
           AND NOT (g.ids ? public.kamix_row_id(t.v))
           AND NOT EXISTS (SELECT 1 FROM mine m WHERE m.id = public.kamix_row_id(t.v))
         ORDER BY public.kamix_row_id(t.v), t.o
      ),
      has_extra AS (SELECT EXISTS (SELECT 1 FROM extra) AS yes)
      SELECT CASE
        WHEN NOT (SELECT yes FROM has_extra)
         AND (SELECT count(*) FROM kept) = (SELECT count(*) FROM mine)
          THEN winner
        ELSE jsonb_set(
          winner,
          ARRAY[nested_key],
          COALESCE((
            SELECT jsonb_agg(e.v ORDER BY
                     CASE WHEN (SELECT yes FROM has_extra)
                          THEN -COALESCE(CASE WHEN jsonb_typeof(e.v -> 'at') = 'number'
                                              THEN (e.v ->> 'at')::numeric END, 0)
                          ELSE 0 END,
                     e.src, e.o)
              FROM (SELECT v, 1 AS src, o FROM kept
                    UNION ALL
                    SELECT v, 2 AS src, o FROM extra) e
          ), '[]'::jsonb))
      END
    )
  END;
$$;

-- Merge the rows a device sends into the stored array.
--   • a stored row keeps its position; it is replaced by the sent copy unless
--     the stored copy is clearly newer (more than 1s, same rule as the app);
--   • a row the server does not have yet is added at the front (the app keeps
--     newest rows first);
--   • stored rows the device did not send are untouched — nothing is removed.
CREATE OR REPLACE FUNCTION public.kamix_sync_merge_rows(
  live jsonb,
  incoming jsonb,
  nested_key text,
  gone jsonb
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  WITH inc_all AS (
    SELECT t.x, t.ord, public.kamix_row_id(t.x) AS id
      FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(incoming) = 'array' THEN incoming ELSE '[]'::jsonb END
           ) WITH ORDINALITY AS t(x, ord)
  ),
  inc AS (
    SELECT DISTINCT ON (id) id, x, ord FROM inc_all WHERE id IS NOT NULL ORDER BY id, ord
  ),
  liv AS (
    SELECT t.x, t.ord, public.kamix_row_id(t.x) AS id
      FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(live) = 'array' THEN live ELSE '[]'::jsonb END
           ) WITH ORDINALITY AS t(x, ord)
  )
  SELECT COALESCE(jsonb_agg(u.x ORDER BY u.grp, u.ord), '[]'::jsonb)
    FROM (
      -- new rows with an id
      SELECT public.kamix_sync_merge_row(i.x, NULL, nested_key, gone) AS x, 1 AS grp, i.ord
        FROM inc i
       WHERE NOT EXISTS (SELECT 1 FROM liv l WHERE l.id = i.id)
      UNION ALL
      -- rows without an id (legacy data): kept as sent unless already stored
      SELECT a.x, 1 AS grp, a.ord
        FROM inc_all a
       WHERE a.id IS NULL
         AND NOT EXISTS (SELECT 1 FROM liv l WHERE l.id IS NULL AND l.x = a.x)
      UNION ALL
      -- stored rows, updated in place
      SELECT CASE
               WHEN i.id IS NULL THEN l.x
               WHEN public.kamix_row_ts(l.x) > public.kamix_row_ts(i.x) + 1000
                 THEN public.kamix_sync_merge_row(l.x, i.x, nested_key, gone)
               ELSE public.kamix_sync_merge_row(i.x, l.x, nested_key, gone)
             END AS x,
             2 AS grp, l.ord
        FROM liv l
        LEFT JOIN inc i ON i.id = l.id
    ) u;
$$;

-- Union of two delete-marker maps {field: [ids]}; ids de-duplicated and sorted
-- in byte order (the order the app uses). NULL when both are empty.
CREATE OR REPLACE FUNCTION public.kamix_sync_union_tombstones(a jsonb, b jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_object_agg(g.k, g.ids)
    FROM (
      SELECT e.k, to_jsonb(array_agg(DISTINCT e.id COLLATE "C" ORDER BY e.id COLLATE "C")) AS ids
        FROM (
          SELECT m.key AS k, v.id
            FROM (SELECT * FROM jsonb_each(CASE WHEN jsonb_typeof(a) = 'object' THEN a ELSE '{}'::jsonb END)
                  UNION ALL
                  SELECT * FROM jsonb_each(CASE WHEN jsonb_typeof(b) = 'object' THEN b ELSE '{}'::jsonb END)) m
            CROSS JOIN LATERAL jsonb_array_elements(
              CASE WHEN jsonb_typeof(m.value) = 'array' THEN m.value ELSE '[]'::jsonb END) AS j(e)
            CROSS JOIN LATERAL (SELECT j.e #>> '{}' AS id) v
           WHERE jsonb_typeof(j.e) = 'string' AND v.id <> ''
        ) e
       GROUP BY e.k
    ) g;
$$;

REVOKE ALL ON FUNCTION public.kamix_row_id(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.kamix_row_ts(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.kamix_sync_merge_row(jsonb, jsonb, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.kamix_sync_merge_rows(jsonb, jsonb, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.kamix_sync_union_tombstones(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kamix_row_id(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.kamix_row_ts(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.kamix_sync_merge_row(jsonb, jsonb, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.kamix_sync_merge_rows(jsonb, jsonb, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.kamix_sync_union_tombstones(jsonb, jsonb) TO authenticated, service_role;

-- ── 4) Record what each save changed (whoever made it: new app, old app, SQL) ─
CREATE OR REPLACE FUNCTION public.kamix_sync_note_rows(
  p_user uuid,
  p_field text,
  p_old jsonb,
  p_new jsonb,
  p_seq bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  whole boolean := false;
BEGIN
  IF jsonb_typeof(p_new) IS DISTINCT FROM 'array' OR jsonb_typeof(p_old) IS DISTINCT FROM 'array' THEN
    whole := true;
  ELSE
    -- Cases a per-row delta cannot describe: rows without an id, the same id
    -- twice, or a row that is no longer in the array. Devices then re-read the
    -- whole field (and re-upload anything the server lost).
    SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(p_new) AS n(x)
                    WHERE public.kamix_row_id(n.x) IS NULL)
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_old) AS o(x)
                    WHERE public.kamix_row_id(o.x) IS NULL)
        OR (SELECT count(*) <> count(DISTINCT public.kamix_row_id(n.x))
              FROM jsonb_array_elements(p_new) AS n(x))
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_old) AS o(x)
                    WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_new) AS n(x)
                                       WHERE public.kamix_row_id(n.x) = public.kamix_row_id(o.x)))
      INTO whole;
  END IF;

  IF whole THEN
    INSERT INTO public.user_data_row_seq (user_id, field, row_id, seq)
    VALUES (p_user, p_field, '', p_seq)
    ON CONFLICT (user_id, field, row_id) DO UPDATE SET seq = EXCLUDED.seq;
    RETURN;
  END IF;

  INSERT INTO public.user_data_row_seq (user_id, field, row_id, seq)
  SELECT DISTINCT p_user, p_field, n.id, p_seq
    FROM (SELECT public.kamix_row_id(t.x) AS id, t.x FROM jsonb_array_elements(p_new) AS t(x)) n
    LEFT JOIN (SELECT public.kamix_row_id(t.x) AS id, t.x FROM jsonb_array_elements(p_old) AS t(x)) o
      ON o.id = n.id
   WHERE o.id IS NULL OR o.x IS DISTINCT FROM n.x
  ON CONFLICT (user_id, field, row_id) DO UPDATE SET seq = EXCLUDED.seq;
END;
$$;
REVOKE ALL ON FUNCTION public.kamix_sync_note_rows(uuid, text, jsonb, jsonb, bigint) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.kamix_sync_note_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  old_t jsonb;
  new_t jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    BEGIN
      DELETE FROM public.user_data_row_seq WHERE user_id = OLD.user_id;
    EXCEPTION WHEN others THEN
      RAISE WARNING 'kamix_sync_note_changes cleanup failed: %', SQLERRM;
    END;
    RETURN NULL;
  END IF;

  BEGIN
    IF TG_OP = 'INSERT' THEN
      INSERT INTO public.user_data_row_seq (user_id, field, row_id, seq)
      VALUES (NEW.user_id, '*', '', NEW.sync_seq)
      ON CONFLICT (user_id, field, row_id) DO UPDATE SET seq = EXCLUDED.seq;
      RETURN NULL;
    END IF;

    IF NEW.products IS DISTINCT FROM OLD.products THEN
      PERFORM public.kamix_sync_note_rows(NEW.user_id, 'products', OLD.products, NEW.products, NEW.sync_seq);
    END IF;
    IF NEW.categories IS DISTINCT FROM OLD.categories THEN
      PERFORM public.kamix_sync_note_rows(NEW.user_id, 'categories', OLD.categories, NEW.categories, NEW.sync_seq);
    END IF;
    IF NEW.invoices IS DISTINCT FROM OLD.invoices THEN
      PERFORM public.kamix_sync_note_rows(NEW.user_id, 'invoices', OLD.invoices, NEW.invoices, NEW.sync_seq);
    END IF;
    IF NEW.customers IS DISTINCT FROM OLD.customers THEN
      PERFORM public.kamix_sync_note_rows(NEW.user_id, 'customers', OLD.customers, NEW.customers, NEW.sync_seq);
    END IF;
    IF NEW.students IS DISTINCT FROM OLD.students THEN
      PERFORM public.kamix_sync_note_rows(NEW.user_id, 'students', OLD.students, NEW.students, NEW.sync_seq);
    END IF;
    IF NEW.purchases IS DISTINCT FROM OLD.purchases THEN
      PERFORM public.kamix_sync_note_rows(NEW.user_id, 'purchases', OLD.purchases, NEW.purchases, NEW.sync_seq);
    END IF;
    IF NEW.expenses IS DISTINCT FROM OLD.expenses THEN
      PERFORM public.kamix_sync_note_rows(NEW.user_id, 'expenses', OLD.expenses, NEW.expenses, NEW.sync_seq);
    END IF;
    IF NEW.reminders IS DISTINCT FROM OLD.reminders THEN
      PERFORM public.kamix_sync_note_rows(NEW.user_id, 'reminders', OLD.reminders, NEW.reminders, NEW.sync_seq);
    END IF;
    IF NEW.accounts IS DISTINCT FROM OLD.accounts THEN
      PERFORM public.kamix_sync_note_rows(NEW.user_id, 'accounts', OLD.accounts, NEW.accounts, NEW.sync_seq);
    END IF;
    IF NEW.account_txs IS DISTINCT FROM OLD.account_txs THEN
      PERFORM public.kamix_sync_note_rows(NEW.user_id, 'account_txs', OLD.account_txs, NEW.account_txs, NEW.sync_seq);
    END IF;
    IF NEW.production IS DISTINCT FROM OLD.production THEN
      PERFORM public.kamix_sync_note_rows(NEW.user_id, 'production', OLD.production, NEW.production, NEW.sync_seq);
    END IF;
    IF NEW.manual_ledger IS DISTINCT FROM OLD.manual_ledger THEN
      PERFORM public.kamix_sync_note_rows(NEW.user_id, 'manual_ledger', OLD.manual_ledger, NEW.manual_ledger, NEW.sync_seq);
    END IF;

    IF NEW.current_invoice IS DISTINCT FROM OLD.current_invoice THEN
      INSERT INTO public.user_data_row_seq (user_id, field, row_id, seq)
      VALUES (NEW.user_id, 'current_invoice', '', NEW.sync_seq)
      ON CONFLICT (user_id, field, row_id) DO UPDATE SET seq = EXCLUDED.seq;
    END IF;

    IF NEW.settings IS DISTINCT FROM OLD.settings THEN
      IF jsonb_typeof(NEW.settings) IS DISTINCT FROM 'object'
         OR jsonb_typeof(OLD.settings) IS DISTINCT FROM 'object'
         OR (NEW.settings - 'catalogTombstones') IS DISTINCT FROM (OLD.settings - 'catalogTombstones') THEN
        INSERT INTO public.user_data_row_seq (user_id, field, row_id, seq)
        VALUES (NEW.user_id, 'settings', '', NEW.sync_seq)
        ON CONFLICT (user_id, field, row_id) DO UPDATE SET seq = EXCLUDED.seq;
      END IF;
      new_t := CASE WHEN jsonb_typeof(NEW.settings -> 'catalogTombstones') = 'object'
                    THEN NEW.settings -> 'catalogTombstones' ELSE '{}'::jsonb END;
      old_t := CASE WHEN jsonb_typeof(OLD.settings -> 'catalogTombstones') = 'object'
                    THEN OLD.settings -> 'catalogTombstones' ELSE '{}'::jsonb END;
      IF new_t IS DISTINCT FROM old_t THEN
        -- Each newly deleted id travels on its own, not the whole (ever growing) list.
        INSERT INTO public.user_data_row_seq (user_id, field, row_id, seq)
        SELECT DISTINCT NEW.user_id, 'tomb:' || t.key, v.e #>> '{}', NEW.sync_seq
          FROM jsonb_each(new_t) AS t(key, value)
          CROSS JOIN LATERAL jsonb_array_elements(
            CASE WHEN jsonb_typeof(t.value) = 'array' THEN t.value ELSE '[]'::jsonb END) AS v(e)
         WHERE jsonb_typeof(v.e) = 'string'
           AND (v.e #>> '{}') <> ''
           AND NOT (CASE WHEN jsonb_typeof(old_t -> t.key) = 'array'
                         THEN old_t -> t.key ELSE '[]'::jsonb END ? (v.e #>> '{}'))
        ON CONFLICT (user_id, field, row_id) DO UPDATE SET seq = EXCLUDED.seq;
      END IF;
    END IF;
  EXCEPTION WHEN others THEN
    -- Never fail the user's save. Tell every device to re-read everything
    -- instead, so no change can be missed.
    RAISE WARNING 'kamix_sync_note_changes failed: %', SQLERRM;
    BEGIN
      INSERT INTO public.user_data_row_seq (user_id, field, row_id, seq)
      VALUES (NEW.user_id, '*', '', NEW.sync_seq)
      ON CONFLICT (user_id, field, row_id) DO UPDATE SET seq = EXCLUDED.seq;
    EXCEPTION WHEN others THEN
      RAISE WARNING 'kamix_sync_note_changes fallback failed: %', SQLERRM;
    END;
  END;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.kamix_sync_note_changes() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS user_data_sync_rows ON public.user_data;
CREATE TRIGGER user_data_sync_rows
  AFTER INSERT OR UPDATE OR DELETE ON public.user_data
  FOR EACH ROW
  EXECUTE FUNCTION public.kamix_sync_note_changes();

-- ── 5) "What changed after version p_since?" ────────────────────────────────
-- Runs with the caller's own rights (RLS: own row only).
-- Result:
--   {exists:false}                                   no data row yet
--   {exists, seq, updated_at, full:true}             read the whole row instead
--   {exists, seq, updated_at, full:false,
--    fields: {products: {rows:[…]}, customers: {whole:[…]}, settings: {whole:{…}}, …},
--    tombstones: {products: [ids], "customers.txs": [ids], …}}
-- settings.whole never contains catalogTombstones (they travel in `tombstones`).
CREATE OR REPLACE FUNCTION public.kamix_sync_pull(p_since bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid      uuid := auth.uid();
  v_seq    bigint;
  v_at     timestamptz;
  f        record;
  v_col    jsonb;
  v_fields jsonb := '{}'::jsonb;
  v_tomb   jsonb := '{}'::jsonb;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT d.sync_seq, d.updated_at INTO v_seq, v_at
    FROM public.user_data d WHERE d.user_id = uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('exists', false, 'seq', 0, 'full', true);
  END IF;

  IF p_since IS NULL OR p_since > v_seq
     OR p_since < COALESCE((SELECT m.min_seq FROM public.user_data_sync_meta m), 0)
     OR EXISTS (SELECT 1 FROM public.user_data_row_seq r
                 WHERE r.user_id = uid AND r.field = '*' AND r.seq > p_since) THEN
    RETURN jsonb_build_object('exists', true, 'seq', v_seq, 'updated_at', v_at, 'full', true);
  END IF;

  IF p_since < v_seq THEN
    FOR f IN
      SELECT r.field, array_agg(r.row_id) AS ids, bool_or(r.row_id = '') AS whole
        FROM public.user_data_row_seq r
       WHERE r.user_id = uid AND r.seq > p_since
       GROUP BY r.field
    LOOP
      IF f.field LIKE 'tomb:%' THEN
        v_tomb := v_tomb || jsonb_build_object(substr(f.field, 6), to_jsonb(f.ids));
        CONTINUE;
      END IF;

      -- CASE reads (de-toasts) only the one column that is needed.
      SELECT CASE f.field
               WHEN 'products'        THEN d.products
               WHEN 'categories'      THEN d.categories
               WHEN 'invoices'        THEN d.invoices
               WHEN 'customers'       THEN d.customers
               WHEN 'students'        THEN d.students
               WHEN 'purchases'       THEN d.purchases
               WHEN 'expenses'        THEN d.expenses
               WHEN 'reminders'       THEN d.reminders
               WHEN 'accounts'        THEN d.accounts
               WHEN 'account_txs'     THEN d.account_txs
               WHEN 'production'      THEN d.production
               WHEN 'manual_ledger'   THEN d.manual_ledger
               WHEN 'settings'        THEN d.settings
               WHEN 'current_invoice' THEN d.current_invoice
             END
        INTO v_col
        FROM public.user_data d WHERE d.user_id = uid;

      IF f.field = 'settings' THEN
        v_fields := v_fields || jsonb_build_object('settings', jsonb_build_object('whole',
          CASE WHEN jsonb_typeof(v_col) = 'object' THEN v_col - 'catalogTombstones' ELSE v_col END));
      ELSIF f.field = 'current_invoice' THEN
        v_fields := v_fields || jsonb_build_object('current_invoice', jsonb_build_object('whole', v_col));
      ELSIF f.field IN ('products', 'categories', 'invoices', 'customers', 'students', 'purchases',
                        'expenses', 'reminders', 'accounts', 'account_txs', 'production',
                        'manual_ledger') THEN
        IF f.whole OR jsonb_typeof(v_col) IS DISTINCT FROM 'array' THEN
          v_fields := v_fields || jsonb_build_object(f.field, jsonb_build_object('whole', v_col));
        ELSE
          v_fields := v_fields || jsonb_build_object(f.field, jsonb_build_object('rows', COALESCE((
            SELECT jsonb_agg(t.x ORDER BY t.ord)
              FROM jsonb_array_elements(v_col) WITH ORDINALITY AS t(x, ord)
             WHERE public.kamix_row_id(t.x) = ANY (f.ids)), '[]'::jsonb)));
        END IF;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'exists', true, 'seq', v_seq, 'updated_at', v_at, 'full', false,
    'fields', v_fields, 'tombstones', v_tomb);
END;
$$;

-- ── 6) "Here are the rows I changed." ───────────────────────────────────────
-- Runs with the caller's own rights (RLS: own row only), so it can do nothing
-- a direct UPDATE of user_data could not already do.
-- p = {
--   rows:            {products: [row, …], invoices: [row, …], …}   changed rows only
--   settings:        {set: {key: value, …}, unset: [key, …], tombstones: {field: [ids]}}
--   current_invoice: {…}                                           the open-invoice board
-- }
-- Result: {seq, updated_at, prev_seq, prev_updated_at}. prev_* is the version
-- right before this save: if it is not the version the device last saw,
-- another device saved in between and the device pulls.
CREATE OR REPLACE FUNCTION public.kamix_sync_push(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid        uuid := auth.uid();
  cols       constant text[] := ARRAY['products', 'categories', 'invoices', 'customers', 'students',
                                      'purchases', 'expenses', 'reminders', 'accounts',
                                      'account_txs', 'production', 'manual_ledger'];
  c          text;
  sets       text[] := '{}';
  v_rows     jsonb := CASE WHEN jsonb_typeof(p -> 'rows') = 'object' THEN p -> 'rows' ELSE '{}'::jsonb END;
  v_sp       jsonb := CASE WHEN jsonb_typeof(p -> 'settings') = 'object' THEN p -> 'settings' END;
  v_prev_seq bigint;
  v_prev_at  timestamptz;
  v_seq      bigint;
  v_at       timestamptz;
  v_settings jsonb;
  v_new_set  jsonb;
  v_tomb     jsonb;
  v_need_tomb boolean;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Lock the row first: saves of one account are applied one after another.
  SELECT d.sync_seq, d.updated_at INTO v_prev_seq, v_prev_at
    FROM public.user_data d WHERE d.user_id = uid FOR UPDATE;
  IF NOT FOUND THEN
    BEGIN
      INSERT INTO public.user_data (user_id) VALUES (uid);
    EXCEPTION WHEN unique_violation THEN
      NULL; -- another device created it a moment ago
    END;
    PERFORM 1 FROM public.user_data d WHERE d.user_id = uid FOR UPDATE;
    v_prev_seq := NULL;
    v_prev_at := NULL;
  END IF;

  v_need_tomb := v_sp IS NOT NULL
              OR jsonb_typeof(v_rows -> 'customers') = 'array'
              OR jsonb_typeof(v_rows -> 'students') = 'array';
  IF v_need_tomb THEN
    SELECT d.settings INTO v_settings FROM public.user_data d WHERE d.user_id = uid;
    v_settings := CASE WHEN jsonb_typeof(v_settings) = 'object' THEN v_settings ELSE '{}'::jsonb END;
    v_tomb := CASE WHEN jsonb_typeof(v_settings -> 'catalogTombstones') = 'object'
                   THEN v_settings -> 'catalogTombstones' ELSE '{}'::jsonb END;
  END IF;

  IF v_sp IS NOT NULL THEN
    v_new_set := v_settings;
    IF jsonb_typeof(v_sp -> 'unset') = 'array' THEN
      v_new_set := v_new_set - ARRAY(
        SELECT u.k FROM jsonb_array_elements_text(v_sp -> 'unset') AS u(k)
         WHERE u.k <> 'catalogTombstones');
    END IF;
    IF jsonb_typeof(v_sp -> 'set') = 'object' THEN
      v_new_set := v_new_set || ((v_sp -> 'set') - 'catalogTombstones');
    END IF;
    v_tomb := COALESCE(public.kamix_sync_union_tombstones(v_tomb, v_sp -> 'tombstones'), '{}'::jsonb);
    IF v_tomb <> '{}'::jsonb THEN
      v_new_set := jsonb_set(v_new_set, '{catalogTombstones}', v_tomb, true);
    END IF;
    IF v_new_set IS DISTINCT FROM v_settings THEN
      sets := sets || 'settings = $3'::text;
    END IF;
  END IF;

  FOREACH c IN ARRAY cols LOOP
    IF jsonb_typeof(v_rows -> c) = 'array' AND jsonb_array_length(v_rows -> c) > 0 THEN
      sets := sets || format(
        '%1$I = public.kamix_sync_merge_rows(%1$I, $1 -> %1$L, %2$L, $2 -> %3$L)',
        c,
        CASE c WHEN 'customers' THEN 'txs' WHEN 'students' THEN 'payments' END,
        CASE c WHEN 'customers' THEN 'customers.txs' WHEN 'students' THEN 'students.payments' END);
    END IF;
  END LOOP;

  IF p ? 'current_invoice' AND jsonb_typeof(p -> 'current_invoice') = 'object' THEN
    sets := sets || 'current_invoice = $5'::text;
  END IF;

  IF array_length(sets, 1) IS NULL THEN
    -- Nothing to store (everything sent is already there).
    SELECT d.sync_seq, d.updated_at INTO v_seq, v_at FROM public.user_data d WHERE d.user_id = uid;
    RETURN jsonb_build_object('seq', v_seq, 'updated_at', v_at,
                              'prev_seq', v_prev_seq, 'prev_updated_at', v_prev_at, 'noop', true);
  END IF;

  -- updated_at: the touch trigger (when installed) makes it strictly increasing;
  -- clock_timestamp() keeps it changing on every save even without that trigger.
  EXECUTE 'UPDATE public.user_data SET ' || array_to_string(sets, ', ')
       || ', updated_at = clock_timestamp() WHERE user_id = $4 RETURNING sync_seq, updated_at'
    INTO v_seq, v_at
    USING v_rows, v_tomb, v_new_set, uid, p -> 'current_invoice';

  RETURN jsonb_build_object('seq', v_seq, 'updated_at', v_at,
                            'prev_seq', v_prev_seq, 'prev_updated_at', v_prev_at);
END;
$$;

REVOKE ALL ON FUNCTION public.kamix_sync_pull(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.kamix_sync_push(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kamix_sync_pull(bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.kamix_sync_push(jsonb) TO authenticated, service_role;

-- ── 7) Realtime signal (same table as 20261002120200, plus the version) ─────
-- Repeated here so this file also works when 20261002120200 was never run.
CREATE TABLE IF NOT EXISTS public.user_data_sync_signal (
  user_id    uuid PRIMARY KEY,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_data_sync_signal
  ADD COLUMN IF NOT EXISTS seq bigint NOT NULL DEFAULT 0;

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
    INSERT INTO public.user_data_sync_signal (user_id, updated_at, seq)
    VALUES (NEW.user_id, NEW.updated_at, NEW.sync_seq)
    ON CONFLICT (user_id) DO UPDATE
      SET updated_at = EXCLUDED.updated_at, seq = EXCLUDED.seq;
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

-- PostgREST: make the two new functions callable right away.
NOTIFY pgrst, 'reload schema';
