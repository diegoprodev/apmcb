-- ============================================================
-- SLICE 1A — Multi-tenant Foundation
-- Tenant PMPB → Org Unit DEC → Reserve APMCB
-- ============================================================
-- REGRA: APMCB NÃO é o tenant. PMPB é o tenant.
-- Hierarquia: Tenant → (org_unit opcional) → Reserve
-- structure_mode='simple' dispensa org_unit.
-- ============================================================

-- ── 1. Novos valores em role_enum ─────────────────────────────
ALTER TYPE role_enum ADD VALUE IF NOT EXISTS 'superadmin';
ALTER TYPE role_enum ADD VALUE IF NOT EXISTS 'admin_global';
ALTER TYPE role_enum ADD VALUE IF NOT EXISTS 'admin_reserva';
ALTER TYPE role_enum ADD VALUE IF NOT EXISTS 'armeiro';
ALTER TYPE role_enum ADD VALUE IF NOT EXISTS 'auditor';

-- ── 2. Tabela tenants ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome            TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,      -- chave natural (ex: 'pmpb')
  tipo_orgao      TEXT NOT NULL DEFAULT 'pm'
    CHECK (tipo_orgao IN ('pm','gc','bombeiro','federal','outro')),
  estado          CHAR(2),
  structure_mode  TEXT NOT NULL DEFAULT 'simple'
    CHECK (structure_mode IN ('simple', 'structured')),
  status          TEXT NOT NULL DEFAULT 'ativo'
    CHECK (status IN ('ativo', 'inativo')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);

-- ── 3. Tabela org_units ────────────────────────────────────────
-- Só necessária quando structure_mode='structured'.
-- parent_org_unit_id permite hierarquia futura (DEC → Batalhão etc.)
CREATE TABLE IF NOT EXISTS org_units (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  parent_org_unit_id  UUID REFERENCES org_units(id),
  nome                TEXT NOT NULL,
  acronym             TEXT NOT NULL,
  type                TEXT NOT NULL DEFAULT 'diretoria'
    CHECK (type IN ('diretoria','batalhao','companhia','centro','guarda','secretaria','unidade','outro')),
  status              TEXT NOT NULL DEFAULT 'ativa'
    CHECK (status IN ('ativa', 'inativa')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, acronym)
);

CREATE INDEX IF NOT EXISTS idx_org_units_tenant ON org_units(tenant_id);

-- ── 4. Tabela reserves ────────────────────────────────────────
-- Unidade operacional de armamento.
-- org_unit_id é OPCIONAL: NULL = reserva direta no tenant (modo simples).
-- Constraint garante que org_unit_id pertença ao mesmo tenant da reserva.
CREATE TABLE IF NOT EXISTS reserves (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  org_unit_id  UUID REFERENCES org_units(id),
  nome         TEXT NOT NULL,
  acronym      TEXT NOT NULL UNIQUE,           -- chave natural (ex: 'APMCB')
  logo_url     TEXT,
  status       TEXT NOT NULL DEFAULT 'ativa'
    CHECK (status IN ('ativa', 'inativa')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Garante que org_unit_id, quando presente, pertença ao mesmo tenant
CREATE OR REPLACE FUNCTION fn_check_reserve_org_unit_tenant()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.org_unit_id IS NOT NULL THEN
    IF (SELECT tenant_id FROM org_units WHERE id = NEW.org_unit_id) <> NEW.tenant_id THEN
      RAISE EXCEPTION 'CROSS_TENANT_VIOLATION: org_unit_id % não pertence ao tenant %',
        NEW.org_unit_id, NEW.tenant_id
      USING ERRCODE = 'P0003';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_reserve_org_unit_tenant
  BEFORE INSERT OR UPDATE OF org_unit_id, tenant_id ON reserves
  FOR EACH ROW EXECUTE FUNCTION fn_check_reserve_org_unit_tenant();

CREATE INDEX IF NOT EXISTS idx_reserves_tenant ON reserves(tenant_id);
CREATE INDEX IF NOT EXISTS idx_reserves_org_unit ON reserves(org_unit_id) WHERE org_unit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reserves_status ON reserves(status);

-- ── 5. Tabela tenant_memberships ──────────────────────────────
-- Usuário pertence ao tenant. Não precisa de reserva específica.
-- Militar comum com tenant_membership pode solicitar em QUALQUER
-- reserva ativa do mesmo tenant — sem reserve_membership.
CREATE TABLE IF NOT EXISTS tenant_memberships (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role       role_enum NOT NULL DEFAULT 'usuario',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_memberships_user ON tenant_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_tenant_memberships_tenant ON tenant_memberships(tenant_id);

-- ── 6. Tabela reserve_memberships ─────────────────────────────
-- Exclusivo para papéis operacionais/admin da reserva.
-- NÃO se aplica ao militar comum (usuario) — ele usa tenant_memberships.
CREATE TABLE IF NOT EXISTS reserve_memberships (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reserve_id UUID NOT NULL REFERENCES reserves(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role       TEXT NOT NULL
    CHECK (role IN ('admin_reserva', 'armeiro', 'auditor_reserva')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (reserve_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_reserve_memberships_user ON reserve_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_reserve_memberships_reserve ON reserve_memberships(reserve_id);

-- ── 7. Tabela user_reserve_preferences ───────────────────────
-- Cache de reserva favorita/recente por usuário.
CREATE TABLE IF NOT EXISTS user_reserve_preferences (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reserve_id       UUID NOT NULL REFERENCES reserves(id) ON DELETE CASCADE,
  selection_count  INTEGER NOT NULL DEFAULT 0,
  last_selected_at TIMESTAMPTZ,
  is_favorite      BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (user_id, reserve_id)
);

CREATE INDEX IF NOT EXISTS idx_urp_user ON user_reserve_preferences(user_id);

-- ── 8. ALTER TABLE profiles ───────────────────────────────────
-- default_tenant_id: cache de conveniência; autorização real via tenant_memberships
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS default_tenant_id UUID REFERENCES tenants(id);

CREATE INDEX IF NOT EXISTS idx_profiles_default_tenant ON profiles(default_tenant_id);

-- ── 9. ALTER tabelas existentes — adicionar tenant_id/reserve_id ──
ALTER TABLE material_types
  ADD COLUMN IF NOT EXISTS tenant_id  UUID REFERENCES tenants(id),
  ADD COLUMN IF NOT EXISTS reserve_id UUID REFERENCES reserves(id);

ALTER TABLE lendings
  ADD COLUMN IF NOT EXISTS tenant_id  UUID REFERENCES tenants(id),
  ADD COLUMN IF NOT EXISTS reserve_id UUID REFERENCES reserves(id);

-- RENAME status → status_legacy para liberar o nome "status"
-- para a máquina de estados definitiva da Fase 5 (saída diária enterprise).
-- Valores atuais: 'ativo'/'devolvido' → preservados em status_legacy.
ALTER TABLE lendings RENAME COLUMN status TO status_legacy;

ALTER TABLE material_requests
  ADD COLUMN IF NOT EXISTS tenant_id  UUID REFERENCES tenants(id),
  ADD COLUMN IF NOT EXISTS reserve_id UUID REFERENCES reserves(id);

ALTER TABLE material_request_items
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);

ALTER TABLE totp_secrets
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);

ALTER TABLE biometric_templates
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);

-- Indexes de tenant nas tabelas existentes
CREATE INDEX IF NOT EXISTS idx_material_types_tenant ON material_types(tenant_id);
CREATE INDEX IF NOT EXISTS idx_lendings_tenant ON lendings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_material_requests_tenant ON material_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON audit_logs(tenant_id);

-- ── 10. RLS — Novas tabelas ───────────────────────────────────
ALTER TABLE tenants              ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_units            ENABLE ROW LEVEL SECURITY;
ALTER TABLE reserves             ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_memberships   ENABLE ROW LEVEL SECURITY;
ALTER TABLE reserve_memberships  ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_reserve_preferences ENABLE ROW LEVEL SECURITY;

-- tenants: apenas superadmin/admin via nexus (service_role)
-- Frontend acessa via BFF — RLS não bloqueia service_role
CREATE POLICY "tenants_service_role" ON tenants
  FOR ALL USING (true)
  WITH CHECK (true);
-- Nota: BFF usa service_role para tenants. RLS de tenant isolation
-- é aplicada em tenant_memberships e nas tabelas de dados.

-- org_units: membro do tenant pode ver
CREATE POLICY "org_units_tenant_member" ON org_units
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM tenant_memberships tm
      WHERE tm.tenant_id = org_units.tenant_id
        AND tm.user_id = auth.uid()
    )
  );

-- reserves: membro do tenant pode ver reserves ativas
CREATE POLICY "reserves_tenant_member_select" ON reserves
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM tenant_memberships tm
      WHERE tm.tenant_id = reserves.tenant_id
        AND tm.user_id = auth.uid()
    )
  );

-- tenant_memberships: usuário vê apenas sua própria membership
CREATE POLICY "tenant_memberships_own" ON tenant_memberships
  FOR SELECT USING (user_id = auth.uid());

-- reserve_memberships: staff vê memberships da sua reserva
CREATE POLICY "reserve_memberships_select" ON reserve_memberships
  FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM reserve_memberships rm2
      WHERE rm2.reserve_id = reserve_memberships.reserve_id
        AND rm2.user_id = auth.uid()
        AND rm2.role IN ('admin_reserva')
    )
  );

-- user_reserve_preferences: usuário gerencia suas próprias preferências
CREATE POLICY "urp_own" ON user_reserve_preferences
  FOR ALL USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── 11. Função updated_at para novas tabelas ──────────────────
CREATE TRIGGER tenants_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER reserves_updated_at
  BEFORE UPDATE ON reserves
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
