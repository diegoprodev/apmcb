-- Fix: RLS de cautelamentos e profiles_update não escopava por tenant_id,
-- permitindo que admin_reserva/armeiro/auditor de um tenant enxergasse (ou,
-- no caso de profiles_update, editasse) registros de custódia de armamento
-- e perfis de OUTRO tenant. profiles_select já tinha sido corrigido com o
-- padrão my_tenant_id() (ver 20260629000003_fix_rls_recursion_profiles_reserves.sql);
-- esta migration completa o mesmo padrão em cautelamentos_select/update e profiles_update.
--
-- Achado ao investigar um relato do dono do projeto sobre a página de
-- Relatórios: a nova aba "Cautelas" consulta cautelamentos diretamente via
-- Supabase SSR (RLS), tornando o vazamento diretamente explorável a partir
-- do client, não só teórico a nível de banco.

DROP POLICY IF EXISTS cautelamentos_select ON cautelamentos;
CREATE POLICY cautelamentos_select ON cautelamentos
  FOR SELECT USING (
    militar_id = auth.uid()
    OR auth_role() = ANY (ARRAY['superadmin'::role_enum, 'admin_global'::role_enum])
    OR (
      auth_role() = ANY (ARRAY['admin_reserva'::role_enum, 'armeiro'::role_enum, 'auditor'::role_enum])
      AND tenant_id = my_tenant_id()
    )
  );

DROP POLICY IF EXISTS cautelamentos_update ON cautelamentos;
CREATE POLICY cautelamentos_update ON cautelamentos
  FOR UPDATE USING (
    auth_role() = ANY (ARRAY['superadmin'::role_enum, 'admin_global'::role_enum])
    OR (
      auth_role() = ANY (ARRAY['admin_reserva'::role_enum, 'armeiro'::role_enum])
      AND tenant_id = my_tenant_id()
    )
  );

DROP POLICY IF EXISTS profiles_update ON profiles;
CREATE POLICY profiles_update ON profiles
  FOR UPDATE USING (
    auth_role() = ANY (ARRAY['superadmin'::role_enum, 'admin_global'::role_enum])
    OR (
      auth_role() = 'admin_reserva'::role_enum
      AND default_tenant_id = my_tenant_id()
    )
    OR (
      auth.uid() = id
      AND auth_role() = ANY (ARRAY['usuario'::role_enum, 'armeiro'::role_enum, 'auditor'::role_enum])
    )
  );
