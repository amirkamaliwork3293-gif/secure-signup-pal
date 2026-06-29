
DROP POLICY IF EXISTS anyone_upload_receipts ON storage.objects;

CREATE POLICY anyone_upload_receipts ON storage.objects
FOR INSERT TO anon, authenticated
WITH CHECK (
  bucket_id = 'receipts'
  AND name ~* '^[a-z0-9_.-]{1,64}/[a-z0-9_.-]{1,80}\.(jpg|jpeg|png|webp|heic|heif)$'
);
