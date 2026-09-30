# EVIDENCE — R-40: `POST /api/handovers` valida a reserva contra o tenant da sessão

## Estado inicial
| Campo | Valor |
|---|---|
| Branch / HEAD inicial | `claude/bold-planck-6xy9fc` / `fb9a008` (cca1d51, 9dde70b, 13eb82b, f6a0117, fb9a008 presentes) |
| `origin/main` | `70c3fa7` (inalterado; não mesclado) |
| Árvore inicial | limpa |
| Migration R-35 | sha256 `d63f4b5e…551b5b`, intacta; nenhuma migration criada |
| Produção | não acessada |
| WIPs | `handovers.ts` não consta no diff de `worktree-biometric-unify-ssa`; só o bloco `POST /` foi alterado (os `sign-*` ficaram intactos) |

## Finding e código vulnerável
`POST /api/handovers` (`roleGuard("armeiro","admin_reserva","admin_global")`): `body.reserve_id` (input do cliente) era usado para (1) a consulta de membership, dispensada para `admin_global`; (2) `generateTurnSnapshot`, que lê `reserves` por `id` sem tenant; (3) o INSERT com `tenant_id` da sessão e `reserve_id` do cliente. Nenhum passo confrontava a reserva com o tenant da sessão. É ali que o input do cliente virava autoridade.

## BEFORE — `R40_BEFORE_CROSS_TENANT = VULNERABLE`
Handler real, sessão: `admin_global` legítimo do tenant A, `body.reserve_id` = reserva do tenant B. Código antigo: **201**, `service_handovers` ganha uma linha com `tenant_id = A` e `reserve_id = B`, e o `report_snapshot` contém o nome da reserva de B. A tentativa de auditoria também disparou (falhou só por falta de tabela no fake). Dos 16 testes (antes do ajuste da membership), 8 falham no código antigo (tenant, snapshot, inexistente, mesma `reserve_id` em outro tenant, erro de lookup, tenant nulo, membership ≠ tenant, guarda estática).
Papéis afetados: `admin_global` (sem membership); `admin_reserva`/`armeiro` com membership "perdida" em reserva de outro tenant (a consulta de membership não olhava o tenant).

## Correção (somente `POST /`)
Ordem nova, tudo antes de qualquer efeito: tenant da sessão obrigatório (403) → reserva buscada por `id` **e** `tenant_id` da sessão (`maybeSingle`) → erro de banco: `logFailure("handovers.create.reserve_lookup_failure")` + 500 genérico → não encontrada: `logRejection` + 404 (igual para inexistente e outro tenant, sem enumeração) → membership (inalterada; `admin_global` segue dispensado dentro do próprio tenant) com `logRejection` na recusa → snapshot (recebe o tenant da sessão, sem `?? ""`) → insert → auditoria. O tenant nunca vem da reserva enviada.

## AFTER
| Cenário | Resultado |
|---|---|
| `admin_global` A, reserva A2 (sem membership) | 201; linha no tenant A, reserva A2 |
| `admin_global` A, reserva de B | 404, nenhuma escrita, sem vazamento |
| Reserva inexistente | 404 idêntico ao cross-tenant |
| Mesma `reserve_id`, sessão do tenant B | 201 só para B; A recebe 404 |
| Erro de banco no lookup | 500 genérico, fail-closed, sem escrita |
| Sem tenant na sessão / `reserve_id` inválido | 403 / 400, sem escrita |
| `admin_reserva` e `armeiro` com membership | 201 (preservado) |
| Sem membership em reserva do próprio tenant | 403 (autorização ≠ tenant) |
| Membership em reserva de outro tenant | 404 (membership não substitui tenant) |
| `usuario` e Modo Usuário (papel efetivo `usuario`) | 403, sem escrita |

**Sem efeito colateral:** nos casos negados, `service_handovers` continua com 0 linhas, **zero INSERT em qualquer tabela** (handover e auditoria) e **zero RPC**. A passagem não tem itens próprios (só `report_snapshot`), então "itens" não se aplica.
**Sessão/Bearer/Modo Usuário:** `/api/handovers/*` está atrás do `authMiddleware` (`index.ts`); Modo Usuário rebaixa o papel efetivo a `usuario` e Bearer sem sessão é limitado a `usuario`; o `roleGuard` barra ambos. Prova compartilhada em `mode-user-auth-paths` (12/12); não reimplementado.

## Contraprovas (arquivo restaurado e conferido com `cmp`)
| # | Mutação | `MUTATION_DETECTED` | Testes |
|---|---|---|---|
| M1 | lookup sem `tenant_id` | YES | 6 (cross-tenant, snapshot, inexistente, mesma `reserve_id`, membership≠tenant, guarda estática) |
| M2 | aceita reserva não encontrada no tenant | YES | 5 |
| M3 | membership ignorada para todos | YES | G e I |
| M3b | exigir membership também de `admin_global` (mede a regra de negócio) | YES | A e C |
| M4 | validação movida para depois da escrita | YES | 5 (inclui a prova de ausência de efeito) |
| M5 | `roleGuard` admite `usuario` | YES | J/K |
| M8 | sem guarda de tenant nulo | YES | tenant nulo |
| M9 | erro de lookup ignorado (fail-open) | YES | E |
Não aplicável: "profile.role no lugar do papel efetivo": a rota lê o papel do `authMiddleware`.

## Regressão
BFF unit 695/695 · integração 216/216 (inclui GET de handovers do lote 4, R-06, R-28, lotes 1–3, R-39, R-35) · web 340/340 · `tsc` BFF e web, `lint:logs`, `git diff --check` OK · hash R-35 intacto. E2E: BLOQUEADO_AMBIENTE.

## Reviews
- **Security:** nenhum achado ≥ 8 no diff. Pré-existentes independentes, registrados e **não corrigidos**: **R-42** (handlers `/:id` fail-open com tenant nulo) e **R-43** (escopo só por tenant, sem reserva; `entrando_id` sem validação; updates sem condição de status).
- **Code review:** 0 CRÍTICO, 0 ALTO (confirmou ordem, fail-closed, sem enumeração, TOCTOU coberto pelas FKs, GET e `sign-*` intactos).
  - MÉDIO 1 (teste não afirma a emissão do evento de auditoria; o fake não tem `audit_events`): **registrado como limitação**; emular a hash-chain de auditoria no fake foge ao R-40.
  - BAIXO 3 (erro da consulta de membership era descartado e virava 403): **corrigido** (`logFailure("handovers.create.membership_failure")` + 500, com teste; 17 testes agora).
  - BAIXO 2 (snapshot relê `reserves` só por id; defesa em profundidade com `.eq(tenant_id)`): **registrado**; `lib/snapshot.ts` é DOCUMENT_ENGINE e o lookup da rota já confina a reserva.
  - BAIXOS 4–5 (guarda estática por texto; log das negações sem asserção): registrados.

## Limitações
- Prova com banco em memória, não PostgREST real; a auditoria persiste em tabelas de hash-chain que o fake não tem (o efeito é medido por INSERTs e RPCs observados).
- TOCTOU entre o lookup e o insert: a reserva não muda de tenant por ação do cliente; a FK de `reserve_id` cobre remoção.
- A regra "não-matriz só na reserva ativa" não foi imposta: D-01 permite várias reservas por membership; fica como decisão de produto.
- R-41 (`scopedReserveIds`) intocado.

## Status
**R-40: DONE_VERIFIED_REPO_PENDING_DEPLOY.** R-34/R-37 seguem PARTIAL_IMPLEMENTATION; R-41 OPEN.
