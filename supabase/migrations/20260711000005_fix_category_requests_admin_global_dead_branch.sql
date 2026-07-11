-- category_requests não tem tenant_id próprio (usa reserve_id). A correção
-- anterior (20260711000003) checava admin_global via reserve_memberships,
-- mas essa tabela só aceita role IN ('admin_reserva','armeiro','auditor_reserva')
-- — admin_global nunca tem linha ali, tornando o branch morto (achado do
-- code review). Corrige checando reserve_id → reserves.tenant_id diretamente.

DROP POLICY IF EXISTS membro_ver_requests ON category_requests;
CREATE POLICY membro_ver_requests ON category_requests FOR SELECT USING (
  requested_by = auth.uid()
  OR EXISTS (
    SELECT 1 FROM reserve_memberships rm
    WHERE rm.user_id = auth.uid() AND rm.reserve_id = category_requests.reserve_id
      AND rm.role = ANY (ARRAY['admin_reserva'::text, 'admin_global'::text])
  )
  OR EXISTS (
    SELECT 1 FROM reserves r
    JOIN profiles p ON p.id = auth.uid()
    WHERE r.id = category_requests.reserve_id
      AND p.role = 'admin_global'::role_enum
      AND p.default_tenant_id = r.tenant_id
  )
);

DROP POLICY IF EXISTS admin_atualizar ON category_requests;
CREATE POLICY admin_atualizar ON category_requests FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM reserve_memberships rm
    WHERE rm.user_id = auth.uid() AND rm.reserve_id = category_requests.reserve_id
      AND rm.role = ANY (ARRAY['admin_reserva'::text, 'admin_global'::text])
  )
  OR EXISTS (
    SELECT 1 FROM reserves r
    JOIN profiles p ON p.id = auth.uid()
    WHERE r.id = category_requests.reserve_id
      AND p.role = 'admin_global'::role_enum
      AND p.default_tenant_id = r.tenant_id
  )
);
