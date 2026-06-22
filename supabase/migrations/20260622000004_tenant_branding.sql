-- Fase 2B — Branding dinâmico por tenant
CREATE TABLE IF NOT EXISTS tenant_branding (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  primary_hex      CHAR(7) DEFAULT '#0f172a'
    CHECK (primary_hex ~ '^#[0-9a-fA-F]{6}$'),
  secondary_hex    CHAR(7) DEFAULT '#3b82f6'
    CHECK (secondary_hex ~ '^#[0-9a-fA-F]{6}$'),
  tenant_logo_url  TEXT,
  reserve_logo_url TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id)
);

-- Seed branding padrão para PMPB
INSERT INTO tenant_branding (tenant_id, primary_hex, secondary_hex)
SELECT id, '#0f172a', '#3b82f6' FROM tenants WHERE slug = 'pmpb'
ON CONFLICT (tenant_id) DO NOTHING;

ALTER TABLE tenant_branding ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_member_read_branding" ON tenant_branding
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM tenant_memberships tm
      WHERE tm.tenant_id = tenant_branding.tenant_id
        AND tm.user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_tenant_branding_tenant ON tenant_branding(tenant_id);

CREATE OR REPLACE FUNCTION set_updated_at_tenant_branding()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_tenant_branding_updated_at
  BEFORE UPDATE ON tenant_branding
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_tenant_branding();
