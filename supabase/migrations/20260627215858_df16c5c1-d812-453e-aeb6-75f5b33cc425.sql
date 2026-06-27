CREATE POLICY "Public can read menu images"
ON storage.objects FOR SELECT TO anon, authenticated
USING (bucket_id = 'menu-images');