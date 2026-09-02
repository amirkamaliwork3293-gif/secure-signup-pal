-- ════════════════════════════════════════════════════════════════════════════
-- بازیابی امن علی خورشیدی (alikhorshidi1998)
-- سوپابیس → SQL Editor → این فایل را کامل Run کنید.
--
-- چه می‌کند:
--   • کاربر را پیدا می‌کند.
--   • وضعیت زنده و همهٔ پشتیبان‌ها را نشان می‌دهد.
--   • کالا/فاکتور/مشتری همهٔ نسخه‌ها را ادغام می‌کند (هیچ شناسه‌ای پاک نمی‌شود).
--   • قبل از تغییر، وضعیت فعلی را هم به‌عنوان پشتیبان نگه می‌دارد.
--
-- این اسکریپت جایگزین کامل نیست؛ ادغام است.
-- اگر خطای تابع نیامد، اول فایل مهاجرت
-- supabase/migrations/20260902120000_never_replace_catalog_with_empty.sql
-- را در SQL Editor اجرا کنید.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.kamix_jsonb_array_len(j jsonb)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN j IS NULL THEN 0
    WHEN jsonb_typeof(j) = 'array' THEN jsonb_array_length(j)
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION public.kamix_jsonb_union_by_id(live jsonb, incoming jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  out_items jsonb := '[]'::jsonb;
  seen text[] := ARRAY[]::text[];
  rec jsonb;
  rid text;
BEGIN
  IF jsonb_typeof(COALESCE(live, 'null'::jsonb)) IS DISTINCT FROM 'array'
     AND jsonb_typeof(COALESCE(incoming, 'null'::jsonb)) IS DISTINCT FROM 'array' THEN
    RETURN COALESCE(incoming, live);
  END IF;
  FOR rec IN SELECT x FROM jsonb_array_elements(COALESCE(incoming, '[]'::jsonb)) AS t(x)
  LOOP
    rid := rec->>'id';
    IF rid IS NULL OR rid = '' THEN
      out_items := out_items || jsonb_build_array(rec);
    ELSIF NOT (rid = ANY (seen)) THEN
      seen := seen || rid;
      out_items := out_items || jsonb_build_array(rec);
    END IF;
  END LOOP;
  FOR rec IN SELECT x FROM jsonb_array_elements(COALESCE(live, '[]'::jsonb)) AS t(x)
  LOOP
    rid := rec->>'id';
    IF rid IS NULL OR rid = '' THEN
      out_items := out_items || jsonb_build_array(rec);
    ELSIF NOT (rid = ANY (seen)) THEN
      seen := seen || rid;
      out_items := out_items || jsonb_build_array(rec);
    END IF;
  END LOOP;
  RETURN out_items;
END;
$$;

SELECT id, username, first_name, last_name, status, created_at
  FROM public.profiles
 WHERE username ILIKE 'alikhorshidi1998'
    OR (first_name ILIKE '%علی%' AND last_name ILIKE '%خورشید%')
 ORDER BY created_at DESC;

-- اگر چند ردیف آمد، همان alikhorshidi1998 را بردارید.

DO $$
DECLARE
  uid uuid;
  live_row public.user_data%ROWTYPE;
  b record;
  merged_products jsonb := '[]'::jsonb;
  merged_invoices jsonb := '[]'::jsonb;
  merged_customers jsonb := '[]'::jsonb;
  merged_categories jsonb := '[]'::jsonb;
  merged_purchases jsonb := '[]'::jsonb;
  merged_expenses jsonb := '[]'::jsonb;
BEGIN
  SELECT id INTO uid
    FROM public.profiles
   WHERE username = 'alikhorshidi1998'
   LIMIT 1;

  IF uid IS NULL THEN
    RAISE EXCEPTION 'کاربر alikhorshidi1998 پیدا نشد';
  END IF;

  SELECT * INTO live_row FROM public.user_data WHERE user_id = uid;

  INSERT INTO public.user_data_backups (user_id, snapshot)
  SELECT user_id, to_jsonb(d) FROM public.user_data d WHERE user_id = uid;

  IF live_row.user_id IS NOT NULL THEN
    merged_products := public.kamix_jsonb_union_by_id(merged_products, live_row.products);
    merged_invoices := public.kamix_jsonb_union_by_id(merged_invoices, live_row.invoices);
    merged_customers := public.kamix_jsonb_union_by_id(merged_customers, live_row.customers);
    merged_categories := public.kamix_jsonb_union_by_id(merged_categories, live_row.categories);
    merged_purchases := public.kamix_jsonb_union_by_id(merged_purchases, live_row.purchases);
    merged_expenses := public.kamix_jsonb_union_by_id(merged_expenses, live_row.expenses);
  END IF;

  FOR b IN
    SELECT snapshot
      FROM public.user_data_backups
     WHERE user_id = uid
     ORDER BY created_at ASC
  LOOP
    merged_products := public.kamix_jsonb_union_by_id(merged_products, b.snapshot->'products');
    merged_invoices := public.kamix_jsonb_union_by_id(merged_invoices, b.snapshot->'invoices');
    merged_customers := public.kamix_jsonb_union_by_id(merged_customers, b.snapshot->'customers');
    merged_categories := public.kamix_jsonb_union_by_id(merged_categories, b.snapshot->'categories');
    merged_purchases := public.kamix_jsonb_union_by_id(merged_purchases, b.snapshot->'purchases');
    merged_expenses := public.kamix_jsonb_union_by_id(merged_expenses, b.snapshot->'expenses');
  END LOOP;

  IF live_row.user_id IS NOT NULL THEN
    merged_products := public.kamix_jsonb_union_by_id(merged_products, live_row.products);
    merged_invoices := public.kamix_jsonb_union_by_id(merged_invoices, live_row.invoices);
    merged_customers := public.kamix_jsonb_union_by_id(merged_customers, live_row.customers);
    merged_categories := public.kamix_jsonb_union_by_id(merged_categories, live_row.categories);
    merged_purchases := public.kamix_jsonb_union_by_id(merged_purchases, live_row.purchases);
    merged_expenses := public.kamix_jsonb_union_by_id(merged_expenses, live_row.expenses);
  END IF;

  IF live_row.user_id IS NULL THEN
    INSERT INTO public.user_data (user_id, products, invoices, customers, categories, purchases, expenses, updated_at)
    VALUES (uid, merged_products, merged_invoices, merged_customers, merged_categories, merged_purchases, merged_expenses, now());
  ELSE
    UPDATE public.user_data
       SET products = merged_products,
           invoices = merged_invoices,
           customers = merged_customers,
           categories = merged_categories,
           purchases = merged_purchases,
           expenses = merged_expenses,
           updated_at = now()
     WHERE user_id = uid;
  END IF;

  RAISE NOTICE 'alikhorshidi1998 merged products=% invoices=% customers=%',
    public.kamix_jsonb_array_len(merged_products),
    public.kamix_jsonb_array_len(merged_invoices),
    public.kamix_jsonb_array_len(merged_customers);
END $$;

-- نتیجه را ببینید
SELECT p.username, p.first_name, p.last_name,
       public.kamix_jsonb_array_len(d.products) AS products,
       public.kamix_jsonb_array_len(d.invoices) AS invoices,
       public.kamix_jsonb_array_len(d.customers) AS customers,
       d.updated_at
  FROM public.profiles p
  JOIN public.user_data d ON d.user_id = p.id
 WHERE p.username = 'alikhorshidi1998';

SELECT 'LIVE' AS kind, d.updated_at,
       public.kamix_jsonb_array_len(d.products) AS products,
       public.kamix_jsonb_array_len(d.invoices) AS invoices
  FROM public.user_data d
  JOIN public.profiles p ON p.id = d.user_id
 WHERE p.username = 'alikhorshidi1998'
UNION ALL
SELECT 'BACKUP', b.created_at,
       public.kamix_jsonb_array_len(b.snapshot->'products'),
       public.kamix_jsonb_array_len(b.snapshot->'invoices')
  FROM public.user_data_backups b
  JOIN public.profiles p ON p.id = b.user_id
 WHERE p.username = 'alikhorshidi1998'
 ORDER BY 2 DESC NULLS FIRST;
