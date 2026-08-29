-- ═══════════════════════════════════════════════════════════════════
-- CAULC-01 — Ciclo de vida da cautela: prazo de devolução personalizável
-- + colunas de cancelamento. Spec completa:
-- docs/enterprise/specs/cautela-lifecycle-enterprise.md
-- ═══════════════════════════════════════════════════════════════════
-- Pedido do usuário: prazo personalizado (15/30/90 dias, 6 meses, 1 ano,
-- indeterminado) + motivo obrigatório ao cancelar uma cautela.
--
-- `prazo_proxima_conferencia` (já existente) é outra coisa — reconferência
-- periódica de custódia, não prazo de devolução obrigatória. Colunas novas,
-- não reaproveitamento.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.cautelamentos
  ADD COLUMN IF NOT EXISTS prazo_devolucao_tipo text
    CHECK (prazo_devolucao_tipo IN ('15_dias','30_dias','90_dias','6_meses','1_ano','indeterminado')),
  ADD COLUMN IF NOT EXISTS prazo_devolucao_data date,
  ADD COLUMN IF NOT EXISTS cancelada_por uuid REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS cancelada_em timestamptz,
  ADD COLUMN IF NOT EXISTS motivo_cancelamento text;

-- prazo_devolucao_data só faz sentido quando o tipo não é indeterminado nem nulo.
ALTER TABLE public.cautelamentos
  ADD CONSTRAINT cautelamentos_prazo_devolucao_data_chk
    CHECK (
      (prazo_devolucao_tipo IS NULL) OR
      (prazo_devolucao_tipo = 'indeterminado' AND prazo_devolucao_data IS NULL) OR
      (prazo_devolucao_tipo <> 'indeterminado' AND prazo_devolucao_data IS NOT NULL)
    );

-- Índice parcial para a query de vencimento (só cautelas ativas com prazo definido).
CREATE INDEX IF NOT EXISTS idx_cautelamentos_prazo_devolucao_ativa
  ON public.cautelamentos (prazo_devolucao_data)
  WHERE status = 'ativa' AND prazo_devolucao_data IS NOT NULL;

-- Tabela de controle do cron de vencimento (CAULC-08) — 1 linha por
-- (cautela, tipo de alerta), UNIQUE evita notificação duplicada se o cron
-- rodar 2x (deploy, retry). Mesmo padrão de material_validity_alert_events.
CREATE TABLE IF NOT EXISTS public.cautela_vencimento_alert_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cautela_id uuid NOT NULL REFERENCES public.cautelamentos(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  tipo_alerta text NOT NULL CHECK (tipo_alerta = ANY (ARRAY['vencendo'::text, 'vencida'::text])),
  -- "vencendo" é um evento único (1 linha basta); "vencida" repete a cada 3
  -- dias enquanto ativa — created_at faz parte da unicidade nesse caso, daí
  -- o UNIQUE não incluir só (cautela_id, tipo_alerta) sozinho.
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cautela_vencimento_alert_vencendo_unico
  ON public.cautela_vencimento_alert_events (cautela_id)
  WHERE tipo_alerta = 'vencendo';

ALTER TABLE public.cautela_vencimento_alert_events ENABLE ROW LEVEL SECURITY;
-- Só o BFF (service role) escreve/lê esta tabela de controle — sem policy
-- nenhuma, RLS habilitada nega tudo por padrão (fail-closed), mesmo padrão
-- já usado em outras tabelas só-BFF deste projeto (biometric_*, etc.).
