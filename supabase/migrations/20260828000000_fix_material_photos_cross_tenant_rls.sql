-- ═══════════════════════════════════════════════════════════════════
-- CRÍTICO: material-photos permitia qualquer usuário autenticado de
-- QUALQUER tenant ler a foto de material de QUALQUER OUTRO tenant.
-- ═══════════════════════════════════════════════════════════════════
-- Achado de code review (2026-08-27) ao revisar o fix do bug de photo_url
-- em POST /api/arsenal/requests — não é regressão daquele fix, é falha
-- pré-existente que o próprio bug mascarava sem querer (ver spec completa
-- em docs/enterprise/specs/material-photos-tenant-isolation-enterprise.md).
--
-- Policy atual (desde 20260629000001_fix_rls_security_audit.sql), sem
-- filtro de tenant nenhum:
--   CREATE POLICY "material_photos_auth_read" ON storage.objects
--     FOR SELECT TO authenticated USING (bucket_id = 'material-photos');
--
-- Superfície real de exploração hoje é estreita (toda exibição de foto na
-- UI passa pelo BFF com service role, que bypassa RLS por completo — ver
-- spec §2) mas a falha de autorização em si é real: qualquer usuário
-- autenticado que descubra um path de outro tenant (screenshot, log,
-- network tab) lê a foto direto via SDK do Supabase no navegador.
--
-- Fix: function SECURITY DEFINER que confere posse via JOIN nas tabelas de
-- negócio (material_types/material_items, que já têm tenant_id desde
-- 20260620000001_multitenant_foundation.sql) — ZERO mudança de dado, o
-- path do objeto nunca muda, só a leitura direta via SDK passa a exigir
-- que o path pertença a uma linha do tenant do usuário. Reaproveita
-- my_tenant_id(), já testado e em produção desde
-- 20260629000006_fix_auth_role_recursion.sql (SECURITY DEFINER, STABLE,
-- desenhado especificamente pra evitar o bug de recursão de RLS que aquela
-- migration corrigiu).
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION can_read_material_photo(object_path TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM material_types mt
      WHERE mt.photo_url = object_path
        AND mt.tenant_id = my_tenant_id()
    )
    OR EXISTS (
      SELECT 1 FROM material_items mi
      WHERE mi.ocorrencia_foto_url = object_path
        AND mi.tenant_id = my_tenant_id()
    )
$$;

COMMENT ON FUNCTION can_read_material_photo(TEXT) IS
  'Confere se o path de um objeto do bucket material-photos pertence a um '
  'material_type ou material_item (foto de ocorrência) do tenant do usuário '
  'autenticado atual. SECURITY DEFINER pra poder ler material_types/'
  'material_items sem depender da RLS dessas tabelas (evita recursão, mesmo '
  'motivo de my_tenant_id() ser SECURITY DEFINER). Usado só pela policy de '
  'leitura direta via SDK do browser — o BFF (service role) nunca passa por '
  'aqui, bypassa RLS por design.';

DROP POLICY IF EXISTS "material_photos_auth_read" ON storage.objects;

CREATE POLICY "material_photos_tenant_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'material-photos' AND can_read_material_photo(name));

-- Rollback de emergência, se esta policy travar leitura legítima em produção
-- (ex.: nome de coluna divergente do schema real — validar com o harness da
-- spec ANTES de aplicar em produção, seção 5):
--
--   DROP POLICY IF EXISTS "material_photos_tenant_read" ON storage.objects;
--   CREATE POLICY "material_photos_auth_read" ON storage.objects
--     FOR SELECT TO authenticated USING (bucket_id = 'material-photos');
