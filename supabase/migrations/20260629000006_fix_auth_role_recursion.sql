-- ═══════════════════════════════════════════════════════════════════
-- CRÍTICO: corrigir recursão infinita em profiles_select
-- ═══════════════════════════════════════════════════════════════════
-- CAUSA: auth_role() lê de profiles sem SECURITY DEFINER →
--   profiles_select chama auth_role() → auth_role() SELECT profiles →
--   profiles_select é avaliado novamente → loop infinito
-- ═══════════════════════════════════════════════════════════════════

-- 1. auth_role() com SECURITY DEFINER — bypassa RLS ao ler profiles
--    ALTER preserva todas as policies dependentes (sem DROP CASCADE)
ALTER FUNCTION auth_role() SECURITY DEFINER;
ALTER FUNCTION auth_role() SET search_path = public, pg_temp;

-- 2. Helper para tenant sem subquery recursivo em profiles_select
CREATE OR REPLACE FUNCTION my_tenant_id()
RETURNS UUID
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT default_tenant_id FROM profiles WHERE id = auth.uid()
$$;

-- 3. Recriar profiles_select sem subquery autorreferente
DROP POLICY IF EXISTS profiles_select ON profiles;
CREATE POLICY profiles_select ON profiles
  FOR SELECT USING (
    auth.uid() = id
    OR auth_role() IN ('admin_global', 'superadmin')
    OR (
      auth_role() IN ('admin_reserva', 'armeiro', 'auditor')
      AND default_tenant_id = my_tenant_id()
    )
  );
