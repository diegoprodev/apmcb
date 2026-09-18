-- Fase 2 (parte 2) da spec de rastreabilidade enterprise: backfill de
-- material_item_event_index a partir de audit_events + cautelamentos JÁ
-- EXISTENTES (eventos gravados ANTES de auditLogForItems existir, então
-- nunca passaram pela tabela de índice nova).
--
-- Cautelamentos já grava item_id (FK real, NOT NULL) e a maioria das ações
-- grava resource_id = cautelamentos.id — dá pra reconstruir a indexação
-- por item sem fabricar evento nenhum (o audit_event original já existe,
-- imutável; só estamos preenchendo a tabela derivada que aponta pra ele).
--
-- Duas formas de join porque duas ações usam resource_id = movement_id (o
-- id do LOTE, não de uma cautela individual) — cautelamento.batch_created
-- e signature.batch_created — enquanto o resto usa resource_id =
-- cautelamentos.id diretamente.
--
-- Idempotente (ON CONFLICT DO NOTHING na unique index já existente
-- material_item_id+audit_event_id) — seguro rodar de novo se necessário.
-- Verificado antes de escrever esta migration: produção tem 0 linhas em
-- `cautelamentos` hoje (CLEAN SLATE 2026-09-10) — este backfill é um no-op
-- neste momento, mas fica pronto pra quando houver histórico real anterior
-- a esta feature.

INSERT INTO public.material_item_event_index (material_item_id, audit_event_id, tenant_id, reserve_id, action, actor_id, event_created_at)
SELECT c.item_id, ae.id, ae.tenant_id, COALESCE(ae.reserve_id, c.reserve_id), ae.action, ae.actor_id, ae.created_at
FROM public.audit_events ae
JOIN public.cautelamentos c ON c.id = ae.resource_id
WHERE ae.resource_type = 'cautelamento'
  -- 'signature.created' NÃO entra aqui de propósito: essa action sempre
  -- grava resource_type='document_signatures' (apps/bff/src/routes/
  -- signatures.ts), nunca 'cautelamento' — a assinatura de cautela real só
  -- existe em lote ('signature.batch_created'), coberta pelo 2º INSERT via
  -- movement_id. Incluí-la aqui seria uma entrada morta que nunca casa.
  AND ae.action IN ('cautelamento.created', 'cautelamento.returned',
                     'cautelamento.cancelled', 'cautelamento.edited',
                     'cautelamento.vencimento_snooze', 'cautelamento.substituted')
  AND c.item_id IS NOT NULL
  AND ae.tenant_id IS NOT NULL
ON CONFLICT (material_item_id, audit_event_id) DO NOTHING;

INSERT INTO public.material_item_event_index (material_item_id, audit_event_id, tenant_id, reserve_id, action, actor_id, event_created_at)
SELECT c.item_id, ae.id, ae.tenant_id, COALESCE(ae.reserve_id, c.reserve_id), ae.action, ae.actor_id, ae.created_at
FROM public.audit_events ae
JOIN public.cautelamentos c ON c.movement_id = ae.resource_id
WHERE ae.resource_type = 'cautelamento'
  AND ae.action IN ('cautelamento.batch_created', 'signature.batch_created')
  AND c.item_id IS NOT NULL
  AND ae.tenant_id IS NOT NULL
ON CONFLICT (material_item_id, audit_event_id) DO NOTHING;
