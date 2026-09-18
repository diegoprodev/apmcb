-- SP9.5 (achado durante o canário de validação pré-SP10) — fix de
-- inconsistência real em category_requests: as policies membro_ver_requests
-- (SELECT) e admin_atualizar (UPDATE) ainda usam o padrão ANTIGO
-- (JOIN reserves + profiles.default_tenant_id) que o SP5/SP6 já provaram
-- problemático — reserves tem RLS própria via tenant_memberships, e o
-- épico já documentou (SP5 hotfix v1 revertido, SP6 C2) que membros reais
-- podem não ter linha em tenant_memberships, causando FALSO-NEGATIVO
-- (nega acesso legítimo a admin_global/auditor em matriz).
--
-- Achado durante teste de canário em PROD (supabase/tests/reserve_isolation_canary.sql,
-- expandido pra cobrir category_requests): confirmado que o admin_global
-- REAL de PMPB hoje TEM tenant_membership (não afeta o tenant real agora),
-- mas category_requests é a ÚNICA tabela do épico inteiro ainda usando o
-- padrão join-com-reserves — inconsistência real de defesa em profundidade,
-- e risco pra qualquer admin_global futuro sem tenant_membership (cenário
-- já confirmado acontecendo com ~13 profiles reais em prod, achado do SP5).
--
-- Diferente das outras 26 tabelas, category_requests NÃO TEM coluna
-- tenant_id própria — só reserve_id. O bypass de matriz precisa confinar
-- ao tenant certo (senão vira cross-tenant leak), mas sem depender da RLS
-- de `reserves` pra isso. Fix: helper novo `reserve_tenant_id(uuid)`
-- SECURITY DEFINER (mesmo padrão de my_tenant_id/user_in_reserve — dono
-- postgres bypassa RLS de reserves internamente), resolve reserve_id ->
-- tenant_id sem depender de tenant_memberships do ator.
--
-- Dormente enquanto tenants.reserve_isolation_enabled = false — mas este
-- fix específico (bypass de matriz) só é relevante quando a flag está ON
-- e o ator está em modo matriz; sem mudança de comportamento pra staff
-- comum (branches requested_by/reserve_memberships inalterados).
--
-- Decisões explícitas (achado da revisão adversarial, 2026-09-17):
-- 1. Ao contrário do padrão §4.2 completo (26 tabelas), o bypass de matriz
--    aqui NÃO condiciona a `(SELECT my_active_reserve_id()) IS NULL`
--    (matriz vs. filial) — comportamento herdado da policy antiga
--    (20260711000005), NÃO é regressão desta migration. Mantido assim de
--    propósito: category_requests é aprovação de categoria de material,
--    ação de escopo de TENANT (nome/slug de categoria não pertence a uma
--    reserva específica do jeito que um item físico pertence), então
--    admin_global/auditor em modo filial continuam vendo o tenant inteiro
--    aqui. Caso o produto queira o comportamento "filial só vê a própria
--    reserva" futuramente, é mudança de requisito de produto, não de bug.
-- 2. `auditor` ganha visibilidade nova nesta migration (a policy antiga só
--    testava `p.role = 'admin_global'`). Intencional — alinhado ao papel de
--    auditor no resto do épico (SELECT-only, nunca em admin_atualizar/UPDATE,
--    que continua restrito a admin_global).
--
-- ROLLBACK: ver bloco no fim (comentado).

CREATE OR REPLACE FUNCTION public.reserve_tenant_id(p_reserve_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT tenant_id FROM public.reserves WHERE id = p_reserve_id;
$$;

REVOKE ALL ON FUNCTION public.reserve_tenant_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_tenant_id(uuid) TO authenticated;

DROP POLICY IF EXISTS membro_ver_requests ON public.category_requests;

CREATE POLICY membro_ver_requests ON public.category_requests
  FOR SELECT
  USING (
    requested_by = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.reserve_memberships rm
      WHERE rm.user_id = (SELECT auth.uid())
        AND rm.reserve_id = category_requests.reserve_id
        AND rm.role = ANY (ARRAY['admin_reserva','admin_global'])
    )
    OR (
      reserve_tenant_id(category_requests.reserve_id) = (SELECT my_tenant_id())
      AND (SELECT auth_role()) IN ('admin_global','auditor')
    )
  );

DROP POLICY IF EXISTS admin_atualizar ON public.category_requests;

CREATE POLICY admin_atualizar ON public.category_requests
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.reserve_memberships rm
      WHERE rm.user_id = (SELECT auth.uid())
        AND rm.reserve_id = category_requests.reserve_id
        AND rm.role = ANY (ARRAY['admin_reserva','admin_global'])
    )
    OR (
      reserve_tenant_id(category_requests.reserve_id) = (SELECT my_tenant_id())
      AND (SELECT auth_role()) = 'admin_global'
    )
  );

-- ROLLBACK (referência, não executado):
--   DROP POLICY IF EXISTS membro_ver_requests ON public.category_requests;
--   DROP POLICY IF EXISTS admin_atualizar ON public.category_requests;
--   CREATE POLICY membro_ver_requests ON public.category_requests FOR SELECT
--     USING ((requested_by = auth.uid()) OR (EXISTS (SELECT 1 FROM reserve_memberships rm WHERE rm.user_id = auth.uid() AND rm.reserve_id = category_requests.reserve_id AND rm.role = ANY (ARRAY['admin_reserva'::text, 'admin_global'::text]))) OR (EXISTS (SELECT 1 FROM reserves r JOIN profiles p ON p.id = auth.uid() WHERE r.id = category_requests.reserve_id AND p.role = 'admin_global'::role_enum AND p.default_tenant_id = r.tenant_id)));
--   CREATE POLICY admin_atualizar ON public.category_requests FOR UPDATE
--     USING ((EXISTS (SELECT 1 FROM reserve_memberships rm WHERE rm.user_id = auth.uid() AND rm.reserve_id = category_requests.reserve_id AND rm.role = ANY (ARRAY['admin_reserva'::text, 'admin_global'::text]))) OR (EXISTS (SELECT 1 FROM reserves r JOIN profiles p ON p.id = auth.uid() WHERE r.id = category_requests.reserve_id AND p.role = 'admin_global'::role_enum AND p.default_tenant_id = r.tenant_id)));
--   DROP FUNCTION IF EXISTS public.reserve_tenant_id(uuid);
