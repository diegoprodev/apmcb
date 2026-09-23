-- Reconciliação de drift: category_requests existia em produção sem
-- CREATE TABLE correspondente commitado (aplicada fora do fluxo de
-- migration, via MCP). Reconstruída a partir do schema real de produção
-- (information_schema/pg_constraint/pg_indexes, jepitcrkicwmvzrmllpn,
-- 2026-09-22) — só as colunas/constraints/índices que já existiam ANTES de
-- 20260817120000_category_requests_edit_flow.sql, que adiciona o resto via
-- ALTER TABLE ... IF NOT EXISTS (idempotente, roda sem conflito em cima
-- desta baseline). RLS habilitada aqui; as policies já existem como
-- migrations a partir de 20260711000003_fix_rls_superadmin_and_admin_global_tenant_scope.sql.
CREATE TABLE IF NOT EXISTS public.category_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reserve_id        uuid NOT NULL REFERENCES public.reserves(id) ON DELETE CASCADE,
  requested_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  nome              text NOT NULL,
  slug              text NOT NULL,
  icon              text,
  description       text,
  status            text DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovado', 'rejeitado')),
  reviewed_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at       timestamptz,
  rejection_reason  text,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

ALTER TABLE public.category_requests ENABLE ROW LEVEL SECURITY;
