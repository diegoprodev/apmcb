-- Fase 2 — RBAC Enterprise
-- Migra roles existentes para nomenclatura institucional.
-- role_enum já tem os novos valores (adicionados no Slice 1A: 20260620000001).

-- 1. Migrar dados: admin → admin_global, master → armeiro
UPDATE profiles SET role = 'admin_global' WHERE role = 'admin';
UPDATE profiles SET role = 'armeiro'      WHERE role = 'master';

-- 2. Atualizar tenant_memberships que referenciam roles legadas
UPDATE tenant_memberships SET role = 'admin_global' WHERE role = 'admin';
UPDATE tenant_memberships SET role = 'armeiro'      WHERE role = 'master';

-- Rollback manual se necessário:
-- UPDATE profiles SET role = 'admin' WHERE role = 'admin_global' AND role != 'superadmin';
-- UPDATE profiles SET role = 'master' WHERE role = 'armeiro';
