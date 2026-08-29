-- ═══════════════════════════════════════════════════════════════════
-- AVU-02 — Snooze/silenciar de alerta de vencimento por cautela.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.cautelamentos
  ADD COLUMN IF NOT EXISTS vencimento_snooze_until date,
  ADD COLUMN IF NOT EXISTS vencimento_silenciado boolean NOT NULL DEFAULT false;
