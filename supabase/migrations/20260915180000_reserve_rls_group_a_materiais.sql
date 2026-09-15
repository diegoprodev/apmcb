-- SP5 do isolamento por reserva — RLS grupo A (materiais): material_types,
-- material_categories, material_items. Ver
-- docs/superpowers/specs/2026-09-09-isolamento-reserva-design.md §4.2/§4.3/§8.
--
-- Dormente enquanto tenants.reserve_isolation_enabled = false (default) —
-- mesmo padrão do SP1: `NOT (SELECT my_tenant_isolation_enabled())` é o
-- primeiro termo do OR em toda policy de leitura, então com a flag OFF o
-- comportamento é IDÊNTICO ao de hoje (só tenant_id). Testado em staging
-- (vfkdycqkddgoqnujwbvl) com a flag ON antes de aplicar em prod — regra
-- canônica da spec §7 ("iterar RLS em prod segue proibido").
--
-- Todo helper sem argumento envelopado em `(SELECT helper())` — SP0.5 provou
-- que chamada nua é per-row (112-279ms/1-2k linhas); com o wrap vira InitPlan
-- 1x/statement (1.5-1.7ms). `user_in_reserve` continua per-row (arg muda por
-- linha) — não se aplica aqui, nenhuma destas 3 tabelas usa esse helper.
--
-- reserve_id NULL em material_types/material_categories (dado pré-SP5, ex:
-- as 6 categorias seed de 20260915165730) é tratado como "catálogo
-- compartilhado do tenant" — visível a todo staff da reserva, não só matriz.
-- Decisão de produto deliberada (não lacuna): sem isso, ligar a flag tornaria
-- as categorias seed invisíveis pra qualquer armeiro escopado, reproduzindo
-- o mesmo bug de "0 categoria no dialog" corrigido em 20260915165730 — só
-- que via RLS em vez de dado ausente. Categoria/tipo criado DEPOIS da flag
-- ligada nasce com reserve_id preenchido (rota BFF, fora deste migration) e
-- fica scoped normalmente. material_items NÃO entra nessa regra — reserve_id
-- é NOT NULL ali desde o SP4 (dispatcher), não há linha NULL possível.
--
-- ROLLBACK:
--   DROP POLICY IF EXISTS material_types_select ON public.material_types;
--   DROP POLICY IF EXISTS material_types_insert ON public.material_types;
--   DROP POLICY IF EXISTS material_types_update ON public.material_types;
--   DROP POLICY IF EXISTS material_types_delete ON public.material_types;
--   CREATE POLICY materials_select ON public.material_types FOR SELECT
--     USING (tenant_id = my_tenant_id());
--   CREATE POLICY materials_write ON public.material_types FOR ALL
--     USING ((auth_role() = ANY (ARRAY['admin_global'::role_enum,'admin_reserva'::role_enum])) AND (tenant_id = my_tenant_id()));
--   DROP POLICY IF EXISTS material_categories_select ON public.material_categories;
--   CREATE POLICY material_categories_tenant_select ON public.material_categories FOR SELECT
--     USING (EXISTS (SELECT 1 FROM tenant_memberships tm WHERE tm.tenant_id = material_categories.tenant_id AND tm.user_id = auth.uid()));
--   CREATE POLICY "tenant members read" ON public.material_categories FOR SELECT
--     USING (tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()));
--   DROP POLICY IF EXISTS material_items_staff_select ON public.material_items;
--   CREATE POLICY material_items_staff_select ON public.material_items FOR SELECT
--     USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.default_tenant_id = material_items.tenant_id AND p.role = ANY (ARRAY['admin_global'::role_enum,'admin_reserva'::role_enum,'armeiro'::role_enum,'auditor'::role_enum])));

-- ── material_types ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS materials_select ON public.material_types;
DROP POLICY IF EXISTS materials_write ON public.material_types; -- FOR ALL — F3, vota SIM no SELECT via OR

CREATE POLICY material_types_select ON public.material_types
  FOR SELECT
  USING (
    tenant_id = (SELECT my_tenant_id())
    AND (
      NOT (SELECT my_tenant_isolation_enabled())
      OR reserve_id IS NULL                                          -- catálogo compartilhado (ver header)
      OR reserve_id = (SELECT my_active_reserve_id())
      OR ((SELECT my_active_reserve_id()) IS NULL
          AND (SELECT auth_role()) IN ('admin_global','auditor'))     -- matriz
    )
  );

CREATE POLICY material_types_insert ON public.material_types
  FOR INSERT
  WITH CHECK (
    (SELECT auth_role()) IN ('admin_global','admin_reserva')
    AND tenant_id = (SELECT my_tenant_id())
    AND (NOT (SELECT my_tenant_isolation_enabled()) OR reserve_id = (SELECT my_active_reserve_id()))
  );

CREATE POLICY material_types_update ON public.material_types
  FOR UPDATE
  USING (
    (SELECT auth_role()) IN ('admin_global','admin_reserva')
    AND tenant_id = (SELECT my_tenant_id())
    AND (NOT (SELECT my_tenant_isolation_enabled()) OR reserve_id IS NULL OR reserve_id = (SELECT my_active_reserve_id()))
  )
  WITH CHECK (
    (SELECT auth_role()) IN ('admin_global','admin_reserva')
    AND tenant_id = (SELECT my_tenant_id())
    AND (NOT (SELECT my_tenant_isolation_enabled()) OR reserve_id = (SELECT my_active_reserve_id()))
  );

CREATE POLICY material_types_delete ON public.material_types
  FOR DELETE
  USING (
    (SELECT auth_role()) IN ('admin_global','admin_reserva')
    AND tenant_id = (SELECT my_tenant_id())
    AND (NOT (SELECT my_tenant_isolation_enabled()) OR reserve_id = (SELECT my_active_reserve_id()))
  );

-- ── material_categories ─────────────────────────────────────────────────
-- Consolidação (achado DRY, CLAUDE.md): duas policies SELECT equivalentes
-- (material_categories_tenant_select via EXISTS, "tenant members read" via
-- IN) coexistiam fazendo o mesmo check de tenant — RLS avalia OR entre
-- policies permissivas da mesma ação, então a redundância nunca restringia
-- nada, só duplicava trabalho no planner. Substituídas por 1 policy com
-- reserve gating.
DROP POLICY IF EXISTS material_categories_tenant_select ON public.material_categories;
DROP POLICY IF EXISTS "tenant members read" ON public.material_categories;

CREATE POLICY material_categories_select ON public.material_categories
  FOR SELECT
  USING (
    tenant_id = (SELECT my_tenant_id())
    AND (
      NOT (SELECT my_tenant_isolation_enabled())
      OR reserve_id IS NULL                                          -- catálogo compartilhado (ver header)
      OR reserve_id = (SELECT my_active_reserve_id())
      OR ((SELECT my_active_reserve_id()) IS NULL
          AND (SELECT auth_role()) IN ('admin_global','auditor'))
    )
  );

-- staff_insert/update/delete JÁ eram INSERT/UPDATE/DELETE explícitas (não
-- FOR ALL) e já filtravam por reserve_id via reserve_memberships — sem
-- gate de flag, sempre reserve-scoped. Comportamento correto e mais estrito
-- que o resto do sistema; mantidas como estão (nada a mudar).

-- ── material_items ──────────────────────────────────────────────────────
-- reserve_id NOT NULL desde o SP4 — sem ramo "catálogo compartilhado" aqui,
-- toda linha já pertence a exatamente 1 reserva.
DROP POLICY IF EXISTS material_items_staff_select ON public.material_items;

CREATE POLICY material_items_staff_select ON public.material_items
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.default_tenant_id = material_items.tenant_id
        AND p.role = ANY (ARRAY['admin_global'::role_enum,'admin_reserva'::role_enum,'armeiro'::role_enum,'auditor'::role_enum])
    )
    AND (
      NOT (SELECT my_tenant_isolation_enabled())
      OR material_items.reserve_id = (SELECT my_active_reserve_id())
      OR ((SELECT my_active_reserve_id()) IS NULL
          AND (SELECT auth_role()) IN ('admin_global','auditor'))
    )
  );

-- material_items_usuario_select (achado do hotfix 20260911150000, correlação
-- via lendings.item_id) não é tocada aqui — já é per-usuário, sem branch de
-- staff/reserva; fora do escopo do grupo A de reserve gating.
