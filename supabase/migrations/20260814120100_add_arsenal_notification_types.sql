-- BUG REAL (mesma classe já corrigida uma vez em
-- 20260714000001_add_armament_cancelled_notification_type.sql): apps/bff/src
-- /routes/arsenal.ts insere notifications com type "arsenal_request"
-- (notifyReviewers, ao armeiro criar solicitação), "arsenal_approved" e
-- "arsenal_rejected" (ao admin revisar) — nenhum dos três valores nunca foi
-- adicionado ao notification_type_enum. O INSERT falha com erro de enum
-- inválido no Postgres e, como o código não checava `{ error }` do insert,
-- a falha era silenciosa: nem o admin_reserva via o sino acender para novas
-- solicitações de armeiro, nem o armeiro era avisado da aprovação/rejeição.
ALTER TYPE public.notification_type_enum ADD VALUE IF NOT EXISTS 'arsenal_request';
ALTER TYPE public.notification_type_enum ADD VALUE IF NOT EXISTS 'arsenal_approved';
ALTER TYPE public.notification_type_enum ADD VALUE IF NOT EXISTS 'arsenal_rejected';
