-- Achado real, crítico: armeiro nunca conseguia ver NENHUMA solicitação
-- remota (SSA) na página /reserva/solicitacoes — a lista sempre vinha
-- vazia ("Nenhuma solicitação pendente"), mesmo com o card do painel
-- principal mostrando corretamente a contagem de pendências. Investigado
-- a partir de um report real do usuário (solicitação feita em 28/07/2026
-- pela matrícula 000003, notificação recebida pelo armeiro 000002, card
-- mostrando 1 pendência, lista sempre vazia).
--
-- Causa raiz: a policy `ssa_items_staff_all` em `material_request_items`
-- (criada em 20260615000001_ssa_schema.sql e NUNCA atualizada por nenhuma
-- das migrations posteriores que corrigiram esse mesmo problema em outras
-- tabelas — 20260625000002, 20260629000001/3/4, 20260711000003) ainda
-- checava `auth_role() IN ('admin', 'master')` — nomes de role OBSOLETOS
-- da fase inicial do projeto. O sistema atual usa
-- admin_global/admin_reserva/armeiro/auditor; nenhum usuário real tem mais
-- role 'admin' ou 'master'. Resultado: um armeiro nunca conseguia ler os
-- itens (`material_request_items`) de uma solicitação de outra pessoa —
-- só via `ssa_items_military_select`, que só libera para o PRÓPRIO
-- solicitante (military_id = auth.uid()), nunca verdadeiro para o armeiro
-- revisando a solicitação de um militar.
--
-- Por que isso travava a página inteira (não só escondia os itens): pra
-- um armeiro, NENHUMA policy PERMISSIVE em material_request_items nunca
-- retornava true — `ssa_items_staff_all` (role obsoleta, nunca bate) OU
-- `ssa_items_military_select` (correlacionada em military_id = auth.uid(),
-- só verdadeira quando o próprio solicitante lê seus próprios itens,
-- nunca quando é o armeiro revisando a solicitação de outra pessoa).
-- Achado de code review: o comentário original desta migration atribuía a
-- lentidão à "subquery correlacionada" da policy antiga — mas
-- `ssa_items_staff_all` não tinha subquery nenhuma, era um check de role
-- plano. A causa real é o CUSTO ACUMULADO de avaliar essa combinação
-- sempre-falsa (2 policies PERMISSIVE combinadas via OR, uma delas com
-- EXISTS correlacionado) para cada linha candidata do embed
-- `items:material_request_items(...)` gerado pelo PostgREST em
-- reserva/solicitacoes/page.tsx, sem conseguir aproveitar o LIMIT externo
-- pra cortar cedo — confirmado ao vivo (445ms sem o join → 8.164s com
-- ele, erro 57014 statement timeout).
--
-- IMPORTANTE — validação pendente: a fórmula "auth_role()/my_tenant_id()
-- (STABLE, cacheadas por statement) + 1 EXISTS indexado por PK" abaixo
-- deveria ser rápida, mas essa mesma suposição de performance não
-- verificada foi exatamente o que causou o bug original — repetir o
-- mesmo timing test (sem join / com join profiles / com join items) já
-- usado pra diagnosticar, contra o banco real, LOGO após aplicar esta
-- migration, antes de considerar o fix definitivamente comprovado.
--
-- A página também não checava o `error` da query (só fazia
-- `const { data } = await query`), então um timeout virava silenciosamente
-- "nenhuma solicitação" em vez de um erro visível — achado secundário,
-- também real e corrigido separadamente (banner de erro em page.tsx).
--
-- Fix: reescreve a policy usando os roles atuais, seguindo o mesmo
-- desenho de privilégio mínimo já usado em material_requests
-- (20260711000003_fix_rls_superadmin_and_admin_global_tenant_scope.sql):
-- leitura para admin_global/admin_reserva/armeiro/auditor, escrita restrita
-- (sem auditor) — tenant-scoped via subquery em material_requests
-- (material_request_items.tenant_id não é populado no INSERT hoje, então
-- não dá pra usar a coluna direto).
--
-- Nota de precedente (achado de code review): se esta tabela algum dia
-- entrar na publication do Supabase Realtime (postgres_changes, não o SSE
-- via BFF que este projeto usa hoje), `auth_role()`/`my_tenant_id()`
-- (SECURITY DEFINER STABLE) retornam NULL no contexto de replicação WAL —
-- mesmo problema documentado em 20260707000001, corrigido lá reescrevendo
-- pra EXISTS inline. Não é um bug vivo agora (nada assina postgres_changes
-- nesta tabela), só um alerta pra quem for adicionar isso no futuro.

DROP POLICY IF EXISTS ssa_items_staff_all ON public.material_request_items;
DROP POLICY IF EXISTS ssa_items_staff_select ON public.material_request_items;
DROP POLICY IF EXISTS ssa_items_staff_write ON public.material_request_items;

CREATE POLICY ssa_items_staff_select ON public.material_request_items
  FOR SELECT
  USING (
    auth_role() = ANY (ARRAY['admin_global', 'admin_reserva', 'armeiro', 'auditor']::role_enum[])
    AND EXISTS (
      SELECT 1 FROM public.material_requests r
      WHERE r.id = request_id AND r.tenant_id = my_tenant_id()
    )
  );

CREATE POLICY ssa_items_staff_write ON public.material_request_items
  FOR ALL
  USING (
    auth_role() = ANY (ARRAY['admin_global', 'admin_reserva', 'armeiro']::role_enum[])
    AND EXISTS (
      SELECT 1 FROM public.material_requests r
      WHERE r.id = request_id AND r.tenant_id = my_tenant_id()
    )
  )
  WITH CHECK (
    auth_role() = ANY (ARRAY['admin_global', 'admin_reserva', 'armeiro']::role_enum[])
    AND EXISTS (
      SELECT 1 FROM public.material_requests r
      WHERE r.id = request_id AND r.tenant_id = my_tenant_id()
    )
  );
