-- ═══════════════════════════════════════════════════════════════════
-- Backfill default_tenant_id — profiles role='usuario' órfãos
-- ═══════════════════════════════════════════════════════════════════
-- Achado durante auditoria de /admin/usuarios: POST /api/admin/militares
-- (BFF) e POST /api/admin/users (Next edge route) nunca setavam
-- profiles.default_tenant_id ao criar um profile novo. Isso ficou
-- mascarado enquanto profiles_select liberava admin_global/superadmin
-- sem checagem de tenant (política anterior a 20260629000005). A
-- migration 20260711000003 corrigiu esse gap de segurança passando a
-- exigir default_tenant_id = my_tenant_id() também para admin_global —
-- e, com isso, expôs o bug: qualquer profile criado por essas duas rotas
-- (a maioria com role='usuario', que 20260629000005 não cobria porque
-- só backfillava staff) ficou definitivamente invisível na grid para
-- admin_global/admin_reserva/armeiro/auditor — sintoma relatado pelo
-- dono do produto como "cadastrei um usuário e ele não apareceu".
--
-- Código já corrigido nesta mesma tarefa (apps/bff/src/routes/admin.ts,
-- apps/web/src/app/api/admin/users/route.ts, apps/web/src/app/api/admin/
-- militares/route.ts) — esta migration é só o backfill dos dados já
-- gravados incorretamente em produção.
--
-- Mesma premissa de 20260629000005: apenas 1 tenant ativo com membros
-- reais em produção (PMPB) — validado abaixo antes de aplicar.

DO $$
DECLARE
  v_pmpb_tenant_id UUID;
  v_tenants_with_members INT;
  v_affected INT;
BEGIN
  SELECT id INTO v_pmpb_tenant_id FROM tenants WHERE slug = 'pmpb';
  IF v_pmpb_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant pmpb não encontrado — abortar migration';
  END IF;

  SELECT COUNT(DISTINCT tenant_id) INTO v_tenants_with_members
  FROM tenant_memberships;

  IF v_tenants_with_members > 1 THEN
    RAISE EXCEPTION
      'Mais de 1 tenant com membros reais (%) — backfill automático para pmpb não é seguro, resolver manualmente',
      v_tenants_with_members;
  END IF;

  SELECT COUNT(*) INTO v_affected
  FROM profiles
  WHERE default_tenant_id IS NULL AND role <> 'superadmin';
  RAISE NOTICE '% profiles órfãos (sem default_tenant_id, role != superadmin) serão atribuídos a pmpb', v_affected;

  -- 1. profiles.default_tenant_id — fonte única usada por my_tenant_id()/
  --    auth_tenant_id() em todas as políticas RLS.
  UPDATE profiles
  SET default_tenant_id = v_pmpb_tenant_id
  WHERE default_tenant_id IS NULL
    AND role <> 'superadmin';

  -- 2. tenant_memberships — fonte usada pelo BFF (auth.ts) para popular
  --    session.tenantId no login. role_enum não tem valor "member" (achado
  --    ao rodar esta migration pela 1a vez — usa o próprio role do profile,
  --    mesma correção aplicada nas 3 rotas de criação).
  INSERT INTO tenant_memberships (user_id, tenant_id, role)
  SELECT p.id, v_pmpb_tenant_id, p.role
  FROM profiles p
  WHERE p.default_tenant_id = v_pmpb_tenant_id
    AND NOT EXISTS (
      SELECT 1 FROM tenant_memberships tm
      WHERE tm.user_id = p.id AND tm.tenant_id = v_pmpb_tenant_id
    );

  RAISE NOTICE 'Backfill concluído: default_tenant_id + tenant_memberships para % profiles', v_affected;
END $$;

-- Validação inline
DO $$
DECLARE
  v_uncovered INT;
BEGIN
  SELECT COUNT(*) INTO v_uncovered
  FROM profiles
  WHERE default_tenant_id IS NULL AND role <> 'superadmin';

  IF v_uncovered > 0 THEN
    RAISE WARNING 'ATENÇÃO: % profiles não-superadmin ainda sem default_tenant_id', v_uncovered;
  ELSE
    RAISE NOTICE 'OK: todo profile não-superadmin tem default_tenant_id';
  END IF;
END $$;
