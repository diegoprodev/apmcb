-- Troca de e-mail de acesso por admin, com duplo opt-in (spec:
-- docs/enterprise/specs/troca-email-acesso-enterprise.md).
--
-- `profiles.email`/`auth.users.email` continuam sempre = "o que está valendo
-- agora" — esta tabela é só o estado transitório entre a solicitação do
-- admin e a confirmação do próprio usuário no e-mail novo. Token bruto nunca
-- persiste, só o HMAC (mesma disciplina de totp_secrets/hashed_token do
-- GoTrue) — quem lê esta tabela não consegue reconstituir o link.
CREATE TABLE public.pending_email_changes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES public.profiles(id),
  tenant_id          UUID NOT NULL REFERENCES public.tenants(id),
  reserve_id         UUID REFERENCES public.reserves(id),
  old_email          TEXT NOT NULL,
  new_email          TEXT NOT NULL,
  token_hash         TEXT NOT NULL,
  requested_by       UUID NOT NULL REFERENCES public.profiles(id),
  requested_by_role  TEXT NOT NULL,
  expires_at         TIMESTAMPTZ NOT NULL,
  confirmed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- No máximo 1 pendência ativa por usuário — uma nova solicitação substitui a
-- anterior (o BFF audita a substituição como admin.user.email_change_superseded
-- antes de inserir a nova linha, então nunca há 2 linhas com confirmed_at IS NULL
-- pro mesmo user_id ao mesmo tempo).
CREATE UNIQUE INDEX pending_email_changes_active_user_idx
  ON public.pending_email_changes (user_id) WHERE confirmed_at IS NULL;

CREATE INDEX pending_email_changes_token_idx ON public.pending_email_changes (token_hash);

ALTER TABLE public.pending_email_changes ENABLE ROW LEVEL SECURITY;
-- Sem nenhuma policy pra anon/authenticated — só service_role (BFF) acessa,
-- mesmo padrão de totp_secrets e audit_events. RLS habilitada sem policy
-- nenhuma já bloqueia tudo por padrão pra roles não-service_role.

-- notification_type_enum.email_changed: a migration original desse valor
-- (20260815090000_add_email_changed_notification_type.sql) nunca chegou a
-- rodar em produção (confirmado via mcp__supabase__list_migrations antes
-- desta migration — não consta na lista de aplicadas). Em vez de depender de
-- ordem de aplicação de um arquivo órfão, o valor é adicionado aqui de forma
-- idempotente; se o arquivo antigo algum dia rodar também, IF NOT EXISTS
-- torna isso um no-op inofensivo.
ALTER TYPE public.notification_type_enum ADD VALUE IF NOT EXISTS 'email_changed';
