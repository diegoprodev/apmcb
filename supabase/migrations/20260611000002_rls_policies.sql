ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE biometric_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE lendings ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION auth_role()
RETURNS role_enum
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$;

-- PROFILES
CREATE POLICY "profiles_select" ON profiles
  FOR SELECT USING (
    auth.uid() = id
    OR auth_role() IN ('admin', 'master')
  );

CREATE POLICY "profiles_insert" ON profiles
  FOR INSERT WITH CHECK (
    auth_role() = 'admin'
  );

CREATE POLICY "profiles_update" ON profiles
  FOR UPDATE USING (
    auth_role() = 'admin'
    OR (auth.uid() = id AND auth_role() = 'usuario')
  );

-- BIOMETRIC TEMPLATES
CREATE POLICY "biometric_admin_master" ON biometric_templates
  FOR ALL USING (
    auth_role() IN ('admin', 'master')
  );

-- MATERIAL TYPES
CREATE POLICY "materials_select" ON material_types
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "materials_write" ON material_types
  FOR ALL USING (auth_role() IN ('admin', 'master'));

-- LENDINGS
CREATE POLICY "lendings_select" ON lendings
  FOR SELECT USING (
    military_id = auth.uid()
    OR auth_role() IN ('admin', 'master')
  );

CREATE POLICY "lendings_write" ON lendings
  FOR ALL USING (
    auth_role() IN ('admin', 'master')
  );

-- NOTIFICATIONS
CREATE POLICY "notifications_select" ON notifications
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "notifications_update_read" ON notifications
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- AUDIT LOGS
CREATE POLICY "audit_admin_only" ON audit_logs
  FOR SELECT USING (auth_role() = 'admin');
