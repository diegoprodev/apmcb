-- ═══════════════════════════════════════════════════════════════════════
-- Fase 6-B: Livro Digital de Serviço
-- service_shifts: turno ativo do armeiro
-- service_log_events: linha do tempo imutável com hash chain (hash computado pelo BFF)
-- DoD: docs/enterprise/07-canonical-definition-of-done.md
-- ═══════════════════════════════════════════════════════════════════════

-- 1. Turno de serviço do armeiro
CREATE TABLE IF NOT EXISTS service_shifts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  reserve_id          uuid NOT NULL REFERENCES reserves(id),
  armeiro_id          uuid NOT NULL REFERENCES profiles(id),
  started_at          timestamptz NOT NULL DEFAULT now(),
  ended_at            timestamptz,
  handover_id         uuid REFERENCES service_handovers(id),
  opening_snapshot    jsonb NOT NULL DEFAULT '{}',
  closing_snapshot    jsonb,
  pending_count       int NOT NULL DEFAULT 0,
  status              text NOT NULL DEFAULT 'ativo'
    CHECK (status IN ('ativo', 'encerrado', 'encerrado_sem_passagem')),
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- 2. Eventos da linha do tempo
-- NOTA: event_hash é text simples — calculado pelo BFF com SHA-256
-- (GENERATED ALWAYS AS não funciona com timestamptz::text — não imutável)
CREATE TABLE IF NOT EXISTS service_log_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id      uuid NOT NULL REFERENCES service_shifts(id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  happened_at   timestamptz NOT NULL DEFAULT now(),
  event_type    text NOT NULL CHECK (event_type IN (
    'turno_assumido',
    'cautela_emitida',
    'cautela_devolvida',
    'saida_autorizada',
    'saida_devolvida',
    'ocorrencia_registrada',
    'solicitacao_aprovada',
    'solicitacao_negada',
    'inventario_divergencia',
    'turno_encerrado',
    'evento_manual'
  )),
  actor_id      uuid NOT NULL REFERENCES profiles(id),
  subject_id    uuid,
  subject_type  text,
  description   text NOT NULL,
  metadata      jsonb NOT NULL DEFAULT '{}',
  resolved_at   timestamptz,
  is_pending    boolean NOT NULL DEFAULT false,
  prev_hash     text,
  event_hash    text NOT NULL DEFAULT ''
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_shifts_tenant      ON service_shifts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_shifts_reserve     ON service_shifts(reserve_id);
CREATE INDEX IF NOT EXISTS idx_shifts_armeiro     ON service_shifts(armeiro_id);
CREATE INDEX IF NOT EXISTS idx_shifts_status      ON service_shifts(status);
CREATE INDEX IF NOT EXISTS idx_log_shift          ON service_log_events(shift_id);
CREATE INDEX IF NOT EXISTS idx_log_type           ON service_log_events(event_type);
CREATE INDEX IF NOT EXISTS idx_log_time           ON service_log_events(happened_at DESC);
CREATE INDEX IF NOT EXISTS idx_log_pending        ON service_log_events(shift_id, is_pending)
  WHERE is_pending = true AND resolved_at IS NULL;

-- 4. RLS
ALTER TABLE service_shifts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_log_events ENABLE ROW LEVEL SECURITY;

-- Armeiro vê só os próprios turnos
CREATE POLICY "armeiro_own_shifts" ON service_shifts
  FOR ALL USING (armeiro_id = auth.uid());

-- Admin_reserva vê turnos de armeiros da sua reserva
CREATE POLICY "admin_reserva_shifts" ON service_shifts
  FOR SELECT USING (
    reserve_id IN (
      SELECT reserve_id FROM reserve_memberships
      WHERE user_id = auth.uid()
    )
  );

-- Tenant isolation
CREATE POLICY "tenant_iso_shifts" ON service_shifts
  USING (tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid);

CREATE POLICY "tenant_iso_log_events" ON service_log_events
  USING (tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid);

-- 5. Imutabilidade: impede UPDATE e DELETE em log_events
CREATE RULE no_update_log_events AS
  ON UPDATE TO service_log_events DO INSTEAD NOTHING;

CREATE RULE no_delete_log_events AS
  ON DELETE TO service_log_events DO INSTEAD NOTHING;
