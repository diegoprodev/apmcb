-- supabase/onprem-bootstrap/000_auth_shim.sql
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
  SELECT NULLIF(current_setting('request.jwt.claims', true), '')::json->>'sub'
$$;
