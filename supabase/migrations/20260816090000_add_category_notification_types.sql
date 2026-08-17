-- BUG REAL (mesma classe já corrigida em
-- 20260814120100_add_arsenal_notification_types.sql para admin_approval_requests):
-- category_requests é um fluxo de aprovação paralelo (armeiro solicita nova
-- categoria de material, admin aprova/rejeita) que existia na API
-- (apps/bff/src/routes/categories.ts) mas nunca foi ligado a nenhuma UI —
-- achado do produto: "não aparece as solicitações de categorias no painel do
-- armeiro, apenas solicitações de materiais". Ao ligar o fluxo à UI, as
-- notificações passam a usar os types "category_request" (ao armeiro criar a
-- solicitação, avisando admin_reserva/admin_global), "category_approved" e
-- "category_rejected" (ao admin revisar, avisando o armeiro solicitante) —
-- nenhum dos três existe em notification_type_enum ainda. Sem esta migration,
-- o INSERT em notifications falha com erro de enum inválido no Postgres em
-- 100% dos casos, silenciosamente (o código só loga o erro, não propaga pro
-- caller — fire-and-forget por design).
ALTER TYPE public.notification_type_enum ADD VALUE IF NOT EXISTS 'category_request';
ALTER TYPE public.notification_type_enum ADD VALUE IF NOT EXISTS 'category_approved';
ALTER TYPE public.notification_type_enum ADD VALUE IF NOT EXISTS 'category_rejected';
