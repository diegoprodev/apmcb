-- ═══════════════════════════════════════════════════════════════════
-- HOTFIX DE SEGURANÇA — escalonamento de privilégio via UPDATE em profiles
--
-- Regressão: 20260711000003_fix_rls_superadmin_and_admin_global_tenant_scope.sql
-- recriou a policy `profiles_update` só com USING, perdendo o WITH CHECK e o
-- congelamento de coluna que 20260614000003_security_hardening.sql tinha posto
-- ("CRITICAL: Prevent military from escalating own role").
--
-- Sem WITH CHECK, o Postgres reusa o USING para checar a linha nova. `auth_role()`
-- é STABLE → no UPDATE enxerga o papel ANTIGO ('usuario'), então a linha nova com
-- role='admin_global' passa. Não há trigger BEFORE UPDATE protegendo colunas.
-- `authenticated` tem GRANT de UPDATE em role/default_tenant_id/registration_status/
-- account_activated_at.
--
-- Explorável (provado 2026-09-10 em transação revertida, conta de teste):
--   -- como authenticated, com o próprio sub no JWT:
--   UPDATE public.profiles SET role='admin_global' WHERE id = auth.uid();  -- 1 row
--   UPDATE public.profiles SET default_tenant_id='<outro tenant>' WHERE id = auth.uid();
-- Efeito: vira admin_global e/ou aponta my_tenant_id() para outro tenant →
-- quebra total do isolamento multi-tenant (toda policy escopa por my_tenant_id()).
--
-- Toda escrita LEGÍTIMA dessas colunas passa pelo BFF com a service_role key
-- (apps/bff/src/services/supabase.ts: createClient(url, SERVICE_ROLE_KEY)) —
-- PATCH /api/profiles/:id, PATCH /api/profiles/me, rotas admin. Grants de coluna
-- não afetam a service_role. As RPCs SECURITY DEFINER que tocam
-- registration_status (record_biometric_enrollment, record_cautelamento_batch)
-- rodam como `postgres` (current_user='postgres'), fora do bloqueio abaixo.
--
-- ROLLBACK (no fim do arquivo).
-- ═══════════════════════════════════════════════════════════════════

-- 1. Revoga UPDATE nas colunas privilegiadas de authenticated/anon.
--    NOTA (pós-aplicação): um REVOKE de COLUNA não subtrai de um GRANT de
--    TABELA já existente (`GRANT UPDATE ON profiles TO authenticated`), então
--    esta linha sozinha é inócua. Quem barra o vetor de fato é o TRIGGER do
--    passo 2 (verificado: exploit bloqueado com 42501, fluxos legítimos via
--    service_role intactos). Endurecer a camada de GRANT — revogar UPDATE de
--    tabela e re-conceder só as colunas de perfil — fica como follow-up
--    separado (baixa urgência: nenhuma escrita de perfil usa token de usuário
--    final hoje; tudo passa pelo BFF com service_role).
REVOKE UPDATE (role, default_tenant_id, registration_status, account_activated_at, created_by)
  ON public.profiles FROM authenticated, anon;

-- 2. Defesa em profundidade: trigger que congela essas colunas para qualquer
--    ator que seja o DB role `authenticated`/`anon` (requisição direta de
--    usuário final via PostgREST). service_role, postgres (RPCs SECURITY
--    DEFINER que controlamos) e supabase_auth_admin (GoTrue gravando
--    account_activated_at no on_first_login) passam livres.
CREATE OR REPLACE FUNCTION public.profiles_freeze_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;  -- service_role / postgres (SECURITY DEFINER) / supabase_auth_admin
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.default_tenant_id IS DISTINCT FROM OLD.default_tenant_id
     OR NEW.registration_status IS DISTINCT FROM OLD.registration_status
     OR NEW.account_activated_at IS DISTINCT FROM OLD.account_activated_at THEN
    RAISE EXCEPTION
      'profiles: role, default_tenant_id, registration_status e account_activated_at só podem ser alterados pelo backend (service_role) ou por RPC autorizada'
      USING ERRCODE = '42501';  -- insufficient_privilege
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_freeze_privileged_columns ON public.profiles;
CREATE TRIGGER profiles_freeze_privileged_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_freeze_privileged_columns();

-- 3. Restaura o WITH CHECK em profiles_update (espelha o USING). Com o trigger
--    acima o WITH CHECK é redundante para o vetor conhecido, mas sem ele a
--    policy aceita linha nova fora do próprio escopo — defesa em profundidade
--    exigida pelas duas revisões adversariais.
DROP POLICY IF EXISTS profiles_update ON public.profiles;
CREATE POLICY profiles_update ON public.profiles
  FOR UPDATE
  USING (
    ((auth_role() = ANY (ARRAY['admin_global'::role_enum, 'admin_reserva'::role_enum]))
       AND (default_tenant_id = my_tenant_id()))
    OR ((auth.uid() = id)
       AND (auth_role() = ANY (ARRAY['usuario'::role_enum, 'armeiro'::role_enum, 'auditor'::role_enum])))
  )
  WITH CHECK (
    ((auth_role() = ANY (ARRAY['admin_global'::role_enum, 'admin_reserva'::role_enum]))
       AND (default_tenant_id = my_tenant_id()))
    OR ((auth.uid() = id)
       AND (auth_role() = ANY (ARRAY['usuario'::role_enum, 'armeiro'::role_enum, 'auditor'::role_enum])))
  );

-- ─── ROLLBACK ──────────────────────────────────────────────────────
-- DROP TRIGGER IF EXISTS profiles_freeze_privileged_columns ON public.profiles;
-- DROP FUNCTION IF EXISTS public.profiles_freeze_privileged_columns();
-- GRANT UPDATE (role, default_tenant_id, registration_status, account_activated_at, created_by)
--   ON public.profiles TO authenticated;
-- -- (manter o WITH CHECK: é estritamente mais seguro que o estado anterior)
-- ═══════════════════════════════════════════════════════════════════
