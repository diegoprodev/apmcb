-- Sistema de e-mail transacional (Resend) — Fase 0 / fundação.
-- Ver docs/email-transacional.md e o plano em .claude/plans/.
--
-- Duas tabelas, ambas escritas SÓ pelo BFF (service_role, bypassa RLS):
--   1. email_log   — trilha de todo desfecho de envio. MUTÁVEL e dedicada
--                    (não a hash-chain audit_events): evita PII imutável
--                    (LGPD) e a race da hash-chain no caminho quente.
--                    Metadata mínima: sem `to`, sem nome, sem subject, sem
--                    link, sem IP. Só recipient_id (FK).
--   2. email_dedup — dedup server-side. A chave é HMAC com pepper server-side
--                    (não pré-colidível por um atacante com o segredo do
--                    endpoint), unicidade garantida pela PRIMARY KEY.

-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template      TEXT NOT NULL,
  category      TEXT NOT NULL CHECK (category IN ('security', 'lifecycle')),
  recipient_id  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  status        TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped', 'suppressed')),
  resend_id     TEXT,
  error_code    TEXT,                       -- código/nome do erro, nunca o corpo cru
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_log_recipient ON email_log(recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_log_created ON email_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_log_status_created ON email_log(status, created_at DESC);

ALTER TABLE email_log ENABLE ROW LEVEL SECURITY;
-- Sem policy: só o BFF (service_role). Mesmo padrão de revoked_sessions / totp_secrets.

-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_dedup (
  dedup_key   TEXT PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- O cron de limpeza filtra por created_at — sem índice seria seq scan diário.
CREATE INDEX IF NOT EXISTS idx_email_dedup_created ON email_dedup(created_at);

ALTER TABLE email_dedup ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────
-- Limpeza periódica (mesmo padrão de cleanup-revoked-sessions).
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

SELECT cron.schedule(
  'cleanup-email-log',
  '23 3 * * *',
  $$DELETE FROM public.email_log WHERE created_at < now() - interval '180 days'$$
);

SELECT cron.schedule(
  'cleanup-email-dedup',
  '27 3 * * *',
  $$DELETE FROM public.email_dedup WHERE created_at < now() - interval '7 days'$$
);

-- ─────────────────────────────────────────────────────────────────────────
-- ROLLBACK
--   SELECT cron.unschedule('cleanup-email-log');
--   SELECT cron.unschedule('cleanup-email-dedup');
--   DROP TABLE IF EXISTS email_dedup;
--   DROP TABLE IF EXISTS email_log;
