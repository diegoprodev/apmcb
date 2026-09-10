-- ═══════════════════════════════════════════════════════════════════
-- SP1 — funções STABLE do isolamento por reserva. DORMENTES até SP5 (nenhuma
-- policy as usa ainda). Padrão: STABLE SECURITY DEFINER SET search_path — o
-- mesmo de my_tenant_id() / auth_role(), avaliadas 1×/statement (InitPlan).
-- Ver docs/superpowers/specs/2026-09-09-isolamento-reserva-design.md §4.1 / F2 / F3.
--
-- ROLLBACK: DROP FUNCTION das 3.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.my_active_reserve_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT active_reserve_id FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.my_tenant_isolation_enabled()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT t.reserve_isolation_enabled
       FROM public.tenants t
       JOIN public.profiles p ON p.default_tenant_id = t.id
      WHERE p.id = auth.uid()),
    false)
$$;

CREATE OR REPLACE FUNCTION public.user_in_reserve(p_uid uuid, p_rid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.reserve_memberships
     WHERE user_id = p_uid AND reserve_id = p_rid
  )
$$;

-- As 3 podem ser chamadas por authenticated (entram na allowlist do CI gate do SP3).
GRANT EXECUTE ON FUNCTION public.my_active_reserve_id()          TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_tenant_isolation_enabled()   TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_in_reserve(uuid, uuid)     TO authenticated;
