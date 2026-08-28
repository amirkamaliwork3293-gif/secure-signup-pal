-- ════════════════════════════════════════════════════════════════════════════
-- ذخیره ابری کاربران با خطای 403 قطع شده بود.
-- این فایل را کامل کپی کنید → سوپابیس → SQL Editor → Run.
--
-- علت: تریگر محافظ کاتالوگ با دسترسی خودِ کاربر اجرا می‌شد و تابع کمکی‌اش
-- برای کاربر قفل بود؛ برای همین UPDATE روی user_data رد می‌شد.
-- بعد از Run، یک‌بار در سایت کالا یا فاکتور را ذخیره کنید؛ خطای کنسول باید برود.
-- ════════════════════════════════════════════════════════════════════════════

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_data TO authenticated;
GRANT ALL ON public.user_data TO service_role;

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

REVOKE ALL ON FUNCTION public.protect_user_data_catalog() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS user_data_protect_catalog ON public.user_data;
CREATE TRIGGER user_data_protect_catalog
  BEFORE UPDATE ON public.user_data
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_user_data_catalog();

SELECT
  p.prosecdef AS trigger_is_security_definer,
  has_table_privilege('authenticated', 'public.user_data', 'UPDATE') AS authenticated_can_update
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'protect_user_data_catalog';
