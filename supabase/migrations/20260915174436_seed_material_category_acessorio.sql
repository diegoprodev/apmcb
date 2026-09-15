-- Follow-up de 20260915165730 (seed_material_categories): "Acessório" ficou
-- de fora do seed inicial, mas é referenciada por nome em
-- apps/web/e2e/crud-arsenal.spec.ts (C3, comentário explícito: "categoria
-- 'acessorio' — não exige calibre nem validade") — indicando que existia em
-- prod antes do clean-slate de 2026-09-10. Sem calibre/validade/veículo
-- (mesmo perfil de "Outro"), então serve como categoria "neutra" de teste.
--
-- ROLLBACK:
--   DELETE FROM public.material_categories
--   WHERE tenant_id = 'f0edc186-693f-4ab0-a0e8-6c18d65876fa' AND slug = 'acessorio';

INSERT INTO public.material_categories
  (tenant_id, reserve_id, nome, slug, requires_caliber, requires_validity,
   default_has_serial_numbers, validity_alert_days, requires_vehicle_fields, icon)
VALUES
  ('f0edc186-693f-4ab0-a0e8-6c18d65876fa', NULL, 'Acessório', 'acessorio', false, false, false, '{}', false, 'package')
ON CONFLICT (tenant_id, nome) DO NOTHING;
