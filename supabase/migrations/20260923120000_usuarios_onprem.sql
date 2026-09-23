-- supabase/migrations/20260923120000_usuarios_onprem.sql
--
-- Tabela de credenciais para o modo ON_PREMISE (ver MIGRATION_SPEC.md §5.2/5.3
-- e docs/superpowers/plans/2026-09-23-auth-provider-abstraction.md). Em modo
-- SUPABASE fica presente mas nunca é escrita nem lida — a mesma pasta de
-- migrations é a fonte única de verdade pros dois ambientes (Fase 1).
--
-- id é o MESMO uuid usado em profiles.id e (on-prem) em auth.users.id — ver
-- Task 7 do plano (script de provisionamento), que insere nas 3 tabelas com
-- o mesmo id numa única transação.
CREATE TABLE IF NOT EXISTS public.usuarios (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL,
  senha_hash  text NOT NULL,
  criado_em   timestamptz NOT NULL DEFAULT now()
);

-- lower(email) em vez da extensão citext: mesma normalização de case que a
-- Supabase Auth já aplica em auth.users.email, sem extensão nova.
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_email_lower_idx
  ON public.usuarios (lower(email));
