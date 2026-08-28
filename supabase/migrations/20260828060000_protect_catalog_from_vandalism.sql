-- جلوگیری از بازنویسی کاتالوگ سالم با فحاشی / نام‌های چینی.
-- اگر اپ قدیمی هنوز روی گوشی کاربر باشد، این تریگر نسخهٔ ابری را نگه می‌دارد.

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

REVOKE ALL ON FUNCTION public.kamix_json_looks_vandalized(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.protect_user_data_catalog()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_data_protect_catalog ON public.user_data;
CREATE TRIGGER user_data_protect_catalog
  BEFORE UPDATE ON public.user_data
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_user_data_catalog();
