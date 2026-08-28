-- ═══════════════════════════════════════════════════════════════════
-- CRÍTICO (achado de code review, 2026-08-28, corrigindo a própria
-- migration anterior no mesmo dia): a policy `occ_staff` criada em
-- 20260828020000_fix_ocorrencias_rls_obsolete_roles_and_tenant_leak.sql
-- incluiu `auth_role() = 'superadmin'::role_enum` como branch de acesso
-- IRRESTRITO (sem filtro de tenant nenhum) — regra canônica deste projeto,
-- confirmada em 20260711000003_fix_rls_superadmin_and_admin_global_tenant_scope.sql
-- e 20260814120000_fix_rls_admin_approval_requests_stale_role.sql, é que
-- superadmin é papel de operação da PLATAFORMA (Nexus/SaaS) e NUNCA deve
-- acessar dado operacional de tenant algum — confirmado também que nenhuma
-- outra policy tenant-scoped do banco referencia 'superadmin' no `qual`
-- (SELECT ... FROM pg_policies WHERE qual ILIKE '%superadmin%' → vazio,
-- exceto a que esta migration corrige).
--
-- A policy antiga (roles obsoletos 'master'/'admin') era "segura por
-- acidente": nunca batia para superadmin, então nunca vazava nada. Ao
-- corrigir os nomes de role, a migration anterior reintroduziu o acesso
-- cross-tenant que a regra do projeto proíbe explicitamente —
-- apps/web/.../reserva/ocorrencias/page.tsx já permite superadmin acessar
-- a página (linha ~17) confiando 100% na RLS pra isolar por tenant; sem
-- este fix, um superadmin logado nessa página veria ocorrências de TODOS
-- os tenants da plataforma.
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS occ_staff ON ocorrencias;

CREATE POLICY occ_staff ON ocorrencias
  FOR ALL
  USING (
    auth_role() = ANY (ARRAY['armeiro'::role_enum, 'admin_reserva'::role_enum, 'admin_global'::role_enum])
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = ocorrencias.military_id
        AND p.default_tenant_id = my_tenant_id()
    )
  );
