-- ═══════════════════════════════════════════════════════════════════
-- profiles.welcome_email_sent_at — guard atômico do e-mail de boas-vindas
-- (Fase 2 do e-mail transacional).
--
-- Coluna DEDICADA, não reuso de account_activated_at: aquele é gravado pelo
-- trigger on_first_login no primeiro last_sign_in_at, que pode acontecer ANTES
-- do militar definir a senha (a sessão do link de recovery já conta como
-- sign-in). O welcome é disparado em POST /api/auth/update-password com um
-- claim atômico:
--   UPDATE profiles SET welcome_email_sent_at = now()
--    WHERE id = $1 AND welcome_email_sent_at IS NULL
--   RETURNING id;
-- Se retornou linha → este request ganhou a corrida → dispara o e-mail.
-- Aditiva, sem default. Com backfill defensivo (abaixo): contas JÁ ativas são
-- marcadas como já-enviado para não receberem "bem-vindo" retroativo num
-- "esqueci a senha", que passa pelo mesmo POST /api/auth/update-password.
--
-- ROLLBACK:
--   ALTER TABLE public.profiles DROP COLUMN IF EXISTS welcome_email_sent_at;
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS welcome_email_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN public.profiles.welcome_email_sent_at IS
  'Quando o e-mail de boas-vindas foi enviado (guard atômico, 1x por conta). NULL = ainda não enviado.';

-- Backfill: quem JÁ está ativo (logou alguma vez ou concluiu o cadastro) não
-- deve receber "bem-vindo" retroativo — sobretudo num "esqueci a senha" de
-- conta antiga, que passa pelo mesmo POST /api/auth/update-password. Marca como
-- já-enviado (com o created_at como carimbo aproximado). Só militares que
-- ativarem a conta A PARTIR de agora entram no fluxo.
-- Idempotente: o WHERE só pega linhas ainda NULL, então re-rodar não altera
-- nada. `account_activated_at` é o carimbo real da ativação; `created_at`
-- (NOT NULL) cobre o caso raro de conta `complete` sem `account_activated_at`.
UPDATE public.profiles
   SET welcome_email_sent_at = COALESCE(account_activated_at, created_at)
 WHERE welcome_email_sent_at IS NULL
   AND (account_activated_at IS NOT NULL OR registration_status = 'complete');
