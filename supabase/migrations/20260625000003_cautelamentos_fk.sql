-- Adiciona FK real: material_items.active_cautelamento_id → cautelamentos.id
-- Fase 5B: tabela cautelamentos agora existe (migration 20260620000005b)

ALTER TABLE material_items
  ADD CONSTRAINT fk_material_items_active_cautelamento
  FOREIGN KEY (active_cautelamento_id) REFERENCES cautelamentos(id)
  ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;
