-- Backfill lendings.reserve_id / lendings.tenant_id para linhas legadas com
-- NULL, causa raiz de um bug reportado como "gravíssimo" em 2026-08-16: no
-- modal "Receber Material" (apps/web/.../saidas/_desarmamento-modal.tsx),
-- após verificação TOTP de um militar, aparecia "Nenhum material ativo
-- encontrado para este usuário" mesmo com a tela de listagem de saídas
-- (saidas/page.tsx, que NÃO filtra por reserve_id — só tenant via RLS)
-- mostrando claramente os itens ativos do mesmo militar.
--
-- Causa raiz confirmada via query read-only em produção (project
-- jepitcrkicwmvzrmllpn, ver apps/web/scripts/_tmp-investigate-null-reserve-
-- lendings.mjs, sessão 2026-08-17): POST /identify em
-- apps/bff/src/routes/lendings.ts filtra lendings ativos com
-- `.eq("reserve_id", body.reserve_id)` — um filtro de igualdade NUNCA casa
-- com NULL em Postgres/PostgREST, então lendings reais e ativos com
-- reserve_id NULL ficam invisíveis para o fluxo de identificação/devolução,
-- embora apareçam normalmente na listagem (que não filtra por reserve_id).
--
-- Isso é 100% dado legado: o código de inserção atual (POST / e POST /batch
-- em lendings.ts) sempre chama a RPC record_lending_batch com p_reserve_id
-- obrigatório (schema zod sem .optional()), e a RPC (ver
-- 20260714000006_biometric_phase1a2_batch_lending_rpc.sql e a versão mais
-- recente em 20260714000010_lending_rpcs_totp_claim_consumption.sql) sempre
-- grava reserve_id na inserção. As 39 linhas afetadas (confirmadas em
-- produção em 2026-08-17: 39 com reserve_id NULL, 19 dessas também com
-- tenant_id NULL) são anteriores a essa validação existir — todas
-- pertencem a um único master_id (0f74d62a-4c48-40b2-8f4d-81b69d0eaddb),
-- sem ambiguidade de reserve_membership.
--
-- Este backfill NÃO altera a lógica de /identify, /batch ou POST / — o
-- filtro por reserve_id ali é uma fronteira de segurança real (escopo
-- multi-tenant/multi-reserva) e enfraquecê-la seria pior que o bug. A
-- correção correta é os DADOS ficarem consistentes com a invariante que o
-- código já assume (reserve_id sempre presente).
--
-- Estratégia (data-driven, não hardcoded, idempotente por natureza — numa
-- segunda execução os dois UPDATEs abaixo encontram 0 linhas elegíveis,
-- porque a primeira execução já preencheu reserve_id/tenant_id, então o
-- WHERE ... IS NULL não casa com nada e nenhuma linha é tocada):
--   1. reserve_id: derivado de reserve_memberships do master_id (quem emitiu
--      o empréstimo — armeiro/admin_reserva/auditor_reserva). reserve_memberships
--      é exclusiva para papéis operacionais/admin da reserva (ver comentário
--      em 20260620000001_multitenant_foundation.sql), então master_id SEMPRE
--      deveria ter exatamente 1 linha ali hoje. Por segurança, o backfill só
--      atua quando há EXATAMENTE 1 reserve_membership para aquele master_id —
--      um master_id com 0 ou >1 memberships fica de fora (não hardcodeamos
--      suposições; confirmado sem ambiguidade em produção em 2026-08-17, mas
--      a query abaixo se protege contra o caso mudar no futuro/em outros
--      ambientes).
--   2. tenant_id: derivado de profiles.default_tenant_id do master_id
--      (cache de conveniência já usado em todo o resto do schema). Edge case
--      conhecido: se `master_id` não existir mais em `profiles` (usuário
--      removido), a linha permanece com tenant_id NULL — aceitável aqui
--      porque não há como derivar o tenant sem essa referência, e esse caso
--      não ocorre nos dados reais confirmados em 2026-08-17 (todos os 39
--      master_id afetados têm profile ativo).
--
-- Validação: cada passo reporta via RAISE NOTICE quantas linhas foram
-- afetadas, para conferência manual do log de aplicação da migration — em
-- produção, 2026-08-18, o backfill real (aplicado via script usando as
-- mesmas credenciais de service_role, equivalente a este UPDATE) afetou
-- exatamente 39 linhas no passo 1 e 0 no passo 2 (todas as 19 linhas com
-- tenant_id NULL também tinham reserve_id NULL, então já foram cobertas
-- pelo passo 1, que seta os dois campos juntos).
--
-- Reversão: não aplicável (backfill idempotente de dados legados; não há
-- "estado anterior correto" a restaurar — os valores NULL eram o próprio bug).

begin;

-- Índice ausente até aqui: os dois UPDATEs abaixo (e a query real de
-- /identify em lendings.ts) filtram/casam por master_id sem nenhum índice
-- dedicado (só idx_lendings_reserve_id e idx_reserve_memberships_user
-- existiam). Sem impacto nas 39 linhas de hoje, mas evita degradação
-- conforme a tabela cresce.
create index if not exists idx_lendings_master_id on public.lendings(master_id);

do $$
declare
  v_step1_count int;
  v_step2_count int;
begin
  -- Passo 1: backfill de reserve_id (+ tenant_id) a partir da
  -- reserve_membership única do master_id que emitiu o lending.
  -- `min(reserve_id)` aqui é só sintaticamente necessário (Postgres exige
  -- agregação para uma coluna não presente no GROUP BY) — `having count(*) =
  -- 1` já garante que existe exatamente 1 reserve_id possível por user_id
  -- neste grupo, então min() nunca precisa escolher entre valores distintos.
  with unique_master_reserve as (
    select user_id, min(reserve_id) as reserve_id
    from public.reserve_memberships
    group by user_id
    having count(*) = 1
  )
  -- LEFT JOIN em profiles de propósito: reserve_id não depende de o profile
  -- do master ainda existir, só tenant_id depende. Dois cenários:
  --   - profile existe: coalesce(l.tenant_id, p.default_tenant_id) preenche
  --     tenant_id com o do profile quando l.tenant_id era NULL, ou preserva
  --     o valor de l.tenant_id se ele já estava preenchido.
  --   - profile não existe (órfão): p.default_tenant_id vem NULL, então
  --     coalesce só preserva l.tenant_id como estava (NULL continua NULL,
  --     valor preenchido continua preenchido) — nunca sobrescreve com NULL.
  -- Em ambos os cenários reserve_id É setado (não depende do LEFT JOIN
  -- encontrar profile); só tenant_id pode ficar sem melhora no caso órfão,
  -- que o passo 2 abaixo tenta cobrir de novo por completude.
  update public.lendings l
  set reserve_id = umr.reserve_id,
      tenant_id = coalesce(l.tenant_id, p.default_tenant_id)
  from unique_master_reserve umr
  left join public.profiles p on p.id = umr.user_id
  where l.reserve_id is null
    and l.master_id = umr.user_id;
  get diagnostics v_step1_count = row_count;
  raise notice 'backfill_lendings passo 1 (reserve_id+tenant_id via reserve_membership única): % linha(s) atualizada(s)', v_step1_count;

  -- Passo 2: backfill de tenant_id isolado, para o caso (não observado em
  -- produção em 2026-08-17, mas coberto por completude) de uma linha já ter
  -- reserve_id preenchido e ainda assim tenant_id NULL.
  update public.lendings l
  set tenant_id = p.default_tenant_id
  from public.profiles p
  where l.tenant_id is null
    and l.master_id = p.id
    and p.default_tenant_id is not null;
  get diagnostics v_step2_count = row_count;
  raise notice 'backfill_lendings passo 2 (tenant_id isolado): % linha(s) atualizada(s)', v_step2_count;
end $$;

commit;
