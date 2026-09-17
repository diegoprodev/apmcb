-- SP9 do isolamento por reserva — RLS de `profiles` (a tabela mais delicada
-- do épico: KEEP tenant-wide por design — profiles não ganha coluna
-- reserve_id, multi-reserva é resolvido via reserve_memberships). Ver
-- docs/superpowers/specs/2026-09-09-isolamento-reserva-design.md §4.2
-- ("profiles"), §4.10 (DROP auth_tenant_id) e §8 (tabela de fases, SP9).
--
-- Dormente enquanto tenants.reserve_isolation_enabled = false (default,
-- estado atual de PMPB em prod) — mesmo padrão SP1/SP4-SP8. Testado em
-- staging com dado real antes de aplicar em prod (regra §7 do épico).
--
-- Achado de consistência (não é o foco do SP9, mas as 3 policies de
-- profiles usavam helper NU desde sempre — nunca tinham passado pelo
-- padrão STABLE-wrap `(SELECT helper())` que o SP0.5 provou ser 100x mais
-- rápido em volume; profiles_insert/update têm o MESMO problema de
-- performance que material_types/lendings/etc tinham antes de SP5/SP6.
-- Como esta migration já mexe na tabela, as 3 policies são recriadas com o
-- wrap — sem mudança de LÓGICA em insert/update (continuam tenant-wide,
-- sem reserve-scoping — não fazem parte do escopo SCOPE-reserva de
-- profiles), só de performance.
--
-- §4.10 — DROP FUNCTION auth_tenant_id(): confirmado 0 consumidores em
-- prod antes de aplicar (nenhuma policy, nenhuma function, nenhum código
-- de app referencia — só a allowlist do gate 1 do CI, atualizada junto).
-- Assert explícito no início desta migration — se algo passou despercebido
-- na minha varredura manual, a migration INTEIRA falha antes de tocar em
-- qualquer policy, não deixa a tabela pela metade.
--
-- ROLLBACK: ver bloco no fim (comentado).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND (qual ILIKE '%auth_tenant_id%' OR with_check ILIKE '%auth_tenant_id%')
  ) THEN
    RAISE EXCEPTION 'auth_tenant_id() ainda referenciada em ao menos 1 policy — abortando (SP9 §4.10 exige 0 consumidores antes do DROP)';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE prosrc ILIKE '%auth_tenant_id%' AND proname != 'auth_tenant_id'
  ) THEN
    RAISE EXCEPTION 'auth_tenant_id() ainda referenciada em ao menos 1 function — abortando (SP9 §4.10 exige 0 consumidores antes do DROP)';
  END IF;
END $$;

-- ── profiles_select ──────────────────────────────────────────────────
-- Dono sempre vê a si mesmo, sem gating de reserva (não é um "recurso
-- reserve-scoped", é a própria identidade). Staff vê os demais profiles do
-- tenant — com reserve-scoping quando a flag está ON: reserva ativa
-- (via user_in_reserve, per-row — SP0.5 mediu 5ms/414 profiles, aceitável
-- até ~5k) ou matriz (admin_global/auditor sem reserva ativa, vê todos do
-- tenant). Idêntico ao comportamento atual quando a flag está OFF (R7).
DROP POLICY IF EXISTS profiles_select ON public.profiles;

CREATE POLICY profiles_select ON public.profiles
  FOR SELECT
  USING (
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

-- ── profiles_insert ──────────────────────────────────────────────────
-- Sem mudança de lógica — só o wrap STABLE. Tenant-wide por design
-- (criação de conta não é uma escrita reserve-scoped; a atribuição de
-- reserva acontece via reserve_memberships, RPC separada).
DROP POLICY IF EXISTS profiles_insert ON public.profiles;

CREATE POLICY profiles_insert ON public.profiles
  FOR INSERT
  WITH CHECK (
    (SELECT auth_role()) IN ('admin_global','admin_reserva')
    AND default_tenant_id = (SELECT my_tenant_id())
  );

-- ── profiles_update ──────────────────────────────────────────────────
-- Sem mudança de lógica — só o wrap STABLE. `profiles_freeze_privileged_columns`
-- (trigger, já em prod) continua sendo a defesa real contra escalação de
-- privilégio via UPDATE — esta policy só decide QUEM pode tentar o UPDATE.
DROP POLICY IF EXISTS profiles_update ON public.profiles;

CREATE POLICY profiles_update ON public.profiles
  FOR UPDATE
  USING (
    ((SELECT auth_role()) IN ('admin_global','admin_reserva') AND default_tenant_id = (SELECT my_tenant_id()))
    OR ((SELECT auth.uid()) = id AND (SELECT auth_role()) IN ('usuario','armeiro','auditor'))
  )
  WITH CHECK (
    ((SELECT auth_role()) IN ('admin_global','admin_reserva') AND default_tenant_id = (SELECT my_tenant_id()))
    OR ((SELECT auth.uid()) = id AND (SELECT auth_role()) IN ('usuario','armeiro','auditor'))
  );

-- ── §4.10 — DROP auth_tenant_id() ────────────────────────────────────
DROP FUNCTION IF EXISTS public.auth_tenant_id();

-- ROLLBACK (referência, não executado):
--   DROP POLICY IF EXISTS profiles_select ON public.profiles;
--   DROP POLICY IF EXISTS profiles_insert ON public.profiles;
--   DROP POLICY IF EXISTS profiles_update ON public.profiles;
--   CREATE POLICY profiles_select ON public.profiles FOR SELECT
--     USING ((auth.uid() = id) OR ((auth_role() = ANY (ARRAY['admin_global'::role_enum, 'admin_reserva'::role_enum, 'armeiro'::role_enum, 'auditor'::role_enum])) AND (default_tenant_id = my_tenant_id())));
--   CREATE POLICY profiles_insert ON public.profiles FOR INSERT
--     WITH CHECK ((auth_role() = ANY (ARRAY['admin_global'::role_enum, 'admin_reserva'::role_enum])) AND (default_tenant_id = my_tenant_id()));
--   CREATE POLICY profiles_update ON public.profiles FOR UPDATE
--     USING (((auth_role() = ANY (ARRAY['admin_global'::role_enum, 'admin_reserva'::role_enum])) AND (default_tenant_id = my_tenant_id())) OR ((auth.uid() = id) AND (auth_role() = ANY (ARRAY['usuario'::role_enum, 'armeiro'::role_enum, 'auditor'::role_enum]))))
--     WITH CHECK (((auth_role() = ANY (ARRAY['admin_global'::role_enum, 'admin_reserva'::role_enum])) AND (default_tenant_id = my_tenant_id())) OR ((auth.uid() = id) AND (auth_role() = ANY (ARRAY['usuario'::role_enum, 'armeiro'::role_enum, 'auditor'::role_enum]))));
--   -- auth_tenant_id() (corpo real, versionado em
--   -- supabase/migrations/20260629000003_fix_rls_recursion_profiles_reserves.sql,
--   -- só recriar se algo inesperado depender dela — 0 consumidores confirmados
--   -- antes de aplicar):
--   -- CREATE OR REPLACE FUNCTION public.auth_tenant_id() RETURNS uuid
--   --   LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
--   --   SELECT p.default_tenant_id FROM public.profiles p WHERE p.id = auth.uid() $$;
