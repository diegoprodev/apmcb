-- Achados do code review sênior sobre 20260917040000_material_item_event_index.sql
-- (tabela ainda vazia — Fase 2/auditLogForItems ainda não implementada —
-- mais barato corrigir agora do que depois com dados reais):
--
-- ALTO: nenhuma FK tinha ON DELETE explícito, diferente de toda outra FK do
-- schema (~40 ocorrências, confirmado por grep). material_item_id vira
-- CASCADE — uma linha de índice sem o item que ela indexa não tem sentido
-- (a tabela é derivada/rebuildable, não canônica; perder linhas de índice
-- de um item deletado é inofensivo, o canônico continua sendo audit_events).
--
-- MÉDIO 1: tenant_id sem índice dedicado — quebra a paridade com
-- audit_events (que tem idx_audit_events_tenant) e não escala pra
-- consultas futuras "todos os eventos deste tenant".
--
-- MÉDIO 2: idx_miei_reserve era single-column — não evita sort extra
-- quando a consulta real é "histórico da reserva X, mais recente
-- primeiro" (mesmo padrão de ordenação do índice por item).

ALTER TABLE public.material_item_event_index
  DROP CONSTRAINT material_item_event_index_material_item_id_fkey,
  ADD CONSTRAINT material_item_event_index_material_item_id_fkey
    FOREIGN KEY (material_item_id) REFERENCES public.material_items(id) ON DELETE CASCADE;

CREATE INDEX idx_miei_tenant ON public.material_item_event_index (tenant_id);

DROP INDEX public.idx_miei_reserve;
CREATE INDEX idx_miei_reserve ON public.material_item_event_index (reserve_id, event_created_at DESC);
