-- جلوگیری از پاک شدن کاتالوگ کاربر:
-- ۱) آرایهٔ خالی هرگز روی آرایهٔ پر نمی‌نشیند.
-- ۲) به‌روزرسانی آرایه‌ها ادغامی است تا کالای جدید با نسخهٔ قدیمی ابر عوض نشود.

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

  FOR rec IN
    SELECT x FROM jsonb_array_elements(COALESCE(incoming, '[]'::jsonb)) AS t(x)
  LOOP
    rid := rec->>'id';
    IF rid IS NULL OR rid = '' THEN
      out_items := out_items || jsonb_build_array(rec);
    ELSIF NOT (rid = ANY (seen)) THEN
      seen := seen || rid;
      out_items := out_items || jsonb_build_array(rec);
    END IF;
  END LOOP;

  FOR rec IN
    SELECT x FROM jsonb_array_elements(COALESCE(live, '[]'::jsonb)) AS t(x)
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

CREATE OR REPLACE FUNCTION public.protect_user_data_catalog()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF public.kamix_json_looks_vandalized(NEW.products)
     AND NOT public.kamix_json_looks_vandalized(OLD.products) THEN
    NEW.products := OLD.products;
  ELSIF public.kamix_jsonb_array_len(NEW.products) = 0
     AND public.kamix_jsonb_array_len(OLD.products) > 0 THEN
    NEW.products := OLD.products;
  ELSE
    NEW.products := public.kamix_jsonb_union_by_id(OLD.products, NEW.products);
  END IF;

  IF public.kamix_json_looks_vandalized(NEW.invoices)
     AND NOT public.kamix_json_looks_vandalized(OLD.invoices) THEN
    NEW.invoices := OLD.invoices;
  ELSIF public.kamix_jsonb_array_len(NEW.invoices) = 0
     AND public.kamix_jsonb_array_len(OLD.invoices) > 0 THEN
    NEW.invoices := OLD.invoices;
  ELSE
    NEW.invoices := public.kamix_jsonb_union_by_id(OLD.invoices, NEW.invoices);
  END IF;

  IF public.kamix_json_looks_vandalized(NEW.categories)
     AND NOT public.kamix_json_looks_vandalized(OLD.categories) THEN
    NEW.categories := OLD.categories;
  ELSIF public.kamix_jsonb_array_len(NEW.categories) = 0
     AND public.kamix_jsonb_array_len(OLD.categories) > 0 THEN
    NEW.categories := OLD.categories;
  ELSE
    NEW.categories := public.kamix_jsonb_union_by_id(OLD.categories, NEW.categories);
  END IF;

  IF public.kamix_json_looks_vandalized(NEW.customers)
     AND NOT public.kamix_json_looks_vandalized(OLD.customers) THEN
    NEW.customers := OLD.customers;
  ELSIF public.kamix_jsonb_array_len(NEW.customers) = 0
     AND public.kamix_jsonb_array_len(OLD.customers) > 0 THEN
    NEW.customers := OLD.customers;
  ELSE
    NEW.customers := public.kamix_jsonb_union_by_id(OLD.customers, NEW.customers);
  END IF;

  IF public.kamix_json_looks_vandalized(NEW.current_invoice)
     AND NOT public.kamix_json_looks_vandalized(OLD.current_invoice) THEN
    NEW.current_invoice := OLD.current_invoice;
  END IF;

  IF public.kamix_json_looks_vandalized(NEW.settings)
     AND NOT public.kamix_json_looks_vandalized(OLD.settings) THEN
    NEW.settings := OLD.settings;
  END IF;

  IF public.kamix_jsonb_array_len(NEW.purchases) = 0
     AND public.kamix_jsonb_array_len(OLD.purchases) > 0 THEN
    NEW.purchases := OLD.purchases;
  ELSIF jsonb_typeof(COALESCE(NEW.purchases, 'null'::jsonb)) = 'array'
     OR jsonb_typeof(COALESCE(OLD.purchases, 'null'::jsonb)) = 'array' THEN
    NEW.purchases := public.kamix_jsonb_union_by_id(OLD.purchases, NEW.purchases);
  END IF;

  IF public.kamix_jsonb_array_len(NEW.expenses) = 0
     AND public.kamix_jsonb_array_len(OLD.expenses) > 0 THEN
    NEW.expenses := OLD.expenses;
  ELSIF jsonb_typeof(COALESCE(NEW.expenses, 'null'::jsonb)) = 'array'
     OR jsonb_typeof(COALESCE(OLD.expenses, 'null'::jsonb)) = 'array' THEN
    NEW.expenses := public.kamix_jsonb_union_by_id(OLD.expenses, NEW.expenses);
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_user_data_catalog() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kamix_jsonb_union_by_id(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kamix_jsonb_array_len(jsonb) FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS user_data_protect_catalog ON public.user_data;
CREATE TRIGGER user_data_protect_catalog
  BEFORE UPDATE ON public.user_data
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_user_data_catalog();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_data TO authenticated;
GRANT ALL ON public.user_data TO service_role;
