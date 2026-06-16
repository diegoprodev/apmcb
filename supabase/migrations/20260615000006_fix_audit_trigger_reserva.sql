-- Fix audit_material_request() trigger function: column renamed armeiro_id → reserva_id
-- in migration 20260615000003 but PostgreSQL does not update function bodies on column
-- renames, leaving the trigger referencing the now-nonexistent armeiro_id column.
-- This breaks every INSERT/UPDATE on material_requests.

CREATE OR REPLACE FUNCTION public.audit_material_request()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.audit_logs (actor_id, action, resource_type, resource_id, metadata)
  VALUES (
    COALESCE(NEW.reserva_id, NEW.military_id),
    CASE TG_OP
      WHEN 'INSERT' THEN 'ssa.solicitado'
      ELSE 'ssa.' || NEW.status::text
    END,
    'material_requests',
    COALESCE(NEW.id, OLD.id),
    jsonb_build_object(
      'status_anterior',  CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END,
      'status_novo',      NEW.status,
      'military_id',      NEW.military_id,
      'reserva_id',       NEW.reserva_id,
      'denial_reason',    NEW.denial_reason,
      'totp_validated',   NEW.totp_validated,
      'expires_at',       NEW.expires_at
    )
  );
  RETURN NEW;
END;
$$;
