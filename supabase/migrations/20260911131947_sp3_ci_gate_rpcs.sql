-- SP3 do isolamento por reserva — RPCs de introspecção só-leitura pro harness
-- de CI. Ver docs/superpowers/specs/2026-09-09-isolamento-reserva-design.md §7/§8.
--
-- Por que RPC (não query direta via supabase-js): PostgREST não expõe
-- pg_catalog/information_schema diretamente — precisa de uma função
-- SECURITY DEFINER que devolva jsonb. Todas STABLE (sem side-effect,
-- permite otimização do planner) e revogadas de anon/authenticated — só
-- service_role (o job de CI) chama.
--
-- v2 (2026-09-11, mesmo dia): code review adversarial achou 3 CRÍTICOs na v1
-- antes de qualquer PR — nenhum chegou a main. Correções:
--   - ci_role_routine_grants: trocado information_schema.role_routine_grants
--     por pg_proc.proacl + aclexplode. A view information_schema NÃO lista
--     grants ao pseudo-papel PUBLIC (grantee 0), e toda function sem
--     GRANT/REVOKE explícito (proacl NULL) tem ACL default = EXECUTE TO
--     PUBLIC — exatamente a classe de furo que 20260714000008 (emergency
--     lockdown) documentou como causa raiz do incidente original. O gate
--     construído pra prevenir reincidência estava cego pra ela. Agora
--     também key por oid::regprocedure (assinatura completa, não só nome) —
--     um overload não-SECDEF não pode mais mascarar um SECDEF do mesmo nome.
--   - Mesma function: também exclui RETURNS trigger (não só event_trigger)
--     — trigger function não é invocável via PostgREST, GRANT nela é ruído
--     (achado real: audit_approval_request/audit_material_request/
--     audit_push_subscription/handle_user_first_login).
--   - ci_security_definer_functions: has_p_reserve_id agora lê
--     p.proargnames diretamente em vez de ILIKE no texto renderizado por
--     pg_get_function_identity_arguments — o ILIKE tinha resultado
--     indeterminado (dependia de proargnames aparecer ou não no texto,
--     nunca verificado contra o banco real antes do review).
--   - Todo jsonb_agg agora com COALESCE(..., '[]'::jsonb) — sem isso,
--     conjunto vazio retorna SQL NULL, que o script tratava como "[]" e
--     imprimia OK. Ou seja: uma RPC que não conseguiu enxergar nada no
--     banco (erro de filtro, mudança de schema, function recriada errada)
--     reportava sucesso. Fail-open na classe de bug mais perigosa possível
--     num gate de segurança.
--   - ci_child_null_reserve_id_counts: SP4 já aplicou NOT NULL direto nas 7
--     tabelas-filho (tabelas vazias na época) — um COUNT(*) WHERE
--     reserve_id IS NULL contra uma coluna NOT NULL é uma tautologia que
--     nunca pode falhar, e ainda paga o custo de 7 full-table-scans por
--     execução. Trocado por leitura de pg_attribute.attnotnull — testa o
--     invariante que pode de fato regredir (alguém remover a constraint via
--     MCP), O(1), sem scan.
--
-- ROLLBACK (volta pra v1 — não recomendado, reabre os 3 CRÍTICOs acima):
--   git checkout <commit anterior> -- supabase/migrations/20260911131947_sp3_ci_gate_rpcs.sql
-- ROLLBACK completo (remove os gates):
--   drop function if exists public.ci_policy_snapshot();
--   drop function if exists public.ci_rls_status();
--   drop function if exists public.ci_role_routine_grants();
--   drop function if exists public.ci_security_definer_functions();
--   drop function if exists public.ci_child_null_reserve_id_counts();

CREATE OR REPLACE FUNCTION public.ci_policy_snapshot()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'schema', schemaname, 'table', tablename, 'policy', policyname,
    'cmd', cmd, 'permissive', permissive, 'roles', roles,
    'qual', qual, 'with_check', with_check
  ) ORDER BY schemaname, tablename, policyname), '[]'::jsonb)
  FROM pg_policies
  WHERE schemaname = 'public';
$$;

CREATE OR REPLACE FUNCTION public.ci_rls_status()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'table', c.relname, 'rowsecurity', c.relrowsecurity, 'forcerowsecurity', c.relforcerowsecurity
  ) ORDER BY c.relname), '[]'::jsonb)
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p'); -- inclui tabela particionada
$$;

-- v2: pg_proc.proacl direto, não information_schema (ver header). Cobre
-- grant explícito a PUBLIC e o default-ACL implícito (proacl NULL).
-- Exclui RETURNS trigger/event_trigger — não invocáveis via PostgREST.
CREATE OR REPLACE FUNCTION public.ci_role_routine_grants()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'routine', p.oid::regprocedure::text,
    'grantee', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END
  ) ORDER BY p.oid::regprocedure::text, (CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END)), '[]'::jsonb)
  FROM pg_proc p
  CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.prosecdef = true
    AND p.prorettype NOT IN ('pg_catalog.trigger'::regtype, 'pg_catalog.event_trigger'::regtype)
    AND a.privilege_type = 'EXECUTE'
    AND (a.grantee = 0 OR a.grantee::regrole::text IN ('anon', 'authenticated'));
$$;

CREATE OR REPLACE FUNCTION public.ci_security_definer_functions()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'name', p.proname,
    'args', pg_get_function_identity_arguments(p.oid),
    'has_p_reserve_id', COALESCE('p_reserve_id' = ANY(p.proargnames), false),
    'has_search_path', COALESCE(EXISTS (SELECT 1 FROM unnest(p.proconfig) cfg WHERE cfg LIKE 'search_path=%'), false),
    'body_mentions_assert_actor', COALESCE(pg_get_functiondef(p.oid) ILIKE '%assert_actor_in_reserve%', false),
    'body_mentions_assert_device', COALESCE(pg_get_functiondef(p.oid) ILIKE '%assert_device_in_reserve%', false)
  ) ORDER BY p.proname), '[]'::jsonb)
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef = true;
$$;

-- v2: attnotnull em vez de COUNT(*) — a coluna já é NOT NULL desde o SP4
-- (tabelas vazias na época), então contar linhas violando é tautologia
-- sempre-zero. O invariante que pode de fato regredir é a CONSTRAINT em si.
CREATE OR REPLACE FUNCTION public.ci_child_null_reserve_id_counts()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(jsonb_object_agg(c.relname, a.attnotnull), '{}'::jsonb)
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND a.attname = 'reserve_id'
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND c.relname = ANY(ARRAY['material_request_items','service_log_events','handover_attachments',
      'inventory_item_checks','material_items','cautela_vencimento_alert_events','document_signatures']);
$$;

REVOKE EXECUTE ON FUNCTION public.ci_policy_snapshot() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ci_rls_status() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ci_role_routine_grants() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ci_security_definer_functions() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ci_child_null_reserve_id_counts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ci_policy_snapshot() TO service_role;
GRANT EXECUTE ON FUNCTION public.ci_rls_status() TO service_role;
GRANT EXECUTE ON FUNCTION public.ci_role_routine_grants() TO service_role;
GRANT EXECUTE ON FUNCTION public.ci_security_definer_functions() TO service_role;
GRANT EXECUTE ON FUNCTION public.ci_child_null_reserve_id_counts() TO service_role;
