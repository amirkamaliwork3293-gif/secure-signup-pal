-- ════════════════════════════════════════════════════════════════════════════
-- Data-integrity snapshot: run BEFORE the deploy and AFTER it (and a day later),
-- then compare. Read-only towards user_data; it only writes its own table.
--
-- 1) Before deploy:   run sections A and B with label 'before'.
-- 2) After deploy:    run section B with label 'after' (change the label).
-- 3) Compare:         run section C. Any row it returns is a user whose number
--                     of rows in some column went DOWN — investigate before
--                     going further (user_data_backups has 6-hourly copies).
--
-- Counts go up as users work; they must never go down. Deleted rows stay in
-- the arrays (soft delete), so even explicit deletes do not lower the counts.
-- ════════════════════════════════════════════════════════════════════════════

-- ── A) table (once) ──
CREATE TABLE IF NOT EXISTS public.kamix_integrity_snapshot (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  label      text NOT NULL,
  taken_at   timestamptz NOT NULL DEFAULT now(),
  user_id    uuid NOT NULL,
  counts     jsonb NOT NULL,
  ledger_txs integer NOT NULL,
  bytes      bigint NOT NULL
);
ALTER TABLE public.kamix_integrity_snapshot ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kamix_integrity_snapshot FROM PUBLIC, anon, authenticated;

-- ── B) take a snapshot (change the label each time) ──
INSERT INTO public.kamix_integrity_snapshot (label, user_id, counts, ledger_txs, bytes)
SELECT 'before',
       d.user_id,
       jsonb_build_object(
         'products',      CASE WHEN jsonb_typeof(d.products) = 'array' THEN jsonb_array_length(d.products) ELSE 0 END,
         'invoices',      CASE WHEN jsonb_typeof(d.invoices) = 'array' THEN jsonb_array_length(d.invoices) ELSE 0 END,
         'categories',    CASE WHEN jsonb_typeof(d.categories) = 'array' THEN jsonb_array_length(d.categories) ELSE 0 END,
         'customers',     CASE WHEN jsonb_typeof(d.customers) = 'array' THEN jsonb_array_length(d.customers) ELSE 0 END,
         'students',      CASE WHEN jsonb_typeof(d.students) = 'array' THEN jsonb_array_length(d.students) ELSE 0 END,
         'purchases',     CASE WHEN jsonb_typeof(d.purchases) = 'array' THEN jsonb_array_length(d.purchases) ELSE 0 END,
         'expenses',      CASE WHEN jsonb_typeof(d.expenses) = 'array' THEN jsonb_array_length(d.expenses) ELSE 0 END,
         'reminders',     CASE WHEN jsonb_typeof(d.reminders) = 'array' THEN jsonb_array_length(d.reminders) ELSE 0 END,
         'accounts',      CASE WHEN jsonb_typeof(d.accounts) = 'array' THEN jsonb_array_length(d.accounts) ELSE 0 END,
         'account_txs',   CASE WHEN jsonb_typeof(d.account_txs) = 'array' THEN jsonb_array_length(d.account_txs) ELSE 0 END,
         'production',    CASE WHEN jsonb_typeof(d.production) = 'array' THEN jsonb_array_length(d.production) ELSE 0 END,
         'manual_ledger', CASE WHEN jsonb_typeof(d.manual_ledger) = 'array' THEN jsonb_array_length(d.manual_ledger) ELSE 0 END
       ),
       COALESCE((SELECT sum(CASE WHEN jsonb_typeof(c -> 'txs') = 'array' THEN jsonb_array_length(c -> 'txs') ELSE 0 END)
                   FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d.customers) = 'array' THEN d.customers ELSE '[]'::jsonb END) c), 0)::int,
       pg_column_size(d.*)
  FROM public.user_data d;

-- ── C) compare: users whose counts went down between two labels ──
WITH b AS (SELECT DISTINCT ON (user_id) * FROM public.kamix_integrity_snapshot WHERE label = 'before' ORDER BY user_id, taken_at DESC),
     a AS (SELECT DISTINCT ON (user_id) * FROM public.kamix_integrity_snapshot WHERE label = 'after'  ORDER BY user_id, taken_at DESC)
SELECT b.user_id, k.key AS field, (b.counts ->> k.key)::int AS before, (a.counts ->> k.key)::int AS after
  FROM b
  JOIN a USING (user_id)
  CROSS JOIN LATERAL jsonb_each(b.counts) k
 WHERE (a.counts ->> k.key)::int < (b.counts ->> k.key)::int
UNION ALL
SELECT b.user_id, 'customers.txs', b.ledger_txs, a.ledger_txs
  FROM b JOIN a USING (user_id)
 WHERE a.ledger_txs < b.ledger_txs
UNION ALL
SELECT b.user_id, 'ROW MISSING', 1, 0
  FROM b LEFT JOIN public.user_data d USING (user_id)
 WHERE d.user_id IS NULL
ORDER BY 1, 2;
