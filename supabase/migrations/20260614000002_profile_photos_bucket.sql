-- Storage bucket for military profile photos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'profile-photos',
  'profile-photos',
  true,
  5242880, -- 5 MB
  ARRAY['image/jpeg','image/jpg','image/png','image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Allow admin and master roles to upload photos
CREATE POLICY "admin_master_can_upload_photos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'profile-photos'
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin', 'master')
    )
  );

-- Allow admin and master to update (upsert) their uploads
CREATE POLICY "admin_master_can_update_photos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'profile-photos'
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin', 'master')
    )
  );

-- Public read — bucket is public so this covers anonymous reads
CREATE POLICY "public_read_photos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'profile-photos');
