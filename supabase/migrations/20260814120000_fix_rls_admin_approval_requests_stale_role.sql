-- Fix stale + unscoped RLS on admin_approval_requests: aar_admin_select and
-- aar_admin_update still checked role = 'admin', a value that no longer
-- exists in role_enum (current roles: admin_global/admin_reserva/superadmin/
-- armeiro/auditor/usuario). Since the BFF writes/reads this table with the
-- service role (bypasses RLS), but a direct SSR Supabase read — e.g. the
-- /admin dashboard's pending-request count — runs under the caller's own
-- JWT (RLS-bound), the stale policy silently matched zero rows for every
-- real admin: the "solicitações pendentes de armeiro" banner on /admin never
-- reflected reality because the underlying SELECT was blocked, and clicking
-- through led nowhere useful even once the page-level guard was fixed.
--
-- This also brings admin_approval_requests in line with the tenant-scoping
-- audit already applied to every other multi-tenant table in
-- 20260711000003_fix_rls_superadmin_and_admin_global_tenant_scope.sql (which
-- fixed aar_own_insert but missed aar_admin_select/aar_admin_update).
--
-- Scope must match apps/bff/src/routes/arsenal.ts exactly, not just "same
-- tenant": admin_global reviews across the whole tenant (scopedRequestorIdsForTenant),
-- but admin_reserva is scoped to their OWN reserve only (scopedRequestorIds).
-- A tenant-only check here (code review finding, ALTO) would let an
-- admin_reserva read full rows — requestor PII, material info — for every
-- reserve in their tenant via a direct Supabase client call, wider than what
-- the BFF ever exposes for that role. reserve scope reuses the same
-- auth_admin_reserve_ids() SECURITY DEFINER helper already used by
-- reserve_memberships_select (20260629000003_fix_rls_recursion_profiles_reserves.sql)
-- to avoid recursion. superadmin is intentionally excluded (Nexus/SaaS-only,
-- never accesses tenant/reserve operational data — see apps/bff H-RBAC
-- comments and idor-read-scope.test.ts).

DROP POLICY IF EXISTS aar_admin_select ON public.admin_approval_requests;
CREATE POLICY aar_admin_select ON public.admin_approval_requests
  FOR SELECT USING (
    (
      auth_role() = 'admin_global'::role_enum
      AND EXISTS (
        SELECT 1 FROM public.profiles requestor
        WHERE requestor.id = admin_approval_requests.requestor_id
          AND requestor.default_tenant_id = public.my_tenant_id()
      )
    )
    OR (
      auth_role() = 'admin_reserva'::role_enum
      AND EXISTS (
        SELECT 1 FROM public.reserve_memberships requestor_rm
        WHERE requestor_rm.user_id = admin_approval_requests.requestor_id
          AND requestor_rm.reserve_id IN (SELECT public.auth_admin_reserve_ids())
      )
    )
  );

DROP POLICY IF EXISTS aar_admin_update ON public.admin_approval_requests;
CREATE POLICY aar_admin_update ON public.admin_approval_requests
  FOR UPDATE USING (
    (
      auth_role() = 'admin_global'::role_enum
      AND EXISTS (
        SELECT 1 FROM public.profiles requestor
        WHERE requestor.id = admin_approval_requests.requestor_id
          AND requestor.default_tenant_id = public.my_tenant_id()
      )
    )
    OR (
      auth_role() = 'admin_reserva'::role_enum
      AND EXISTS (
        SELECT 1 FROM public.reserve_memberships requestor_rm
        WHERE requestor_rm.user_id = admin_approval_requests.requestor_id
          AND requestor_rm.reserve_id IN (SELECT public.auth_admin_reserve_ids())
      )
    )
  );
