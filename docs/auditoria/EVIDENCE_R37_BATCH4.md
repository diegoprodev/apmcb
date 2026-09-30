# EVIDENCE — R-34 / R-37, lote 4 da C_HYBRID: `/reserva/passagens`

## Estado inicial e decisão
| Campo | Valor |
|---|---|
| Branch / HEAD inicial | `claude/bold-planck-6xy9fc` / `f6a0117` (cca1d51, 9dde70b, 13eb82b presentes) |
| `origin/main` | `70c3fa7` (PR #58, e-mail de convites; nenhum arquivo deste lote; não mesclado) |
| Árvore inicial | limpa |
| Migration R-35 | sha256 `d63f4b5e…551b5b`, intacta; nenhuma migration criada |
| WIPs | `worktree-biometric-unify-ssa` não toca `handovers.ts`, `passagens`, `reserves.ts` nem `web-session` |
| **BATCH4_DECISION** | **GO**, com escopo menor que o esperado: só a página SSR |

## Discovery
- **READ PATH (dados):** `_client.tsx` busca `GET /api/handovers` no BFF (Bearer + cookie). Esse endpoint já usa papel efetivo, `scopedReserveIds`, tenant e participação do armeiro (SP9.5). Não há leitura direta de passagens.
- **Leitura direta da página (antes):** `profiles.role` (autoridade) e `reserve_memberships` (`[0]`, limit 10, sem ordem) — dados do próprio usuário, mas decidiam acesso e reserva.
- **WRITE PATH:** `POST /api/handovers` e `sign-*` (BFF), não alterados. `_client.tsx` inalterado.
- **Relação com `[id]`:** página e componentes próprios; fora do lote, nenhuma dependência compartilhada alterada.
- **Semântica:** `service_handovers` tem UMA `reserve_id`, `tenant_id`, `saindo_id`, `entrando_id`, `status`. Não há reserva de origem/destino (testes D/E do prompt não se aplicam). Armeiro só vê as em que participa; admin_reserva/admin_global veem as da reserva ativa; matriz (admin_global sem reserva) vê o tenant, até 50.

## BEFORE (honesto quanto ao alcance)
`page.test.tsx` contra a página antiga: **10 de 12 falham**.
- BEFORE_STAFF: renderiza o casco com `profiles.role`.
- BEFORE_MODE_USER: o mesmo staff em Modo Usuário também recebia o casco de staff (papel do perfil, reservas e JWT no cliente); o BFF negava a listagem (403), então **não havia vazamento de passagens**, e sim de casco/autorização de UI e de reservas do próprio usuário.
- BEFORE_USUARIO / TENANT / RESERVE: a autorização da página dependia de `profiles.role`; a reserva escolhida era `memberships[0]`, não a ativa.

## Implementação
| Arquivo | Mudança |
|---|---|
| `reserva/passagens/page.tsx` | papel efetivo (`resolveWebSessionRole`, fail-closed por identidade); reserva de `GET /api/reserves/active` (lote 3); sem tabelas; sem `superadmin`; falha da reserva → `reserveId` null com log; `token` segue indo ao cliente (escrita, inalterada) |
| `apps/bff/src/routes/handovers.ts` `GET /` | desempate `order(id)`; 500 genérico com `logFailure("handovers.list.failure")` |
| `__tests__/helpers/fake-postgrest.ts` | `or()` passa a aceitar `eq` |
| `page.test.tsx` (12), `handovers-list-scope.test.ts` (12) | novos |

## AFTER
| Cenário | Resultado |
|---|---|
| Staff normal | casco com papel efetivo e reserva ativa da sessão |
| Modo Usuário | redirect `/reserva`; nada de casco/JWT; endpoint 403 |
| Usuário / papel elevado só no perfil / superadmin / auditor | redirect |
| Outro tenant; outra reserva; mesma `reserve_id` em outro tenant | nunca aparecem (60 linhas de A2 à frente não ocupam o limit) |
| `?reserve_id` do cliente | só refina dentro do escopo |
| Matriz / filial | matriz: tenant, máx. 50; admin_global em filial confinado |
| Sem reserva ativa não-matriz | lista vazia |
| Identidade divergente, sem cookie | fail-closed |

## Multi-sessão e Bearer (R-28)
Referenciado a `mode-user-auth-paths` (12/12): `/api/handovers/*` e `/api/reserves/*` ficam atrás do mesmo `authMiddleware`; Bearer é limitado a `usuario`. O Bearer que o cliente envia continua o mesmo de antes; o lote não adiciona Bearer.

## Mutações (arquivos restaurados e conferidos com `cmp`)
| # | Mutação | Detecção |
|---|---|---|
| M1 | sem `.eq(tenant_id)` | 4 testes (escopo A1, `?reserve_id`, matriz, N2) |
| M2 | sem `.in(reserve_id)` | 3 testes (A1, tenant B, N2) |
| M3 | sem filtro de participação do armeiro | teste do armeiro |
| M4 | `reserve_id` do cliente fora do escopo aceito | teste `?reserve_id` |
| M5 | roleGuard admite `usuario` | testes B e C |
| M6 | remover atalho de lista vazia | **equivalente** (`in.()` já devolve vazio); "sem reserva ativa" protege o resultado |
| P1 | sem autorização na página | 6 testes |
| P2 | conjunto de papéis amplo | 4 testes |
| P3 | ignora papel efetivo (Modo Usuário) | 7 testes |
| P4 | papel fixo repassado ao cliente | 2 testes |
| P5 | reserva sempre null | STAFF_NORMAL |
| P6 | BFF sem cookie | STAFF_NORMAL |

Limite: o fake não ordena; o desempate por `id` e o `logFailure` têm só guarda estática.

## Regressão
BFF unit 695/695 · integração 200/200 (inclui R-06, R-28, lotes 1–3, R-39, R-35) · web 339/339 · `tsc` BFF e web, `lint:logs`, eslint da página, `git diff --check` OK · hash R-35 intacto. E2E: BLOQUEADO_AMBIENTE.

## Reviews
- **Security:** nenhum achado ≥ 8 introduzido pelo lote. Achado **pré-existente e independente → R-40** (`POST /api/handovers`: `body.reserve_id` como autoridade, sem checar tenant; `admin_global` dispensa membership; snapshot lê `reserves` por `id`). Não corrigido: é write path e está fora do lote.
- **Code review:** 0 CRÍTICO; nenhum ALTO introduzido pelo lote. O revisor reiterou como ALTO o mesmo problema pré-existente do `POST /api/handovers` (R-40) e pediu tratamento: **registrado como R-40 (OPEN, com fix e teste propostos)** e não corrigido aqui porque o prompt proíbe alterar write path e DOCUMENT_ENGINE/snapshot. Não é "débito silencioso": está no ledger com teste necessário.
  - MÉDIO 2 (POST aceita reserva não ativa para membro de duas reservas): mesmo patch de R-40.
  - MÉDIO 3 (`scopedReserveIds` engole erro e devolve 200 vazio): **R-41**, arquivo SHARED_CRITICAL de sessão.
  - MÉDIO 4 (ordem só com guarda estática; falta índice composto): **limitação registrada**; o fake não ordena.
  - BAIXO 5 (botão Criar habilitado com `reserveId` null dá mensagem enganosa): exige alterar `_client.tsx` (write-adjacent); registrado. BAIXO 6 (mais casos de reserva ativa): **corrigido** (403 e id não-string). BAIXOS 7–9 (SSOT de papéis, `reserveIds` obsoleto no cliente, sem log no redirect por papel): registrados.

## Mudanças de comportamento
- `superadmin` deixa de acessar a página.
- Matriz com memberships não é mais limitada a `memberships[0]`: lista o tenant (o que o BFF já autorizava).
- A reserva do casco é a ativa da sessão, não `memberships[0]`.

## Status
**Lote 4: DONE_VERIFIED** (repositório). **R-34 e R-37: PARTIAL_IMPLEMENTATION**; faltam 13 páginas (ver ledger). Novos: R-40 e R-41.
