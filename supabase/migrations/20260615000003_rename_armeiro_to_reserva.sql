-- Step 1 of 2: DDL changes (must commit before using new enum value)
-- Rename armeiro_id → reserva_id in material_requests
ALTER TABLE public.material_requests RENAME COLUMN armeiro_id TO reserva_id;
ALTER TABLE public.material_requests
  RENAME CONSTRAINT material_requests_armeiro_id_fkey TO material_requests_reserva_id_fkey;

-- Add 'usuario' to role_enum (can only be USED in a subsequent migration)
ALTER TYPE public.role_enum ADD VALUE IF NOT EXISTS 'usuario';
