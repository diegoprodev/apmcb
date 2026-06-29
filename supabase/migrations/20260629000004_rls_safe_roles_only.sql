-- ═══════════════════════════════════════════════════════════════════
-- RLS Safe: corrige nomes de roles (C2) sem exigir tenant_id (dado ausente)
-- O isolamento de tenant via default_tenant_id será enforçado em migration
-- futura, após popular tenant_memberships / reserve_memberships corretamente.
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────
-- PROFILES — roles novas, sem filtro de tenant (backward compat)
-- ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS profiles_select ON profiles;
CREATE POLICY profiles_select ON profiles
  FOR SELECT USING (
    auth.uid() = id
    OR auth_role() IN ('admin_global','admin_reserva','armeiro','superadmin','auditor')
  );

-- ─────────────────────────────────────────────────────────────────
-- MATERIAL_TYPES — qualquer autenticado lê (tenant_id nos dados protege via BFF)
-- ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "materials_select" ON material_types;
DROP POLICY IF EXISTS "materials_write" ON material_types;

CREATE POLICY "materials_select" ON material_types
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "materials_write" ON material_types
  FOR ALL USING (
    auth_role() IN ('admin_global','admin_reserva','superadmin')
  );

-- ─────────────────────────────────────────────────────────────────
-- LENDINGS — militar vê as suas; staff vê todas (roles novas)
-- ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "lendings_select" ON lendings;
DROP POLICY IF EXISTS "lendings_staff_write" ON lendings;
DROP POLICY IF EXISTS "lendings_write" ON lendings;

CREATE POLICY "lendings_select" ON lendings
  FOR SELECT USING (
    military_id = auth.uid()
    OR auth_role() IN ('admin_global','admin_reserva','armeiro','superadmin','auditor')
  );

CREATE POLICY "lendings_staff_write" ON lendings
  FOR ALL USING (
    auth_role() IN ('admin_global','admin_reserva','armeiro','superadmin')
  );

-- ─────────────────────────────────────────────────────────────────
-- MATERIAL_REQUESTS (SSA) — roles novas
-- ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "ssa_military_select" ON material_requests;
DROP POLICY IF EXISTS "ssa_staff_insert" ON material_requests;
DROP POLICY IF EXISTS "ssa_staff_update" ON material_requests;

CREATE POLICY "ssa_military_select" ON material_requests
  FOR SELECT USING (
    military_id = auth.uid()
    OR auth_role() IN ('admin_global','armeiro','admin_reserva','superadmin','auditor')
  );

CREATE POLICY "ssa_staff_insert" ON material_requests
  FOR INSERT WITH CHECK (
    auth_role() IN ('usuario','admin_global','armeiro','admin_reserva','superadmin')
  );

CREATE POLICY "ssa_staff_update" ON material_requests
  FOR UPDATE
  USING (
    auth_role() IN ('admin_global','armeiro','admin_reserva','superadmin')
    OR (auth_role() = 'usuario' AND military_id = auth.uid() AND status = 'pendente')
  )
  WITH CHECK (
    auth_role() IN ('admin_global','armeiro','admin_reserva','superadmin')
    OR (auth_role() = 'usuario' AND military_id = auth.uid())
  );

-- ─────────────────────────────────────────────────────────────────
-- AUDIT_LOGS — roles novas
-- ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "audit_admin_only" ON audit_logs;

CREATE POLICY "audit_admin_only" ON audit_logs
  FOR SELECT USING (
    auth_role() IN ('admin_global','superadmin','auditor')
  );

-- ─────────────────────────────────────────────────────────────────
-- BIOMETRIC_TEMPLATES — roles novas
-- ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "biometric_staff_tenant" ON biometric_templates;

CREATE POLICY "biometric_staff_tenant" ON biometric_templates
  FOR ALL USING (
    auth_role() IN ('admin_global','admin_reserva','armeiro','superadmin')
  );

-- ─────────────────────────────────────────────────────────────────
-- MATERIAL_ITEMS — roles novas, sem subquery N+1
-- ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "material_items_staff_select" ON material_items;
DROP POLICY IF EXISTS "material_items_usuario_select" ON material_items;

CREATE POLICY "material_items_staff_select" ON material_items
  FOR SELECT USING (
    auth_role() IN ('admin_global','admin_reserva','superadmin','armeiro','auditor')
  );

CREATE POLICY "material_items_usuario_select" ON material_items
  FOR SELECT USING (
    auth_role() = 'usuario'
    AND EXISTS (
      SELECT 1 FROM lendings l
      WHERE l.military_id = auth.uid() AND l.status_legacy = 'ativo'
    )
  );
