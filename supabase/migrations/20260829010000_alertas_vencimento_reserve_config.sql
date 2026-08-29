-- ═══════════════════════════════════════════════════════════════════
-- AVU-01 — Alertas de vencimento unificados: colunas de configuração por
-- reserva. Spec completa:
-- docs/enterprise/specs/alertas-vencimento-unificado-enterprise.md
-- Mesmo padrão já usado em reserves.allow_remote_requests/
-- remote_allowed_categories — colunas diretas, sem tabela de settings nova.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.reserves
  ADD COLUMN IF NOT EXISTS cautela_alert_dias_antes integer[] NOT NULL DEFAULT '{7}',
  ADD COLUMN IF NOT EXISTS material_validity_alert_dias_padrao integer[] NOT NULL DEFAULT '{365,180,90}';
