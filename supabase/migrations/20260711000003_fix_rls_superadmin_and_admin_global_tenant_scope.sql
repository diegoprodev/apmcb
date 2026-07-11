-- Regra canônica confirmada pelo dono do projeto: superadmin (Nexus/SaaS
-- operator) NUNCA deve acessar dados de nenhum tenant — é papel de operação
-- da plataforma, não de operação de um tenant específico. admin_global deve
-- ser escopado ao PRÓPRIO tenant (estrutura em cascata dentro do tenant),
-- nunca cross-tenant. Toda tabela multi-tenant deve filtrar por tenant_id.
--
-- Auditoria (pg_policies) encontrou o mesmo padrão incorreto — admin_global
-- e superadmin agrupados em uma cláusula SEM checagem de tenant_id — em 10
-- tabelas. Esta migration corrige todas de uma vez, removendo superadmin e
-- adicionando escopo de tenant a admin_global onde faltava.

-- ── profiles ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS profiles_select ON profiles;
CREATE POLICY profiles_select ON profiles FOR SELECT USING (
  auth.uid() = id
  OR (
    auth_role() = ANY (ARRAY['admin_global'::role_enum, 'admin_reserva'::role_enum, 'armeiro'::role_enum, 'auditor'::role_enum])
    AND default_tenant_id = my_tenant_id()
  )
);

DROP POLICY IF EXISTS profiles_insert ON profiles;
CREATE POLICY profiles_insert ON profiles FOR INSERT WITH CHECK (
  auth_role() = ANY (ARRAY['admin_global'::role_enum, 'admin_reserva'::role_enum])
  AND default_tenant_id = my_tenant_id()
);

DROP POLICY IF EXISTS profiles_update ON profiles;
CREATE POLICY profiles_update ON profiles
  FOR UPDATE USING (
    (
      auth_role() = ANY (ARRAY['admin_global'::role_enum, 'admin_reserva'::role_enum])
      AND default_tenant_id = my_tenant_id()
    )
    OR (
      auth.uid() = id
      AND auth_role() = ANY (ARRAY['usuario'::role_enum, 'armeiro'::role_enum, 'auditor'::role_enum])
    )
  );

-- ── cautelamentos ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS cautelamentos_select ON cautelamentos;
CREATE POLICY cautelamentos_select ON cautelamentos
  FOR SELECT USING (
    militar_id = auth.uid()
    OR (
      auth_role() = ANY (ARRAY['admin_global'::role_enum, 'admin_reserva'::role_enum, 'armeiro'::role_enum, 'auditor'::role_enum])
      AND tenant_id = my_tenant_id()
    )
  );

DROP POLICY IF EXISTS cautelamentos_update ON cautelamentos;
CREATE POLICY cautelamentos_update ON cautelamentos
  FOR UPDATE USING (
    auth_role() = ANY (ARRAY['admin_global'::role_enum, 'admin_reserva'::role_enum, 'armeiro'::role_enum])
    AND tenant_id = my_tenant_id()
  );

DROP POLICY IF EXISTS cautelamentos_insert ON cautelamentos;
CREATE POLICY cautelamentos_insert ON cautelamentos
  FOR INSERT WITH CHECK (
    auth_role() = ANY (ARRAY['admin_global'::role_enum, 'admin_reserva'::role_enum, 'armeiro'::role_enum])
    AND tenant_id = my_tenant_id()
  );

-- ── audit_logs ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS audit_admin_only ON audit_logs;
CREATE POLICY audit_admin_only ON audit_logs FOR SELECT USING (
  auth_role() = ANY (ARRAY['admin_global'::role_enum, 'auditor'::role_enum])
  AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.default_tenant_id = audit_logs.tenant_id)
);

-- ── biometric_templates ─────────────────────────────────────────────────
DROP POLICY IF EXISTS biometric_staff_tenant ON biometric_templates;
CREATE POLICY biometric_staff_tenant ON biometric_templates FOR ALL USING (
  auth_role() = ANY (ARRAY['admin_global'::role_enum, 'admin_reserva'::role_enum, 'armeiro'::role_enum])
  AND EXISTS (
    SELECT 1 FROM profiles staff_p JOIN profiles user_p ON user_p.id = biometric_templates.user_id
    WHERE staff_p.id = auth.uid() AND staff_p.default_tenant_id = user_p.default_tenant_id
  )
);

-- ── category_requests (usa reserve_id, não tem tenant_id próprio) ───────
DROP POLICY IF EXISTS membro_ver_requests ON category_requests;
CREATE POLICY membro_ver_requests ON category_requests FOR SELECT USING (
  requested_by = auth.uid()
  OR EXISTS (
    SELECT 1 FROM reserve_memberships rm
    WHERE rm.user_id = auth.uid() AND rm.reserve_id = category_requests.reserve_id
      AND rm.role = ANY (ARRAY['admin_reserva'::text, 'admin_global'::text])
  )
);

DROP POLICY IF EXISTS admin_atualizar ON category_requests;
CREATE POLICY admin_atualizar ON category_requests FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM reserve_memberships rm
    WHERE rm.user_id = auth.uid() AND rm.reserve_id = category_requests.reserve_id
      AND rm.role = ANY (ARRAY['admin_reserva'::text, 'admin_global'::text])
  )
);

-- ── lendings ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS lendings_staff_write ON lendings;
CREATE POLICY lendings_staff_write ON lendings FOR ALL USING (
  auth_role() = ANY (ARRAY['admin_global'::role_enum, 'admin_reserva'::role_enum, 'armeiro'::role_enum])
  AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.default_tenant_id = lendings.tenant_id)
);

DROP POLICY IF EXISTS lendings_select ON lendings;
CREATE POLICY lendings_select ON lendings FOR SELECT USING (
  military_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.role = ANY (ARRAY['admin_global'::role_enum, 'admin_reserva'::role_enum, 'armeiro'::role_enum, 'auditor'::role_enum])
      AND p.default_tenant_id = lendings.tenant_id
  )
);

-- ── material_items ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS material_items_staff_select ON material_items;
CREATE POLICY material_items_staff_select ON material_items FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.default_tenant_id = material_items.tenant_id
      AND p.role = ANY (ARRAY['admin_global'::role_enum, 'admin_reserva'::role_enum, 'armeiro'::role_enum, 'auditor'::role_enum])
  )
);

-- ── material_types ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS materials_write ON material_types;
CREATE POLICY materials_write ON material_types FOR ALL USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.role = ANY (ARRAY['admin_global'::role_enum, 'admin_reserva'::role_enum])
      AND p.default_tenant_id = material_types.tenant_id
  )
);

DROP POLICY IF EXISTS materials_select ON material_types;
CREATE POLICY materials_select ON material_types FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.default_tenant_id = material_types.tenant_id)
);

-- ── material_requests (SSA) ─────────────────────────────────────────────
DROP POLICY IF EXISTS ssa_staff_insert ON material_requests;
CREATE POLICY ssa_staff_insert ON material_requests FOR INSERT WITH CHECK (
  auth_role() = ANY (ARRAY['usuario'::role_enum, 'admin_global'::role_enum, 'armeiro'::role_enum, 'admin_reserva'::role_enum])
  AND tenant_id = my_tenant_id()
);

DROP POLICY IF EXISTS ssa_military_select ON material_requests;
CREATE POLICY ssa_military_select ON material_requests FOR SELECT USING (
  military_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.role = ANY (ARRAY['admin_global'::role_enum, 'armeiro'::role_enum, 'admin_reserva'::role_enum, 'auditor'::role_enum])
      AND p.default_tenant_id = material_requests.tenant_id
  )
);

DROP POLICY IF EXISTS ssa_staff_update ON material_requests;
CREATE POLICY ssa_staff_update ON material_requests FOR UPDATE USING (
  (
    auth_role() = ANY (ARRAY['admin_global'::role_enum, 'armeiro'::role_enum, 'admin_reserva'::role_enum])
    AND tenant_id = auth_tenant_id()
  )
  OR (auth_role() = 'usuario'::role_enum AND military_id = auth.uid() AND status = 'pendente'::material_request_status_enum)
) WITH CHECK (
  (
    auth_role() = ANY (ARRAY['admin_global'::role_enum, 'armeiro'::role_enum, 'admin_reserva'::role_enum])
    AND tenant_id = auth_tenant_id()
  )
  OR (auth_role() = 'usuario'::role_enum AND military_id = auth.uid())
);

-- ── admin_approval_requests ─────────────────────────────────────────────
DROP POLICY IF EXISTS aar_own_insert ON admin_approval_requests;
CREATE POLICY aar_own_insert ON admin_approval_requests FOR INSERT WITH CHECK (
  requestor_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
      AND profiles.role = ANY (ARRAY['armeiro'::role_enum, 'admin_global'::role_enum, 'admin_reserva'::role_enum])
  )
);
