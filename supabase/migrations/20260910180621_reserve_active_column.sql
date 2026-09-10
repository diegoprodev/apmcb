-- ═══════════════════════════════════════════════════════════════════
-- SP1 — colunas do mecanismo de reserva ativa.
-- DORMENTES: nenhuma policy/função usa estas colunas neste plano. As policies
-- de negócio só são reescritas nos sub-planos SP5–SP9, atrás da flag
-- `reserve_isolation_enabled` (que nasce `false`). Ver
-- docs/superpowers/specs/2026-09-09-isolamento-reserva-design.md §4.1.
--
-- ROLLBACK:
--   ALTER TABLE public.profiles DROP COLUMN IF EXISTS active_reserve_id;
--   ALTER TABLE public.tenants   DROP COLUMN IF EXISTS reserve_isolation_enabled;
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS active_reserve_id uuid
    REFERENCES public.reserves(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_profiles_active_reserve
  ON public.profiles(active_reserve_id) WHERE active_reserve_id IS NOT NULL;

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS reserve_isolation_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.active_reserve_id IS
  'Reserva ativa do usuário (SP1 do isolamento por reserva). Fonte de verdade que o RLS lê a partir de SP5. Imutável via PostgREST (trigger profiles_freeze_privileged_columns) — só o BFF grava.';
COMMENT ON COLUMN public.tenants.reserve_isolation_enabled IS
  'Feature flag do isolamento por reserva. false = comportamento tenant-wide atual. Ligar por tenant no rollout (SP10).';
