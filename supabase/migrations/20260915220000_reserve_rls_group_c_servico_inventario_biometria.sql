-- SP7 do isolamento por reserva — RLS grupo C (serviço/inventário/
-- biometria): service_shifts, service_log_events, service_handovers,
-- handover_attachments, inventory_reserve_checks, inventory_item_checks,
-- material_validity_alert_events, biometric_devices, biometric_challenges,
-- biometric_pairing_codes. Ver
-- docs/superpowers/specs/2026-09-09-isolamento-reserva-design.md §4.2/§4.3/§8.
--
-- Dormente enquanto tenants.reserve_isolation_enabled = false (default) —
-- mesmo padrão SP1/SP4/SP5/SP6. Testado em staging com a flag ON antes de
-- aplicar em prod (regra §7).
--
-- ── audit_events FICA DE FORA deste migration (achado real, 2026-09-15) ──
-- O spec §8 lista audit_events no grupo C, mas: 1480 linhas reais em prod
-- (não é clean-slate — trilha de auditoria sobrevive/se recompõe desde
-- 2026-09-10), TODAS com reserve_id NULL, e a tabela tem uma RULE
-- (no_update_audit_events) que bloqueia QUALQUER UPDATE — não dá pra
-- backfillar reserve_id nem aplicar NOT NULL sem antes decidir como tratar
-- a trava de imutabilidade (dropar a rule temporariamente é uma decisão de
-- produto/segurança que merece sua própria revisão, não uma linha a mais
-- neste migration). Fica como follow-up dedicado.
--
-- ── Pré-condição confirmada em prod, 2026-09-15 ───────────────────────────
-- service_shifts/service_log_events/service_handovers/handover_attachments/
-- inventory_reserve_checks/inventory_item_checks/biometric_devices/
-- biometric_challenges/biometric_pairing_codes: reserve_id e tenant_id já
-- são NOT NULL (nenhum ALTER necessário aqui). material_validity_alert_events:
-- tenant_id NOT NULL, reserve_id nullable mas 0 linhas hoje — sem dado a
-- perder, mas NÃO aplicamos NOT NULL aqui porque não há confirmação de que
-- todo insert-site preenche a coluna (mesmo tipo de alegação que o SP6
-- provou falsa pra lendings — sem auditoria de insert-site feita ainda pra
-- esta tabela, mais seguro deixar nullable e gatear IS NULL na policy).
--
-- ── Tabelas sem policy alguma hoje (só service_role) ──────────────────────
-- service_handovers, handover_attachments, inventory_reserve_checks,
-- inventory_item_checks, biometric_devices, biometric_challenges,
-- biometric_pairing_codes: confirmado via grep que NENHUM consumidor em
-- apps/web usa essas tabelas via client direto — só rotas do BFF
-- (service_role, bypassa RLS). Adiciona SELECT staff dormente (mesmo
-- padrão do document_signatures/cautela_vencimento_alert_events no SP6) —
-- capacidade pronta pra uso futuro, sem mudar comportamento atual.
--
-- ── FORCE ROW LEVEL SECURITY nas 3 biometric_* (spec §8, "RPC-only") ─────
-- Essas 3 só são escritas via RPCs SECURITY DEFINER (biometric bridge,
-- fases 1A-1C) — nenhum INSERT/UPDATE direto em app code. FORCE RLS
-- garante que RLS se aplica mesmo pro dono da tabela (defesa-em-profundidade
-- contra um erro de configuração futuro que rode como owner em vez de
-- service_role; service_role continua bypassando RLS independente de
-- FORCE, por BYPASSRLS).
--
-- ROLLBACK: ver bloco no fim do arquivo (comentado).

-- ── 1. service_shifts ────────────────────────────────────────────────
-- armeiro_own_shifts (FOR ALL) e tenant_iso_shifts (FOR ALL, padrão
-- auth.jwt()->app_metadata pré-§4.2) — ambas dropadas e recriadas.
-- admin_reserva_shifts (SELECT, já reserve_id-scoped mas sem tenant check
-- nem flag gate) também reescrita.
DROP POLICY IF EXISTS admin_reserva_shifts ON public.service_shifts;
DROP POLICY IF EXISTS armeiro_own_shifts ON public.service_shifts; -- FOR ALL — F3
DROP POLICY IF EXISTS tenant_iso_shifts ON public.service_shifts; -- FOR ALL — F3, padrão jwt pré-§4.2

CREATE POLICY service_shifts_select ON public.service_shifts
  FOR SELECT
  USING (
    (
      armeiro_id = (SELECT auth.uid())
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

CREATE POLICY service_shifts_insert ON public.service_shifts
  FOR INSERT
  WITH CHECK (
    (SELECT auth_role()) IN ('admin_global','admin_reserva','armeiro')
    AND tenant_id = (SELECT my_tenant_id())
    AND (NOT (SELECT my_tenant_isolation_enabled()) OR reserve_id = (SELECT my_active_reserve_id()))
  );

-- Achado ALTO do review: o branch dono (armeiro) usava o predicado de
-- SELECT-dono (reserve_id IN memberships — vê/toca em qualquer reserva
-- onde é membro) num contexto de WRITE. Todo o resto do padrão WRITE do
-- épico (SP5/SP6, e o INSERT/DELETE desta própria tabela) pina a escrita
-- à reserva ATIVA — service_shifts não tem RPC (assert_actor_in_reserve
-- não cobre esta tabela), então aqui o RLS é a defesa primária, não
-- defesa-em-profundidade. Sem o pin, um armeiro multi-reserva conseguia
-- editar/mover o próprio turno para qualquer reserva onde tem membership
-- via API REST direta, sem nunca ter "entrado" nela pelo chevron.
CREATE POLICY service_shifts_update ON public.service_shifts
  FOR UPDATE
  USING (
    (
      armeiro_id = (SELECT auth.uid())
      AND tenant_id = (SELECT my_tenant_id())
      AND (NOT (SELECT my_tenant_isolation_enabled()) OR reserve_id = (SELECT my_active_reserve_id()))
    )
    OR (
      (SELECT auth_role()) IN ('admin_global','admin_reserva')
      AND tenant_id = (SELECT my_tenant_id())
      AND (NOT (SELECT my_tenant_isolation_enabled()) OR reserve_id = (SELECT my_active_reserve_id()))
    )
  )
  WITH CHECK (
    (
      armeiro_id = (SELECT auth.uid())
      AND tenant_id = (SELECT my_tenant_id())
      AND (NOT (SELECT my_tenant_isolation_enabled()) OR reserve_id = (SELECT my_active_reserve_id()))
    )
    OR (
      (SELECT auth_role()) IN ('admin_global','admin_reserva')
      AND tenant_id = (SELECT my_tenant_id())
      AND (NOT (SELECT my_tenant_isolation_enabled()) OR reserve_id = (SELECT my_active_reserve_id()))
    )
  );

CREATE POLICY service_shifts_delete ON public.service_shifts
  FOR DELETE
  USING (
    (SELECT auth_role()) IN ('admin_global','admin_reserva')
    AND tenant_id = (SELECT my_tenant_id())
    AND (NOT (SELECT my_tenant_isolation_enabled()) OR reserve_id = (SELECT my_active_reserve_id()))
  );

-- ── 2. service_log_events ────────────────────────────────────────────
-- tenant_iso_log_events (FOR ALL, padrão auth.jwt()->app_metadata) —
-- dropada e recriada no padrão §4.2. Sem coluna de dono — é log de turno.
--
-- Achado MÉDIO do review: só SELECT+INSERT (sem UPDATE/DELETE) — decisão
-- deliberada, não omissão (diferente do M7 do SP6, onde faltava DELETE por
-- descuido): log de evento de turno é append-only por natureza do produto
-- (timeline auditável do turno, RPC log_shift_event_atomic é o único
-- caminho de escrita real hoje). Sem consumidor client-side de UPDATE/
-- DELETE (confirmado via grep) e sem justificativa de produto pra
-- permitir editar/apagar evento de log depois de criado.
DROP POLICY IF EXISTS tenant_iso_log_events ON public.service_log_events; -- FOR ALL — F3

CREATE POLICY service_log_events_select ON public.service_log_events
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

CREATE POLICY service_log_events_insert ON public.service_log_events
  FOR INSERT
  WITH CHECK (
    (SELECT auth_role()) IN ('admin_global','admin_reserva','armeiro')
    AND tenant_id = (SELECT my_tenant_id())
    AND (NOT (SELECT my_tenant_isolation_enabled()) OR reserve_id = (SELECT my_active_reserve_id()))
  );

-- ── 3. service_handovers (zero policies hoje) ────────────────────────
CREATE POLICY service_handovers_staff_select ON public.service_handovers
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

-- ── 4. handover_attachments (zero policies hoje) ─────────────────────
CREATE POLICY handover_attachments_staff_select ON public.handover_attachments
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

-- ── 5. inventory_reserve_checks (só service_role hoje) ───────────────
CREATE POLICY inventory_reserve_checks_staff_select ON public.inventory_reserve_checks
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

-- ── 6. inventory_item_checks (só service_role hoje) ──────────────────
CREATE POLICY inventory_item_checks_staff_select ON public.inventory_item_checks
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

-- ── 7. material_validity_alert_events ────────────────────────────────
-- Policy antiga (SELECT, já reserve_id-scoped via reserve_memberships) sem
-- tenant check nem flag gate — e (achado ALTO do review, pré-existente,
-- não introduzido aqui mas propagado se eu não corrigisse: CLAUDE.md
-- "falhas pré-existentes") o EXISTS de reserve_memberships era
-- incondicional, aplicado ATÉ no caminho matriz — admin_global/auditor em
-- matriz (sem entrar em nenhuma reserva pelo chevron) não têm membership
-- nenhuma, então nunca viam NADA, quebrando a visão ampla que a matriz
-- deveria ter (mesmo padrão de todas as outras 9 policies deste arquivo).
-- Fix: EXISTS vira o único predicado de reserva pro caminho STAFF
-- comum (armeiro/admin_reserva/auditor "de reserva" — dados por role
-- específico, não pelo papel genérico), e a matriz sai desse branch,
-- igual ao padrão do resto do arquivo. reserve_id nullable (0 linhas
-- hoje) — NULL só visível à matriz (dado incompleto, não catálogo
-- compartilhado como no SP5).
DROP POLICY IF EXISTS material_validity_alert_events_reserve_staff_select ON public.material_validity_alert_events;

CREATE POLICY material_validity_alert_events_staff_select ON public.material_validity_alert_events
  FOR SELECT
  USING (
    tenant_id = (SELECT my_tenant_id())
    AND (
      NOT (SELECT my_tenant_isolation_enabled())
      OR (
        reserve_id IS NOT NULL
        AND reserve_id = (SELECT my_active_reserve_id())
        AND EXISTS (
          SELECT 1 FROM public.reserve_memberships rm
          WHERE rm.reserve_id = material_validity_alert_events.reserve_id
            AND rm.user_id = (SELECT auth.uid())
            AND rm.role = ANY (ARRAY['admin_reserva','armeiro','auditor_reserva'])
        )
      )
      OR ((SELECT my_active_reserve_id()) IS NULL AND (SELECT auth_role()) IN ('admin_global','auditor'))
    )
  );

-- ── 8-10. biometric_devices / biometric_challenges / biometric_pairing_codes
-- (zero policies hoje, RPC-only) ──────────────────────────────────────
CREATE POLICY biometric_devices_staff_select ON public.biometric_devices
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

CREATE POLICY biometric_challenges_staff_select ON public.biometric_challenges
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

CREATE POLICY biometric_pairing_codes_staff_select ON public.biometric_pairing_codes
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

ALTER TABLE public.biometric_devices FORCE ROW LEVEL SECURITY;
ALTER TABLE public.biometric_challenges FORCE ROW LEVEL SECURITY;
ALTER TABLE public.biometric_pairing_codes FORCE ROW LEVEL SECURITY;

-- ROLLBACK (referência, não executado):
--   ALTER TABLE public.biometric_devices NO FORCE ROW LEVEL SECURITY;
--   ALTER TABLE public.biometric_challenges NO FORCE ROW LEVEL SECURITY;
--   ALTER TABLE public.biometric_pairing_codes NO FORCE ROW LEVEL SECURITY;
--   DROP POLICY IF EXISTS biometric_devices_staff_select ON public.biometric_devices;
--   DROP POLICY IF EXISTS biometric_challenges_staff_select ON public.biometric_challenges;
--   DROP POLICY IF EXISTS biometric_pairing_codes_staff_select ON public.biometric_pairing_codes;
--   DROP POLICY IF EXISTS material_validity_alert_events_staff_select ON public.material_validity_alert_events;
--   CREATE POLICY material_validity_alert_events_reserve_staff_select ON public.material_validity_alert_events FOR SELECT
--     USING (EXISTS (SELECT 1 FROM reserve_memberships rm WHERE rm.reserve_id = material_validity_alert_events.reserve_id AND rm.user_id = auth.uid() AND rm.role = ANY (ARRAY['admin_reserva','armeiro','auditor_reserva'])));
--   DROP POLICY IF EXISTS inventory_reserve_checks_staff_select ON public.inventory_reserve_checks;
--   DROP POLICY IF EXISTS inventory_item_checks_staff_select ON public.inventory_item_checks;
--   DROP POLICY IF EXISTS handover_attachments_staff_select ON public.handover_attachments;
--   DROP POLICY IF EXISTS service_handovers_staff_select ON public.service_handovers;
--   DROP POLICY IF EXISTS service_log_events_select ON public.service_log_events;
--   DROP POLICY IF EXISTS service_log_events_insert ON public.service_log_events;
--   CREATE POLICY tenant_iso_log_events ON public.service_log_events FOR ALL
--     USING (tenant_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'tenant_id'::text)::uuid);
--   DROP POLICY IF EXISTS service_shifts_select ON public.service_shifts;
--   DROP POLICY IF EXISTS service_shifts_insert ON public.service_shifts;
--   DROP POLICY IF EXISTS service_shifts_update ON public.service_shifts;
--   DROP POLICY IF EXISTS service_shifts_delete ON public.service_shifts;
--   CREATE POLICY admin_reserva_shifts ON public.service_shifts FOR SELECT
--     USING (reserve_id IN (SELECT reserve_id FROM reserve_memberships WHERE user_id = auth.uid()));
--   CREATE POLICY armeiro_own_shifts ON public.service_shifts FOR ALL
--     USING (armeiro_id = auth.uid());
--   CREATE POLICY tenant_iso_shifts ON public.service_shifts FOR ALL
--     USING (tenant_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'tenant_id'::text)::uuid);
