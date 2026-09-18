-- Fase 1 da spec de rastreabilidade enterprise (histórico completo de
-- movimentação por item de material + histórico de ações do usuário).
--
-- `audit_events` (hash-chain, canônico) continua sendo a fonte de verdade
-- ator-cêntrica. O problema não é o mecanismo, é indexação por item: a
-- maioria dos eventos hoje NUNCA aponta `resource_id` pro `material_item`
-- afetado (cautelamento grava resource_id=cautelamento.id; lending usa o
-- wrapper legado auditAction() que não grava resource_id nem metadata
-- nenhum) — uma saída em lote de 50 itens hoje não deixa NENHUM item_id
-- correlacionável em audit_events.
--
-- Esta tabela é DERIVADA/rebuildable a partir de audit_events.metadata.
-- item_ids — não é o registro canônico, por isso NÃO é hash-chained e NÃO
-- tem RULE de imutabilidade: se for perdida, reconstrói sem perda de
-- informação real (o canônico continua sendo audit_events). Isso resolve
-- deliberadamente o gargalo de escrita da hash-chain (getLastEventHash faz
-- um SELECT sequencial por partição antes de cada INSERT em audit_events —
-- uma operação em lote grava 1 evento em audit_events (custo sequencial
-- O(1)) + N linhas nesta tabela (insert multi-row, sem dependência entre
-- linhas, paralelizável).
CREATE TABLE public.material_item_event_index (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_item_id  UUID NOT NULL REFERENCES public.material_items(id),
  audit_event_id    UUID NOT NULL REFERENCES public.audit_events(id),
  tenant_id         UUID NOT NULL REFERENCES public.tenants(id),
  -- Reserva do item NO MOMENTO do evento (não a reserva atual do item) —
  -- permite reconstruir "por quais reservas este item passou e quando",
  -- mesmo que audit_events.reserve_id de eventos anteriores a esta feature
  -- seja sempre NULL (nunca preenchido pelo código até agora).
  reserve_id        UUID REFERENCES public.reserves(id),
  -- Denormalizado de audit_events.action — evita join só pra filtrar por
  -- tipo de movimento (ex: contar quantas "lending.returned" um item teve).
  action            TEXT NOT NULL,
  actor_id          UUID REFERENCES public.profiles(id),
  event_created_at  TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Timeline de um item, mais recente primeiro — query principal da Fase 6
-- (GET /api/material-items/:id/historico).
CREATE INDEX idx_miei_item_created ON public.material_item_event_index (material_item_id, event_created_at DESC);

-- Corte de visibilidade por reserva (admin_reserva/armeiro só veem o
-- trecho enquanto o item esteve na própria reserva — Fase 6).
CREATE INDEX idx_miei_reserve ON public.material_item_event_index (reserve_id);

-- Um mesmo audit_event nunca gera duas linhas para o mesmo item (idempotência
-- de escrita — se auditLogForItems for chamado 2x pro mesmo evento por
-- engano, o segundo insert falha em vez de duplicar a timeline).
CREATE UNIQUE INDEX idx_miei_item_event ON public.material_item_event_index (material_item_id, audit_event_id);

ALTER TABLE public.material_item_event_index ENABLE ROW LEVEL SECURITY;
-- Sem nenhuma policy pra anon/authenticated — só service_role (BFF) escreve
-- e lê, mesmo padrão de totp_secrets/pending_email_changes/audit_events.
-- RLS habilitada sem policy nenhuma já bloqueia tudo por padrão.
