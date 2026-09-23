-- Fix RLS recursion introduced by tenant-isolation policies.
-- Policies cannot query the same relation they protect. Use SECURITY DEFINER
-- helpers for the small auth-context lookups needed by RLS.

CREATE OR REPLACE FUNCTION public.auth_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.default_tenant_id
  FROM public.profiles p
  WHERE p.id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.auth_admin_reserve_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT rm.reserve_id
  FROM public.reserve_memberships rm
  WHERE rm.user_id = auth.uid()
    AND rm.role = 'admin_reserva'
$$;

DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT USING (
    auth.uid() = id
    OR (
      auth_role() IN ('admin_global','admin_reserva','armeiro','superadmin','auditor')
      AND default_tenant_id = public.auth_tenant_id()
    )
  );

DROP POLICY IF EXISTS "reserve_memberships_select" ON public.reserve_memberships;
CREATE POLICY "reserve_memberships_select" ON public.reserve_memberships
  FOR SELECT USING (
    user_id = auth.uid()
    OR reserve_id IN (SELECT public.auth_admin_reserve_ids())
  );
