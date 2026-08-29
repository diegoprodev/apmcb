-- ═══════════════════════════════════════════════════════════════════
-- Achado real do usuário (2026-08-29): a migration anterior
-- (20260829080000) cancelou 134 cautelas de teste e liberou os itens que
-- elas prendiam — mas 119 dos "itens liberados" eram, eles mesmos,
-- material_types SINTÉTICOS criados por specs E2E (nome literal no banco,
-- ex: "E2E Cautela EditCautela 1787084098710-276" — visível pro usuário no
-- diálogo "Editar Cautela" e no autocomplete de seleção de item, motivo do
-- "por que não aparece o material selecionado" reportado). Voltarem a
-- status_operacional='disponivel' os tornou SELECIONÁVEIS de novo na hora
-- de emitir/trocar material de uma cautela real — pioria, não melhoria,
-- desse achado específico.
--
-- Soft-delete (ativo=false), mesmo padrão já usado pelo botão "Desativar"
-- do admin_reserva e pela limpeza de "E2E Categoria" já existente em
-- global-teardown.ts — nunca hard-delete (cautelas históricas, inclusive as
-- 134 recém-canceladas, ainda referenciam esses material_items via FK).
-- ═══════════════════════════════════════════════════════════════════

UPDATE public.material_types
   SET ativo = false
 WHERE (nome ILIKE 'E2E%' OR nome ILIKE 'Teste%')
   AND ativo = true;
