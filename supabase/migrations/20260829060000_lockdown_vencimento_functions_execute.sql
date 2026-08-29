-- ═══════════════════════════════════════════════════════════════════
-- CRÍTICO de code review (implementação de AVU): check_cautelas_vencimento()
-- e check_material_validade_vencimento() são SECURITY DEFINER — criadas sem
-- REVOKE explícito, ficaram executáveis via PostgREST por `anon` e
-- `authenticated` (confirmado: has_function_privilege('anon', oid,
-- 'EXECUTE') = true nas duas). Como rodam com privilégio do dono (bypassam
-- RLS de propósito), qualquer pessoa com a anon key pública (embutida no
-- bundle do frontend, por design) podia chamar
-- POST /rest/v1/rpc/check_material_validade_vencimento com
-- {"p_reserve_id": "<qualquer reserva de qualquer tenant>"} SEM autenticar
-- — bypass total do roleGuard("admin_reserva") e do escopo por reserva que
-- o parâmetro p_reserve_id foi desenhado pra garantir (o parâmetro só
-- protege a chamada feita PELO BFF; não fecha a porta direta ao Postgres).
-- Mesma classe de bug já corrigida uma vez neste projeto
-- (20260714000008_emergency_lockdown_exposed_functions.sql) — as duas
-- functions novas desta spec simplesmente não replicaram o mesmo passo.
--
-- record_cautelamento_batch: achado no mesmo levantamento, mesma classe de
-- bug, pré-existente (função de outra spec, só estendida hoje com um
-- parâmetro novo) — corrigida junto pela regra canônica do projeto sobre
-- falhas encontradas durante o trabalho.
-- ═══════════════════════════════════════════════════════════════════

REVOKE EXECUTE ON FUNCTION public.check_cautelas_vencimento() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_material_validade_vencimento(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_cautelamento_batch(uuid, uuid, uuid, uuid, uuid, text, jsonb, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.check_cautelas_vencimento() TO service_role;
GRANT EXECUTE ON FUNCTION public.check_material_validade_vencimento(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_cautelamento_batch(uuid, uuid, uuid, uuid, uuid, text, jsonb, text) TO service_role;
