-- Migration: User status + lending detail fields
-- Adds impedimento_administrativo status, auth_mode and material_request_id to lendings

-- 1. New registration status value
ALTER TYPE registration_status_enum ADD VALUE IF NOT EXISTS 'impedimento_administrativo';

-- 2. Authentication mode on lendings (biometria / totp / manual)
ALTER TABLE public.lendings
  ADD COLUMN IF NOT EXISTS auth_mode TEXT
    CHECK (auth_mode IN ('biometria', 'totp', 'manual')) DEFAULT 'manual';

-- 3. Back-reference to SSA remote request (nullable — only set when created via SSA deliver)
ALTER TABLE public.lendings
  ADD COLUMN IF NOT EXISTS material_request_id UUID
    REFERENCES public.material_requests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS lendings_material_request_id_idx
  ON public.lendings (material_request_id)
  WHERE material_request_id IS NOT NULL;
