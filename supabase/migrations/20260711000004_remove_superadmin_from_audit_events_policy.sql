-- Última ocorrência de 'superadmin' em policy de dado de tenant. Já era
-- escopada por tenant_memberships (não era vazamento), mas por consistência
-- com a regra canônica (superadmin não acessa dado de tenant algum), remove.
DROP POLICY IF EXISTS authorized_read_audit ON audit_events;
CREATE POLICY authorized_read_audit ON audit_events FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM profiles p
    JOIN tenant_memberships tm ON tm.user_id = p.id AND tm.tenant_id = audit_events.tenant_id
    WHERE p.id = auth.uid()
      AND p.role = ANY (ARRAY['admin_global'::role_enum, 'admin_reserva'::role_enum, 'auditor'::role_enum])
  )
);
