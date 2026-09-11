-- ═══════════════════════════════════════════════════════════════════
-- HOTFIX DE SEGURANÇA — tabela `tenants` gravável por qualquer um (inclusive anon)
--
-- Estado achado 2026-09-10:
--   • única policy: `tenants_service_role FOR ALL TO public USING(true) WITH CHECK(true)`
--   • grants: anon E authenticated têm INSERT/UPDATE/DELETE/TRUNCATE
--   → com a anon key (pública, no bundle JS), SEM login:
--       DELETE FROM tenants  → CASCADE apaga org_units/reserves/tenant_memberships
--                              de TODOS os tenants
--       UPDATE tenants SET status='suspended'  → trava todo mundo
--       mutação de contrato/subdomínio/limites/branding
--   Provado explorável (tx revertida, role anon): UPDATE tenants rows=1.
--
-- Toda escrita LEGÍTIMA em `tenants` passa pelo BFF com a service_role key
-- (apps/bff/src/routes/{nexus,admin,index}.ts). `layout.tsx` só LÊ o próprio tenant.
--
-- ROLLBACK no fim.
-- ═══════════════════════════════════════════════════════════════════

-- 1. Revoga escrita de anon/authenticated (REVOKE de TABELA — pega de verdade,
--    diferente de REVOKE de coluna). service_role tem bypassrls + não é afetado.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.tenants FROM authenticated, anon;

-- 2. Trigger belt: mesmo que o Supabase re-conceda o grant num CREATE OR REPLACE
--    futuro (já mordeu este projeto 3×: 20260714000007/008, 20260829060000),
--    bloqueia escrita direta de usuário final.
CREATE OR REPLACE FUNCTION public.tenants_block_enduser_writes()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'tenants: escrita só via backend (service_role)' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS tenants_block_enduser_writes ON public.tenants;
CREATE TRIGGER tenants_block_enduser_writes
  BEFORE INSERT OR UPDATE OR DELETE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.tenants_block_enduser_writes();

-- 3. SELECT: anon perde acesso (estava lendo nome/contrato/valor_pago de TODOS os
--    tenants). authenticated fica escopado ao próprio tenant.
DROP POLICY IF EXISTS tenants_service_role ON public.tenants;
CREATE POLICY tenants_select_own ON public.tenants
  FOR SELECT
  TO authenticated
  USING (
    id = (SELECT default_tenant_id FROM public.profiles WHERE id = auth.uid())
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'superadmin'::role_enum
  );

-- ─── ROLLBACK ──────────────────────────────────────────────────────
-- DROP TRIGGER IF EXISTS tenants_block_enduser_writes ON public.tenants;
-- DROP FUNCTION IF EXISTS public.tenants_block_enduser_writes();
-- DROP POLICY IF EXISTS tenants_select_own ON public.tenants;
-- CREATE POLICY tenants_service_role ON public.tenants FOR ALL USING (true) WITH CHECK (true);
-- GRANT INSERT, UPDATE, DELETE ON public.tenants TO authenticated;  -- (NÃO recomendado — era o bug)
-- ═══════════════════════════════════════════════════════════════════
