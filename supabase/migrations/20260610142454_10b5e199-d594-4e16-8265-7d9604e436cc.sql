
CREATE POLICY "anyone_upload_receipts" ON storage.objects FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'receipts');
CREATE POLICY "admins_read_receipts" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'receipts' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "owners_read_receipts" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'receipts' AND owner = auth.uid());
