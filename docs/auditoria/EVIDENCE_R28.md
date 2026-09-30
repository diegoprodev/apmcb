# EVIDENCE — R-28: Modo Usuário por sessão (D-02)

> Histórico: em `7b38868` este item ficou em BLOCKED_PRODUCT_DECISION. A decisão D-02 (abaixo) destravou a correção.

## Estado inicial
| Campo | Valor |
|---|---|
| Branch | `claude/bold-planck-6xy9fc` |
| HEAD | `7b38868` (docs R-28 bloqueado) sobre `9665c8f` (R-06) |
| `main` | `5f91635`, ancestral de HEAD |
| Working tree | limpo |
| `middleware/auth.ts` | última mudança em 09-23 (`38d9185`, `c9c5b62` — AuthProvider); nenhuma ref (inclusive `ops/vps-env-storage`, `worktree-biometric-unify-ssa`) com mudança concorrente |

## DECISÃO D-02
"Modo Usuário é um **contexto operacional de redução de privilégios**, com **escopo por sessão**. Enquanto uma sessão estiver com `activeMode = usuario`, todas as requisições daquela sessão têm papel efetivo `usuario`."

Ele **não é**:
- MFA nem reautenticação;
- trava global por usuário, nem estado persistido por usuário;
- algo que afete outra sessão ou dispositivo;
- substituto de SoD.

Ele **não pode** ser contornado por Bearer que pertença ao fluxo daquela sessão web.

## ANTES
| Caminho | Papel efetivo |
|---|---|
| Cookie `apmcb_session` (iron-session) | `usuario` se `activeMode=usuario`; senão `session.role` — correto |
| Só Bearer (JWT Supabase), sem cookie | `profiles.role` — **Modo Usuário ignorado** |
| Cookie + Bearer | Cookie vence (identidade, papel, tenant, reserva vêm da sessão) |
| Rotas `/api/admin/*` e `/api/reserva/aging-count` do Next | `profiles.role` — **Modo Usuário ignorado** (service role) |
| Web: `admin/comando/_client.tsx` | só Bearer → métricas de staff em Modo Usuário |
| Web SSR: `admin/arsenal/solicitacoes`, `admin/livros`, `admin/saidas` | só Bearer |

Reprodução com handler real: `Authorization: Bearer <admin>` sem cookie → `GET /api/dashboard/command` **200** (staff).

## ARQUITETURA ESCOLHIDA
**Privilégio de staff só existe dentro de uma sessão web**, porque é a sessão que carrega o modo.
- **BFF (`middleware/auth.ts`)**: Bearer sem sessão autentica a identidade normalmente, mas o papel efetivo tem teto `usuario`. O caminho do cookie não muda.
- **Web, navegador**: os fluxos de staff mandam o cookie (`credentials: "include"`). Comando era o único que não mandava.
- **Web, SSR**: as páginas de staff repassam `apmcb_session` ao BFF (`lib/web-session.ts → bffSessionHeaders`), no mesmo padrão de `lib/verified-user.ts` e dos proxies Nexus.
- **Rotas de staff do servidor Next**: autorizam pelo papel **efetivo** da sessão (`resolveWebSessionRole`). Ele consulta `GET /api/session/info` e confere que `userId` é a identidade do JWT. Sem sessão, com outra identidade ou em caso de erro, nega (fail-closed).
- `GET /api/session/info` passa a devolver `userId`, para essa conferência.

## POR QUE NÃO PERSISTIR MODE USER POR USUÁRIO
- D-02 proíbe: o modo é da sessão. Persistir por usuário faria o Modo Usuário do celular rebaixar o notebook, que é exatamente o que o teste TWO_SESSIONS_SAME_USER proíbe.
- Exigiria migration e mudança em todas as policies, e `supabase/migrations/**` está fora do escopo.
- O JWT da Supabase identifica o usuário, não a sessão web. Nenhum dado no token diz "esta sessão está em Modo Usuário".
- Por isso a solução não "ensina o modo" ao Bearer. Ela tira do Bearer a capacidade de conceder staff.

## CONSUMIDORES BEARER
| Consumidor | Antes | Depois |
|---|---|---|
| Clientes do navegador com Bearer **e** `credentials: "include"` (usuarios ×2, saidas, cautelas, ocorrências, passagens ×2, saídas ×2, solicitações, reportar-ocorrência, verify-totp, SSA) | cookie vence | **inalterado**: o cookie continua vencendo; o Bearer é redundante |
| `admin/comando/_client.tsx` | só Bearer | só cookie (`credentials: "include"`); **Bearer e prop `token` removidos** (o JWT sai do payload RSC) |
| SSR `admin/arsenal/solicitacoes`, `admin/livros`, `admin/saidas` | Bearer | repassam `apmcb_session` (**Bearer removido**) |
| SSR `efetivo/page.tsx`, `efetivo/minhas-cautelas` | Bearer (papel = `profiles.role`) | Bearer **preservado**; papel efetivo `usuario`, que é o que a rota (`/cautelamentos/ativos`) pede → corrige R-32 |
| `app/api/mode/route.ts` → `POST /api/session/mode` | Bearer | **removido**: proxy sem chamadores (o toggle chama o BFF direto com cookie). O ramo Bearer de `/mode` criava uma iron-session nova de staff (sem `sessionId`, logo não revogável; sem tenant e sem CSRF). Era um bypass em 2 requisições (achado CRÍTICO do code-review) e também foi **removido**: `/mode` exige sessão (401 + log `session.mode.denied_without_session`) |
| Pentest do BFF (`__tests__/pentest`) e E2E Playwright (Node `fetch` com Bearer) | Bearer | migrados para sessão web via exchange (`pentest-fixtures.sessionHeaders`, `e2e/harness/bff-session.ts`). Continuam com Bearer, de propósito: negativos 401 (JV-NXS-03, JV-AUTH-05, TT09), militar (`ssa-approval`) e `page.request` com cookie do contexto (VF30, `harness/ssa.ts`) |
| Mobile, CLI, integração externa | não existem | — |
| Bridge Windows | device-auth Ed25519 (não usa Bearer de usuário) | — |
| ON_PREMISE | Bearer → 501 | inalterado |

Bearer segue válido como **autenticação**, com capacidade de `usuario`: branding, próprias cautelas etc.

## IDENTIDADE MISTA
- **BFF**: com sessão válida, identidade, papel, tenant e reserva vêm **só** da sessão, e o Bearer é ignorado. Provado nos dois sentidos: cookie de usuario com Bearer de admin, e cookie de admin com Bearer de usuario.
- **Next**: `resolveWebSessionRole(user.id)` nega quando a sessão do BFF pertence a outra identidade (`userId` diferente do JWT). A negação é logada como `[web-session] sessão do BFF é de outra identidade`.

## MULTI-SESSION
O modo continua **só na iron-session**; nada foi persistido por usuário. O teste TWO_SESSIONS_SAME_USER roda duas sessões seladas do mesmo usuário:
- A, em Modo Usuário → 403;
- B, staff → 200;
- A de novo → 403;
- `/info` de B → `admin_global`.

## CORREÇÃO
| Arquivo | Mudança |
|---|---|
| `apps/bff/src/middleware/auth.ts` | Bearer sem sessão: `role = "usuario"`, antes `profiles.role`; log `auth.bearer_role_capped` quando o teto rebaixa staff. Comentário falso sobre `apmcb_mode` corrigido (R-33) |
| `apps/bff/src/routes/session.ts` | `/info` devolve `userId`; `POST /mode` exige iron-session (fallback Bearer removido) |
| `apps/web/src/app/api/mode/route.ts` | removido (proxy morto) |
| `apps/web/src/lib/web-session.ts` (novo) | `bffSessionHeaders()`, `resolveWebSessionRole(expectedUserId)` |
| `apps/web/src/app/(dashboard)/admin/comando/_client.tsx` | `credentials: "include"` |
| `admin/arsenal/solicitacoes/page.tsx`, `admin/livros/page.tsx`, `admin/saidas/page.tsx` | SSR repassa a sessão, sem Bearer; loga quando o BFF recusa |
| `app/api/admin/{almoxarifado,users,search-profiles}/route.ts`, `app/api/reserva/aging-count/route.ts` | papel efetivo da sessão em vez de `profiles.role` (R-31) |

## CONTRAPROVA
| Suite | Código antigo | Corrigido |
|---|---|---|
| BFF `mode-user-auth-paths.test.ts` (12), com `auth.ts` e `session.ts` antigos | **6 / 4** nos 10 primeiros casos: MODE_USER_BEARER_ONLY 200, MIXED_IDENTITY ×2 sem `userId`, R-32 403 | **12 / 0** |
| Só o `middleware/auth.ts` antigo (com `session.ts` novo) | 8 / 2 (bypass, R-32) | — |
| Só o `routes/session.ts` antigo | 9 / 3 (MODE_ENDPOINT_BEARER_ONLY: 200 + Set-Cookie de staff; MIXED_IDENTITY ×2) | — |
| Web `mode-user-staff-routes.test.ts` (4) | **1 / 3**: Modo Usuário, identidade mista e sem sessão passavam como staff | **4 / 0** |
| Web `_client.test.tsx` (Comando) | FAIL (`credentials` undefined) | PASS |

## TESTES
BFF — `apps/bff/src/__tests__/integration/mode-user-auth-paths.test.ts`, usando `authMiddleware` e rotas reais com iron-session selada de verdade:

| Caso | Esperado | Resultado |
|---|---|---|
| STAFF_SESSION_NORMAL | 200 | PASS |
| MODE_USER_SESSION | 403; `/info` usuario | PASS |
| MODE_USER_SESSION_PLUS_BEARER | 403 | PASS |
| MODE_USER_BEARER_ONLY (bypass) | 403; `/info` usuario | PASS |
| STAFF_BEARER_LEGITIMATE (branding) | 200 | PASS |
| TWO_SESSIONS_SAME_USER | A 403 · B 200 · A 403 | PASS |
| MIXED_IDENTITY (sessão usuario + Bearer admin) | 403; identidade da sessão | PASS |
| MIXED_IDENTITY inversa | identidade/tenant da sessão admin; 200 | PASS |
| MODE_ENDPOINT_BEARER_ONLY (Bearer → `POST /mode staff`) | 401, sem Set-Cookie | PASS |
| MODE_ENDPOINT_SESSION (toggle legítimo da própria sessão) | usuario → 403; staff → 200 | PASS |
| R-32 (Bearer admin → `/cautelamentos/ativos`) | 200 | PASS |
| USUARIO_NORMAL | 403 / 403 / usuario | PASS |

Web:
- `lib/web-session.test.ts` (7): repasse do cookie, sem sessão, staff, MODE_USER → usuario, MIXED_IDENTITY → null, sem cookie sem fetch, 401/rede → null.
- `app/api/mode-user-staff-routes.test.ts` (4, handlers reais): staff passa do gate; MODE_USER_WEB_FLOW → 403/403/403/count 0; MIXED_IDENTITY → nega; sem sessão → nega.
- `admin/comando/_client.test.tsx` (1): `credentials: include` e **sem** header `authorization`.

| Regressão | Resultado |
|---|---|
| BFF unit (`node --test`, env CI) | 689/689 (teste de fiação de `/mode` ajustado: 3 asserções do fallback Bearer → 2 que provam que ele não existe) |
| BFF integração (`bun test src/__tests__/integration`) | 136/136 |
| BFF `tsc --noEmit` | OK |
| `pnpm lint:logs` | OK |
| Web `tsc --noEmit` (inclui `e2e/`) | OK |
| Web `vitest run` | 283/283 (39 arquivos) |
| ESLint nos arquivos alterados | 0 erros; 1 warning pré-existente (`react-hooks/set-state-in-effect` em `_client.tsx:84`, já existe em HEAD e em outros 48 pontos do repo) |
| `git diff --check` | OK |
| E2E Playwright e pentest dinâmico do BFF | **migrados, não executados**: batem em produção com as contas `@apmcb.dev` (proibido neste prompt; B-06). Precisam rodar no pós-deploy |

## R-06 REGRESSION
`dashboard-scope-real-handler.test.ts`: **20/20**. O escopo tenant/reserva não mudou. MODE_USER_PRIVILEGE continua bloqueado pelo `roleGuard`.

## R-31
Corrigido, por ser consequência direta de R-28: com o Bearer sem staff, essas rotas de service role eram o caminho web restante. O enforcement fica no servidor Next, que é quem executa a escrita com service role, e usa o papel efetivo da sessão do BFF. Não é bloqueio visual. Status: **DONE_VERIFIED**.

## R-32
Corrigido pelo próprio teto: o Bearer de admin_global no SSR de `/efetivo` agora tem papel efetivo `usuario`, que `/cautelamentos/ativos` aceita. `cautelamentos.ts` não foi alterado. Teste: R-32 → 200 (antes 403). Status: **DONE_VERIFIED**.

## R-33
- **Corrigido**: o comentário falso no `middleware/auth.ts` que dizia "o cookie é usado apenas pelo Bearer path" (estava no diff natural).
- **Confirmado**: `apmcb_mode` não é fonte de verdade. Nenhum caminho de autorização do BFF nem do Next lê esse cookie; a autorização vem de `session.activeMode`.
- **Removido**: o proxy `app/api/mode/route.ts` e o comentário falso que ele tinha.
- **Pendentes (fora do diff natural)**: expiração de 8h fixas contra sessão deslizante; `session.destroy()` não apaga `apmcb_mode`.

Status: **PARTIAL** (o resto é só divergência de UI).

## ACHADO NOVO — Supabase direto (PostgREST/RLS) com o JWT da sessão (R-34)
Introspecção read-only de produção (`pg_policies`, só SELECT): as policies de escrita para `authenticated` autorizam por `auth_role()`, isto é, `profiles.role`. Exemplos:
- `lendings` insert/update/delete;
- `cautelamentos` insert/update;
- `material_types` insert/update/delete;
- `profiles` insert/update;
- `service_shifts` insert/delete.

As de leitura seguem o mesmo padrão.

O JWT da Supabase da sessão web fica no cookie `sb-*`, legível pelo JS. Um titular em Modo Usuário pode chamar o PostgREST direto com esse JWT e agir como staff dentro das policies. Isso também explica por que as páginas SSR que leem o Supabase direto (18 arquivos em `(dashboard)/admin` e `reserva`) continuam renderizando dados de staff em Modo Usuário.

Nenhum fluxo do produto **escreve** direto pelo Supabase: as escritas vão pelo BFF ou pelas rotas de service role, agora cobertas.

Correção possível respeitando D-02: guardar o modo por **sessão de auth** (claim `session_id` do JWT) e fazer `auth_role()` retornar `usuario` quando essa sessão estiver em Modo Usuário. Isso exige migration e mudança de função/policies, o que é proibido neste prompt. Não foi testado de forma ofensiva em produção.

## WIP_INFRA
A mudança em `middleware/auth.ts` é de 1 linha lógica, mais comentários, no ramo Bearer. Não toca AuthProvider, `verifyAccessToken`, ON_PREMISE (501) nem o contrato de identidade. Nenhuma ref tem mudança concorrente no arquivo. Em `routes/session.ts`, `/info` ganhou `userId` e `POST /mode` perdeu o fallback Bearer, que usava o AuthProvider. Com isso a rota deixa de depender do AuthProvider, e o teste de fiação `auth-routes-provider-wiring` foi ajustado. O middleware continua usando o AuthProvider como antes. **Sem conflito.** WIP_BIOMETRIA, migrations, `cautelamentos.ts`, `shifts.ts`, SSA, R-05/R-08/R-25/R-29, DSE, `reserve_isolation_enabled` e as contas `@apmcb.dev`: não tocados.

## REVIEWS
**Code-review (sub-agente sênior, mandato do CLAUDE.md), 3 rodadas.**

Rodada 1: 1 CRÍTICO, 2 ALTO, 3 MÉDIO, 4 BAIXO.
- **C1**, `POST /api/session/mode` via Bearer criava sessão de staff (bypass do teto em 2 requisições): **corrigido**, com teste e contraprova.
- **A1**, pentest do BFF só com Bearer (negativos passariam pelo motivo errado; controles positivos quebrariam): **corrigido**. O harness usa sessão, e há um controle explícito "sessão ≠ 403, só Bearer = 403".
- **A2**, E2E com `fetch` só Bearer em rotas de staff: **corrigido** (16 specs migrados).
- **M1**, SSR engolindo recusa em silêncio: **logado**.
- **M2**, teto sem rastro: **log `auth.bearer_role_capped`**.
- **M3**, tenant/reserva das rotas Next vindo de `profiles`: **registrado**; é pré-existente.
- **B1**, Comando com Bearer e JWT no RSC: **removido**.
- **B2** (memoização) e **B3** (default de `BFF_URL`, que segue o precedente de `verified-user.ts`): registrados.

Rodada 2: produção OK; 2 ALTO nos testes migrados.
- **A1**, cookie de `/identify` concatenado ao da sessão em `saidas`/`item-integrity` (a iron-session leria o antigo): **corrigido**, o cookie agora substitui.
- **A2**, o pentest de downgrade ignorava o cache de 60s do guard: **corrigido**, o teste afirma a janela real (≤ 70s).
- **M1**, esta evidência: atualizada.
- **M2**, efeitos colaterais do exchange no harness (audit, alerta de dispositivo, reserva ativa, rate limit): **documentado** nos dois harness; uma sessão por token.
- Baixos: log via `c.get("log")` com `requestId`; comentário do toggle; `BFF_URL` importado de `e2e/harness.ts` (SSOT).
- **B4**, fora do escopo: `reserva/passagens` ainda passa o JWT ao cliente.

Rodada 3: **PASSOU, 0 CRÍTICO, 0 ALTO.**
- Residual acatado: o laço do teste de downgrade agora usa `GET /api/dashboard/stats`, que é só leitura, em vez de abrir turno.
- Comentário obsoleto em `saidas.spec.ts` removido.
- Registrados (BAIXO): M3 (tenant/reserva nas rotas Next vêm de `profiles`); memoização de `resolveWebSessionRole`; JWT no RSC de `reserva/passagens` (pré-existente); E2E e pentest precisam rodar antes de promover.

**Security-review** (skill, sub-agente): **nenhum achado com confiança ≥ 8**. Informativo: o fallback Bearer de `/mode`, que foi removido depois (C1).

## PRODUÇÃO
Só SELECT em `pg_policies` (introspecção). Nenhuma mutação, migration, db push, login ou E2E/pentest contra produção. As contas `@apmcb.dev` não foram usadas.

## STATUS
**R-28: PARTIAL.** Pelo critério do prompt, R-28 **não** fica DONE_VERIFIED.

| Pergunta | Resposta | Prova |
|---|---|---|
| Uma sessão em Modo Usuário recupera staff via Bearer no BFF? | **NÃO** | MODE_USER_BEARER_ONLY, MODE_USER_SESSION_PLUS_BEARER (403) |
| … via `POST /api/session/mode` com Bearer? | **NÃO** | MODE_ENDPOINT_BEARER_ONLY (401, sem Set-Cookie) |
| … via rotas de staff do Next (`/api/admin/*`, aging-count)? | **NÃO** | `mode-user-staff-routes.test.ts` |
| … via PostgREST/RLS direto com o JWT da sessão? | **SIM** | `pg_policies` (R-34), aberto |
| Outra sessão staff do mesmo usuário continua staff? | **SIM** | TWO_SESSIONS_SAME_USER |

- Fica fora do Modo Usuário, por desenho da D-02: abrir **outra** sessão com as próprias credenciais (login/exchange). A D-02 exclui reautenticação, e isso é multi-sessão, não contorno da sessão em Modo Usuário.
- R-31 e R-32: **DONE_VERIFIED**.
- R-33: **PARTIAL**.
- R-34 (novo): **BLOCKED_SCOPE**, porque exige migration de RLS, proibida neste prompt.
