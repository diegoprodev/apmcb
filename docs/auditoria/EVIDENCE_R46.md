# EVIDENCE — R-46: `GET /api/arsenal/items/disponiveis` confinado à reserva da sessão

## Estado inicial
| Campo | Valor |
|---|---|
| Branch / HEAD inicial | `claude/bold-planck-6xy9fc` / `586da10` (28dd443, 8489f2c, 940288f, f243865 presentes) |
| `origin/main` | `70c3fa7` (inalterado; não mesclado) |
| Árvore inicial | limpa |
| Migration R-35 | sha256 `d63f4b5e…551b5b`, intacta; nenhuma migration; produção não acessada |
| WIPs | `worktree-biometric-unify-ssa` não toca `routes/arsenal.ts`; `cautelamentos.ts`/`saidas.ts` não foram editados |

## Endpoint, consumers e domínio
- **Handler:** `apps/bff/src/routes/arsenal.ts`, `GET /items/disponiveis`, `roleGuard("armeiro","admin_reserva","admin_global")`, atrás do `authMiddleware` (`/api/arsenal/*`).
- **Consumers (confirmados no código):** modal "Registrar ocorrência" (`reserva/arsenal/manutencao/_registrar-ocorrencia-dialog.tsx`, sem parâmetros) e o seletor de item de `/reserva/cautelas` (`_cautelas-client.tsx`, `?for=cautela`).
- **Antes:** `material_items` por `tenant_id` e `status_operacional='disponivel'`, ordem `identificador_principal`, `.limit(300)`; embed `reserve:reserves(nome, acronym)` (ambíguo: `material_items` tem 2 FKs para `reserves`, `current_unit_id` e `reserve_id`). Campos: `id`, `identificador_principal`, `status_operacional`, tipo (`nome`, `categoria`[, `cautela_habilitada`, `ativo`]) e reserva (`nome`, `acronym`).
- **Domínio:** "disponível" = `status_operacional = 'disponivel'` (inalterado; no modo cautela, também tipo habilitado/ativo e item elegível). `material_items.reserve_id` NOT NULL (reserva dona, derivada do tipo de material); sem item sem reserva. Nenhum parâmetro de escopo vem do cliente (só `q` e `for`).

## R46_REPRODUCED = YES
Handler real, sessão de armeiro da reserva A (tenant A), com itens disponíveis nas reservas A, B e C do mesmo tenant: o código antigo devolvia `bc-000`, `bc-001`… (reservas B e C) além dos de A. O BFF usa service role, então a RLS `material_items_staff_select` (`reserve_id = reserva ativa`) não protege. **11 de 15 testes falham no código antigo.**
Já corretos antes (passam no código antigo): tenant isolation (o tenant B nunca aparece), 403 para papel efetivo `usuario` (Modo Usuário/militar comum), 400 sem tenant, erro de banco → 500.

## Regra de escopo (sem decisão de produto nova)
Fonte: `lib/reserve-scope.ts` ("matriz = admin_global/auditor SEM reserva ativa vê o tenant inteiro; qualquer outro papel, incluindo admin_global/auditor EM modo filial, fica confinado à reserva ativa") e a RLS `material_items_staff_select` (`reserve_id = my_active_reserve_id()` ou matriz). É a mesma regra de todas as listagens do BFF (SP9.5) e do lote 6. Armeiro e admin_reserva: reserva ativa (idênticos); admin_global: tenant na matriz, reserva ativa em filial; D-01 (múltiplas memberships) governa a reserva ATIVA da sessão, não a enumeração do tenant.

## Correção (só `GET /items/disponiveis`, sem migration)
- `scopedReserveIds(role, reservaAtiva, tenant)` da SESSÃO; `.in("reserve_id", reserveIds)` no banco, **antes** do `.limit(300)`; `tenant_id` mantido; status inalterado.
- Sem reserva no escopo (não-matriz sem reserva ativa): `[]` legítimo, sem consultar. Erro ao calcular o escopo (só matriz): `logFailure("arsenal.disponiveis.failure")` + 500, `material_items` não consultada (R-41). Erro de banco: 500 genérico + `logFailure` (antes não logava).
- Ordem `identificador_principal`, `id` (tiebreak); limit 300 preservado.
- Embed com hint de coluna: `reserve:reserves!reserve_id(nome, acronym)` nos dois selects (a reserva DONA, a mesma coluna do filtro e da RLS) (**R47_PARTIAL_OBSERVATION_ONLY**: o hint foi aplicado só neste endpoint; R-47 segue OPEN/a confirmar, o helper web de `/admin/arsenal/manutencao` não foi tocado). `POSTGREST_REAL_VALIDATION = BLOQUEADO_AMBIENTE` (MCP Supabase indisponível; produção fora de escopo).
- Writes (`PATCH /items/:id/ocorrencia`, `POST /api/cautelamentos`) **não foram tocados** (ver R-48/R-49).
- `fake-postgrest.ts` ganhou `ilike` (contém, sem diferenciar caixa).

## AFTER (15 testes, `arsenal-disponiveis-scope.test.ts`)
armeiro A: só A (apesar de 350 itens de B/C à frente do limit, de outro tenant e da mesma `reserve_id` em outro tenant); admin_reserva A: igual; admin_global em filial A: confinado; admin_global na matriz: tenant A (A, B, C), nunca o tenant B, limit 300 preservado; tenant B: só o próprio; só `disponivel`; consumer cautela (`?for=cautela`) e consumer ocorrência (`?q=`) dentro da reserva (o número de B/C não é enumerável); `usuario`/Modo Usuário 403 sem consulta; sem tenant 400; sem reserva ativa `[]` sem consultar; erro de banco 500 genérico sem vazar; erro de escopo da matriz 500 sem consultar `material_items`; guardas estáticas (tenant e reserva no banco, tiebreak, hint nos dois selects, nenhum embed sem hint, `logFailure` ×2, select sem `tenant_id`/número de série).
Multi-sessão/Bearer (R-28): `/api/arsenal/*` está atrás do `authMiddleware`; Modo Usuário rebaixa a `usuario`, Bearer sem sessão é limitado a `usuario`; o `roleGuard` barra (`mode-user-auth-paths` 12/12; não duplicado).

## Contraprovas (arquivo restaurado, `cmp` conferido)
| # | Mutação | Resultado |
|---|---|---|
| M1 | sem filtro de reserva | DETECTED |
| M2 | sem filtro de tenant | DETECTED |
| M3 | reserva vinda do cliente | NOT_APPLICABLE (a rota não lê reserva do cliente) |
| M4 | admin_global sempre tenant-wide | DETECTED (por M1: filial confinada) |
| M5 | papel efetivo ignorado (`usuario` admitido) | DETECTED |
| M6 | erro de banco vira lista | DETECTED |
| R-41 | erro de escopo vira `[]` | DETECTED (2 testes) |
| M7 | limit antes do filtro | DETECTED indiretamente (os 350 itens de B/C à frente do limit só passam com o filtro no banco) |
| M8 | sem filtro de `disponivel` | DETECTED |
| M9 | embed sem hint | DETECTED (guarda estática: ×2 e nenhum sem hint) |
| M10 | sem `logFailure` | DETECTED (guarda estática: ×2) |
| atalho de escopo vazio | removido | DETECTED ("sem consultar material_items") |
Nota: as duas primeiras tentativas de duas mutações não aplicaram o padrão (contagem 0) e foram refeitas.

## Regressão
BFF unit 695/695 · integração 300/300 (inclui R-06, R-28, lotes 1–6, R-35, R-39, R-40, R-41, R-42/R-43) · web 366/366 · `tsc` BFF e web, `lint:logs`, `git diff --check` OK · hash R-35 intacto. Incidente: o teste estático existente `idor-read-scope` exige `.eq("tenant_id", tenantId)` imediatamente antes de `.eq("status_operacional", "disponivel")`; reordenei minha cláusula `.in("reserve_id")` para depois do status (o teste não foi alterado). E2E: BLOQUEADO_AMBIENTE.

## Reviews
- **Security:** nenhum achado ≥ 8 no diff (escopo só da sessão; `?q` e `?for` só acrescentam filtros sobre a mesma query; fail-closed). **Pré-existentes, independentes, confiança 8/10, NÃO corrigidos:** **R-48** (`PATCH /api/arsenal/items/:id/ocorrencia` não compara a reserva do item com a sessão: armeiro de A altera item de B) e **R-49** (`POST /api/cautelamentos` valida o item só por tenant e confia em `body.reserve_id`: armeiro de A cautela item de B; `POST /:id/troca` parecido, 7/10). `cautelamentos.ts` é arquivo da WIP_BIOMETRIA: coordenar antes de corrigir o R-49.
- **Code review:** 0 CRÍTICO, 0 ALTO introduzido (confirmou a regra = RLS `material_items_staff_select`, filtro antes do limit, erro vs vazio, shape dos consumers, sem colisão WIP). O ALTO que ele cita é o mesmo dos writes (R-48/R-49).
  - MÉDIO (rótulo por `current_unit_id` × filtro por `reserve_id`): **corrigido**: o embed agora usa `reserves!reserve_id` (guarda estática atualizada).
  - MÉDIO (seletor de reserva do formulário de cautela × lista só da reserva ativa; D-01): **registrado**: quem tem várias memberships só recebe itens da reserva ativa; o seletor do formulário pode oferecer outra reserva, e o POST (R-49) não impede o desalinhamento. Corrigir exige alterar `_cautelas-client.tsx` e o POST (fora do R-46).
  - BAIXOS registrados: limite de 300 sem busca no servidor no seletor de cautela (pré-existente); `q` sem tamanho máximo nem escape de `%`/`_` (agora confinado à reserva); o fake não valida embed/hint (smoke contra PostgREST real fica `BLOQUEADO_AMBIENTE`).

## Limitações
- O filtro e o rótulo exibido usam a mesma coluna (`reserve_id`, a reserva dona).
- O fake não ordena nem projeta colunas nem valida embeds; ordem e embed só têm guarda estática.
- Com o isolamento desligado a RLS era tenant-inteiro; o BFF sempre confina (padrão dos lotes 3–6).

## Status
**R-46: DONE_VERIFIED_REPO_PENDING_DEPLOY.** R-34/R-37 PARTIAL_IMPLEMENTATION; R-44, R-45 OPEN; R-47 OPEN/a confirmar; Batch 7 NOT_STARTED. Novos: R-48, R-49.
