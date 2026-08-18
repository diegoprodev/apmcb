-- category_requests até agora só suportava um fluxo implícito ("criar") —
-- toda solicitação virava uma NOVA categoria ao ser aprovada (ver
-- POST /requests/:id/approve em apps/bff/src/routes/categories.ts). Produto
-- pediu um segundo fluxo: um armeiro (role sem canManage, só canRequest)
-- propor uma EDIÇÃO de uma categoria JÁ EXISTENTE para aprovação do
-- admin_reserva/admin_global — hoje ele só tem "Solicitar Nova Categoria";
-- para qualquer categoria já cadastrada, a UI trava em "Somente leitura"
-- sem nenhuma alternativa de propor uma mudança.
--
-- Reaproveitamos a MESMA tabela em vez de criar uma nova: category_requests
-- já tem toda a infraestrutura de RLS/scoping por reserve_id (ver
-- 20260711000003/20260711000005) e os endpoints de aprovação/rejeição já
-- existem e já são escopados corretamente — duplicar isso numa tabela nova
-- violaria DRY/SSOT para um ganho pequeno (só mais 2 colunas de
-- discriminação + 5 colunas de flags, todas nullable/aditivas).
--
-- `type` distingue os dois fluxos: 'create' (comportamento existente,
-- default, preserva 100% das linhas já gravadas) e 'edit' (novo).
-- `target_category_id` só é preenchido para type='edit' — aponta para a
-- categoria que está sendo proposta para edição. ON DELETE CASCADE: este
-- sistema nunca faz DELETE físico de material_categories (só soft-delete
-- via `active=false`, ver DELETE /api/categories/:id), então este CASCADE é
-- só uma rede de segurança para o caso (hoje inexistente) de uma remoção
-- física futura — não deixaria uma solicitação de edição pendurada
-- apontando para um id inexistente.
--
-- As 5 colunas requires_caliber/requires_validity/default_has_serial_numbers/
-- validity_alert_days/requires_vehicle_fields espelham os mesmos campos de
-- material_categories/CategorySchema (ver normalizeCategoryBody em
-- categories.ts). Para type='create' elas ficam NULL (o approve continua
-- calculando defaults via getMaterialCategoryDefaults, exatamente como já
-- fazia antes desta migration — nenhuma mudança de comportamento no fluxo de
-- criação). Para type='edit' elas guardam os valores PROPOSTOS pelo armeiro,
-- aplicados ao aprovar via a MESMA função applyCategoryUpdate usada por
-- PATCH /api/categories/:id (reaproveitada, não duplicada).
--
-- Confirmado empiricamente em produção (2026-08-18, teste reversível: insert
-- de uma linha 'pendente' com o mesmo (reserve_id, slug) de uma linha
-- 'aprovado' já existente, sucesso, seguido de delete da linha de teste) que
-- o índice único existente em (reserve_id, slug) É de fato um índice PARCIAL
-- restrito a `WHERE status = 'pendente'` — não colide com linhas 'aprovado'
-- já existentes da solicitação de CRIAÇÃO original da mesma categoria.
-- POST /:id/edit-request funciona como esperado para categorias já aprovadas.

ALTER TABLE public.category_requests
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'create',
  ADD COLUMN IF NOT EXISTS target_category_id uuid
    REFERENCES public.material_categories(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS requires_caliber boolean,
  ADD COLUMN IF NOT EXISTS requires_validity boolean,
  ADD COLUMN IF NOT EXISTS default_has_serial_numbers boolean,
  ADD COLUMN IF NOT EXISTS validity_alert_days integer[],
  ADD COLUMN IF NOT EXISTS requires_vehicle_fields boolean;

ALTER TABLE public.category_requests
  ADD CONSTRAINT category_requests_type_chk CHECK (type IN ('create', 'edit'));

-- Garante consistência estrutural: toda linha 'edit' precisa apontar para
-- uma categoria alvo; toda linha 'create' não deve ter alvo. Evita ambiguidade
-- no código de aprovação (POST /requests/:id/approve), que decide o branch
-- (insert vs. update em material_categories) com base só em `type`.
ALTER TABLE public.category_requests
  ADD CONSTRAINT category_requests_type_target_chk CHECK (
    (type = 'edit' AND target_category_id IS NOT NULL) OR
    (type = 'create' AND target_category_id IS NULL)
  );

-- Acelera consultas futuras por "solicitações de edição pendentes desta
-- categoria" (ex: um badge "já há uma edição pendente" na UI do armeiro) e
-- o JOIN feito em GET /api/categories/requests para trazer os valores ATUAIS
-- da categoria ao lado dos propostos (diff "antigo → novo" na tela de
-- aprovação do admin).
CREATE INDEX IF NOT EXISTS category_requests_target_category_id_idx
  ON public.category_requests (target_category_id) WHERE target_category_id IS NOT NULL;
