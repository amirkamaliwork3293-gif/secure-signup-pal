
-- 1) Remove public SELECT on signup_requests
DROP POLICY IF EXISTS "anyone_read_own_request_by_username" ON public.signup_requests;

CREATE POLICY "admins_read_signup_requests"
ON public.signup_requests
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 2) Tighten receipts upload policy with strict path pattern
DROP POLICY IF EXISTS "anyone_upload_receipts" ON storage.objects;

CREATE POLICY "anyone_upload_receipts"
ON storage.objects
FOR INSERT
TO anon, authenticated
WITH CHECK (
  bucket_id = 'receipts'
  AND name ~ '^[a-z0-9_-]{1,40}/[0-9]+-[a-z0-9]+\.(jpg|jpeg|png|webp)$'
);

-- 3) Restrict UPDATE/DELETE on receipts to admins only (restrictive deny-by-default for everyone else)
CREATE POLICY "admins_update_receipts"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'receipts' AND public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (bucket_id = 'receipts' AND public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "admins_delete_receipts"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'receipts' AND public.has_role(auth.uid(), 'admin'::app_role));
