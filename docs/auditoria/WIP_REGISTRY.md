# WIP_REGISTRY — trabalho em andamento (baseline 0, HEAD `bf0aa0f`)

> Fonte: branches remotas + histórico de `main`. **Mudanças locais não pushadas da máquina do
> desenvolvedor não são visíveis** (ver `BASELINE_0.md §1.1`). Nada aqui foi alterado.

---

## WIP_INFRA_HIBRIDA

### Já integrado em `main` (faz parte da BASELINE, mas é frente viva)

| Commit | Conteúdo |
|---|---|
| `bbe0d3c` | reconcilia migration history Supabase + `MIGRATION_SPEC.md` |
| `04100a1` | plano `docs/superpowers/plans/2026-09-23-auth-provider-abstraction.md` |
| `1ff7d89` | `supabase/onprem-bootstrap/000_auth_shim.sql` |
| `7044e78` | `lib/infra-env.ts` — `AMBIENTE_INFRA` obrigatório, fail-closed |
| `a31da7e` / `e012550` / `461b738` | `AuthProvider`, `SupabaseAuthProvider`, `LocalAuthProvider` (bcrypt, `public.usuarios`), factory |
| `38d9185` / `c9c5b62` / `015ec78` | fiação em `routes/auth.ts`, `middleware/auth.ts`, `routes/session.ts` + fixes de review |
| `a56909f` / `add1b8f` | `scripts/provision-local-user.ts` |
| migration `20260923120000_usuarios_onprem.sql` | tabela `public.usuarios` |

### Branches

| Branch | Commits | Arquivos | Status |
|---|---|---|---|
| `ops/vps-env-storage` | `0c52df6` (2026-09-24) "workflow temporario grava STORAGE_* no .env da VPS" | `.github/workflows/ops-vps-env-storage.yml` | não mergeada. **Nenhum código em `main` lê `STORAGE_*`** → indica trabalho de Storage (fase 3) fora do remoto — WIP_ORIGEM_INCONCLUSIVA quanto ao código consumidor |
| `ops/add-deploy-key` | linhagem antiga | workflow pontual de chave SSH | histórico (workflow equivalente já está em `main`: `.github/workflows/add-deploy-key.yml`) |
| `auth-provider-abstraction` | mergeada (`39c5c2d`) | — | branch não existe no remoto (local/limpa) |

### Status por item (`MIGRATION_SPEC.md §12`)

| Fase | Item | Status | Evidência |
|---|---|---|---|
| 1 | Consolidar schema / reconciliar histórico | IMPLEMENTADO | `bbe0d3c` |
| 2 | Abstrair Auth (`AuthProvider`, `LocalAuthProvider`) | IMPLEMENTADO (auth) / PARCIAL (sistema) | Testes unitários passam (T2). **Todas as rotas de dados continuam usando `services/supabase.ts` (supabase-js + service role)**, que exige `SUPABASE_URL` no import → em `ON_PREMISE` o BFF não opera dados. Bearer token retorna 501 em ON_PREMISE (por design) |
| 2 | Bootstrap de schema on-prem | PARCIAL | T11: shim + cadeia aplica 2/178 migrations em Postgres 16 puro; o próprio shim declara que só cobre as 2 primeiras |
| 3 | Storage S3 único | NÃO ENCONTRADO (em `main`) / EM DESENVOLVIMENTO? | só o workflow `ops/vps-env-storage` |
| 4 | Realtime LISTEN/NOTIFY | NÃO ENCONTRADO | nenhum `pg_notify`/`LISTEN` no BFF |
| 5 | Web dockerizado + `docker-compose.onprem.yml` | NÃO ENCONTRADO | só `docker-compose.yml`/`.prod.yml`/`.biometric.yml` (serviço único `bff`) |
| 6 | LGPD + DR (restore executado) | NÃO ENCONTRADO | `infra/scripts/backup.sh` faz backup de config nginx/env/repo — **não do banco** |

### Mapa de infraestrutura (sem alterar)

| Item | Status | Nota |
|---|---|---|
| Dockerfile BFF (`oven/bun:1.2-alpine`, usuário não-root, healthcheck) | IMPLEMENTADO | `bun install ... 2>/dev/null \|\| bun install --production` — sem lockfile `bun.lockb` versionado → build não reprodutível (INCONCLUSIVO se há lockfile na VPS) |
| Compose (`docker-compose.yml` + `.prod.yml`) | IMPLEMENTADO (Cloud) | `.prod.yml` usa `env_file: .env`; `AMBIENTE_INFRA` não está na lista explícita de `docker-compose.yml`, depende do `.env` da VPS (`infra/scripts/setup-vps.sh` escreve `AMBIENTE_INFRA=SUPABASE`) — INCONCLUSIVO se a VPS atual tem a variável |
| `docker-compose.biometric.yml` | IMPLEMENTADO (legado) | mapeia `/dev/bus/usb` para o BFF — pertence ao SDK ZKTeco server-side que o WIP_BIOMETRIA remove |
| Nginx (`infra/nginx/api.apmcb.pmpb.online.conf`, `cloudflare-realip.conf`) | IMPLEMENTADO (Cloud) | TLS via Cloudflare/nginx; `TRUSTED_CLIENT_IP_ROLLOUT.md` |
| Deploy (`ci-cd.yml`: build, stop, recreate, healthcheck, rollback por tag `apmcb-bff:rollback`) | IMPLEMENTADO | depende de SSH na VPS |
| Logs | IMPLEMENTADO | pino JSON + `json-file` 50m×5 |
| Backup do banco / restore / upgrade / sizing | NÃO ENCONTRADO (repo) | Supabase gerencia no SaaS; nada para on-prem |
| Secrets | IMPLEMENTADO (Cloud) | `.env` na VPS, CF Pages env; `wrangler.toml` está no `.gitignore` mas `apps/web/wrangler.toml` **é versionado** (adicionado antes da regra); conteúdo verificado: só `name`, `compatibility_*`, `pages_build_output_dir` — sem segredo. Inconsistência cosmética, não risco |

### Possíveis conflitos
- `routes/auth.ts`, `middleware/auth.ts`, `routes/session.ts` são também o núcleo do Modo
  Usuário e da sessão (SECURITY_SCOPE) → **SHARED_CRITICAL**.
- `supabase/migrations/**` e `CHANGELOG.md`.
- `.github/workflows/**` (deploy) × qualquer remediação que mexa em CI.

---

## WIP_BIOMETRIA

### Já integrado em `main`
PRs #48–#53 (`d1e305b`, `6a7d8ab`, `fc1f6bc`, `469e514`, `513b4d0`, `f0b6a79`): pair 500,
UI de captura, modal NITGEN, digital duplicada, autostart da bridge, diálogo com fases,
captura na devolução para armeiro multi-reserva.

### Branches

| Branch | À frente/atrás | Último commit | Arquivos | Status |
|---|---|---|---|---|
| `worktree-biometric-unify-ssa` | 21 / 34 | 2026-09-29 20:46 "turno e assinatura do armeiro so com a digital do proprio armeiro" | 54 arquivos, +2189/−871 | **ATIVA**. Não mergeada |
| `fix/lending-rpcs-liveness-null` | 1 / 5 | 2026-09-23 22:27 | `supabase/migrations/20260924001500_lending_rpcs_liveness_null_allowed.sql` | não mergeada. **Risco de drift**: se foi aplicada ao vivo em produção (padrão já registrado no CHANGELOG para outras correções), o repo não reflete o banco — INCONCLUSIVO |
| `biometric-bridge-phase0/1a-spec/1a1/1b-spec` | linhagem antiga | 2026-07 | specs/fundação | histórico, sem ancestral comum |

### Conteúdo de `worktree-biometric-unify-ssa` (por commit)
Novo `lib/biometric-authorization.ts` (autoatendimento escopado para `usuario`);
`validateSelfBiometricProof` + `consumeBiometricProof` substituem `validateBiometric` em
`cautelamentos.ts` e `shifts.ts`; **remove** `services/fingerprint/*` (SDK ZKTeco server-side) e
endpoints mortos de `saidas.ts`; `SignDialog`/`ShiftAuthDialog` usam `BiometricCaptureDialog`
real; bridge: poller resiliente a timeout, dedo escolhido na janela nativa NITGEN,
reconhecimento de dedo recém-cadastrado.

**Atenção de merge**: o commit `abfacca` da branch é o mesmo fix de `d1e305b` já em `main`
(cherry-pick) → conflito provável em `routes/biometric-bridge.ts`. A branch está 34 commits
atrás e toca `cautelamentos.ts` (1871 linhas), que `main` alterou em `23170b6`/`bf0aa0f`
(rastreabilidade cross-turno).

### Mapa de integração biométrica (estado em `main`, somente leitura)

| Pergunta | Resposta (código) | Status |
|---|---|---|
| Onde está a bridge | `apps/bridge-windows/BridgeClient` (.NET, tray app, autostart) | CÓDIGO EXISTE / INTEGRADO |
| Protocolo | **HTTP de saída bridge → BFF** (não localhost, não WebSocket): `POST /api/biometric-bridge/pair` (código de pareamento), `GET /tenant-key`, `POST /heartbeat`, `GET /challenges/next?reserve_id=` (polling), `POST /challenges/:id/proof`, `POST /challenges/:id/enrollment`, `GET /templates/sync` | CÓDIGO INTEGRADO |
| Autenticação do dispositivo | Ed25519 por requisição (`lib/biometric-device-auth.ts`, `middleware/biometric-device-auth.ts`), fora do `authMiddleware`; pinning de certificado (`CertificatePinning.cs`) | CÓDIGO INTEGRADO |
| Identificação do dispositivo | `biometric_devices` (tenant/reserva fixos), `bridgeDeviceId/TenantId/ReserveId` no contexto Hono | CÓDIGO INTEGRADO |
| Onde ocorre o matching | **Na bridge** (SDK NITGEN, `NitgenSdkAdapter.cs`) contra templates sincronizados | CÓDIGO INTEGRADO |
| Template armazenado? | Sim: `biometric_templates` no banco; trafega cifrado (AES-256-GCM, `TemplateCipher.cs`) com **chave derivada por tenant** entregue a qualquer bridge pareada via `GET /tenant-key` | CÓDIGO INTEGRADO; escopo por reserva da sincronização INCONCLUSIVO |
| Imagem biométrica armazenada? | Não encontrado no BFF/banco | NÃO ENCONTRADO |
| O que o Andrômeda recebe | Prova assinada com `matched_user_id`, `match_score`, dados do desafio (`ProofPayload.cs`) → `biometric_proof` consumido uma vez (`biometric_proof_consumptions`) | CÓDIGO INTEGRADO |
| Onde entra na cautela/saída | `record_lending_batch`/`record_lending_returns` validam `biometric_proof_id` (ator, tenant, reserva); em `main`, `sign-armeiro`/`sign-militar` de cautela ainda usam `validateBiometric()` **server-side** (SDK no VPS, sem hardware → 503) — é exatamente o que a WIP substitui | PARCIAL em `main`; WIP_BIOMETRIA |
| Timeouts/retries/reconexão | `ChallengePoller`, `HeartbeatService`, `BridgeOrchestrator` (fixes na WIP) | WIP_BIOMETRIA |
| Simulador | `routes/biometric-simulator.ts`, só se `NODE_ENV!=production && BIOMETRIC_SIMULATOR_ENABLED=true` | CÓDIGO INTEGRADO |

### Possíveis conflitos
`cautelamentos.ts`, `shifts.ts`, `saidas.ts`, `lib/shift-auth.ts`, telas de cautela/livro,
`supabase/migrations/**`, `CHANGELOG.md`. Qualquer remediação de R-01 (hash), R-09
(assinaturas) ou SoD em cautela **colide** com esta branch.

---

## WIP_ORIGEM_INCONCLUSIVA

| Branch | Conteúdo | Por que inconclusiva |
|---|---|---|
| `docs/spec-identificar-usuario` | `docs/superpowers/specs/*identificar-usuario-ficha-operacional-design.md` (v1→v7, revisões com notas) | spec de produto ("Identificar Usuário → Ficha Operacional"); pode alimentar biometria (identificação do militar) ou UX do armeiro. Só docs — risco de conflito baixo |
| `feat/busca-usuario-por-email` (linhagem antiga) | "wip: … rota /api/diagnostico temp (remover antes do merge)" | sem ancestral comum; verificar se `/api/diagnostico` chegou a produção (não existe em `main`) |
| Branches pré-reescrita (28) | SP1–SP7, e-mail, rebrand, fixes de segurança | conteúdo presumivelmente já portado para `main` (raiz `73e8198` = SP7); não verificado commit a commit |
