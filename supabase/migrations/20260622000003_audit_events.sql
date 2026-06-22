-- Fase 3 — Audit Events com Hash Encadeado
-- Cria trilha de auditoria imutável com hash SHA-256 encadeado.
-- NOTA: referencia 'reserves' (não 'unidades' — tabela renomeada na Fase 1).

-- 1. Tabela audit_events
CREATE TABLE IF NOT EXISTS audit_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seq             BIGSERIAL NOT NULL,
  tenant_id       UUID REFERENCES tenants(id),
  reserve_id      UUID REFERENCES reserves(id),
  actor_id        UUID REFERENCES profiles(id),
  actor_role      TEXT NOT NULL,
  action          TEXT NOT NULL,          -- namespace.verb: "lending.created"
  resource_type   TEXT NOT NULL,
  resource_id     UUID,
  before_snapshot JSONB,
  after_snapshot  JSONB,
  metadata        JSONB DEFAULT '{}',
  ip              INET,
  user_agent      TEXT,
  device_id       TEXT,
  event_hash      TEXT NOT NULL,          -- SHA-256 calculado no BFF
  previous_hash   TEXT,                   -- hash do evento anterior (cadeia)
  created_at      TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- 2. RULE de imutabilidade (mais forte que RLS — aplica mesmo para service_role)
-- Silenciosamente ignora UPDATE/DELETE (não lança erro, apenas no-ops).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_rules WHERE tablename = 'audit_events' AND rulename = 'no_update_audit_events'
  ) THEN
    CREATE RULE no_update_audit_events AS ON UPDATE TO audit_events DO INSTEAD NOTHING;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_rules WHERE tablename = 'audit_events' AND rulename = 'no_delete_audit_events'
  ) THEN
    CREATE RULE no_delete_audit_events AS ON DELETE TO audit_events DO INSTEAD NOTHING;
  END IF;
END $$;

-- 3. Realtime CDC para Nexus
ALTER TABLE audit_events REPLICA IDENTITY FULL;

-- 4. Indexes de performance
CREATE INDEX IF NOT EXISTS idx_audit_events_tenant    ON audit_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_actor     ON audit_events(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_action    ON audit_events(action);
CREATE INDEX IF NOT EXISTS idx_audit_events_seq       ON audit_events(seq);
CREATE INDEX IF NOT EXISTS idx_audit_events_resource  ON audit_events(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_created   ON audit_events(created_at DESC);

-- 5. RLS — INSERT via service_role somente (BFF usa service_role key)
--    SELECT para roles autorizados do mesmo tenant
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

-- INSERT: apenas service_role consegue (via BFF com SUPABASE_SERVICE_ROLE_KEY)
-- A policy abaixo é para anon/authenticated que NÃO devem inserir:
-- (service_role bypassa RLS — não precisa de policy para ele)
CREATE POLICY "block_direct_insert_audit" ON audit_events
  FOR INSERT WITH CHECK (FALSE);  -- bloqueia qualquer cliente com anon/authenticated key

-- SELECT: admin_global, admin_reserva, auditor, superadmin do mesmo tenant
CREATE POLICY "authorized_read_audit" ON audit_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM profiles p
      JOIN tenant_memberships tm ON tm.user_id = p.id AND tm.tenant_id = audit_events.tenant_id
      WHERE p.id = auth.uid()
        AND p.role IN ('admin_global', 'admin_reserva', 'auditor', 'superadmin')
    )
  );
