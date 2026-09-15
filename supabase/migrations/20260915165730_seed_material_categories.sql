-- Achado real (investigação E2E, 2026-09-15): CI/CD nightly falhando desde
-- 2026-09-12 (4 dias seguidos) — 26 testes falhando em cascata a partir de
-- C1 (crud-arsenal.spec.ts), causa raiz: `material_categories` está VAZIA em
-- prod desde o clean-slate de 2026-09-10 (0 linhas). O dialog de criar
-- material (#mat-categorias-menu) não tem nenhuma opção pra clicar — sem
-- categoria, é impossível cadastrar QUALQUER material pela UI, não só nos
-- testes. Achado de produção real, não só débito de teste.
--
-- material_types.categoria/categoria_slug (o enum antigo, pré-SP em
-- 20260628000004) usava os slugs abaixo — mantido aqui como convenção,
-- já que material_categories hoje é 100% dinâmica (sem enum no código).
--
-- reserve_id NULL = categoria compartilhada em todas as reservas do tenant
-- (mesmo comportamento implícito de antes do SP5 — RLS de
-- material_categories_tenant_select/`tenant members read` não filtram por
-- reserve_id; SP5 decide o escopo por-reserva de verdade).
--
-- ROLLBACK:
--   DELETE FROM public.material_categories
--   WHERE tenant_id = 'f0edc186-693f-4ab0-a0e8-6c18d65876fa'
--     AND slug IN ('arma','colete','radio','veiculo','farda','outro');

INSERT INTO public.material_categories
  (tenant_id, reserve_id, nome, slug, requires_caliber, requires_validity,
   default_has_serial_numbers, validity_alert_days, requires_vehicle_fields, icon)
VALUES
  ('f0edc186-693f-4ab0-a0e8-6c18d65876fa', NULL, 'Arma', 'arma', true, false, true, '{}', false, 'crosshair'),
  ('f0edc186-693f-4ab0-a0e8-6c18d65876fa', NULL, 'Colete', 'colete', false, true, true, '{365,180,90}', false, 'shield'),
  ('f0edc186-693f-4ab0-a0e8-6c18d65876fa', NULL, 'Rádio', 'radio', false, false, true, '{}', false, 'radio'),
  ('f0edc186-693f-4ab0-a0e8-6c18d65876fa', NULL, 'Veículo', 'veiculo', false, false, false, '{}', true, 'car'),
  ('f0edc186-693f-4ab0-a0e8-6c18d65876fa', NULL, 'Farda', 'farda', false, false, false, '{}', false, 'shirt'),
  ('f0edc186-693f-4ab0-a0e8-6c18d65876fa', NULL, 'Outro', 'outro', false, false, false, '{}', false, 'tag')
ON CONFLICT (tenant_id, nome) DO NOTHING;
