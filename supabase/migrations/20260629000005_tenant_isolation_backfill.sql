-- ═══════════════════════════════════════════════════════════════════
-- Tenant Isolation Backfill — Dívida Técnica C1
-- Spec: docs/enterprise/specs/tenant-isolation-backfill.md
-- ═══════════════════════════════════════════════════════════════════
-- Contexto: apenas 1 tenant ativo em produção (PMPB).
-- Todo staff sem default_tenant_id → PMPB.
-- superadmin e admin_global → acesso global, sem tenant scoped.
-- ═══════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_pmpb_tenant_id  UUID;
  v_default_reserve UUID;
BEGIN

  -- Resolver IDs dinamicamente (não hardcoded)
  SELECT id INTO v_pmpb_tenant_id FROM tenants WHERE slug = 'pmpb';
  IF v_pmpb_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant pmpb não encontrado — abortar migration';
  END IF;

  -- Reserve default = primeira do PMPB (a mais antiga)
  SELECT id INTO v_default_reserve
  FROM reserves
  WHERE tenant_id = v_pmpb_tenant_id
  ORDER BY created_at
  LIMIT 1;

  -- ─────────────────────────────────────────────────────────────────
  -- 1. Populate default_tenant_id para staff scoped sem tenant
  -- ─────────────────────────────────────────────────────────────────
  UPDATE profiles
  SET default_tenant_id = v_pmpb_tenant_id
  WHERE default_tenant_id IS NULL
    AND role IN ('admin_reserva', 'armeiro', 'auditor');

  RAISE NOTICE 'Profiles de staff atualizados com tenant PMPB';

  -- ─────────────────────────────────────────────────────────────────
  -- 2. Populate tenant_memberships para todo staff sem entrada
  -- ─────────────────────────────────────────────────────────────────
  INSERT INTO tenant_memberships (user_id, tenant_id)
  SELECT p.id, v_pmpb_tenant_id
  FROM profiles p
  WHERE p.role IN ('admin_reserva', 'armeiro', 'auditor', 'admin_global')
    AND NOT EXISTS (
      SELECT 1 FROM tenant_memberships tm
      WHERE tm.user_id = p.id AND tm.tenant_id = v_pmpb_tenant_id
    );

  RAISE NOTICE 'tenant_memberships populados para staff PMPB';

  -- ─────────────────────────────────────────────────────────────────
  -- 3. Populate reserve_memberships para armeiros/admin_reserva sem entrada
  -- ─────────────────────────────────────────────────────────────────
  IF v_default_reserve IS NOT NULL THEN
    INSERT INTO reserve_memberships (user_id, reserve_id, role)
    SELECT p.id, v_default_reserve, p.role
    FROM profiles p
    WHERE p.role IN ('admin_reserva', 'armeiro')
      AND NOT EXISTS (
        SELECT 1 FROM reserve_memberships rm WHERE rm.user_id = p.id
      );

    RAISE NOTICE 'reserve_memberships populados para armeiros/admin_reserva';
  END IF;

END $$;

-- ─────────────────────────────────────────────────────────────────
-- 4. Ativar RLS com tenant isolation para staff scoped
-- ─────────────────────────────────────────────────────────────────

-- PROFILES: superadmin/admin_global global; scoped roles filtrados por tenant
DROP POLICY IF EXISTS profiles_select ON profiles;
CREATE POLICY profiles_select ON profiles
  FOR SELECT USING (
    auth.uid() = id
    OR auth_role() IN ('admin_global', 'superadmin')
    OR (
      auth_role() IN ('admin_reserva', 'armeiro', 'auditor')
      AND default_tenant_id = (
        SELECT p2.default_tenant_id FROM profiles p2 WHERE p2.id = auth.uid()
      )
    )
  );

-- LENDINGS: military vê as suas; global vê tudo; scoped vê seu tenant
DROP POLICY IF EXISTS "lendings_select" ON lendings;
DROP POLICY IF EXISTS "lendings_staff_write" ON lendings;

CREATE POLICY "lendings_select" ON lendings
  FOR SELECT USING (
    military_id = auth.uid()
    OR auth_role() IN ('admin_global', 'superadmin')
    OR (
      auth_role() IN ('admin_reserva', 'armeiro', 'auditor')
      AND EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.id = auth.uid()
          AND p.default_tenant_id = lendings.tenant_id
      )
    )
  );

CREATE POLICY "lendings_staff_write" ON lendings
  FOR ALL USING (
    auth_role() IN ('admin_global', 'superadmin')
    OR (
      auth_role() IN ('admin_reserva', 'armeiro')
      AND EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.id = auth.uid()
          AND p.default_tenant_id = lendings.tenant_id
      )
    )
  );

-- MATERIAL_TYPES: global vê tudo; autenticado vê seu tenant
DROP POLICY IF EXISTS "materials_select" ON material_types;
DROP POLICY IF EXISTS "materials_write" ON material_types;

CREATE POLICY "materials_select" ON material_types
  FOR SELECT USING (
    auth_role() IN ('admin_global', 'superadmin')
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.default_tenant_id = material_types.tenant_id
    )
  );

CREATE POLICY "materials_write" ON material_types
  FOR ALL USING (
    auth_role() IN ('admin_global', 'superadmin')
    OR (
      auth_role() = 'admin_reserva'
      AND EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.id = auth.uid()
          AND p.default_tenant_id = material_types.tenant_id
      )
    )
  );

-- AUDIT_LOGS: global vê tudo; auditor vê seu tenant
DROP POLICY IF EXISTS "audit_admin_only" ON audit_logs;

CREATE POLICY "audit_admin_only" ON audit_logs
  FOR SELECT USING (
    auth_role() IN ('admin_global', 'superadmin')
    OR (
      auth_role() = 'auditor'
      AND EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.id = auth.uid()
          AND p.default_tenant_id = audit_logs.tenant_id
      )
    )
  );

-- BIOMETRIC_TEMPLATES: global vê tudo; scoped por tenant
DROP POLICY IF EXISTS "biometric_staff_tenant" ON biometric_templates;

CREATE POLICY "biometric_staff_tenant" ON biometric_templates
  FOR ALL USING (
    auth_role() IN ('admin_global', 'superadmin')
    OR (
      auth_role() IN ('admin_reserva', 'armeiro')
      AND EXISTS (
        SELECT 1 FROM profiles staff_p
        JOIN profiles user_p ON user_p.id = biometric_templates.user_id
        WHERE staff_p.id = auth.uid()
          AND staff_p.default_tenant_id = user_p.default_tenant_id
      )
    )
  );

-- MATERIAL_ITEMS: global vê tudo; staff scoped por tenant
DROP POLICY IF EXISTS "material_items_staff_select" ON material_items;
DROP POLICY IF EXISTS "material_items_usuario_select" ON material_items;

CREATE POLICY "material_items_staff_select" ON material_items
  FOR SELECT USING (
    auth_role() IN ('admin_global', 'superadmin')
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.default_tenant_id = material_items.tenant_id
        AND p.role IN ('admin_reserva', 'armeiro', 'auditor')
    )
  );

CREATE POLICY "material_items_usuario_select" ON material_items
  FOR SELECT USING (
    auth_role() = 'usuario'
    AND EXISTS (
      SELECT 1 FROM lendings l
      WHERE l.military_id = auth.uid() AND l.status_legacy = 'ativo'
    )
  );

-- ─────────────────────────────────────────────────────────────────
-- 5. Validação inline
-- ─────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_uncovered INT;
BEGIN
  SELECT COUNT(*)
  INTO v_uncovered
  FROM profiles
  WHERE role IN ('admin_reserva','armeiro','auditor')
    AND default_tenant_id IS NULL;

  IF v_uncovered > 0 THEN
    RAISE WARNING 'ATENÇÃO: % perfis de staff ainda sem default_tenant_id', v_uncovered;
  ELSE
    RAISE NOTICE 'OK: todo staff scoped tem default_tenant_id';
  END IF;
END $$;
