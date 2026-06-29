-- ═══════════════════════════════════════════════════════════════════
-- Auditoria de Segurança Global — Fix RLS + Roles + Tenant Isolation
-- Data: 2026-06-29
-- Corrige: C1, C2, A5, A6 do relatório de auditoria
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────
-- 1. PROFILES — Staff filtra por tenant_id + roles novas
-- ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS profiles_select ON profiles;
CREATE POLICY profiles_select ON profiles
  FOR SELECT USING (
    auth.uid() = id
    OR (
      auth_role() IN ('admin_global','admin_reserva','armeiro','superadmin','auditor')
      AND default_tenant_id = (
        SELECT p2.default_tenant_id FROM profiles p2 WHERE p2.id = auth.uid()
      )
    )
  );

-- ─────────────────────────────────────────────────────────────────
-- 2. MATERIAL_TYPES — isolamento por tenant
-- ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "materials_select" ON material_types;
DROP POLICY IF EXISTS "materials_write" ON material_types;

CREATE POLICY "materials_select" ON material_types
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.default_tenant_id = material_types.tenant_id
    )
  );

CREATE POLICY "materials_write" ON material_types
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.default_tenant_id = material_types.tenant_id
        AND p.role IN ('admin_global','admin_reserva','superadmin')
    )
  );

-- ─────────────────────────────────────────────────────────────────
-- 3. LENDINGS — isolamento por tenant + roles novas
-- ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "lendings_select" ON lendings;
DROP POLICY IF EXISTS "lendings_staff_write" ON lendings;
DROP POLICY IF EXISTS "lendings_write" ON lendings;

CREATE POLICY "lendings_select" ON lendings
  FOR SELECT USING (
    military_id = auth.uid()
    OR (
      auth_role() IN ('admin_global','admin_reserva','armeiro','superadmin','auditor')
      AND EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.id = auth.uid() AND p.default_tenant_id = lendings.tenant_id
      )
    )
  );

-- Staff pode modificar apenas dentro do seu tenant
CREATE POLICY "lendings_staff_write" ON lendings
  FOR ALL USING (
    auth_role() IN ('admin_global','admin_reserva','armeiro','superadmin')
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.default_tenant_id = lendings.tenant_id
    )
  );

-- ─────────────────────────────────────────────────────────────────
-- 4. MATERIAL_REQUESTS (SSA) — roles novas + isolamento
-- ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "ssa_staff_select" ON material_requests;
DROP POLICY IF EXISTS "ssa_staff_update" ON material_requests;
DROP POLICY IF EXISTS "ssa_military_select" ON material_requests;
DROP POLICY IF EXISTS "ssa_military_insert" ON material_requests;

-- Militar vê apenas as próprias solicitações
CREATE POLICY "ssa_military_select" ON material_requests
  FOR SELECT USING (
    military_id = auth.uid()
    OR auth_role() IN ('admin_global','armeiro','admin_reserva','superadmin','auditor')
  );

-- Staff pode inserir/atualizar
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
-- 5. AUDIT_LOGS — role nova + tenant_id
-- ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "audit_admin_only" ON audit_logs;

CREATE POLICY "audit_admin_only" ON audit_logs
  FOR SELECT USING (
    auth_role() IN ('admin_global','superadmin','auditor')
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.default_tenant_id = audit_logs.tenant_id
    )
  );

-- ─────────────────────────────────────────────────────────────────
-- 6. BIOMETRIC_TEMPLATES — tenant isolation
-- ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "biometric_admin_master" ON biometric_templates;
DROP POLICY IF EXISTS "biometric_staff_tenant" ON biometric_templates;

CREATE POLICY "biometric_staff_tenant" ON biometric_templates
  FOR ALL USING (
    auth_role() IN ('admin_global','admin_reserva','armeiro','superadmin')
    AND EXISTS (
      SELECT 1 FROM profiles staff_p
      JOIN profiles user_p ON user_p.id = biometric_templates.user_id
      WHERE staff_p.id = auth.uid()
        AND staff_p.default_tenant_id = user_p.default_tenant_id
    )
  );

-- ─────────────────────────────────────────────────────────────────
-- 7. MATERIAL_ITEMS — eliminar N+1 subqueries; usar EXISTS com JOIN
-- ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "material_items_staff_select" ON material_items;
DROP POLICY IF EXISTS "material_items_usuario_select" ON material_items;

CREATE POLICY "material_items_staff_select" ON material_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.default_tenant_id = material_items.tenant_id
        AND p.role IN ('admin_global','admin_reserva','superadmin','armeiro','auditor')
    )
  );

-- Usuário vê apenas itens atualmente sob sua responsabilidade
CREATE POLICY "material_items_usuario_select" ON material_items
  FOR SELECT USING (
    auth_role() = 'usuario'
    AND EXISTS (
      SELECT 1 FROM lendings l
      WHERE l.military_id = auth.uid()
        AND l.status_legacy = 'ativo'
    )
  );

-- ─────────────────────────────────────────────────────────────────
-- 8. NOTIFICATIONS INSERT — validar que usuário existe (anti cross-tenant)
-- ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS notifications_insert_service ON notifications;

CREATE POLICY notifications_insert_service ON notifications
  FOR INSERT TO service_role
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = notifications.user_id
    )
  );

-- ─────────────────────────────────────────────────────────────────
-- 9. ADMIN_APPROVAL_REQUESTS — roles novas
-- ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS aar_own_insert ON admin_approval_requests;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'admin_approval_requests') THEN
    CREATE POLICY aar_own_insert ON admin_approval_requests
      FOR INSERT WITH CHECK (
        requestor_id = auth.uid()
        AND EXISTS (
          SELECT 1 FROM profiles
          WHERE id = auth.uid()
            AND role IN ('armeiro','admin_global','admin_reserva','superadmin')
        )
      );
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────
-- 10. STORAGE BUCKETS — tornar privados (fotos militares e materiais)
-- ─────────────────────────────────────────────────────────────────
UPDATE storage.buckets
  SET public = false
  WHERE id IN ('profile-photos', 'material-photos');

DROP POLICY IF EXISTS "public_read_photos" ON storage.objects;
DROP POLICY IF EXISTS "material_photos_public_read" ON storage.objects;
DROP POLICY IF EXISTS "profile_photos_auth_read" ON storage.objects;
DROP POLICY IF EXISTS "material_photos_auth_read" ON storage.objects;

CREATE POLICY "profile_photos_auth_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'profile-photos');

CREATE POLICY "material_photos_auth_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'material-photos');
