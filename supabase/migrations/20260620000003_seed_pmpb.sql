-- ============================================================
-- SLICE 1A — Seed Idempotente PMPB → DEC → APMCB
-- ============================================================
-- Safe to run N times: usa ON CONFLICT DO NOTHING.
-- Chaves naturais: tenants.slug, org_units.(tenant_id, acronym),
--                 reserves.acronym
--
-- NOTA FUTURA — Exemplo de tenant simples (Guarda Municipal):
--   INSERT INTO tenants (nome, slug, tipo_orgao, estado, structure_mode)
--   VALUES ('Guarda Municipal de Santa Rita', 'guarda-santa-rita', 'gc', 'PB', 'simple')
--   ON CONFLICT (slug) DO NOTHING;
--
--   INSERT INTO reserves (tenant_id, org_unit_id, nome, acronym)
--   SELECT id, NULL, 'Reserva Central', 'CENTRAL'
--   FROM tenants WHERE slug = 'guarda-santa-rita'
--   ON CONFLICT (acronym) DO NOTHING;
--
--   org_unit_id = NULL é válido — o schema suporta ambos os modelos.
-- ============================================================

-- ── 1. Tenant PMPB ────────────────────────────────────────────
INSERT INTO tenants (nome, slug, tipo_orgao, estado, structure_mode, status)
VALUES (
  'Polícia Militar da Paraíba',
  'pmpb',
  'pm',
  'PB',
  'structured',
  'ativo'
)
ON CONFLICT (slug) DO NOTHING;

-- ── 2. Org Unit DEC (dentro do PMPB) ─────────────────────────
INSERT INTO org_units (tenant_id, nome, acronym, type, status)
SELECT
  id,
  'Diretoria de Educação e Cultura',
  'DEC',
  'diretoria',
  'ativa'
FROM tenants
WHERE slug = 'pmpb'
ON CONFLICT (tenant_id, acronym) DO NOTHING;

-- ── 3. Reserva APMCB (dentro do DEC) ─────────────────────────
INSERT INTO reserves (tenant_id, org_unit_id, nome, acronym, status)
SELECT
  t.id,
  o.id,
  'Academia de Polícia Militar do Cabo Branco',
  'APMCB',
  'ativa'
FROM tenants t
JOIN org_units o ON o.tenant_id = t.id AND o.acronym = 'DEC'
WHERE t.slug = 'pmpb'
ON CONFLICT (acronym) DO NOTHING;

-- ── 4. Migrar profiles existentes → PMPB ─────────────────────
UPDATE profiles
SET default_tenant_id = (SELECT id FROM tenants WHERE slug = 'pmpb')
WHERE default_tenant_id IS NULL;

-- ── 5. Criar tenant_memberships para profiles existentes ──────
INSERT INTO tenant_memberships (tenant_id, user_id, role)
SELECT
  (SELECT id FROM tenants WHERE slug = 'pmpb'),
  id,
  role
FROM profiles
ON CONFLICT (tenant_id, user_id) DO NOTHING;

-- ── 6. Migrar material_types → PMPB/APMCB ────────────────────
UPDATE material_types
SET
  tenant_id  = (SELECT id FROM tenants WHERE slug = 'pmpb'),
  reserve_id = (SELECT id FROM reserves WHERE acronym = 'APMCB')
WHERE tenant_id IS NULL;

-- ── 7. Migrar lendings → PMPB/APMCB ──────────────────────────
UPDATE lendings
SET
  tenant_id  = (SELECT id FROM tenants WHERE slug = 'pmpb'),
  reserve_id = (SELECT id FROM reserves WHERE acronym = 'APMCB')
WHERE tenant_id IS NULL;

-- ── 8. Migrar material_requests → PMPB/APMCB ─────────────────
UPDATE material_requests
SET
  tenant_id  = (SELECT id FROM tenants WHERE slug = 'pmpb'),
  reserve_id = (SELECT id FROM reserves WHERE acronym = 'APMCB')
WHERE tenant_id IS NULL;

-- ── 9. Migrar material_request_items → PMPB ──────────────────
UPDATE material_request_items
SET tenant_id = (SELECT id FROM tenants WHERE slug = 'pmpb')
WHERE tenant_id IS NULL;

-- ── 10. Migrar audit_logs → PMPB ─────────────────────────────
UPDATE audit_logs
SET tenant_id = (SELECT id FROM tenants WHERE slug = 'pmpb')
WHERE tenant_id IS NULL;

-- ── 11. Migrar notifications → PMPB ──────────────────────────
UPDATE notifications
SET tenant_id = (SELECT id FROM tenants WHERE slug = 'pmpb')
WHERE tenant_id IS NULL;

-- ── 12. Registrar criação no audit_log (idempotente) ─────────
DO $$
DECLARE v_tenant_id UUID;
BEGIN
  SELECT id INTO v_tenant_id FROM tenants WHERE slug = 'pmpb';
  IF v_tenant_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM audit_logs WHERE action = 'tenant.created' AND resource_id = v_tenant_id)
  THEN
    INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, metadata, tenant_id)
    VALUES (
      NULL,
      'tenant.created',
      'tenant',
      v_tenant_id,
      json_build_object('slug', 'pmpb', 'structure_mode', 'structured', 'seed', true),
      v_tenant_id
    );
  END IF;
END $$;
