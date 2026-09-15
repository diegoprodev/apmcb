-- Hotfix pós code-review adversarial do SP5 (20260915180000). Achados
-- CRÍTICO/ALTO endereçados antes de fechar a fase — nenhum é explorável em
-- prod HOJE (tenant_count=1, sem tenant B pra injetar; flag OFF em todo
-- lugar), mas são defeitos reais e o review pegou antes de virarem
-- incidente (a diferença exata que o pipeline de 5 etapas do CLAUDE.md
-- existe pra fazer).
--
-- CRÍTICO — material_categories_staff_insert/update/delete nunca checavam
-- tenant_id (só reserve_memberships.role='admin_reserva'). Um admin_reserva
-- podia INSERT com qualquer tenant_id arbitrário no payload — a linha
-- aterrissa no catálogo de OUTRO tenant, e com a SELECT policy do SP5
-- (puramente tenant_id-based) todo usuário desse tenant B passaria a ver a
-- categoria forjada. Pré-existente (não introduzido pelo SP5), mas o SP5
-- tornou tenant_id o único predicado de leitura — exatamente a superfície
-- que a injeção exploraria. Fix: AND tenant_id = (SELECT my_tenant_id()).
--
-- ALTO (assimetria) — material_types_update tinha `OR reserve_id IS NULL`
-- no USING mas não no WITH CHECK: um admin_reserva conseguia ABRIR o
-- UPDATE de uma linha de catálogo compartilhado (USING passa) mas o SAVE
-- falhava com 42501 opaco (WITH CHECK exige reserve_id = ativa) — ou, pior,
-- se preenchesse reserve_id pra passar, a linha compartilhada virava
-- exclusiva daquela reserva e desaparecia de todas as outras (efeito
-- colateral não confirmado, sem audit). Fix: remove o branch NULL do
-- USING, alinhando com INSERT/DELETE — linha de catálogo compartilhado só
-- é editável pela matriz (via chevron, §4.8), nunca por escrita
-- reserve-scoped. Não há branch matriz aqui porque §4.8 já resolve isso
-- fora do SQL: admin_global sem active_reserve_id simplesmente não passa
-- no `auth_role() IN (...)  AND reserve_id = active_reserve_id` — tem que
-- entrar na reserva primeiro. Mesmo comportamento de antes do SP5 (a
-- policy materials_write original também não tinha branch matriz).
--
-- ROLLBACK:
--   DROP POLICY IF EXISTS material_categories_staff_insert ON public.material_categories;
--   CREATE POLICY material_categories_staff_insert ON public.material_categories FOR INSERT
--     WITH CHECK (EXISTS (SELECT 1 FROM reserve_memberships rm WHERE rm.reserve_id = material_categories.reserve_id AND rm.user_id = auth.uid() AND rm.role = 'admin_reserva'));
--   (idem update/delete, sem o AND tenant_id)
--   material_types_update: reverter para incluir `OR reserve_id IS NULL` no USING.

DROP POLICY IF EXISTS material_categories_staff_insert ON public.material_categories;
DROP POLICY IF EXISTS material_categories_staff_update ON public.material_categories;
DROP POLICY IF EXISTS material_categories_staff_delete ON public.material_categories;

CREATE POLICY material_categories_staff_insert ON public.material_categories
  FOR INSERT
  WITH CHECK (
    tenant_id = (SELECT my_tenant_id())
    AND EXISTS (
      SELECT 1 FROM public.reserve_memberships rm
      WHERE rm.reserve_id = material_categories.reserve_id
        AND rm.user_id = (SELECT auth.uid())
        AND rm.role = 'admin_reserva'
    )
  );

CREATE POLICY material_categories_staff_update ON public.material_categories
  FOR UPDATE
  USING (
    tenant_id = (SELECT my_tenant_id())
    AND EXISTS (
      SELECT 1 FROM public.reserve_memberships rm
      WHERE rm.reserve_id = material_categories.reserve_id
        AND rm.user_id = (SELECT auth.uid())
        AND rm.role = 'admin_reserva'
    )
  )
  WITH CHECK (
    tenant_id = (SELECT my_tenant_id())
    AND EXISTS (
      SELECT 1 FROM public.reserve_memberships rm
      WHERE rm.reserve_id = material_categories.reserve_id
        AND rm.user_id = (SELECT auth.uid())
        AND rm.role = 'admin_reserva'
    )
  );

CREATE POLICY material_categories_staff_delete ON public.material_categories
  FOR DELETE
  USING (
    tenant_id = (SELECT my_tenant_id())
    AND EXISTS (
      SELECT 1 FROM public.reserve_memberships rm
      WHERE rm.reserve_id = material_categories.reserve_id
        AND rm.user_id = (SELECT auth.uid())
        AND rm.role = 'admin_reserva'
    )
  );

-- material_types_update: remove a assimetria USING/WITH CHECK.
DROP POLICY IF EXISTS material_types_update ON public.material_types;

CREATE POLICY material_types_update ON public.material_types
  FOR UPDATE
  USING (
    (SELECT auth_role()) IN ('admin_global','admin_reserva')
    AND tenant_id = (SELECT my_tenant_id())
    AND (NOT (SELECT my_tenant_isolation_enabled()) OR reserve_id = (SELECT my_active_reserve_id()))
  )
  WITH CHECK (
    (SELECT auth_role()) IN ('admin_global','admin_reserva')
    AND tenant_id = (SELECT my_tenant_id())
    AND (NOT (SELECT my_tenant_isolation_enabled()) OR reserve_id = (SELECT my_active_reserve_id()))
  );
