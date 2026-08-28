-- ═══════════════════════════════════════════════════════════════════
-- CRÍTICO: policy da tabela `ocorrencias` (reportes de problema com
-- material feitos pelo próprio militar) usava nomes de role OBSOLETOS —
-- nenhum armeiro/admin_reserva/admin_global/superadmin real conseguia ver
-- NENHUMA ocorrência reportada, desde a migração de roles. Ao corrigir os
-- nomes, a mesma policy também não tinha NENHUM isolamento por tenant —
-- corrigindo só os nomes reabriria exatamente o mesmo tipo de vazamento
-- cross-tenant já corrigido hoje em material-photos
-- (20260828000000_fix_material_photos_cross_tenant_rls.sql). Os dois
-- problemas são corrigidos juntos nesta migration, mesmo raciocínio.
-- ═══════════════════════════════════════════════════════════════════
-- Achado ao investigar por que uma ocorrência de material reportada por um
-- militar (matrícula 000003) nunca foi vista/resolvida por nenhum armeiro —
-- confirmado com dado real: `SELECT count(*) FROM ocorrencias` tem 1 linha
-- em "em_analise", e `SELECT role, count(*) FROM profiles GROUP BY role`
-- confirma ZERO profiles com role 'admin'/'master' (os únicos valores que a
-- policy antiga aceitava) — só os roles atuais (armeiro, admin_reserva,
-- admin_global, superadmin, usuario, auditor). A página
-- apps/web/src/app/(dashboard)/reserva/ocorrencias/page.tsx (Server
-- Component, query direta sujeita a RLS) sempre devolvia lista vazia pra
-- QUALQUER staff real, mascarando silenciosamente todo relato desde a
-- reforma de roles.
--
-- Policy antiga:
--   CREATE POLICY occ_staff ON ocorrencias FOR ALL
--     USING (auth_role() = ANY (ARRAY['master'::role_enum, 'admin'::role_enum]));
--
-- Fix: nomes de role atuais (armeiro/admin_reserva/admin_global — mesmo
-- conjunto que a própria página já valida no redirect de acesso) + escopo
-- por tenant via profiles.default_tenant_id do MILITAR que reportou
-- (`ocorrencias` não tem tenant_id/reserve_id próprio — nunca foi
-- atualizada desde antes da fundação multi-tenant,
-- 20260620000001_multitenant_foundation.sql). superadmin (plataforma,
-- também permitido a acessar esta página) fica fora do filtro de tenant —
-- é o papel cross-tenant por natureza, mesmo tratamento que outras
-- policies desta base dão a ele.
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS occ_staff ON ocorrencias;

CREATE POLICY occ_staff ON ocorrencias
  FOR ALL
  USING (
    auth_role() = 'superadmin'::role_enum
    OR (
      auth_role() = ANY (ARRAY['armeiro'::role_enum, 'admin_reserva'::role_enum, 'admin_global'::role_enum])
      AND EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.id = ocorrencias.military_id
          AND p.default_tenant_id = my_tenant_id()
      )
    )
  );

-- Rollback de emergência (restaura o comportamento antigo — staff nunca vê
-- nada, mas não introduz vazamento cross-tenant novo):
--
--   DROP POLICY IF EXISTS occ_staff ON ocorrencias;
--   CREATE POLICY occ_staff ON ocorrencias FOR ALL
--     USING (auth_role() = ANY (ARRAY['master'::role_enum, 'admin'::role_enum]));
