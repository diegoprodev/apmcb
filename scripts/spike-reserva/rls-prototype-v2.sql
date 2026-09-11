-- SP0.5 spike v2 — (SELECT helper()) wrap p/ forçar InitPlan + drop FOR ALL leak + índice
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL session_replication_role = replica;
-- ~400 profiles extra p/ testar grid efetivo em volume (metade membros reserva A)
INSERT INTO auth.users (id, email, aud, role, created_at, updated_at)
SELECT ('bbbb0000-0000-0000-0000-'||lpad(g::text,12,'0'))::uuid, 'p'||g||'@spike.dev','authenticated','authenticated',now(),now()
FROM generate_series(1,400) g ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (id, matricula, nome_completo, role, registration_status, default_tenant_id, created_at, updated_at)
SELECT ('bbbb0000-0000-0000-0000-'||lpad(g::text,12,'0'))::uuid,'VOL'||g,'Militar Vol '||g,'usuario','complete','f0edc186-693f-4ab0-a0e8-6c18d65876fa',now(),now()
FROM generate_series(1,400) g ON CONFLICT DO NOTHING;
INSERT INTO public.reserve_memberships (reserve_id, user_id, role)
SELECT (CASE WHEN g % 2 = 0 THEN '9b83b932-5d16-422c-aeb7-512074127154' ELSE 'a8376271-d7f9-4fa6-9657-9714016e29b0' END)::uuid,
       ('bbbb0000-0000-0000-0000-'||lpad(g::text,12,'0'))::uuid,'usuario'
FROM generate_series(1,400) g ON CONFLICT DO NOTHING;
COMMIT;
ANALYZE public.profiles; ANALYZE public.reserve_memberships;

BEGIN;
-- índice p/ o caminho staff scoped (reserve_id, data_emissao)
CREATE INDEX IF NOT EXISTS idx_caut_reserve_dataemissao ON public.cautelamentos(reserve_id, data_emissao DESC);
CREATE INDEX IF NOT EXISTS idx_mt_reserve_nome ON public.material_types(reserve_id, nome);

-- ── material_types: helpers wrapped em (SELECT ...) ────────────────────
DROP POLICY IF EXISTS materials_select ON public.material_types;
CREATE POLICY materials_select ON public.material_types FOR SELECT
USING (
  tenant_id = (SELECT my_tenant_id())
  AND (SELECT auth_role()) IN ('admin_global','admin_reserva','armeiro','auditor')
  AND (
    NOT (SELECT my_tenant_isolation_enabled())
    OR reserve_id = (SELECT my_active_reserve_id())
    OR ((SELECT my_active_reserve_id()) IS NULL AND (SELECT auth_role()) IN ('admin_global','auditor'))
  )
);

-- ── lendings: DROP a FOR ALL, split, wrap ─────────────────────────────
DROP POLICY IF EXISTS lendings_staff_write ON public.lendings;
CREATE POLICY lendings_staff_insert ON public.lendings FOR INSERT WITH CHECK (
  (SELECT auth_role()) IN ('admin_global','admin_reserva','armeiro')
  AND tenant_id = (SELECT my_tenant_id())
  AND (NOT (SELECT my_tenant_isolation_enabled()) OR reserve_id = (SELECT my_active_reserve_id()))
);
CREATE POLICY lendings_staff_update ON public.lendings FOR UPDATE USING (
  (SELECT auth_role()) IN ('admin_global','admin_reserva','armeiro')
  AND tenant_id = (SELECT my_tenant_id())
  AND (NOT (SELECT my_tenant_isolation_enabled()) OR reserve_id = (SELECT my_active_reserve_id()))
);
CREATE POLICY lendings_staff_delete ON public.lendings FOR DELETE USING (
  (SELECT auth_role()) IN ('admin_global','admin_reserva','armeiro')
  AND tenant_id = (SELECT my_tenant_id())
  AND (NOT (SELECT my_tenant_isolation_enabled()) OR reserve_id = (SELECT my_active_reserve_id()))
);
DROP POLICY IF EXISTS lendings_select ON public.lendings;
CREATE POLICY lendings_select ON public.lendings FOR SELECT USING (
  ( military_id = (SELECT auth.uid())
    AND (NOT (SELECT my_tenant_isolation_enabled())
         OR reserve_id IN (SELECT reserve_id FROM reserve_memberships WHERE user_id = (SELECT auth.uid()))) )
  OR
  ( tenant_id = (SELECT my_tenant_id())
    AND (SELECT auth_role()) IN ('admin_global','admin_reserva','armeiro','auditor')
    AND ( NOT (SELECT my_tenant_isolation_enabled())
          OR reserve_id = (SELECT my_active_reserve_id())
          OR ((SELECT my_active_reserve_id()) IS NULL AND (SELECT auth_role()) IN ('admin_global','auditor')) ) )
);

-- ── cautelamentos: wrap ──────────────────────────────────────────────
DROP POLICY IF EXISTS cautelamentos_select ON public.cautelamentos;
CREATE POLICY cautelamentos_select ON public.cautelamentos FOR SELECT USING (
  ( militar_id = (SELECT auth.uid())
    AND (NOT (SELECT my_tenant_isolation_enabled())
         OR reserve_id IN (SELECT reserve_id FROM reserve_memberships WHERE user_id = (SELECT auth.uid()))) )
  OR
  ( tenant_id = (SELECT my_tenant_id())
    AND (SELECT auth_role()) IN ('admin_global','admin_reserva','armeiro','auditor')
    AND ( NOT (SELECT my_tenant_isolation_enabled())
          OR reserve_id = (SELECT my_active_reserve_id())
          OR ((SELECT my_active_reserve_id()) IS NULL AND (SELECT auth_role()) IN ('admin_global','auditor')) ) )
);

-- ── profiles: wrap (user_in_reserve continua per-row — arg = profiles.id) ─
DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles FOR SELECT USING (
  (SELECT auth.uid()) = id
  OR (
    (SELECT auth_role()) IN ('admin_global','admin_reserva','armeiro','auditor')
    AND default_tenant_id = (SELECT my_tenant_id())
    AND (
      NOT (SELECT my_tenant_isolation_enabled())
      OR ((SELECT my_active_reserve_id()) IS NULL AND (SELECT auth_role()) IN ('admin_global','auditor'))
      OR user_in_reserve(profiles.id, (SELECT my_active_reserve_id()))
    )
  )
);
COMMIT;
ANALYZE public.cautelamentos; ANALYZE public.material_types;
SELECT 'v2 aplicado' ok, (SELECT count(*) FROM profiles) profiles_total;
