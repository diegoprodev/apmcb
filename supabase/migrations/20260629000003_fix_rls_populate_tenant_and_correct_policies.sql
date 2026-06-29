-- ═══════════════════════════════════════════════════════════════════
-- Correção pós-auditoria: populate default_tenant_id + refinar policies
-- Problema: staff sem default_tenant_id ficava bloqueado pelos novos RLS
-- Solução: popular via reserve_memberships + diferenciar global vs scoped
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────
-- STEP 1: Popular default_tenant_id para staff via reserve_memberships
-- ─────────────────────────────────────────────────────────────────
UPDATE profiles p
SET default_tenant_id = (
  SELECT r.tenant_id
  FROM reserve_memberships rm
  JOIN reserves r ON r.id = rm.reserve_id
  WHERE rm.user_id = p.id
  ORDER BY rm.created_at
  LIMIT 1
)
WHERE p.default_tenant_id IS NULL
  AND p.role IN ('admin_reserva','armeiro','auditor');

-- ─────────────────────────────────────────────────────────────────
-- STEP 2: Corrigir policies — global roles veem tudo, scoped ficam no tenant
-- ─────────────────────────────────────────────────────────────────

-- 2a. PROFILES
DROP POLICY IF EXISTS profiles_select ON profiles;
CREATE POLICY profiles_select ON profiles
  FOR SELECT USING (
    auth.uid() = id
    OR auth_role() IN ('admin_global','superadmin')
    OR (
      auth_role() IN ('admin_reserva','armeiro','auditor')
      AND default_tenant_id = (
        SELECT p2.default_tenant_id FROM profiles p2 WHERE p2.id = auth.uid()
      )
    )
  );

-- 2b. MATERIAL_TYPES
DROP POLICY IF EXISTS "materials_select" ON material_types;
DROP POLICY IF EXISTS "materials_write" ON material_types;

CREATE POLICY "materials_select" ON material_types
  FOR SELECT USING (
    auth_role() IN ('admin_global','superadmin')
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.default_tenant_id = material_types.tenant_id
    )
  );

CREATE POLICY "materials_write" ON material_types
  FOR ALL USING (
    auth_role() IN ('admin_global','superadmin')
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.default_tenant_id = material_types.tenant_id
        AND p.role IN ('admin_reserva','superadmin','admin_global')
    )
  );

-- 2c. LENDINGS
DROP POLICY IF EXISTS "lendings_select" ON lendings;
DROP POLICY IF EXISTS "lendings_staff_write" ON lendings;

CREATE POLICY "lendings_select" ON lendings
  FOR SELECT USING (
    military_id = auth.uid()
    OR auth_role() IN ('admin_global','superadmin')
    OR (
      auth_role() IN ('admin_reserva','armeiro','auditor')
      AND EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.id = auth.uid() AND p.default_tenant_id = lendings.tenant_id
      )
    )
  );

CREATE POLICY "lendings_staff_write" ON lendings
  FOR ALL USING (
    auth_role() IN ('admin_global','superadmin')
    OR (
      auth_role() IN ('admin_reserva','armeiro')
      AND EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.id = auth.uid() AND p.default_tenant_id = lendings.tenant_id
      )
    )
  );

-- 2d. MATERIAL_REQUESTS (SSA)
DROP POLICY IF EXISTS "ssa_military_select" ON material_requests;
DROP POLICY IF EXISTS "ssa_staff_insert" ON material_requests;
DROP POLICY IF EXISTS "ssa_staff_update" ON material_requests;

CREATE POLICY "ssa_military_select" ON material_requests
  FOR SELECT USING (
    military_id = auth.uid()
    OR auth_role() IN ('admin_global','superadmin','armeiro','admin_reserva','auditor')
  );

CREATE POLICY "ssa_staff_insert" ON material_requests
  FOR INSERT WITH CHECK (
    auth_role() IN ('usuario','admin_global','armeiro','admin_reserva','superadmin')
  );

CREATE POLICY "ssa_staff_update" ON material_requests
  FOR UPDATE
  USING (
    auth_role() IN ('admin_global','superadmin','armeiro','admin_reserva')
    OR (auth_role() = 'usuario' AND military_id = auth.uid() AND status = 'pendente')
  )
  WITH CHECK (
    auth_role() IN ('admin_global','superadmin','armeiro','admin_reserva')
    OR (auth_role() = 'usuario' AND military_id = auth.uid())
  );

-- 2e. AUDIT_LOGS
DROP POLICY IF EXISTS "audit_admin_only" ON audit_logs;

CREATE POLICY "audit_admin_only" ON audit_logs
  FOR SELECT USING (
    auth_role() IN ('admin_global','superadmin')
    OR (
      auth_role() = 'auditor'
      AND EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.id = auth.uid() AND p.default_tenant_id = audit_logs.tenant_id
      )
    )
  );

-- 2f. BIOMETRIC_TEMPLATES
DROP POLICY IF EXISTS "biometric_staff_tenant" ON biometric_templates;

CREATE POLICY "biometric_staff_tenant" ON biometric_templates
  FOR ALL USING (
    auth_role() IN ('admin_global','superadmin')
    OR (
      auth_role() IN ('admin_reserva','armeiro')
      AND EXISTS (
        SELECT 1 FROM profiles staff_p
        JOIN profiles user_p ON user_p.id = biometric_templates.user_id
        WHERE staff_p.id = auth.uid()
          AND staff_p.default_tenant_id = user_p.default_tenant_id
      )
    )
  );

-- 2g. MATERIAL_ITEMS
DROP POLICY IF EXISTS "material_items_staff_select" ON material_items;
DROP POLICY IF EXISTS "material_items_usuario_select" ON material_items;

CREATE POLICY "material_items_staff_select" ON material_items
  FOR SELECT USING (
    auth_role() IN ('admin_global','superadmin')
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.default_tenant_id = material_items.tenant_id
        AND p.role IN ('admin_reserva','armeiro','auditor')
    )
  );

CREATE POLICY "material_items_usuario_select" ON material_items
  FOR SELECT USING (
    auth_role() = 'usuario'
    AND EXISTS (
      SELECT 1 FROM lendings l
      WHERE l.military_id = auth.uid()
        AND l.status_legacy = 'ativo'
    )
  );
