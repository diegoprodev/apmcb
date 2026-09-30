-- Baseline das policies de storage.objects para o bucket profile-photos,
-- exatamente como em pg_policies de produção (lido como metadado em 2026-09-30)
-- e idêntico às migrations 20260614000002 / 20260627000002 / 20260629000001.
-- Formato canônico (uma policy por linha): nome|cmd|permissive|roles|using|with_check
admin_master_can_update_photos|UPDATE|PERMISSIVE|{authenticated}|((bucket_id = 'profile-photos'::text) AND (EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::role_enum, 'master'::role_enum]))))))|
admin_master_can_upload_photos|INSERT|PERMISSIVE|{authenticated}||((bucket_id = 'profile-photos'::text) AND (EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::role_enum, 'master'::role_enum]))))))
profile_photos_auth_read|SELECT|PERMISSIVE|{authenticated}|(bucket_id = 'profile-photos'::text)|
profile_photos_authenticated_insert|INSERT|PERMISSIVE|{authenticated}||(bucket_id = 'profile-photos'::text)
profile_photos_authenticated_update|UPDATE|PERMISSIVE|{authenticated}|(bucket_id = 'profile-photos'::text)|
