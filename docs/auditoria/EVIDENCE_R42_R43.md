# EVIDENCE — R-42 / R-43: handlers `/:id` de handovers

## Estado inicial e decisão
| Campo | Valor |
|---|---|
| Branch / HEAD inicial | `claude/bold-planck-6xy9fc` / `54a63cd` (28dd443, 8489f2c, 54a63cd presentes) |
| `origin/main` | `70c3fa7` (inalterado; não mesclado) |
| Árvore inicial | limpa |
| WIP_BIOMETRIA | `worktree-biometric-unify-ssa` **não modifica** `routes/handovers.ts` (só `biometric-*`, `shift-auth`, `cautelamentos`, `saidas`, `shifts` etc.); o commit `4b6438d` toca apenas `lib/biometric-proof.ts` e seu teste |
| WIP_INFRA_HIBRIDA | não tocada |
| Migration R-35 | sha256 `d63f4b5e…551b5b`, intacta; nenhuma migration; produção não acessada |
| **R42_R43_DECISION** | **GO** (sem colisão textual; correção limitada a `handovers.ts`; sem schema; ressalvas R-43B e R-45 abaixo) |

## Mapa dos handlers `/:id` (antes → depois)
| Handler | Guard de papel | Tenant | Reserva | Status / UPDATE |
|---|---|---|---|---|
| GET `/:id` | armeiro, admin_reserva, admin_global, auditor | `if (tenantId && …)` → **403 sem tenant + comparação estrita** | só tenant → **escopo de reserva** (armeiro: participação, inalterada) | leitura |
| GET `/:id/pdf` | idem | idem | idem | leitura |
| POST `/:id/sign-exit` | armeiro, admin_reserva, admin_global | idem | identidade (`saindo_id`) | UPDATE sem condição → **tenant+status+assinatura vazia, linhas conferidas** |
| POST `/:id/assign-entry` | admin_reserva, admin_global | idem | só tenant → **escopo de reserva** | `entrando_id` sem validação → **validado**; UPDATE condicionado |
| POST `/:id/sign-entry` | armeiro, admin_reserva, admin_global | idem | identidade (`entrando_id`) | UPDATE condicionado |
| POST `/:id/report-divergence` | idem | idem | participante: identidade; admin: **escopo de reserva** | UPDATE condicionado |
| GET `/:id/verify` | **público** (QR code) | n/a | n/a | inalterado, intencional |

## BEFORE (código antigo, handler real; 16 de 23 testes falham; 1 deles por limitação do fake, ajustado depois)
- `R42_REPRODUCED = YES` (no handler): sessão de staff com `tenantId` nulo lê a passagem de outro tenant (GET `/:id`) e passa na checagem nos POSTs. Alcançabilidade real: o `authMiddleware` aceita `tenantId = session.tenantId ?? null`; exige uma sessão de staff sem tenant.
- `R43_A_REPRODUCED = YES`: `admin_reserva` ativo em A1 lê (GET e PDF) e atribui/reporta em passagem de A2 (mesmo tenant).
- `R43_B_REPRODUCED = YES`: `entrando_id` inexistente, de outro tenant, sem papel de staff ou sem membership na reserva era aceito.
- `R43_C_REPRODUCED = YES`: com transição concorrente entre leitura e UPDATE, o UPDATE sem condição sobrescrevia o status (200).
- `R43_D_REPRODUCED = YES`: UPDATE com zero linhas ou erro respondia sucesso.
- Já protegidos antes (passam no código antigo): tenant diferente (404), fluxo legítimo de matriz/admin e a participação do armeiro.

## Correção (somente `routes/handovers.ts`; helpers locais)
- `requireSessionTenant`: tenant ausente → 403 `{error:"sem tenant"}` + `logRejection`, **antes** de ler a passagem; comparação de tenant sempre estrita.
- `reserveInScope` = `canAccessResourceReserve(role, reservaAtiva, reserve_id da passagem)`: mesma regra por-ID do resto do BFF (matriz = tenant; demais = reserva ativa). 404 igual ao de tenant diferente (sem enumeração). Armeiro continua pela regra de participação; `sign-*` continuam presos à identidade.
- **R-43B**, `assign-entry`: o entrante precisa existir com `default_tenant_id` = tenant da sessão, ter papel `armeiro|admin_reserva|admin_global` (os que passam no roleGuard do `sign-entry`) e, exceto `admin_global`, membership de staff na reserva da passagem. **Regra inferida por simetria com o POST do R-40 (não documentada como regra de produto)**; 422 `"Armeiro entrante inválido para esta reserva"`, falha de banco → 500 genérico com `logFailure`.
- `transitionFailure` (R-43C/D): UPDATE `.eq(id).eq(tenant_id).eq(status, esperado)` (+ `.is(assinatura, null)` nos `sign-*`) + `.select("id")`; zero linhas → 409 `"A passagem mudou de estado; recarregue a página"` com log `handovers.transition_lost`; erro → 500 genérico + `logFailure`.
- Não alterados: POST (R-40), GET lista e `scopedReserveIds` (R-41), `verify`, TOTP, hashes, snapshot, assinaturas (apenas o UPDATE final).
- `fake-postgrest.ts`: ganhou `update()` (aplica nas linhas filtradas e as devolve), para provar o UPDATE.

## AFTER (24 testes)
tenant ausente → 403 em todos os handlers, sem escrita nem RPC; tenant diferente → 404; mesma tenant/outra reserva → 404 sem escrita (admin_reserva e admin_global em filial); matriz e admin na própria reserva → preservados; `entrando_id` inexistente/outro tenant/sem membership/sem papel de staff (inclui perfil `usuario` com membership de staff) → 422 sem escrita; `admin_global` entrante isento de membership; status inválido → 422; transição concorrente → 409 sem sobrescrever; passagem sumida (zero linhas) → 409; erro do UPDATE → 500 sem vazar; entrante participante reporta divergência por identidade. **Sem efeito colateral** nos negados: zero INSERT/UPDATE e zero RPC.
**Modo Usuário/Bearer:** `/api/handovers/*` está atrás do `authMiddleware`; Modo Usuário rebaixa a `usuario`, Bearer sem sessão é limitado a `usuario`; o `roleGuard` barra ambos (`mode-user-auth-paths` 12/12; não duplicado).

## Contraprovas (arquivo restaurado, `cmp` conferido)
| # | Mutação | Resultado |
|---|---|---|
| M1 | GET `/:id` volta ao padrão `if (tenantId && …)` | DETECTED (T1) |
| M1' | helper devolve `""` para tenant ausente | equivalente (os chamadores já negam valor falso) |
| M2 | `reserveInScope` sempre verdadeiro | DETECTED (3) |
| M3a | entrante sem membership aceito | DETECTED |
| M3b | entrante sem filtro de tenant | DETECTED |
| M3c | entrante sem checagem de papel | DETECTED (só depois de criar perfil `usuario` com membership de staff) |
| M4 | UPDATE sem condição de status | DETECTED (concorrência + guarda estática) |
| M5 | ignora zero linhas | DETECTED (3) |
| M6 | tenant derivado do objeto em vez da sessão | DETECTED (T2) |

## Regressão
BFF unit 695/695 · integração 253/253 · web 340/340 · `tsc`, `lint:logs`, `git diff --check` OK · hash R-35 intacto. E2E: BLOQUEADO_AMBIENTE. Incidente: o teste estático existente `idor-read-scope` procura `"Acesso negado"` numa janela de 2000 caracteres do GET `/pdf`; minhas linhas a empurraram para fora. Corrigi reordenando o bloco e encurtando a mensagem 403 (o teste não foi alterado).

## Reviews
- **Security:** sem bypass de tenant, reserva, Modo Usuário ou Bearer; sem escalada via `entrando_id`. 1 achado ≥ 8, MÉDIO: assinatura órfã/duplicada quando o UPDATE condicional perde a corrida nos `sign-*` → **R-45** (OPEN). Era invisível antes (UPDATE perdedor ignorado, 200); agora a resposta é 409. Corrigir exige schema/transação.
  Pré-existentes abaixo do limiar, registrados no texto: `verify` público sem rate-limit; oráculo de existência dentro do tenant (403 vs 404); `GET /` lista ainda com `if (tenantId)` (contido pelo `.in(reserve_id)`); entrante com membership revogada depois do assign ainda assina por identidade.
- **Code review:** 0 CRÍTICO, 0 ALTO; confirmou que POST (R-40), lista (R-41) e `verify` não foram tocados, a ordem tenant → escopo → status → escrita e a ausência de vazamento.
  - MÉDIO 1 (assinatura órfã): **R-45**, já registrado. Mitigação barata aplicada: o contexto do log `handovers.transition_lost` dos `sign-*` agora traz `signatureId`, tornando a órfã rastreável. As mitigações (a) TOTP atômico, (c) revogação compensatória e (d) RPC/índice único foram **não aplicadas** (tocam TOTP/DOCUMENT_ENGINE ou exigem schema).
  - BAIXO 2 (o 409 prometia "tente novamente", mas o TOTP já foi consumido): **corrigido**, mensagem agora "recarregue a página".
  - BAIXO 3 (mensagem 403 `sem tenant` difere do POST; repetição em 6 handlers): registrado (a mensagem curta é necessária para o teste estático existente de janela de 2000 caracteres).
  - BAIXO 4 (a UI de `passagens/[id]` lista armeiros sem filtrar pela reserva da passagem; escolher um de outra reserva retorna 422): registrado como follow-up de UX, fora do escopo (página do lote futuro).
  - Regra B: o revisor confirmou que "validar entrante (tenant + membership)" já constava no ledger (R-43), então a regra tem lastro documental; o risco real é o armeiro de outra reserva cobrindo o turno, agora negado (fail-closed). **Antes do deploy, confirmar com o produto e conferir se há perfis de staff com `default_tenant_id` nulo ou divergente do `tenant_memberships`** (resultariam em 422).
  - Observações: `admin_reserva` sem reserva ativa na sessão passa a receber 404 nos `/:id` (consistente com a lista; sem teste dedicado); o revisor relatou "192 pass, 13 fail" na pasta de integração, que é uma execução sem as variáveis de ambiente de CI (a minha, com as variáveis, deu 253/253).

## Limitações
- Regra B inferida (decisão de produto pendente de confirmação).
- `sign-*` só têm teste de tenant nulo e cross-tenant (TOTP real pesado); a condição de status/assinatura vazia neles tem só guarda estática e as mutações no `assign-entry`/`report-divergence`.
- O fake não resolve embeds: o caso positivo de participação do armeiro não é exercitado.
- Assinatura órfã: R-45.

## Status
**R-42: DONE_VERIFIED_REPO_PENDING_DEPLOY. R-43: DONE_VERIFIED_REPO_PENDING_DEPLOY** (A/B/C/D no BFF, com ressalvas B inferida e R-45). R-44 OPEN; R-34/R-37 PARTIAL_IMPLEMENTATION. Novo: R-45.
