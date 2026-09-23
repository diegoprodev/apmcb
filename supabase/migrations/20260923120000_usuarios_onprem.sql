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
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid() REFERENCES auth.users(id) ON DELETE CASCADE,
  email       text NOT NULL,
  senha_hash  text NOT NULL,
  criado_em   timestamptz NOT NULL DEFAULT now()
);

-- lower(email) em vez da extensão citext: mesma normalização de case que a
-- Supabase Auth já aplica em auth.users.email, sem extensão nova.
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_email_lower_idx
  ON public.usuarios (lower(email));

-- Mesmo padrão de 20260911000000_known_login_devices.sql (mesma ameaça:
-- esta tabela guarda senha_hash). Sem RLS, uma tabela nova em `public` é
-- alcançável via PostgREST com a chave anon por padrão num projeto Supabase
-- real.
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.usuarios IS 'Credenciais de login para o modo ON_PREMISE. Sem policy: apenas service_role acessa (mesmo padrão de known_login_devices).';
