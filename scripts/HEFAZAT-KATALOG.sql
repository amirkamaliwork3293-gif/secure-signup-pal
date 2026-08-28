-- ════════════════════════════════════════════════════════════════════════════
-- این فایل را کامل کپی کنید و در سوپابیس → SQL Editor → Run بزنید.
--
-- چه می‌کند:
--   ۱) اگر گوشی کاربر هنوز نسخهٔ خراب (فحاشی / اسم چینی) را داشته باشد،
--      دیگر نمی‌تواند آن را روی دادهٔ سالم سوپابیس بنویسد.
--   ۲) فهرستی از حساب‌هایی که خودِ دادهٔ ابری‌شان هنوز خراب است نشان می‌دهد
--      (این‌ها را باید از «بازیابی محصولات و فاکتورها» در پنل ادمین برگردانید).
--
-- بعد از Run:
--   سایت را Publish کنید. به کاربر آسیب‌دیده بگویید اپ را کامل ببندد و دوباره باز کند.
-- ════════════════════════════════════════════════════════════════════════════

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

-- اگر این فهرست خالی بود یعنی دادهٔ ابری سالم است (مثل مهران بهوندی).
-- برنامه باید همان نام‌های سوپابیس را بعد از باز شدن دوبارهٔ اپ نشان بدهد.
-- اگر ردیفی دیدید، در پنل ادمین «بازیابی محصولات و فاکتورها» را برای همان کاربر بزنید.
SELECT p.username,
       p.first_name,
       p.last_name,
       public.kamix_json_looks_vandalized(d.products) AS products_bad,
       public.kamix_json_looks_vandalized(d.invoices) AS invoices_bad,
       (SELECT string_agg(x, ' | ')
          FROM (
            SELECT e->>'name' AS x
              FROM jsonb_array_elements(COALESCE(d.products, '[]'::jsonb)) e
             LIMIT 6
          ) s) AS sample_products
  FROM public.profiles p
  JOIN public.user_data d ON d.user_id = p.id
 WHERE public.kamix_json_looks_vandalized(d.products)
    OR public.kamix_json_looks_vandalized(d.invoices)
 ORDER BY p.last_name, p.first_name;
