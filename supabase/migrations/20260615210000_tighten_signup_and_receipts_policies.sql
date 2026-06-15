-- Tighten public-facing RLS:
--   1) Drop overly-broad public SELECT on signup_requests (USING true exposed all rows).
--      Admin reads continue to work via the service-role server functions.
--   2) Restrict anonymous receipt uploads to a safe path/extension shape so the
--      bucket cannot be used as a free file dump.

DROP POLICY IF EXISTS "anyone_read_own_request_by_username" ON public.signup_requests;

DROP POLICY IF EXISTS "anyone_upload_receipts" ON storage.objects;

CREATE POLICY "anyone_upload_receipts"
ON storage.objects
FOR INSERT
TO anon, authenticated
WITH CHECK (
  bucket_id = 'receipts'
  AND name ~ '^[a-z0-9_-]{1,40}/[0-9]+-[a-z0-9]+\.(jpg|jpeg|png|webp)$'
);
