-- BUG REAL, MESMA CLASSE já corrigida 4x neste repo (armament_cancelled,
-- totp_configured, arsenal_request/approved/rejected, email_changed): a
-- notificação enviada ao usuário ao ser desativado ou receber impedimento
-- administrativo (apps/bff/src/routes/profiles.ts PATCH /:id/status,
-- "Notify the affected user on impactful transitions") usa os tipos
-- "account_deactivated" e "account_blocked" — nenhum dos dois nunca existiu
-- em notification_type_enum desde o schema inicial (só
-- material_issued/material_returned/account_created/biometric_registered).
-- O INSERT é fire-and-forget (resultado nunca checado) — falha 100% das
-- vezes em silêncio, e o usuário afetado nunca recebe o aviso de que sua
-- conta foi desativada ou bloqueada por impedimento administrativo.
ALTER TYPE public.notification_type_enum ADD VALUE IF NOT EXISTS 'account_deactivated';
ALTER TYPE public.notification_type_enum ADD VALUE IF NOT EXISTS 'account_blocked';
