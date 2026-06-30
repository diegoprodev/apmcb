-- Consolidar triggers duplicados em material_items (M4)
--
-- ANTES: dois triggers BEFORE UPDATE em material_items:
--   1. validate_item_possession → _validate_item_possession (lógica simples)
--   2. trg_validate_item_transition → fn_validate_item_transition (superset completo)
--
-- fn_validate_item_transition já cobre 100% de _validate_item_possession, mais:
--   - Bloqueia estados finais (manutencao, extraviado, baixado, inapto)
--   - Limpa current_holder_user_id/active_lending_id ao retornar para disponivel
--   - Atualiza last_movement_at e updated_at
--
-- DEPOIS: único trigger canônico trg_validate_item_transition

DROP TRIGGER IF EXISTS validate_item_possession ON material_items;
DROP FUNCTION IF EXISTS _validate_item_possession();
