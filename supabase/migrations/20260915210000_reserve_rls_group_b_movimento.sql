-- SP6 do isolamento por reserva — RLS grupo B (movimento): lendings,
-- cautelamentos, material_requests, material_request_items,
-- category_requests, document_signatures, cautela_vencimento_alert_events.
-- Ver docs/superpowers/specs/2026-09-09-isolamento-reserva-design.md
-- §4.2/§4.3/§8 (linha "SP6").
--
-- Dormente enquanto tenants.reserve_isolation_enabled = false (default) —
-- mesmo padrão SP1/SP4/SP5. Testado em staging (vfkdycqkddgoqnujwbvl) com
-- a flag ON antes de aplicar em prod (regra §7).
--
-- ── Pré-condição confirmada em prod, 2026-09-15 (não por suposição) ──────
-- As 7 tabelas do grupo B estão VAZIAS (clean-slate 2026-09-10, nenhum
-- fluxo de movimento rodou ainda) → NOT NULL direto em reserve_id/tenant_id
-- onde nullable hoje, sem NOT VALID/VALIDATE faseado (mesmo padrão SP4).
-- lendings.reserve_id: confirmado obrigatório na origem real
-- (record_lending_batch RPC, 20260821000001_cautelamentos_batch_rpc.sql:42,
-- RAISE se p_reserve_id IS NULL) — NOT NULL na coluna só formaliza o que
-- já é verdade no único caminho de escrita.
--
-- ── Padrão "dono" (§4.2) ──────────────────────────────────────────────
-- lendings/cautelamentos/material_requests/material_request_items: o
-- militar SEMPRE vê o que é dele nas reservas onde tem membership, mesmo
-- que a reserva ativa seja outra (decisão de produto, SEC-MÉD-3 do v4).
--
-- ── document_signatures ──────────────────────────────────────────────
-- Policy antiga (`tenant_isolation_signatures`) usava
-- `auth.jwt()->app_metadata->>tenant_id` direto — o padrão pré-§4.2 que a
-- consolidação F7 substitui tabela por tabela (§4.10). Também não tinha
-- restrição de PAPEL: qualquer membro do tenant lia toda assinatura
-- (nome, IP, proof) via client direto. Sem consumidor real via client
-- direto hoje (grep: só rotas do BFF, service_role, usam esta tabela) —
-- reforçar para staff-only + reserve gating é estritamente mais seguro,
-- não quebra nada existente.
--
-- ── cautela_vencimento_alert_events ──────────────────────────────────
-- Zero policies hoje (só service_role acessa, via cron). Nenhum
-- consumidor via client direto (grep confirma). Adiciona SELECT staff
-- dormente — capacidade pronta pra uma feature futura de listar alertas
-- na UI, sem mudar comportamento atual (ninguém lê isso hoje fora do BFF).
--
-- ROLLBACK: ver bloco no fim do arquivo (comentado).

-- ── 0. NOT NULL nas colunas de escopo (tabelas vazias, ver header) ──────
ALTER TABLE public.lendings ALTER COLUMN reserve_id SET NOT NULL;
ALTER TABLE public.lendings ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.material_requests ALTER COLUMN reserve_id SET NOT NULL;
ALTER TABLE public.material_requests ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.category_requests ALTER COLUMN reserve_id SET NOT NULL;

-- ── 1. lendings ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS lendings_select ON public.lendings;
DROP POLICY IF EXISTS lendings_staff_write ON public.lendings; -- FOR ALL — F3

CREATE POLICY lendings_select ON public.lendings
  FOR SELECT
  USING (
    (
      military_id = (SELECT auth.uid())
      AND (
        NOT (SELECT my_tenant_isolation_enabled())
        OR reserve_id IN (SELECT reserve_id FROM public.reserve_memberships WHERE user_id = (SELECT auth.uid()))
      )
    )
    OR (
      (SELECT auth_role()) IN ('admin_global','admin_reserva','armeiro','auditor')
      AND tenant_id = (SELECT my_tenant_id())
      AND (
        NOT (SELECT my_tenant_isolation_enabled())
        OR reserve_id = (SELECT my_active_reserve_id())
        OR ((SELECT my_active_reserve_id()) IS NULL AND (SELECT auth_role()) IN ('admin_global','auditor'))
      )
    )
  );

CREATE POLICY lendings_insert ON public.lendings
  FOR INSERT
  WITH CHECK (
    (SELECT auth_role()) IN ('admin_global','admin_reserva','armeiro')
    AND tenant_id = (SELECT my_tenant_id())
    AND (NOT (SELECT my_tenant_isolation_enabled()) OR reserve_id = (SELECT my_active_reserve_id()))
  );

CREATE POLICY lendings_update ON public.lendings
  FOR UPDATE
  USING (
    (SELECT auth_role()) IN ('admin_global','admin_reserva','armeiro')
    AND tenant_id = (SELECT my_tenant_id())
    AND (NOT (SELECT my_tenant_isolation_enabled()) OR reserve_id = (SELECT my_active_reserve_id()))
  )
  WITH CHECK (
    (SELECT auth_role()) IN ('admin_global','admin_reserva','armeiro')
    AND tenant_id = (SELECT my_tenant_id())
    AND (NOT (SELECT my_tenant_isolation_enabled()) OR reserve_id = (SELECT my_active_reserve_id()))
  );

-- M7 (achado do review): FOR ALL antigo cobria DELETE; INSERT/UPDATE/DELETE
-- explícitas precisam reproduzir as 3 ações, não só 2 (F3, mesmo padrão
-- SP4/SP5 de nunca deixar capacidade cair no split).
CREATE POLICY lendings_delete ON public.lendings
  FOR DELETE
  USING (
    (SELECT auth_role()) IN ('admin_global','admin_reserva','armeiro')
    AND tenant_id = (SELECT my_tenant_id())
    AND (NOT (SELECT my_tenant_isolation_enabled()) OR reserve_id = (SELECT my_active_reserve_id()))
  );

-- ── 2. cautelamentos ─────────────────────────────────────────────────
DROP POLICY IF EXISTS cautelamentos_select ON public.cautelamentos;
DROP POLICY IF EXISTS cautelamentos_insert ON public.cautelamentos;
DROP POLICY IF EXISTS cautelamentos_update ON public.cautelamentos;

CREATE POLICY cautelamentos_select ON public.cautelamentos
  FOR SELECT
  USING (
    (
      militar_id = (SELECT auth.uid())
      AND (
        NOT (SELECT my_tenant_isolation_enabled())
        OR reserve_id IN (SELECT reserve_id FROM public.reserve_memberships WHERE user_id = (SELECT auth.uid()))
      )
    )
    OR (
      (SELECT auth_role()) IN ('admin_global','admin_reserva','armeiro','auditor')
      AND tenant_id = (SELECT my_tenant_id())
      AND (
        NOT (SELECT my_tenant_isolation_enabled())
        OR reserve_id = (SELECT my_active_reserve_id())
        OR ((SELECT my_active_reserve_id()) IS NULL AND (SELECT auth_role()) IN ('admin_global','auditor'))
      )
    )
  );

CREATE POLICY cautelamentos_insert ON public.cautelamentos
  FOR INSERT
  WITH CHECK (
    (SELECT auth_role()) IN ('admin_global','admin_reserva','armeiro')
    AND tenant_id = (SELECT my_tenant_id())
    AND (NOT (SELECT my_tenant_isolation_enabled()) OR reserve_id = (SELECT my_active_reserve_id()))
  );

CREATE POLICY cautelamentos_update ON public.cautelamentos
  FOR UPDATE
  USING (
    (SELECT auth_role()) IN ('admin_global','admin_reserva','armeiro')
    AND tenant_id = (SELECT my_tenant_id())
    AND (NOT (SELECT my_tenant_isolation_enabled()) OR reserve_id = (SELECT my_active_reserve_id()))
  )
  WITH CHECK (
    (SELECT auth_role()) IN ('admin_global','admin_reserva','armeiro')
    AND tenant_id = (SELECT my_tenant_id())
    AND (NOT (SELECT my_tenant_isolation_enabled()) OR reserve_id = (SELECT my_active_reserve_id()))
  );

-- ── 3. material_requests ─────────────────────────────────────────────
-- ssa_staff_update trocado de auth_tenant_id() pra my_tenant_id() (F7,
-- spec §4.10 — único consumidor de auth_tenant_id() antes deste migration).
--
-- A4/B14 (achado do review): o branch "usuario" (dono) de ssa_staff_update
-- e ssa_military_cancel tinha WITH CHECK sem checar tenant_id/reserve_id —
-- um usuario podia fazer PATCH na própria solicitação PENDENTE trocando
-- reserve_id/tenant_id pra outra reserva/tenant (mesma classe do CRÍTICO
-- do hotfix SP5, 20260915200000). Fix: os dois ganham o mesmo check
-- tenant+reserve-membership do padrão "dono" usado em ssa_military_select.
DROP POLICY IF EXISTS ssa_military_select ON public.material_requests;
DROP POLICY IF EXISTS ssa_military_cancel ON public.material_requests;
DROP POLICY IF EXISTS ssa_staff_insert ON public.material_requests;
DROP POLICY IF EXISTS ssa_staff_update ON public.material_requests;

CREATE POLICY ssa_military_cancel ON public.material_requests
  FOR UPDATE
  USING (
    military_id = (SELECT auth.uid())
    AND status IN ('pendente','aprovado')
    AND tenant_id = (SELECT my_tenant_id())
    AND (
      NOT (SELECT my_tenant_isolation_enabled())
      OR reserve_id IN (SELECT reserve_id FROM public.reserve_memberships WHERE user_id = (SELECT auth.uid()))
    )
  )
  WITH CHECK (
    military_id = (SELECT auth.uid())
    AND status = 'cancelado'
    AND tenant_id = (SELECT my_tenant_id())
    AND (
      NOT (SELECT my_tenant_isolation_enabled())
      OR reserve_id IN (SELECT reserve_id FROM public.reserve_memberships WHERE user_id = (SELECT auth.uid()))
    )
  );

CREATE POLICY ssa_military_select ON public.material_requests
  FOR SELECT
  USING (
    (
      military_id = (SELECT auth.uid())
      AND (
        NOT (SELECT my_tenant_isolation_enabled())
        OR reserve_id IN (SELECT reserve_id FROM public.reserve_memberships WHERE user_id = (SELECT auth.uid()))
      )
    )
    OR (
      (SELECT auth_role()) IN ('admin_global','admin_reserva','armeiro','auditor')
      AND tenant_id = (SELECT my_tenant_id())
      AND (
        NOT (SELECT my_tenant_isolation_enabled())
        OR reserve_id = (SELECT my_active_reserve_id())
        OR ((SELECT my_active_reserve_id()) IS NULL AND (SELECT auth_role()) IN ('admin_global','auditor'))
      )
    )
  );

CREATE POLICY ssa_staff_insert ON public.material_requests
  FOR INSERT
  WITH CHECK (
    (SELECT auth_role()) IN ('usuario','admin_global','admin_reserva','armeiro')
    AND tenant_id = (SELECT my_tenant_id())
    AND (NOT (SELECT my_tenant_isolation_enabled()) OR reserve_id = (SELECT my_active_reserve_id()))
  );

CREATE POLICY ssa_staff_update ON public.material_requests
  FOR UPDATE
  USING (
    (
      (SELECT auth_role()) IN ('admin_global','admin_reserva','armeiro')
      AND tenant_id = (SELECT my_tenant_id())
      AND (NOT (SELECT my_tenant_isolation_enabled()) OR reserve_id = (SELECT my_active_reserve_id()))
    )
    OR (
      (SELECT auth_role()) = 'usuario' AND military_id = (SELECT auth.uid()) AND status = 'pendente'
      AND tenant_id = (SELECT my_tenant_id())
      AND (NOT (SELECT my_tenant_isolation_enabled()) OR reserve_id IN (SELECT reserve_id FROM public.reserve_memberships WHERE user_id = (SELECT auth.uid())))
    )
  )
  WITH CHECK (
    (
      (SELECT auth_role()) IN ('admin_global','admin_reserva','armeiro')
      AND tenant_id = (SELECT my_tenant_id())
      AND (NOT (SELECT my_tenant_isolation_enabled()) OR reserve_id = (SELECT my_active_reserve_id()))
    )
    OR (
      (SELECT auth_role()) = 'usuario' AND military_id = (SELECT auth.uid())
      AND tenant_id = (SELECT my_tenant_id())
      AND (NOT (SELECT my_tenant_isolation_enabled()) OR reserve_id IN (SELECT reserve_id FROM public.reserve_memberships WHERE user_id = (SELECT auth.uid())))
    )
  );

-- ── 4. material_request_items ────────────────────────────────────────
DROP POLICY IF EXISTS ssa_items_staff_select ON public.material_request_items;
DROP POLICY IF EXISTS ssa_items_staff_write ON public.material_request_items; -- FOR ALL — F3
-- ssa_items_military_insert/select intocadas — já per-dono, sem
-- branch de staff/reserva.

CREATE POLICY ssa_items_staff_select ON public.material_request_items
  FOR SELECT
  USING (
    (SELECT auth_role()) IN ('admin_global','admin_reserva','armeiro','auditor')
    AND tenant_id = (SELECT my_tenant_id())
    AND (
      NOT (SELECT my_tenant_isolation_enabled())
      OR reserve_id = (SELECT my_active_reserve_id())
      OR ((SELECT my_active_reserve_id()) IS NULL AND (SELECT auth_role()) IN ('admin_global','auditor'))
    )
  );

CREATE POLICY ssa_items_staff_insert ON public.material_request_items
  FOR INSERT
  WITH CHECK (
    (SELECT auth_role()) IN ('admin_global','admin_reserva','armeiro')
    AND tenant_id = (SELECT my_tenant_id())
    AND (NOT (SELECT my_tenant_isolation_enabled()) OR reserve_id = (SELECT my_active_reserve_id()))
  );

CREATE POLICY ssa_items_staff_update ON public.material_request_items
  FOR UPDATE
  USING (
    (SELECT auth_role()) IN ('admin_global','admin_reserva','armeiro')
    AND tenant_id = (SELECT my_tenant_id())
    AND (NOT (SELECT my_tenant_isolation_enabled()) OR reserve_id = (SELECT my_active_reserve_id()))
  )
  WITH CHECK (
    (SELECT auth_role()) IN ('admin_global','admin_reserva','armeiro')
    AND tenant_id = (SELECT my_tenant_id())
    AND (NOT (SELECT my_tenant_isolation_enabled()) OR reserve_id = (SELECT my_active_reserve_id()))
  );

CREATE POLICY ssa_items_staff_delete ON public.material_request_items
  FOR DELETE
  USING (
    (SELECT auth_role()) IN ('admin_global','admin_reserva','armeiro')
    AND tenant_id = (SELECT my_tenant_id())
    AND (NOT (SELECT my_tenant_isolation_enabled()) OR reserve_id = (SELECT my_active_reserve_id()))
  );

-- ── 5. category_requests ─────────────────────────────────────────────
-- Sem coluna tenant_id (deriva de reserves.tenant_id).
--
-- C2 (CRÍTICO do review, mesma classe do CRÍTICO do hotfix SP5): a policy
-- `armeiro_criar` (INSERT) só checava `requested_by = auth.uid()` + papel
-- — nenhuma referência a `reserve_id` nem `reserve_memberships`. Um
-- armeiro da reserva A conseguia INSERT com `reserve_id` de QUALQUER outra
-- reserva — a linha aparece na fila de aprovação daquela reserva via
-- `membro_ver_requests` (que aí sim checa reserve_memberships), e ao ser
-- aprovada gera `material_categories` numa reserva onde o autor não é
-- membro. Fix: `EXISTS` em `reserve_memberships`, mesmo predicado que
-- `membro_ver_requests`/`admin_atualizar` já usam (consistente com as
-- policies irmãs, não um padrão novo).
--
-- Sem join a `reserves` para checar tenant: tentado no staging e revertido
-- — `reserves` tem RLS própria (`reserves_tenant_member_select`, via
-- `tenant_memberships`) que filtra a linha ANTES do WHERE comparar
-- tenant_id, então um staff real sem linha em `tenant_memberships` (gap
-- de dados já achado no review do SP5 hotfix — 13 perfis em prod) teria o
-- EXISTS falso mesmo pra reserva/tenant corretos — reproduziria o mesmo
-- bug de "0 visível" que o SP5 já corrigiu uma vez, só que travando a
-- ESCRITA em vez da leitura. `reserve_memberships` sozinha já é a mesma
-- fronteira de confiança usada pelas 2 policies irmãs — não é enfraquecer,
-- é alinhar.
DROP POLICY IF EXISTS armeiro_criar ON public.category_requests;

CREATE POLICY armeiro_criar ON public.category_requests
  FOR INSERT
  WITH CHECK (
    requested_by = (SELECT auth.uid())
    AND (SELECT auth_role()) IN ('armeiro','admin_reserva','admin_global')
    AND EXISTS (
      SELECT 1 FROM public.reserve_memberships rm
      WHERE rm.reserve_id = category_requests.reserve_id
        AND rm.user_id = (SELECT auth.uid())
    )
  );
-- membro_ver_requests / admin_atualizar mantidas como estão — já
-- reserve_id-scoped via reserve_memberships desde antes do SP6, sem
-- tenant-wide, nada a apertar (confirmado corpo a corpo no review).

-- ── 6. document_signatures ───────────────────────────────────────────
-- Consolidação F7 (§4.10): sai do padrão auth.jwt()->app_metadata, entra
-- no padrão §4.2 do grupo. Restringe a staff (nenhum consumidor via client
-- direto hoje — só rotas BFF/service_role usam esta tabela).
DROP POLICY IF EXISTS tenant_isolation_signatures ON public.document_signatures;

CREATE POLICY document_signatures_staff_select ON public.document_signatures
  FOR SELECT
  USING (
    (SELECT auth_role()) IN ('admin_global','admin_reserva','armeiro','auditor')
    AND tenant_id = (SELECT my_tenant_id())
    AND (
      NOT (SELECT my_tenant_isolation_enabled())
      OR reserve_id = (SELECT my_active_reserve_id())
      OR ((SELECT my_active_reserve_id()) IS NULL AND (SELECT auth_role()) IN ('admin_global','auditor'))
    )
  );

-- ── 7. cautela_vencimento_alert_events ───────────────────────────────
-- Zero policies hoje (só cron/service_role). Adiciona SELECT staff
-- dormente — nenhum consumidor via client direto hoje, capacidade pronta
-- pra uma feature futura sem mudar comportamento atual.
CREATE POLICY cautela_vencimento_alert_events_staff_select ON public.cautela_vencimento_alert_events
  FOR SELECT
  USING (
    (SELECT auth_role()) IN ('admin_global','admin_reserva','armeiro','auditor')
    AND tenant_id = (SELECT my_tenant_id())
    AND (
      NOT (SELECT my_tenant_isolation_enabled())
      OR reserve_id = (SELECT my_active_reserve_id())
      OR ((SELECT my_active_reserve_id()) IS NULL AND (SELECT auth_role()) IN ('admin_global','auditor'))
    )
  );

-- M10 (achado do review): material_requests/category_requests filtram por
-- reserve_id nas policies novas mas não tinham índice na coluna (diferente
-- das 7 filhas do SP4, que ganharam índice junto). lendings/cautelamentos
-- já têm (idx_lendings_reserve_id, idx_cautelamentos_reserve_id).
CREATE INDEX IF NOT EXISTS idx_material_requests_reserve_id ON public.material_requests(reserve_id);
CREATE INDEX IF NOT EXISTS idx_category_requests_reserve_id ON public.category_requests(reserve_id);

-- ROLLBACK (referência, não executado):
--   ALTER TABLE public.lendings ALTER COLUMN reserve_id DROP NOT NULL;
--   ALTER TABLE public.lendings ALTER COLUMN tenant_id DROP NOT NULL;
--   ALTER TABLE public.material_requests ALTER COLUMN reserve_id DROP NOT NULL;
--   ALTER TABLE public.material_requests ALTER COLUMN tenant_id DROP NOT NULL;
--   ALTER TABLE public.category_requests ALTER COLUMN reserve_id DROP NOT NULL;
--   DROP POLICY IF EXISTS lendings_select ON public.lendings;
--   DROP POLICY IF EXISTS lendings_insert ON public.lendings;
--   DROP POLICY IF EXISTS lendings_update ON public.lendings;
--   CREATE POLICY lendings_select ON public.lendings FOR SELECT
--     USING ((military_id = auth.uid()) OR ((auth_role() = ANY (ARRAY['admin_global'::role_enum,'admin_reserva'::role_enum,'armeiro'::role_enum,'auditor'::role_enum])) AND (tenant_id = my_tenant_id())));
--   CREATE POLICY lendings_staff_write ON public.lendings FOR ALL
--     USING ((auth_role() = ANY (ARRAY['admin_global'::role_enum,'admin_reserva'::role_enum,'armeiro'::role_enum])) AND (tenant_id = my_tenant_id()));
--   (idem cautelamentos/material_requests/material_request_items — ver
--    supabase/ci/policy-snapshot.json anterior a este commit para os corpos exatos)
--   DROP POLICY IF EXISTS document_signatures_staff_select ON public.document_signatures;
--   CREATE POLICY tenant_isolation_signatures ON public.document_signatures FOR SELECT
--     USING (tenant_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'tenant_id'::text)::uuid);
--   DROP POLICY IF EXISTS cautela_vencimento_alert_events_staff_select ON public.cautela_vencimento_alert_events;
