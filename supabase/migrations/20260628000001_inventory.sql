-- Fase 8: Inventário Periódico
-- Tabelas: inventory_campaigns, inventory_reserve_checks, inventory_item_checks

CREATE TABLE IF NOT EXISTS inventory_campaigns (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  nome              TEXT NOT NULL,
  descricao         TEXT,
  reserve_ids       UUID[],           -- null = todas as reserves do tenant
  prazo_inicio      TIMESTAMPTZ,
  prazo_fim         TIMESTAMPTZ NOT NULL,
  status            TEXT DEFAULT 'planejado'
    CHECK (status IN ('planejado','em_andamento','em_revisao','concluido','cancelado')),
  criado_por        UUID NOT NULL REFERENCES profiles(id),
  pdf_storage_path  TEXT,
  document_hash     TEXT,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory_reserve_checks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  campaign_id     UUID NOT NULL REFERENCES inventory_campaigns(id) ON DELETE CASCADE,
  reserve_id      UUID NOT NULL REFERENCES reserves(id),
  responsavel_id  UUID REFERENCES profiles(id),
  armeiro_id      UUID REFERENCES profiles(id),
  status          TEXT DEFAULT 'pendente'
    CHECK (status IN ('pendente','em_andamento','concluido','divergencia')),
  observacao      TEXT,
  signature_id    UUID REFERENCES document_signatures(id),
  concluido_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory_item_checks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  reserve_check_id UUID NOT NULL REFERENCES inventory_reserve_checks(id) ON DELETE CASCADE,
  material_type_id UUID NOT NULL REFERENCES material_types(id),
  qtd_esperada     INT NOT NULL,
  qtd_contada      INT,
  status           TEXT DEFAULT 'pendente'
    CHECK (status IN ('pendente','conforme','divergencia')),
  divergencia_desc TEXT,
  conferido_por    UUID REFERENCES profiles(id),
  conferido_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inv_campaigns_tenant     ON inventory_campaigns(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inv_campaigns_status     ON inventory_campaigns(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_inv_reserve_checks_camp  ON inventory_reserve_checks(campaign_id);
CREATE INDEX IF NOT EXISTS idx_inv_reserve_checks_res   ON inventory_reserve_checks(reserve_id);
CREATE INDEX IF NOT EXISTS idx_inv_item_checks_rc       ON inventory_item_checks(reserve_check_id);

ALTER TABLE inventory_campaigns      ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_reserve_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_item_checks    ENABLE ROW LEVEL SECURITY;

-- BFF usa service_role — bypass RLS
CREATE POLICY "service_role_all_inv_campaigns"
  ON inventory_campaigns FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_inv_reserve_checks"
  ON inventory_reserve_checks FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_inv_item_checks"
  ON inventory_item_checks FOR ALL TO service_role USING (true) WITH CHECK (true);
