-- Invalidação de sessão por-dispositivo (não mais global por usuário).
--
-- Achado real 2026-07-15: profiles.sessions_invalidated_at (migration
-- 20260626000001) invalida TODAS as sessões do usuário emitidas antes de um
-- timestamp — correto para revogação administrativa em massa (ban, reset de
-- senha), mas usado também no fluxo normal de POST /api/auth/logout fazia
-- qualquer logout (inclusive de um teste automatizado usando uma conta
-- fixture compartilhada) derrubar TODOS os outros dispositivos/abas
-- logados com a mesma conta — incidente real que bloqueou o login do
-- próprio usuário em produção.
--
-- revoked_sessions é uma denylist por session_id individual (gerado no
-- login/exchange, gravado no cookie selado). Logout normal passa a revogar
-- só a própria sessão; sessions_invalidated_at continua existindo para
-- revogação em massa administrativa (não tocado por este commit).
CREATE TABLE IF NOT EXISTS revoked_sessions (
  session_id  UUID PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  revoked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Cookie tem maxAge de 8h — um registro de revogação nunca precisa viver
  -- além disso. Permite limpeza periódica sem risco de apagar uma
  -- revogação ainda relevante.
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '8 hours')
);

CREATE INDEX IF NOT EXISTS idx_revoked_sessions_expires ON revoked_sessions(expires_at);

ALTER TABLE revoked_sessions ENABLE ROW LEVEL SECURITY;

-- Só o BFF (service_role, bypassa RLS) lê/escreve esta tabela — nenhuma
-- policy concede acesso a anon/authenticated, mesmo padrão de totp_secrets.

-- Limpeza periódica — achado de code review: sem isso, um INSERT por
-- logout faz a tabela crescer indefinidamente. expires_at (default 8h,
-- igual ao maxAge do cookie) nunca precisa ficar retido além disso.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

SELECT cron.schedule(
  'cleanup-revoked-sessions',
  '0 * * * *',
  $$DELETE FROM public.revoked_sessions WHERE expires_at < now()$$
);
