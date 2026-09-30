# EVIDENCE — R-41: `scopedReserveIds` falha fechado

## Estado inicial
| Campo | Valor |
|---|---|
| Branch / HEAD inicial | `claude/bold-planck-6xy9fc` / `28dd443` (R-40); cca1d51, 9dde70b, 13eb82b, f6a0117, fb9a008 presentes |
| `origin/main` | `70c3fa7` (inalterado; não mesclado) |
| Árvore inicial | limpa |
| WIPs | `cautelamentos.ts` e `shifts.ts` (WIP_BIOMETRIA) **não editados**; `worktree-biometric-unify-ssa` intacta |
| Migration R-35 | sha256 `d63f4b5e…551b5b`, intacta; nenhuma migration; produção não acessada |

## Definição e callers
`scopedReserveIds(role, reserveId, tenantId)` em `apps/bff/src/lib/reserve-scope.ts`. Matriz (admin_global/auditor sem reserva ativa) consulta `reserves` por `tenant_id`; os demais devolvem `[reserveId]` ou `[]` sem consultar o banco.
Callers em `routes/`: `handovers.ts` (GET), `lendings.ts`, `ocorrencias.ts`, `ssa.ts`, `saidas.ts`, `cautelamentos.ts`, `shifts.ts`, `dashboard.ts` (`resolveDashboardScope`). Todos chamam com `await` direto, fora de try/catch, e tratam `[]` como "nenhum resultado". `categories.ts` tem uma **cópia local** (fora do escopo, ver R-44).

## R41_REPRODUCED = YES
```
error da query de reserves → `logger.error(...); return []` → caller trata [] como "sem resultado" → 200
```
BEFORE (handler real, matriz `admin_global` sem reserva ativa, consulta de `reserves` com erro `57014`): **`R41_BEFORE_DB_ERROR = HTTP_200_EMPTY`** — status 200, corpo `{"handovers":[]}`; query que falhou: `reserves` filtrada por `tenant_id`. Com o código antigo falharam 3 testes novos: o helper não lança, o endpoint devolve 200 e a guarda estática.

## Vazio legítimo ≠ falha
| Estado | Antes | Agora |
|---|---|---|
| Consulta ok, tenant sem reservas | `[]` | `[]` (sucesso vazio → 200 `[]`) |
| Filial / não-matriz | `[reserveId]` / `[]` (sem consulta) | igual |
| Consulta falhou | `[]` (indistinguível) | lança `ReserveScopeLookupError` |

## Correção
- `ReserveScopeLookupError` (mensagem fixa, `code` do banco; o texto cru fica só no `logger.error` existente).
- `GET /api/handovers`: `try/catch` só do `ReserveScopeLookupError` → `logFailure("handovers.list.scope_failure")` + **500** `{"error":"Erro ao buscar passagens"}`, **sem consultar `service_handovers`**; outros erros sobem.
- Demais callers **não foram editados**: o erro sobe ao `app.onError` (500 genérico `Internal server error` + `requestId`, log `http.unhandled_error`). Isso evita tocar `cautelamentos.ts`/`shifts.ts` (WIP_BIOMETRIA) e mantém o formato de sucesso idêntico.
- POST (R-40) e handlers `/:id` (R-42/R-43) sem alteração.

## AFTER
| Cenário | Resultado |
|---|---|
| Matriz, consulta ok | só reservas do tenant da sessão (nem B1, nem a de mesma `reserve_id` em outro tenant) |
| Tenant sem reservas, consulta ok | 200 `[]` |
| Matriz, erro na consulta | 500 genérico; sem `secret_table`/texto do banco; `service_handovers` **não** consultada |
| Filial (admin_reserva A1) | só A1; não depende da consulta de `reserves` (ok mesmo com ela quebrada) |
| `usuario`/Modo Usuário | 403, sem nenhuma consulta |
| `GET /api/lendings` (outro caller), erro no escopo | 500 e `lendings` não consultada |
Limit/ordem/desempate por id e membership (lote 4/R-40) não foram tocados; regressão verde.

## Mutações (arquivos restaurados e conferidos com `cmp`)
| # | Mutação | Resultado |
|---|---|---|
| M1 | helper volta a `return []` | **DETECTED** (3 testes: helper, endpoint, outro caller) |
| M2 | caller deixa o erro subir sem tratamento | **DETECTED** (corpo/`logFailure` esperados) |
| M3 | caller converte erro em `[]` | **DETECTED** (500 esperado) |
| M4 | segue para a consulta de handovers após a falha | **DETECTED** (teste de não continuação) |
| M5 | remove o `logFailure` | **DETECTED só por guarda estática** (não há asserção do log emitido; limitação) |

## Regressão
BFF unit 695/695 · integração 229/229 · web 340/340 · `tsc` BFF e web, `lint:logs`, `git diff --check` OK · hash R-35 intacto. E2E: BLOQUEADO_AMBIENTE.

## Reviews
- **Security:** nenhum achado ≥ 8; nenhum caller engole o erro; sem vazamento (resposta genérica). Pré-existente independente → **R-44** (cópia local em `categories.ts`, fail-closed por retorno vazio, BAIXO).
- **Code review:** 0 CRÍTICO, 0 ALTO; confirmou que os 8 callers não têm try/catch e que o erro sobe ao `app.onError`.
  - MÉDIO 1 (`constructor(readonly code)` é parameter property, não suportado pelo runner `node --experimental-strip-types`; quebraria qualquer teste unitário que importasse o helper): **corrigido** (campo declarado e atribuído no corpo); confirmado importando sob strip-types.
  - BAIXO 2 (os testes montam um Hono sem o `onError` de produção; o teste do `lendings` só confere status 500): **registrado como limitação**; BAIXO 3 (M5 só por guarda estática): registrado.

## Limitações
- Callers além do handovers respondem pelo `app.onError` genérico, sem `logFailure` próprio; o helper já loga com `code`/`error`.
- Mudança de comportamento: nos callers antigos, falha de banco passa de 200 vazio para 500 (intencional).
- Prova com banco em memória; o `logFailure` do handovers só tem guarda estática.

## Status
**R-41: DONE_VERIFIED_REPO_PENDING_DEPLOY.** R-42/R-43 OPEN; R-34/R-37 PARTIAL_IMPLEMENTATION. Novo: R-44.
