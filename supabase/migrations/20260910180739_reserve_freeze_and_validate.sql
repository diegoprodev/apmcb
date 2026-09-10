-- ═══════════════════════════════════════════════════════════════════
-- SP1 — congela `profiles.active_reserve_id` para usuário final (todo switch
-- passa pelo BFF) + trigger que valida a entrada numa reserva.
-- Ver docs/superpowers/specs/2026-09-09-isolamento-reserva-design.md §4.1.
--
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS profiles_validate_active_reserve ON public.profiles;
--   DROP FUNCTION IF EXISTS public.profiles_validate_active_reserve();
--   -- e restaurar profiles_freeze_privileged_columns() SEM a linha de active_reserve_id
--   --   (corpo original em 20260910130000... na verdade em 20260910 fix_profiles_privilege_escalation)
-- ═══════════════════════════════════════════════════════════════════

-- 1. Estende o freeze do #27: active_reserve_id também é imutável via PostgREST.
CREATE OR REPLACE FUNCTION public.profiles_freeze_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.default_tenant_id IS DISTINCT FROM OLD.default_tenant_id
     OR NEW.registration_status IS DISTINCT FROM OLD.registration_status
     OR NEW.account_activated_at IS DISTINCT FROM OLD.account_activated_at
     OR NEW.active_reserve_id IS DISTINCT FROM OLD.active_reserve_id THEN
    RAISE EXCEPTION
      'profiles: role, default_tenant_id, registration_status, account_activated_at e active_reserve_id so podem ser alterados pelo backend (service_role) ou por RPC autorizada'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

-- 2. Valida a reserva de destino num switch (roda para service_role/postgres — belt).
CREATE OR REPLACE FUNCTION public.profiles_validate_active_reserve()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- usuário final nem chega aqui (o freeze acima aborta antes); redundância explícita.
  IF current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'active_reserve_id so via BFF' USING ERRCODE = '42501';
  END IF;

  IF NEW.active_reserve_id IS NOT NULL THEN
    IF NEW.default_tenant_id IS NULL THEN
      RAISE EXCEPTION 'usuario sem tenant nao entra em reserva' USING ERRCODE = '42501';
    END IF;

    PERFORM 1 FROM public.reserves r
      WHERE r.id = NEW.active_reserve_id
        AND r.status = 'ativa'
        AND r.tenant_id = NEW.default_tenant_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'reserva invalida, inativa ou de outro tenant' USING ERRCODE = '42501';
    END IF;

    IF NEW.role NOT IN ('admin_global', 'auditor')
       AND NOT EXISTS (
         SELECT 1 FROM public.reserve_memberships m
         WHERE m.user_id = NEW.id AND m.reserve_id = NEW.active_reserve_id
       ) THEN
      RAISE EXCEPTION 'usuario sem vinculo com a reserva de destino' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS profiles_validate_active_reserve ON public.profiles;
CREATE TRIGGER profiles_validate_active_reserve
  BEFORE UPDATE OF active_reserve_id ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_validate_active_reserve();
