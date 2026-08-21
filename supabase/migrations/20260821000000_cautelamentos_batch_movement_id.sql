-- Cautela com múltiplos materiais — Fase 1: coluna de agrupamento
-- Ver docs/enterprise/specs/cautela-multi-item-batch-enterprise.md (CMB).
--
-- Hoje `cautelamentos.item_id` é 1:1 com um `material_items` físico — não
-- existe forma de agrupar N cautelas criadas na mesma ação do armeiro (ex:
-- cautelar uma pistola + um coldre pro mesmo militar de uma vez). Padrão já
-- provado no mesmo projeto para exatamente esse problema: `lendings.movement_id`
-- (ver uq_lendings_movement_material). Replicado aqui com a granularidade
-- certa para cautela: por item físico (não por tipo+quantidade, que é a
-- semântica de lendings).
--
-- Aditivo e retrocompatível: cautelas existentes (movement_id IS NULL)
-- continuam válidas — cada uma é seu próprio "lote de 1", sem backfill.

ALTER TABLE cautelamentos ADD COLUMN IF NOT EXISTS movement_id uuid;

COMMENT ON COLUMN cautelamentos.movement_id IS
  'Agrupa N cautelas criadas na mesma ação do armeiro (múltiplos materiais numa única operação). NULL para cautelas legadas/individuais — cada uma é seu próprio lote de 1.';

-- Garante que o mesmo item físico não pode aparecer duas vezes no mesmo
-- lote (mesma checagem de duplicata que a RPC de criação em lote fará,
-- reforçada no schema).
CREATE UNIQUE INDEX IF NOT EXISTS uq_cautelamentos_movement_item
  ON cautelamentos(movement_id, item_id)
  WHERE movement_id IS NOT NULL;

-- Índice de apoio para listar/agrupar por movimento (usado pelo frontend
-- pra renderizar o card "Lote de N" e pelas rotas de assinatura em lote).
CREATE INDEX IF NOT EXISTS idx_cautelamentos_movement
  ON cautelamentos(movement_id)
  WHERE movement_id IS NOT NULL;
