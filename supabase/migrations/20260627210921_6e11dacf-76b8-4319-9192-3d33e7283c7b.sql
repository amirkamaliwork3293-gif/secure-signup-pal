
DROP POLICY IF EXISTS "menu_images_owner_write" ON storage.objects;
DROP POLICY IF EXISTS "menu_images_owner_update" ON storage.objects;
DROP POLICY IF EXISTS "menu_images_owner_delete" ON storage.objects;
DROP POLICY IF EXISTS "menu_images_owner_read" ON storage.objects;

CREATE POLICY "menu_images_owner_write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'menu-images' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "menu_images_owner_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'menu-images' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "menu_images_owner_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'menu-images' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "menu_images_owner_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'menu-images' AND (storage.foldername(name))[1] = auth.uid()::text);
