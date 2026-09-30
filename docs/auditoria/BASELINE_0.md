# BASELINE_0 — Andrômeda (baseline forense)

> Estado observado no início do processo de auditoria/remediação. **Nada de código foi alterado
> nesta sessão** — só este diretório `docs/auditoria/` foi criado.
> Convenção de evidência usada em todo o diretório:
> `CÓDIGO EXISTE` → `CÓDIGO INTEGRADO` → `FLUXO EXECUTÁVEL` → `FLUXO TESTADO` → `FLUXO COM EVIDÊNCIA`.
> "Confirmado estático" = lido no código, caminho de execução seguido, **sem** execução contra
> banco/BFF reais. "Confirmado por execução" = reproduzido localmente nesta sessão.

---

## 1. Identificação

| Campo | Valor |
|---|---|
| Data/hora | 2026-09-29 23:54 UTC (20:54 America/Recife) |
| Commit HEAD | `bf0aa0fae30921a6883ff9f4db02cc0b5082db97` — `feat(reserva,relatorios): rastreabilidade cross-turno — aging alert na UI (#54)` (2026-09-29 20:51 -0300) |
| Branch da sessão | `claude/bold-planck-6xy9fc` (idêntica a `main` e `origin/main` no HEAD acima) |
| Ambiente | Container cloud efêmero, clone fresco do GitHub (`diegoprodev/apmcb`) |
| `git status` | limpo — 0 modificados, 0 staged, 0 untracked |
| Worktrees | apenas o principal (`/home/user/apmcb`) |
| Tags | nenhuma |
| Submodules | nenhum |
| Commits em `main` | 67 (raiz `73e8198`, 2026-09-15 — ver §2.2) |

### 1.1 Limitação crítica desta baseline

Esta sessão roda num **clone novo na nuvem**. Mudanças **não commitadas**, **não pushadas**,
worktrees locais (`.worktrees/`, `.claude/worktrees/` — ambos no `.gitignore`) e stashes que
existam na máquina do desenvolvedor **não são visíveis daqui**. Tudo que está classificado como
WIP abaixo vem de **branches remotas**. Para fechar a baseline, rodar na máquina local e anexar
a saída a este arquivo:

```bash
git status --porcelain=v1 -b
git worktree list
git stash list
git branch -vv
git log --oneline origin/main..HEAD
```

---

## 2. Estado Git

### 2.1 Branches remotas relevantes (mesma linhagem de `main`)

| Branch | À frente / atrás de `main` | Último commit | Classificação |
|---|---|---|---|
| `worktree-biometric-unify-ssa` | 21 / 34 | 2026-09-29 20:46 | **WIP_BIOMETRIA** (ativa, 54 arquivos) |
| `docs/spec-identificar-usuario` | 7 / 3 | 2026-09-29 15:07 | WIP_ORIGEM_INCONCLUSIVA (só docs) |
| `ops/vps-env-storage` | 1 / 1 | 2026-09-24 09:24 | **WIP_INFRA_HIBRIDA** (workflow ops) |
| `fix/lending-rpcs-liveness-null` | 1 / 5 | 2026-09-23 22:27 | WIP_BIOMETRIA (migration **não mergeada**) |
| `fix/reserva-ativa-multi-reserva` | 0 / 2 | 2026-09-24 | mergeada (#53) |
| `feat/dialogo-biometria-fases` | 0 / 4 | 2026-09-23 | mergeada (#52) |
| `fix/erros-amigaveis-e-autostart` | 0 / 6 | 2026-09-23 | mergeada (#51) |
| `fix/biometria-saida-e-cadastro` | 0 / 8 | 2026-09-23 | mergeada (#50) |
| `fix/biometria-ui-e-bridge` | 0 / 10 | 2026-09-23 | mergeada (#49) |
| `hotfix/biometric-bridge-pair-500-on-null` | 0 / 24 | 2026-09-23 | mergeada (#48) |

Detalhes por frente em `WIP_REGISTRY.md`.

### 2.2 Reescrita de histórico (fato relevante)

`main` tem raiz em `73e8198` (2026-09-15). **28 branches remotas não têm ancestral comum com
`main`** (`git merge-base` vazio): são da linhagem anterior (458–703 commits cada), ex.
`feat/reserva-sp2`, `feat/reserva-sp7-*`, `biometric-bridge-phase*`, `fix/storage-egress`,
`feat/busca-usuario-por-email` (último commit: *"wip: … rota /api/diagnostico temp (remover
antes do merge)"*). Consequência: **nenhuma delas pode ser mergeada/rebaseada em `main`
diretamente** — só por cherry-pick/porte manual. Tratar como arquivo histórico; não apagar.

### 2.3 Commits recentes em `main` por frente

- **INFRA_HIBRIDA (já na baseline)**: `bbe0d3c`, `1b72eca`, `04100a1`, `1ff7d89`, `7044e78`,
  `a31da7e`, `e012550`, `461b738`, `38d9185`, `c9c5b62`, `a56909f`, `add1b8f`, `015ec78`,
  merge `39c5c2d` (Auth Provider Abstraction).
- **BIOMETRIA (já na baseline)**: `d1e305b`/`6e5969f`, `6a7d8ab`/`404f11b`, `fc1f6bc`/`da97cc1`,
  `469e514`/`f9cc709`, `513b4d0`/`8153752`, `f0b6a79`/`797865d`.
- **Rastreabilidade cross-turno**: `23170b6`, `bf0aa0f`.

---

## 3. Arquitetura encontrada (confirmada abrindo código)

Monorepo **pnpm 9 + turbo** (`pnpm-workspace.yaml`: `apps/*`, `packages/*`).

| Componente | Local | Tecnologia | Responsabilidade confirmada |
|---|---|---|---|
| Frontend | `apps/web` | Next.js (App Router), Cloudflare Pages/OpenNext, PWA (`src/app/sw.ts`) | UI staff (`/reserva`, `/admin`), UI usuário (`/efetivo`), Nexus superadmin (`/nexus`), verificação pública (`/v/*`), alguns route handlers (`src/app/api/*`) |
| BFF | `apps/bff` | Hono sobre **Bun** (`bun run src/index.ts`), Docker, VPS Hetzner atrás de Nginx | Toda regra de negócio; usa **service role key** (`services/supabase.ts`) → **bypassa RLS** |
| Bridge biométrica | `apps/bridge-windows` | .NET (WinForms tray), SDK NITGEN | Captura/matching local, polling de desafios no BFF |
| Shared | `packages/shared` | TS | Tipos/constantes |
| Banco | `supabase/migrations` (178 arquivos) | Supabase Postgres + RLS + pg_cron + Storage + Realtime | Schema, RLS, RPCs `SECURITY DEFINER` |
| Edge Function | `supabase/functions/expire-requests` | Deno | Expiração de solicitações |
| Infra | `docker-compose*.yml`, `infra/nginx`, `infra/scripts`, `scripts/` | Docker Compose, Nginx, bash | Deploy BFF blue/green via SSH (`.github/workflows/ci-cd.yml`) |
| On-prem (parcial) | `supabase/onprem-bootstrap`, `apps/bff/src/lib/{infra-env,auth-provider*,local-auth-provider}.ts`, `MIGRATION_SPEC.md` | Postgres puro + bcrypt | Só autenticação abstraída (ver §7) |

### 3.1 Autenticação / sessão
- Login no BFF (`routes/auth.ts`) via `AuthProvider` (`SUPABASE` → GoTrue; `ON_PREMISE` → bcrypt
  em `public.usuarios`), selecionado por `AMBIENTE_INFRA` (obrigatório, sem default, fail-closed).
- Sessão **iron-session** (`apmcb_session`, HttpOnly, 8h, renovação deslizante) com
  `userId, role, tenantId, reserveId, activeMode, originalRole, csrfToken, sessionId, issuedAt`.
- Fallback **Bearer** (JWT Supabase) em `middleware/auth.ts` — resolve role em `profiles` e
  tenant com `tenant_memberships ... limit(1)` **sem ordenação**.
- `session-guard.ts`: invalida sessão se `profiles.role` mudou, `sessions_invalidated_at` ou
  `revoked_sessions`. Cache de 60 s. Falha na checagem de revogação → **fail-open com log**.
- CSRF por token dedicado (`middleware/csrf.ts`), rate limit (`middleware/rate-limit.ts`).

### 3.2 Autorização
- `roleGuard(...roles)` compara com o **papel efetivo da sessão** (= `profiles.role` global, ou
  `usuario` em Modo Usuário).
- Escopo de reserva no BFF é **manual** (service role ignora RLS): `lib/reserve-scope.ts`
  (`scopedReserveIds`, `canAccessResourceReserve`), `assertActorReserveAccess` em `lendings.ts`,
  `requireActiveShift(role, id, targetReserveId?)` em `lib/shift-guard.ts`.
- No banco: RLS por tenant/reserva (SP1–SP10) e RPCs com `assert_actor_in_reserve` —
  **dormentes se `tenants.reserve_isolation_enabled = false`**; o CHANGELOG (v49) registra que
  foi ligado no tenant PMPB em 2026-09-17/18. **Não verificado no banco nesta sessão**
  (Supabase MCP falhou a conexão) → INCONCLUSIVO.

### 3.3 Domínios mapeados (rota BFF → tabela principal)
Reservas (`reserves.ts`), usuários/perfis (`profiles.ts`, `admin.ts`), memberships
(`tenant_memberships`, `reserve_memberships`), cautelas (`cautelamentos.ts`), saídas/movimentações
(`lendings.ts`, `saidas.ts`), solicitações SSA (`ssa.ts` → `material_requests`), materiais/arsenal
(`arsenal.ts`, `categories.ts`, `inventory.ts`), ocorrências (`ocorrencias.ts`), Livro Digital /
turnos (`shifts.ts`, `lib/shift-events.ts`), passagem de serviço (`handovers.ts`), PDF
(`lib/pdf/*`), assinaturas (`signatures.ts`), TOTP (`totp.ts`, `lib/totp-guard.ts`), biometria
(`biometric*.ts`), notificações/push (`notifications.ts`, `push.ts`), auditoria
(`middleware/audit.ts`, `audit_events` com hash encadeado, `nexus.ts`), realtime SSE
(`realtime.ts`), e-mail transacional (`services/email.ts`, Resend), storage (fotos de perfil/material).

---

## 4. Serviços e dependências externas

| Serviço | Uso | Estado nesta sessão |
|---|---|---|
| BFF produção (`api.apmcb.pmpb.online`, VPS Hetzner) | Todo fluxo autenticado | **Indisponível (pagamento, previsão dia 3)** — e além disso a política de egress deste container bloqueia o host → `BLOQUEADO_BFF` |
| Supabase (`jepitcrkicwmvzrmllpn`) | DB/Auth/Storage/Realtime | MCP Supabase falhou (`ERR_PROXY_TUNNEL`) — sem leitura do banco real |
| Cloudflare Pages (`apmcb.pages.dev`) | Frontend | egress bloqueado neste container |
| Resend | E-mail | não testado |
| NITGEN SDK / hardware | Bridge | indisponível (sem Windows/.NET/hardware) |

---

## 5. Testes executados nesta sessão

| # | Teste | Comando | Resultado | Classificação |
|---|---|---|---|---|
| T1 | BFF unit (sem env) | `pnpm --filter @apmcb/bff test` | 598/602 — 4 arquivos falham no import: `Missing SUPABASE_URL` | CONFIGURACAO_LOCAL (CI injeta env dummy) |
| T2 | BFF unit (env dummy igual ao CI) | idem + env do `ci.yml` | **644/644 pass** | — |
| T3 | BFF typecheck | `tsc --noEmit` | pass | — |
| T4 | BFF gate OBS17 | `pnpm lint:logs` | pass (0 `console.*`) | — |
| T5 | BFF integração (mock) | `bun test src/__tests__/integration` | 85/89 sem `EMAIL_CHANGE_TOKEN_SECRET`; **89/89** com ele | CONFIGURACAO_LOCAL. Obs.: não hermético — um teste tenta rede real (`dummy.supabase.co` bloqueado) e mocks de `audit_events.order` ausentes geram `audit.persist.exception` sem falhar o teste (lacuna de asserção) |
| T6 | shared typecheck | `pnpm typecheck` | pass | — |
| T7 | Web typecheck | `tsc --noEmit` | pass | — |
| T8 | Web lint | `eslint` | 0 erros, 100 warnings | — (warnings pré-existentes, ex. `react-hooks/refs` em `use-last-truthy.ts`) |
| T9 | Web unit | `vitest` | **271/271 pass** (36 arquivos) | — |
| T10 | Web build | `pnpm build` (env placeholder do CI) | **pass** (`Compiled successfully in 49s`) | Obs.: o build **reescreve `apps/web/public/sw.js`, que é versionado** → todo build suja o working tree (revertido nesta sessão com `git checkout -- apps/web/public/sw.js`, artefato gerado pela própria sessão) |
| T11 | Cadeia de migrations em Postgres 16 local descartável | shim on-prem + 178 migrations | aplica 2/178; falha em `20260611000003_seed_dev.sql` (`auth.users.encrypted_password` inexistente) | WIP_INFRA (comportamento **declarado** no próprio shim) |
| P1 | Sonda `hashDocument` | script local | **hash idêntico para conteúdos diferentes** | BUG_PROVAVEL → confirmado (R-01) |
| P2 | Sonda janela TOTP (otplib 13.4.1, `afterTimeStep:1`) | script local | aceita só o passo atual; código do passo anterior (-30 s) rejeitado | comentário do código diz "±1 step" — divergência (R-12) |

### 5.2 Testes **não** executados

| Teste | Motivo | Classificação |
|---|---|---|
| Playwright E2E (`apps/web/e2e`, 91 arquivos, 20+ projects) | `baseURL` default = produção (`apmcb.pages.dev`) + BFF prod; egress bloqueado | BLOQUEADO_BFF (e **inseguro**: escreve em prod) |
| Pentest (`test:pentest`) | Roda contra BFF real com contas reais; comentário no próprio teste registra que já alterou dado de produção | BLOQUEADO_BFF / inseguro |
| `ci:reserve-gates` | exige `SUPABASE_URL`/service key reais | DEPENDENCIA_INDISPONIVEL |
| `supabase/tests/reserve_isolation_canary.sql` | desenhado para rodar **em produção** dentro de `BEGIN…ROLLBACK` | DEPENDENCIA_INDISPONIVEL |
| Bridge .NET (`BridgeClient.Tests`) | `dotnet` não instalado no container | DEPENDENCIA_INDISPONIVEL |

**Observação estrutural**: não existe hoje suíte de banco **local** (Postgres/Supabase local)
para RLS/RPCs. Toda evidência de isolamento no banco vem de execuções contra produção
(documentadas no CHANGELOG/canary). Isso é um bloqueio de processo, não só do BFF.

---

## 6. Riscos evidenciados (resumo — detalhes e IDs em `REMEDIATION_LEDGER.md`)

| ID | Sev. | Risco | Tipo de evidência |
|---|---|---|---|
| R-01 | CRÍTICO | `hashDocument()` ignora todo o conteúdo do documento; toda cautela nova grava o **mesmo** `document_hash` (`1a7c0eab…ced9`) | **Confirmado por execução** (P1) |
| R-02 | CRÍTICO | Credenciais de contas com senha em texto no repositório (`admin@apmcb.dev`/`Admin@123`, admin_global) — o próprio repo afirma que existem em produção | Confirmado estático (texto do repo); estado atual em prod INCONCLUSIVO |
| R-03 | ALTO | TOTP de autoassinatura é obtível pela própria sessão (`GET /api/totp/code`) → não é segundo fator independente | Confirmado estático |
| R-04 | ALTO | Autoaprovação/autoentrega de solicitação SSA (Modo Usuário → staff) sem bloqueio | Confirmado estático; runtime BLOQUEADO_BFF |
| R-05 | ALTO | SSA `approve`/`reject`/`deliver` sem checagem de **reserva** (só tenant, e tenant fail-open) | Confirmado estático |
| R-06 | ALTO | `GET /api/dashboard/stats` sem filtro de tenant nem reserva (service role) | Confirmado estático |
| R-07 | ALTO | Revogação de assinatura não muda o status público (`/api/verify` continua "válido") | Confirmado estático |
| R-08 | ALTO | `deliver` SSA: insere lendings **antes** do update condicional de status → corrida gera saídas duplicadas; grava `auth_mode:"totp"` sem verificação no ato | Confirmado estático |
| R-09 | MÉDIO | `sign-armeiro`/`sign-militar`: sem checagem de reserva; rollback via `DELETE` em `document_signatures` é anulado pelo trigger `no_delete_signatures` (assinatura órfã) | Confirmado estático |
| R-10 | MÉDIO | `GET /api/dashboard/command`: `?reserve_id=` do cliente sobrepõe a reserva da sessão para `admin_reserva` | Confirmado estático |
| R-11 | MÉDIO | `session.reserveId` (cookie) e `profiles.active_reserve_id` (DB) podem divergir entre sessões/dispositivos; remoção de membership não invalida sessão | Confirmado estático |
| R-12 | BAIXO | Janela TOTP só aceita passo atual (comentário afirma ±1) | Confirmado por execução (P2) |
| R-13 | MÉDIO | Padrão fail-open `if (tenantId) query.eq(...)` / `tenantId && x.tenant_id && …` em ~25 pontos | Confirmado estático; explorabilidade INCONCLUSIVA |
| R-14 | MÉDIO | Suítes E2E/pentest apontam para produção por default | Confirmado estático |

---

## 7. WIP em andamento (resumo — ver `WIP_REGISTRY.md`)

- **WIP_INFRA_HIBRIDA**: fases 1–2 do `MIGRATION_SPEC.md §12` estão em `main` (reconciliação de
  migrations + Auth Provider). Fases 3–6 (Storage S3, Realtime LISTEN/NOTIFY, web dockerizado,
  `docker-compose.onprem.yml`, DR) **não encontradas** no repositório. Branch
  `ops/vps-env-storage` sugere trabalho de Storage fora do remoto.
- **WIP_BIOMETRIA**: `worktree-biometric-unify-ssa` (ativa hoje) reescreve autenticação
  biométrica de cautela/turno e remove SDK ZKTeco server-side; `fix/lending-rpcs-liveness-null`
  com migration não mergeada.

## 8. Bloqueios
BFF indisponível até o dia 3 + egress bloqueado + Supabase MCP sem conexão + ausência de .NET.
Ver `BLOCKERS.md`.

## 9. Áreas que NÃO devem ser tocadas sem coordenação

| Área | Motivo |
|---|---|
| `apps/bridge-windows/**` | WIP_BIOMETRIA ativa |
| `apps/bff/src/routes/{biometric,biometric-bridge,biometric-simulator,cautelamentos,shifts,saidas}.ts`, `apps/bff/src/lib/{biometric-*,shift-auth}.ts` | Alterados em `worktree-biometric-unify-ssa` |
| `apps/web/src/components/{biometric,cautelas/sign-dialog*,livro/shift-auth-dialog*,ui/finger-selector*}` e telas `reserva/{cautelas,livro,militares}`, `efetivo/minhas-cautelas` | idem |
| `apps/bff/src/lib/{infra-env,auth-provider*,local-auth-provider}.ts`, `routes/auth.ts`, `middleware/auth.ts`, `routes/session.ts`, `supabase/onprem-bootstrap/**`, `MIGRATION_SPEC.md`, `docker-compose*.yml`, `apps/bff/Dockerfile`, `infra/**`, `.github/workflows/**` | WIP_INFRA_HIBRIDA |
| `supabase/migrations/**` | SHARED_CRITICAL — toda frente escreve aqui; timestamps colidem |
| `CHANGELOG.md` | SHARED — conflito textual garantido |

## 10. Skills disponíveis vs. citadas no `CLAUDE.md`

O `CLAUDE.md` cita `superpowers:test-driven-development`, `spec-to-code-compliance`,
`differential-review`, `insecure-defaults:audit`, `static-analysis:semgrep` e o sub-agente
`code-reviewer`. **Nenhuma delas está instalada neste ambiente cloud.** Skill "Caveman" também
não foi encontrada. Disponíveis aqui: `code-review`, `security-review`, `simplify`, `run`,
`session-start-hook`. O pipeline de qualidade do `CLAUDE.md` precisa ser adaptado (ou as skills
instaladas) antes da primeira remediação — ver proposta em `REMEDIATION_LEDGER.md §Processo`.
