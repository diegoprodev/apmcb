# EVIDENCE — R-34 / R-37, lote 7 da C_HYBRID: `/admin/arsenal/manutencao`

Data: 2026-10-02. Branch `claude/bold-planck-6xy9fc`. Sem produção, sem migration, sem deploy.

## Antes
`page.tsx` autorizava por `profiles.role === admin_global` e lia `material_items` (helper `fetchManutencaoItems`) e `reserves` direto do Supabase com o JWT do usuário (RLS por `profiles.role`; o Modo Usuário — D-02 — era ignorado). O helper tinha embed `reserves(...)` sem hint de coluna (R-47) e engolia o erro como `[]`.

## Depois
| Arquivo | Mudança |
|---|---|
| `apps/bff/src/routes/arsenal.ts` | handler do lote 6 extraído para `listManutencao(c, withReserves)` (mesma lógica; rota de reserva inalterada em contrato). Nova `GET /api/arsenal/items/manutencao-admin` (`roleGuard("admin_global")`) → `{items, reserves}`; escopo por `scopedReserveIds` (matriz = tenant inteiro; filial = reserva ativa); `reserves` filtradas por tenant + `status=ativa` + `.in("id", reserveIds)`; falha em qualquer consulta → `logFailure` + 500 genérico; sem reservas no escopo → `{items: [], reserves: []}` |
| `admin/arsenal/manutencao/page.tsx` | sem Supabase; `resolveWebSessionRole` (fail-closed); só `admin_global` efetivo; 401 → login, 403 → `/`, falha/forma inesperada → aviso (nunca lista vazia); timeout 8 s; log por caso |
| `lib/material-items-manutencao.ts` | `fetchManutencaoItems` removido (sem consumidores; resolve R-47 no helper); mantidos os tipos |
| Testes | `arsenal-manutencao-admin-scope.test.ts` (10), `admin/arsenal/manutencao/page.test.tsx` (10); âncora de 2 guardas estáticas do lote 6 atualizada (`const listManutencao`) |

Decisão: em modo filial o admin_global vê só a reserva ativa (mesma regra de leitura de `scopedReserveIds`, igual às demais listagens); na matriz, o tenant inteiro. A página antes (RLS) não tinha essa distinção; é consistente com R-48 (assimetria leitura×escrita já sinalizada).

## Verificação
- Mutações (todas mortas): remover `.in("id", reserveIds)` das reservas; remover `.eq("tenant_id")`; incluir `armeiro` no roleGuard admin; engolir erro de `reserves` (sobreviveu até adicionar o teste "falha só em reservas, modo filial"); remover o redirect de papel na página.
- Suítes: BFF unit 695/695, integração 347/347, web 376/376; `tsc` (bff/web), `lint:logs`, `git diff --check` limpos; hash R-35 `d63f4b5e58a91c4f` intacto.
- Limitação: emulador não valida embeds/projeção; PGRST201 não confirmado contra PostgREST real.

## Revisão (code + segurança) — 0 CRÍTICO / 0 ALTO
- MÉDIO 1 (texto "todas as reservas" enganoso em modo filial): corrigido (cabeçalho descreve o escopo).
- MÉDIO 2 (reserva `inativa` some do filtro, que só lista `ativa`): comportamento mantido de propósito (igual à página anterior); registrado.
- BAIXO: segunda consulta a `reserves` em série (latência), paginação por offset sob escrita concorrente (herdada do lote 6), casts sem validação de contrato na página, estilo de indentação: aceitos/registrados, sem impacto de segurança.
- Etapas não executadas: Playwright/E2E (BLOQUEADO_AMBIENTE: só contra produção) e semgrep/insecure-defaults (não rodados nesta passagem; revisão de segurança feita por leitura).
