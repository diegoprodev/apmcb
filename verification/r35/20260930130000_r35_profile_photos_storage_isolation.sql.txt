-- ═══════════════════════════════════════════════════════════════════
-- R-35 — isolamento do bucket privado `profile-photos`
-- (docs/auditoria/EVIDENCE_R35.md)
--
-- Problema: as policies de storage.objects para `profile-photos` autorizavam
-- qualquer `authenticated` só por bucket_id:
--   profile_photos_auth_read            SELECT  USING (bucket_id = 'profile-photos')
--   profile_photos_authenticated_insert INSERT  WITH CHECK (bucket_id = 'profile-photos')
--   profile_photos_authenticated_update UPDATE  USING (bucket_id = 'profile-photos')  (sem WITH CHECK)
-- → qualquer usuário autenticado, de qualquer tenant, lia, criava e
--   sobrescrevia/movia qualquer foto de perfil pela API de Storage.
-- Além delas, admin_master_can_upload_photos / admin_master_can_update_photos
-- autorizam papéis legados ('admin', 'master') por profiles.role.
--
-- Modelo real (verificado no código, não inventado):
--   - TODA escrita legítima usa service_role: BFF replaceProfilePhoto
--     (POST /api/profiles/me/photo e /:id/photo, path `<profile_id>/<uuid>.webp`
--     gerado no servidor, autorização self ou staff do mesmo tenant),
--     POST /api/admin/upload-photo (`legacy-staged/<uuid>.webp`, staff),
--     scripts de manutenção e setup de E2E.
--   - TODA leitura legítima usa service_role: GET /api/profiles/:id/photo-url
--     gera URL assinada (TTL 1h) só para o próprio perfil ou staff do mesmo
--     tenant da sessão; o web não lê o bucket com o JWT do usuário.
--   - O path não é fonte de verdade de tenant (não contém tenant_id); a
--     vinculação objeto → perfil → tenant vive em profiles.foto_url /
--     default_tenant_id, avaliada no BFF.
-- Logo, a menor policy segura é NENHUMA para authenticated/anon: deny by
-- default. service_role ignora RLS e segue funcionando.
--
-- Escopo: somente o bucket `profile-photos`. Não altera grants (R-36),
-- material-photos nem outros buckets, nem tabelas de public (R-34).
-- Aplicação remota: NÃO feita nesta entrega (ver EVIDENCE_R35.md).
--
-- ROLLBACK (reabre R-35 — só para emergência):
--   recriar as 5 policies com as definições de
--   20260614000002 / 20260627000002 / 20260629000001.
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS profile_photos_auth_read            ON storage.objects;
DROP POLICY IF EXISTS profile_photos_authenticated_insert ON storage.objects;
DROP POLICY IF EXISTS profile_photos_authenticated_update ON storage.objects;
DROP POLICY IF EXISTS admin_master_can_upload_photos      ON storage.objects;
DROP POLICY IF EXISTS admin_master_can_update_photos      ON storage.objects;

-- Guardas (falham a migration inteira em vez de deixar acesso aberto):
DO $$
DECLARE
  leftover text;
  is_public boolean;
BEGIN
  -- Escopo das guardas 1 e 2: só policies PERMISSIVAS aplicáveis a anon,
  -- authenticated ou PUBLIC — as únicas que concedem acesso direto a esses
  -- papéis (policies permissivas se somam; RESTRICTIVE só restringe;
  -- service_role ignora RLS). Policies de outros buckets não são afetadas.

  -- 1. Nenhuma dessas policies pode citar o bucket (inclui drift de nome:
  --    uma policy equivalente com outro nome reabriria o acesso).
  SELECT string_agg(policyname, ', ') INTO leftover
    FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND permissive = 'PERMISSIVE'
     AND roles && ARRAY['anon', 'authenticated', 'public']::name[]
     AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%profile-photos%';
  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION 'R-35: policy remanescente referencia profile-photos: %', leftover;
  END IF;

  -- 2. Nenhuma dessas policies pode deixar de filtrar bucket_id: sem filtro
  --    de bucket ela vale para TODOS os buckets, inclusive profile-photos.
  --    Policies que filtram outro bucket (ex.: material-photos) passam.
  SELECT string_agg(policyname, ', ') INTO leftover
    FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND permissive = 'PERMISSIVE'
     AND roles && ARRAY['anon', 'authenticated', 'public']::name[]
     AND (coalesce(qual, '') || coalesce(with_check, '')) NOT LIKE '%bucket_id%';
  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION 'R-35: policy aplicável a anon/authenticated sem filtro de bucket_id alcança profile-photos: %', leftover;
  END IF;

  -- 3. O bucket precisa continuar privado (URL pública ignoraria as policies).
  SELECT public INTO is_public FROM storage.buckets WHERE id = 'profile-photos';
  IF is_public IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'R-35: bucket profile-photos ausente ou público (public=%)', is_public;
  END IF;
END $$;
