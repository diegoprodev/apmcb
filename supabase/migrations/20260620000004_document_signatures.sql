-- Fase 4 — Assinatura Eletrônica Nível 1
-- Migration: document_signatures com RULE de imutabilidade

-- 1. Criar tabela document_signatures
CREATE TABLE IF NOT EXISTS document_signatures (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  signer_id        UUID NOT NULL REFERENCES profiles(id),
  document_type    TEXT NOT NULL
    CHECK (document_type IN ('lending','handover','inventory','inventory_campaign')),
  document_id      UUID NOT NULL,
  document_hash    TEXT NOT NULL,
  signature_proof  TEXT NOT NULL,
  signed_at        TIMESTAMPTZ DEFAULT now() NOT NULL,
  ip               INET NOT NULL,
  user_agent       TEXT,
  totp_verified    BOOLEAN DEFAULT false,
  signature_level  INT DEFAULT 1
    CHECK (signature_level IN (1, 2, 3)),
  revoked_at       TIMESTAMPTZ,
  revocation_reason TEXT,
  replaced_by      UUID REFERENCES document_signatures(id),
  created_at       TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- 2. RULE de imutabilidade (mais forte que RLS — aplica mesmo para service_role)
CREATE RULE no_update_signatures AS ON UPDATE TO document_signatures DO INSTEAD NOTHING;
CREATE RULE no_delete_signatures AS ON DELETE TO document_signatures DO INSTEAD NOTHING;

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_signatures_document ON document_signatures(document_type, document_id);
CREATE INDEX IF NOT EXISTS idx_signatures_signer ON document_signatures(signer_id);
CREATE INDEX IF NOT EXISTS idx_signatures_tenant ON document_signatures(tenant_id);
CREATE INDEX IF NOT EXISTS idx_signatures_created ON document_signatures(created_at);

-- 4. RLS
ALTER TABLE document_signatures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_insert_signatures" ON document_signatures
  FOR INSERT WITH CHECK (TRUE);

CREATE POLICY "tenant_isolation_signatures" ON document_signatures
  FOR SELECT USING (
    tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid
  );

CREATE POLICY "signer_and_admin_select" ON document_signatures
  FOR SELECT USING (
    signer_id = auth.uid()
    OR (SELECT role FROM profiles WHERE id = auth.uid())
      IN ('admin_global','admin_reserva','auditor','superadmin')
  );
