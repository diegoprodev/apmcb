-- Nota opcional do armeiro ao aprovar uma solicitação remota
ALTER TABLE public.material_requests ADD COLUMN IF NOT EXISTS armeiro_nota TEXT NULL;
