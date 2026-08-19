-- Achado real, CRÍTICO — a migration anterior (20260819010000) corrigiu os
-- NOMES de role obsoletos na policy de material_request_items, mas o
-- timeout de 8s+ continuou EXATAMENTE IGUAL depois de aplicada (revalidado
-- ao vivo contra o banco real, confirmado pelo dono do produto). Causa raiz
-- verdadeira, só descoberta agora: a policy corrigida ainda usava
--
--   EXISTS (SELECT 1 FROM material_requests r WHERE r.id = request_id AND r.tenant_id = my_tenant_id())
--
-- — um EXISTS CORRELACIONADO (referencia request_id da linha de fora) que
-- o Postgres precisa replanejar/reexecutar para CADA linha de
-- material_request_items sendo avaliada pela RLS, mesmo com r.id sendo PK.
-- Confirmado isolando o problema: até um `SELECT count(*) FROM
-- material_request_items` SEM NENHUM JOIN, sem filtro nenhum, também
-- travava em ~8s — não era o embed do PostgREST, era a avaliação da RLS
-- em si, linha a linha, contra ~1000 linhas acumuladas de execuções de
-- teste.
--
-- Fix de verdade: material_request_items JÁ TEM uma coluna tenant_id
-- própria (20260620000001_multitenant_foundation.sql) — nunca populada de
-- forma consistente no INSERT (631 de 1005 linhas com tenant_id NULL,
-- corrigido agora em apps/bff/src/routes/ssa.ts, os 2 pontos de INSERT em
-- material_request_items). Comparar essa coluna direto
-- (`tenant_id = my_tenant_id()`) é um filtro plano por linha — sem
-- subquery nenhuma — e é ordens de magnitude mais barato que o EXISTS
-- correlacionado, porque my_tenant_id() (STABLE, sem argumentos) só
-- precisa ser avaliada UMA VEZ por statement (InitPlan), sobrando só uma
-- comparação de igualdade de valor já presente na própria linha.

-- 1. Backfill: popula tenant_id em todas as linhas existentes a partir do
--    material_requests pai — one-time, não é um custo recorrente por
--    query como o EXISTS da policy era.
UPDATE public.material_request_items mri
SET tenant_id = mr.tenant_id
FROM public.material_requests mr
WHERE mri.request_id = mr.id
  AND mri.tenant_id IS NULL
  AND mr.tenant_id IS NOT NULL;

-- 2. Índice de apoio — o filtro de RLS agora roda em toda leitura de staff
--    (SELECT/UPDATE/DELETE), então merece índice próprio, ao contrário do
--    backfill acima (executado uma vez só).
CREATE INDEX IF NOT EXISTS idx_material_request_items_tenant
  ON public.material_request_items (tenant_id);

-- 3. Reescreve as policies (criadas em 20260819010000) sem o EXISTS
--    correlacionado.
DROP POLICY IF EXISTS ssa_items_staff_all ON public.material_request_items;
DROP POLICY IF EXISTS ssa_items_staff_select ON public.material_request_items;
DROP POLICY IF EXISTS ssa_items_staff_write ON public.material_request_items;

CREATE POLICY ssa_items_staff_select ON public.material_request_items
  FOR SELECT
  USING (
    auth_role() = ANY (ARRAY['admin_global', 'admin_reserva', 'armeiro', 'auditor']::role_enum[])
    AND tenant_id = my_tenant_id()
  );

CREATE POLICY ssa_items_staff_write ON public.material_request_items
  FOR ALL
  USING (
    auth_role() = ANY (ARRAY['admin_global', 'admin_reserva', 'armeiro']::role_enum[])
    AND tenant_id = my_tenant_id()
  )
  WITH CHECK (
    auth_role() = ANY (ARRAY['admin_global', 'admin_reserva', 'armeiro']::role_enum[])
    AND tenant_id = my_tenant_id()
  );
