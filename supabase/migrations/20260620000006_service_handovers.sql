-- Fase 6: Livro Digital de Serviço
-- Tables: service_handovers, handover_attachments

-- 1. service_handovers
CREATE TABLE IF NOT EXISTS service_handovers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reserve_id            UUID NOT NULL REFERENCES reserves(id),
  saindo_id             UUID NOT NULL REFERENCES profiles(id),
  entrando_id           UUID REFERENCES profiles(id),
  status                TEXT NOT NULL DEFAULT 'aguardando_assinatura_saida'
    CHECK (status IN (
      'aguardando_assinatura_saida',
      'aguardando_atribuicao',
      'aguardando_assinatura_entrada',
      'concluido',
      'divergencia',
      'vencido',
      'cancelado'
    )),
  report_snapshot       JSONB NOT NULL DEFAULT '{}',
  observacao_saindo     TEXT,
  observacao_entrada    TEXT,
  divergencia_descricao TEXT,
  prazo_assumcao        TIMESTAMPTZ,
  saindo_signature_id   UUID REFERENCES document_signatures(id),
  entrada_signature_id  UUID REFERENCES document_signatures(id),
  document_hash         TEXT,
  pdf_storage_path      TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. handover_attachments
CREATE TABLE IF NOT EXISTS handover_attachments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  handover_id  UUID NOT NULL REFERENCES service_handovers(id) ON DELETE CASCADE,
  tipo         TEXT NOT NULL CHECK (tipo IN ('foto_divergencia', 'documento')),
  storage_path TEXT NOT NULL,
  descricao    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_handovers_tenant    ON service_handovers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_handovers_reserve   ON service_handovers(reserve_id);
CREATE INDEX IF NOT EXISTS idx_handovers_status    ON service_handovers(status);
CREATE INDEX IF NOT EXISTS idx_handovers_saindo    ON service_handovers(saindo_id);
CREATE INDEX IF NOT EXISTS idx_handovers_entrando  ON service_handovers(entrando_id);
CREATE INDEX IF NOT EXISTS idx_handovers_created   ON service_handovers(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_handover_att_parent ON handover_attachments(handover_id);

-- 4. updated_at trigger
CREATE OR REPLACE TRIGGER handovers_updated_at
  BEFORE UPDATE ON service_handovers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 5. RLS
ALTER TABLE service_handovers    ENABLE ROW LEVEL SECURITY;
ALTER TABLE handover_attachments ENABLE ROW LEVEL SECURITY;

-- Tenant isolation: BFF usa service role key (RLS bypassed), mas habilitamos para segurança
CREATE POLICY "tenant_isolation_handovers" ON service_handovers
  FOR ALL USING (
    tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid
  );

CREATE POLICY "tenant_isolation_attachments" ON handover_attachments
  FOR ALL USING (
    tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid
  );
