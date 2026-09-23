\set ON_ERROR_STOP on
-- supabase/onprem-bootstrap/000_auth_shim.sql
--
-- COBERTURA: este shim satisfaz SOMENTE as necessidades de
-- `supabase/migrations/20260611000001_initial_schema.sql` e
-- `supabase/migrations/20260611000002_rls_policies.sql` (schema `auth`
-- mínimo: tabela `auth.users(id,email)` + função `auth.uid()`). Ele NÃO
-- cobre `auth.jwt()` (usado em ~12 lugares de migrations posteriores, ex.
-- 20260620000004_document_signatures.sql, 20260620000006_service_handovers.sql,
-- 20260628000002_service_shifts_livro_digital.sql), `auth.role()`
-- (20260629000004_rls_safe_roles_only.sql), colunas extras de `auth.users`
-- que outras migrations referenciam (encrypted_password, email_confirmed_at,
-- created_at, updated_at, last_sign_in_at), triggers que algumas migrations
-- criam em `auth.users`, nem a extensão `pgcrypto` que `seed_dev` usa.
-- Repetir toda a pasta `supabase/migrations/` contra um Postgres on-prem
-- real vai bater em outras referências `auth.*` não definidas aqui —
-- cobertura completa da superfície `auth.*` é trabalho futuro, fora do
-- escopo deste plano (ver seção "Pendente" do plano de Auth Provider
-- Abstraction).
--
-- ON-PREM ONLY. NUNCA rodar contra um projeto Supabase real — lá o schema
-- `auth` já existe, é gerenciado pela GoTrue, e `auth.uid()` já lê o JWT do
-- PostgREST via `request.jwt.claims`. Este arquivo recria só o suficiente
-- pra satisfazer:
--   1. o FK `profiles.id REFERENCES auth.users(id)` (20260611000001).
--   2. a função `auth.uid()` que ~250 RLS policies chamam via
--      my_tenant_id()/auth_role()/etc — mesma assinatura, mesmo corpo do
--      Supabase (só lê uma GUC de sessão), então nenhuma policy muda.
--
-- Aplicar ANTES de `supabase db push --db-url $ON_PREM_DATABASE_URL`
-- (ver MIGRATION_SPEC.md §4.4). Aplicação: psql -f 000_auth_shim.sql.
--
-- O BFF, em modo ON_PREMISE, executa `SET LOCAL request.jwt.claims =
-- '{"sub":"<uuid>"}'` no início de cada transação autenticada (ver Task 6
-- deste plano + MIGRATION_SPEC.md §4.2) — é isso que auth.uid() lê abaixo.

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text
);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT (NULLIF(current_setting('request.jwt.claims', true), '')::json->>'sub')::uuid
$$;
