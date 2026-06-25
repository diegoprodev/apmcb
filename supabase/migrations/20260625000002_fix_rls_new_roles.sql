-- Fase 2 RLS fix: atualizar políticas de profiles para novos roles (Fase 2 RBAC)
-- Os roles admin_global, superadmin, admin_reserva, armeiro, auditor não estavam
-- incluídos nas políticas originais que só conheciam admin/master/military

DROP POLICY IF EXISTS profiles_select ON profiles;
DROP POLICY IF EXISTS profiles_insert ON profiles;
DROP POLICY IF EXISTS profiles_update ON profiles;

-- SELECT: staff vê todos; usuario vê só o próprio perfil
CREATE POLICY profiles_select ON profiles FOR SELECT USING (
  auth.uid() = id
  OR auth_role() = ANY (ARRAY[
    'admin'::role_enum,
    'master'::role_enum,
    'superadmin'::role_enum,
    'admin_global'::role_enum,
    'admin_reserva'::role_enum,
    'armeiro'::role_enum,
    'auditor'::role_enum
  ])
);

-- INSERT: admins criam perfis
CREATE POLICY profiles_insert ON profiles FOR INSERT WITH CHECK (
  auth_role() = ANY (ARRAY[
    'admin'::role_enum,
    'superadmin'::role_enum,
    'admin_global'::role_enum,
    'admin_reserva'::role_enum
  ])
);

-- UPDATE: admins atualizam qualquer perfil; usuario atualiza o próprio
CREATE POLICY profiles_update ON profiles FOR UPDATE USING (
  auth_role() = ANY (ARRAY[
    'admin'::role_enum,
    'superadmin'::role_enum,
    'admin_global'::role_enum,
    'admin_reserva'::role_enum
  ])
  OR (
    auth.uid() = id
    AND auth_role() = ANY (ARRAY['military'::role_enum, 'usuario'::role_enum])
  )
);
