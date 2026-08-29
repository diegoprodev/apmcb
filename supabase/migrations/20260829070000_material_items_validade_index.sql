-- ═══════════════════════════════════════════════════════════════════
-- Achado MÉDIO de code review (implementação de AVU-07):
-- check_material_validade_vencimento() consulta material_items por
-- validade_item SEM filtro de status_operacional (correto — um material
-- extraviado/em manutenção com validade vencendo ainda deve alertar, mesmo
-- comportamento do código TypeScript removido) — mas o único índice
-- existente (idx_material_items_validade) é parcial e exige
-- status_operacional='cautelado', não cobrindo esta query. Roda como
-- sequential/bitmap scan a cada execução diária do cron; baixo custo hoje
-- (785 linhas), mas sem suporte de índice pra crescer.
-- ═══════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_material_items_validade_any_status
  ON public.material_items (validade_item)
  WHERE validade_item IS NOT NULL;
