# Changelog — APMCB Plataforma de Governança de Bens Sensíveis

> Mantido por convenção semântica. Datas em ISO 8601 (America/Recife, UTC-3).
> Roadmap completo: `docs/enterprise/02-enterprise-roadmap.md`
> DoD Canônica: `docs/enterprise/07-canonical-definition-of-done.md`

---

# 2026-06-28

### Features

* **arsenal/categorias:** Almoxarifado agora tem aba de categorias para `admin_reserva`, com cadastro/edicao logica de categorias, flags de calibre, validade, numero de serie, veiculo e alertas configuraveis.
* **reserva/almoxarifado:** rota `/reserva/arsenal` agora exibe abas `Materiais` e `Categorias` para `admin_reserva` e `armeiro`; o dropdown de categoria tem seta explicita para listar categorias ja criadas e botao `+` separado para criacao rapida.
* **arsenal/ux:** dialogos de adicionar material no admin e de solicitar material no armeiro ganharam seletor-criador de categoria com botao `+`, mantendo a categoria no dropdown e ativando campos contextuais sem trocar de tela.
* **arsenal/veiculos:** categoria de veiculos passa a exigir placa e modelo, com campos de cor e ano opcionais para viaturas, carros, motos, vans e categorias equivalentes.
* **arsenal/metadados:** cadastro de material agora suporta categoria livre, descricao opcional, calibre obrigatorio para armas, controle opcional de numero de serie e validade obrigatoria para coletes com alertas configuraveis de 1 ano, 6 meses e 90 dias.
* **arsenal/rbac:** solicitacoes de armeiro carregam os novos metadados e continuam indo para aprovacao exclusiva do `admin_reserva`; `admin_global` deixou de ser role de mutacao direta em `/api/admin/almoxarifado`.
* **notificacoes:** criada base de deduplicacao `material_validity_alert_events` e rotina BFF para gerar notificacoes de validade para armeiros, admins da reserva e militar com posse ativa.
* **relatorios:** filtros avancados de admin/reserva agora incluem categoria e calibre quando categoria `arma` e exportacoes CSV/Excel incluem coluna `Calibre`.

### Bug Fixes

* **arsenal/usuarios:** abas `Materiais/Categorias` agora ficam no topo do Almoxarifado para `admin_reserva` e `armeiro`; modal de adicionar material foi ampliado, foto do perfil no header usa carregamento imediato, `/admin/usuarios` aceita `admin_reserva`, busca/autocomplete reutiliza o endpoint existente e o cadastro de militar permite perfil inicial `usuario` ou `armeiro` conforme RBAC.
* **auth/cloudflare:** server components em runtime Edge agora leem `SUPABASE_URL` e `SUPABASE_ANON_KEY` tambem dos bindings `getRequestContext().env`, evitando redirect indevido para `/login` apos login em Cloudflare Pages.
* **auth/layout:** dashboard deixou de selecionar `profiles.reserve_id` inexistente no banco real; a reserva atual agora vem de `reserve_memberships`, removendo redirect indevido para `/login` apos autenticacao valida.

### Database

* **supabase:** aplicada no banco real a migration `20260628000004_material_category_ux.sql`, ampliando `material_categories`, relacionando `material_types.category_id`, incluindo campos de veiculo e recriando `material_availability` com os novos metadados.
* **supabase:** aplicada no banco real a migration `20260628000003_material_metadata_alerts.sql`, com `material_types.categoria` em texto livre, `categoria_slug`, `calibre`, flags de serie/validade, `validity_alert_days`, indices e view `material_availability` ampliada.

### Validation

* `node --experimental-strip-types --test apps/bff/src/__tests__/audit-hash.test.ts apps/bff/src/__tests__/totp-guard.test.ts apps/bff/src/__tests__/material-metadata.test.ts` = 24 passed.
* `pnpm typecheck` OK.
* `pnpm lint` OK.
* `pnpm --filter web build` OK.
* `supabase migration list` confirma `20260628000004` local/remoto aplicado.

---

# 2026-06-27

### Features

* **arsenal/perfil/feedback:** fotos opcionais de materiais com bucket `material-photos`, upload/captura em cadastro de material, perfil do usuario com foto/preferencias, rota `/suporte` para problema/sugestao/critica/elogio e regressao E2E `arsenal-profile-feedback` (3/3).
* **arsenal/rbac:** fluxo de solicitacao do armeiro para adicao/desativacao/ajuste de material com aprovacao exclusiva por `admin_reserva`; `superadmin` permanece restrito a gestao global/tenants/saude/branding, sem dados internos da reserva.

* **fase-d:** PDF de passagem de turno com QR code verificável — endpoint público `GET /api/handovers/:id/verify` embutido como matrix QR via `pdf-lib` rectangles (pure JS, zero canvas)
* **fase-d:** `apps/bff/src/lib/totp-guard.ts` — `checkTotpGuard()` função pura extraída; TOTP anti-replay consolidado em `handovers.ts`, `saidas.ts` e `cautelamentos.ts` (elimina VULN #1)
* **fase-d:** testes unitários BFF — 15/15 passando com `node --experimental-strip-types`:
  - `audit-hash.test.ts` — 8 casos: determinismo, encadeamento SHA-256, JSON canônico, tamper detection
  - `totp-guard.test.ts` — 7 casos: anti-replay, rate-limit 5/15min, expiração de janela, verificação criptográfica

### Bug Fixes

* **suporte:** removido seletor redundante de tipo de contato; pagina mantem apenas canal unico, email, copiar email, envio por email e prazo de resposta.
* **auth/login:** login por senha agora cria sessao HttpOnly no BFF via `/api/auth/exchange` antes do redirect, evitando 401 em `/api/auth/me` e retorno para `login?reason=session_expired`.
* **suporte:** rota `/suporte` simplificada para canal unico, email `suporteonix@arckosia.com.br`, selecao de tipo de contato, botao de copiar email e prazo de resposta de ate 3 dias uteis.
* **reserva/arsenal:** botao `Adicionar Material` restaurado para `armeiro`; agora abre solicitacao de adicao via aprovacao do `admin_reserva`, sem permitir gestao direta interna por `superadmin`.
* **reserva/sw:** service worker deixou de cachear navegacoes autenticadas (`/reserva`, dashboard etc.) com `NetworkFirst`, evitando `sw.js no-response` em rotas dinamicas de sessao.
* **reserva/cautelas:** lista inicial carrega via cookie BFF sem aguardar `supabase.auth.getSession()`; endpoint reduziu payload do SELECT e recebeu indices compostos `tenant/status/created_at` e `tenant/militar/created_at`.
* **reserva/ui:** Sheet fecha por `Escape`, evitando overlay preso apos cancelar a solicitacao de material em testes e uso real.
* **bff/inventory:** verificacao publica de inventario movida para rota sem auth antes do middleware, preservando QR/hash publico em producao.
* **deploy/bff:** workflow do VPS agora usa `fetch/reset`, `set -euo pipefail`, remove container antigo `apmcb-bff` e recria o servico, evitando falso verde quando `git pull` ou `docker compose up` falham.
* **supabase:** migrations `20260627000002_material_photos_arsenal_rbac` e `20260627000003_cautelamentos_performance` aplicadas e verificadas no banco real; bucket `material-photos`, coluna `material_types.photo_url` e indices de cautelas confirmados.
* **deploy/cloudflare:** runtime Edge restaurado nas rotas dinamicas do App Router para compatibilidade com `@cloudflare/next-on-pages`.
* **arsenal:** botao/modal de Adicionar Material restaurado; `admin_reserva` gerencia direto e `armeiro` solicita aprovacao.
* **playwright/local:** smoke local estabilizado removendo runtime Edge das rotas dashboard afetadas pelo crash RSC no Next Windows; teste HTTPS continua valido em deploy e e pulado somente em `localhost`.

### Validation

* `pnpm typecheck` (web) OK; `pnpm --filter @apmcb/bff typecheck` OK; `pnpm lint` OK com warnings existentes; `pnpm build` OK; Playwright `chromium + rbac-suite + arsenal-profile-feedback` = 53 passed, 1 skipped local HTTPS.

### Bug Fixes (E2E)

* **e2e:** DEC13 — filtro de reserva localizado por `aria-label` (compatível com produção); `name="reserve"` adicionado ao componente `_client.tsx`
* **e2e:** smoke brand panel — expectativa atualizada para "Plataforma de Controle" (texto padrão sem `?tenant=` param)
* **e2e:** smoke Reserva action cards — card renomeado para "Cadastrar Biometria" (era "Cadastrar Militar")
* **e2e:** M03 — `#create-role` não renderizado para armeiro (MASTER_ROLES.length=1); teste corrigido
* **e2e:** M04 — seletor escopo `dialog#create-role` para não capturar opções de outros `<select>` na página
* **e2e:** F02/F03 — `img[alt='Prévia']` (era "Prévia da foto"); botão X via seletor CSS sibling
* **e2e:** playwright.config.ts — projeto `dec-suite` adicionado (DEC01-DEC15)

### Rastreabilidade

* `supabase/migrations/20260626000001_rls_material_items_role_based.sql` — formaliza RLS Fase B.2 aplicada via psql

---

# 2026-06-26

### Features

* **fase7:** Dashboard de Comando Enterprise — rota `/(dashboard)/admin/comando`, endpoint `GET /api/dashboard/command` com 14 cards de exceção e conformidade, filtro por reserva, auto-refresh 30s; suite dec-suite DEC01-DEC15 (15/15 ✅)
* **fase6:** Livro Digital de Serviço — tabela `service_handovers`, 8 endpoints de passagem de turno, snapshot JSONB automático de 6 tabelas, assinatura dupla TOTP, PDF verificável, notificações push para armeiro entrante; suite handover-suite HT01-HT08 (8/8 ✅)
* **admin:** CRUD completo de org-units e reserves para `admin_global` em `/admin/estrutura` — spec ES01-ES15
* **bff:** endpoint `GET /api/categories` para categorias customizadas por tenant
* **ci/cd:** GitHub Actions — lint + typecheck + E2E smoke bloqueiam deploy CF Pages; auto-deploy BFF via SSH em push para main
* **security (fase-a):** consolidação de 6 fixes críticos do pm-assessment:
  - BUG #1: `roleGuard` explícito em `GET /api/ocorrencias`
  - BUG #2: `tenant_id` obrigatório em `lendings.ts` — retorna 400 se null
  - VULN #1: anti-replay movido para ANTES de `verifySync` em `signatures.ts` (padrão consistente)
  - VULN #2: `pendingTotpSetup` migrado de `Map` em memória para `iron-session` (stateless, sobrevive redeploy)
  - Fix: `PATCH /api/profiles` e `PATCH /api/profiles/:id/status` com `.eq("tenant_id")`
  - Fix: docker-compose.prod.yml sem devices USB para VPS limpa
* **security/ux (fase-b/c):**
  - RLS `material_items_staff_select` + `material_items_usuario_select` — staff vê tudo; usuário só vê itens próprios ou disponíveis
  - `sessions_invalidated_at` adicionado à tabela `profiles`
  - Hook `useRoleGuard` — polling 5min + `window.focus` para revalidação de sessão
  - `RoleWatcher` integrado ao dashboard layout
  - `/api/auth/me` valida role DB vs sessão; force re-login se divergir
  - `issuedAt` adicionado à `SessionData` para invalidação por timestamp

### Bug Fixes

* **handovers:** `document_type` correto para constraint (`lending | handover | inventory`)
* **handovers:** `tenant_id` adicionado no SELECT `GET /:id`; spec com `reserveId` fixo e membership check
* **handovers:** HT05 busca profile do cadete via Supabase REST (Bearer token)
* **rbac:** armeiro removido de `POST /api/admin/militares`; fix `dashboard.ts` TS2339
* **build:** `useSearchParams` em login wrappado em `Suspense boundary`; FK hint em cautelamentos
* **totp:** parar polling quando servidor retorna 404 (TOTP não configurado)
* **lint:** `eslint.config.mjs` — ignora `e2e/`, `playwright-report/`, `public/sw.js` (212 erros → 0 erros)
* **docker:** remover USB device do compose base; criar `docker-compose.biometric.yml` override
* **bugs:** 5 falhas críticas de produção corrigidas (bff auth, fetch direto Supabase)

### Docs

* `docs/enterprise/reports/pm-assessment-fase-bc-report.md` — relatório completo Fases B+C com checklist G01-G17
* `docs/enterprise/pm-assessment-v1.md` — Fases A, B, C marcadas como `[x]`

---

# 2026-06-25

### Features

* **fase5b:** Nexus Enterprise completo — BFF + frontend:
  - Sidebar colapsável com branding accordion
  - Login dinâmico por tenant (slug param)
  - Setup 2FA via `/nexus/setup-2fa`
  - Gestão de usuários completa com reset TOTP
  - suite nexus-enterprise-suite NE01-NE16
* **fase5:** Saída Diária Enterprise (item-based) — `POST /api/saidas` e fluxo completo:
  - Dual-auth TOTP + biometria em `sign-armeiro` / `sign-militar`
  - Status machine: `pending` → `signed_armeiro` → `active` → `returned`
  - suite saida-suite SD01-SD06 (6/6 ✅)
* **fase5:** Cautela Permanente — tabelas `lendings` enterprise + `cautelamentos` + trigger P0001 (posse exclusiva):
  - PDFs com hash verificável
  - UI cautelas com `SignDialog` dual-auth
  - Bucket `custody-docs` no Supabase Storage
  - suite cautelamento-suite CT01-CT08 (8/8 ✅)
  - suite item-integrity-suite IT01-IT09
* **fase4:** Assinatura Eletrônica Nível 1:
  - Tabela `document_signatures` com RULE de imutabilidade
  - `apps/bff/src/lib/document-hash.ts` — `hashDocument()`
  - `apps/bff/src/lib/signature-proof.ts` — `computeSignatureProof()`
  - Rota pública `/v/[document_id]` para verificação
  - suite signature-suite SIG01-SIG06 (6/6 ✅)
* **e2e:** visual-full-suite — bateria visual ponta-a-ponta VF01-VF35

### Bug Fixes

* **bff:** `document_type` correto para constraint Supabase (`lending` vs `handover`)
* **bff/e2e:** `ip` inválido em `inet NOT NULL`; suites F5 em serial mode
* **bff:** substituição de `supabase.auth.getUser/signInWithPassword` por `fetch` direto (BFF iron-session)
* **fase4:** edge runtime na página `/v/[document_id]` para CF Pages
* **totp:** `armeiro` e `admin` roles podem chamar `totp/setup` para document signing
* **layout:** mapeia roles RBAC Fase 2 para nav UI (`armeiro→master`, `admin_global→admin`)
* **e2e:** NE14 usa `domcontentloaded` para evitar timeout no fetch de branding

---

# 2026-06-23

### Bug Fixes

* **types:** corrige `UserData` duplicado em `_edit-dialog.tsx` e `_user-actions.tsx` — tipo canônico exportado de `_edit-dialog`
* **types:** remove `@ts-expect-error` obsoleto em `e2e/rbac.spec.ts:34`
* **frontend:** role checks e `status_legacy` corrigidos em admin/usuarios, reserva/militares

### Docs

* **reports:** relatórios finais das Fases 1, 2 e 3 gerados em `docs/enterprise/reports/`
* **roadmap:** Fase 3 marcada como concluída; Fase 2B renumerada para 7B

---

# 2026-06-22

### Features

* **fase3:** `audit_events` com hash SHA-256 encadeado, RULE SQL de imutabilidade, snapshots before/after, middleware fire-and-forget em todos os endpoints sensíveis
* **fase3:** `computeEventHash()` em `apps/bff/src/lib/audit-hash.ts` — cadeia de hash verificável (`previous_hash` do evento N+1 = hash do evento N)
* **fase3:** suite `audit-suite` — AT01-AT05 + SEC-3-01 + SEC-3-03 (7/7 ✅)
* **fase2:** RBAC Enterprise — 6 roles institucionais: `superadmin`, `admin_global`, `admin_reserva`, `armeiro`, `usuario`, `auditor`
* **fase2:** migração de dados: `admin→admin_global`, `master→armeiro` aplicada via Supabase SDK (service_role)
* **fase2:** `roleGuard` atualizado em 10+ rotas BFF; `HonoVariables` com tipo `Role` expandido
* **fase2:** `landAt` corrigido: `armeiro→/reserva`, `admin_global→/admin`, `auditor/admin_reserva→/reserva`
* **fase2:** suite `rbac-suite` — PT01-PT08 + SEC-2-* (10/10 ✅)
* **fase1:** suite `multitenant-suite` — TT01-TT14 (14/14 ✅); Slice 1A completo
* **e2e:** `global-setup.ts` — fix permanente do ENOTEMPTY no Playwright (rimraf recursivo)
* **infra:** `playwright.config.ts` — workers:2, mobile-safari removido do run principal, invite-activate deduplicado

### Bug Fixes

* **auth:** `exchange` com role `master` redirecionava para `/cadete` após migração — corrigido `armeiro→/reserva`
* **e2e:** harness.ts USERS atualizado: `admin_global` e `armeiro` como role values pós-migração

### Breaking Changes

* Roles `"admin"` e `"master"` **removidos** do tipo `Role` e `SessionData`. Usar `"admin_global"` e `"armeiro"`.

---

# 2026-06-19

### Features

* **auth:** tela de ativação de conta por convite (`/auth/confirmar-conta`) com formulário de primeira senha, medidor de força, visibility toggle e redirecionamento por role
* **auth:** `/api/auth/activate-account` — edge route que marca `account_activated_at` via service_role após definição da primeira senha
* **auth:** melhoria em `/auth/update-password` — visibility toggle em ambos os campos, exibição contextual do e-mail, checklist visual de requisitos
* **e2e:** suite `invite-suite` — IA01-IA17 (17 testes cobrindo ativação, reset, routing PKCE e proteção de API)

### Bug Fixes

* **auth:** `inviteUserByEmail`/`generateLink` redirecionavam para `/login` que não processa código PKCE — alterado para `/auth/callback?next=/auth/confirmar-conta`
* **auth:** callback route suporta fluxo de convite via parâmetro `next` + fallback `token_hash + type` (OTP flows)
* **e2e:** flakiness SD05-SD07 eliminada usando `tr[data-testid^='saida-row-']` para aguardar hidratação React
* **deploy:** `docker-compose.yml` corrigido com `SESSION_SECRET` e `INTERNAL_API_SECRET` no environment do BFF

---

# 2026-06-18

### Bug Fixes

* **e2e:** corrige autenticação Bearer e session isolation no harness SSA
* **infra:** `SUPABASE_SERVICE_ROLE_KEY` no `/opt/apmcb/.env` substituído pela chave real; container BFF recriado para recarregar env vars
* **e2e:** `getSupabaseToken` detecta JSON plano vs base64url — `@supabase/ssr` v0.12 sem `cookieEncoding` armazena sessão como JSON direto
* **e2e:** `clearCookies()` antes de cada `login()` elimina corrupção de cookies fragmentados entre trocas de usuário
* **e2e:** `bffCall` omite `Content-Type` quando body ausente — evita 400 do zValidator Hono ao parsear corpo vazio
* **tests:** rate limit aumentado para 100/min; fix ST01 text mismatch

---

# 2026-06-17

### Features

* **arsenal:** filtros de busca + categoria + estoque na página de almoxarifado do armeiro
* **arsenal:** clicar em material abre detail sheet com KPIs, barra de disponibilidade e status
* **arsenal:** armeiro pode solicitar ajuste de estoque ao admin (stepper +/- com mínimo = em uso)
* **arsenal:** armeiro pode solicitar adição de material em batch; solicitações pendentes no dashboard admin
* **arsenal:** página `/admin/arsenal/solicitacoes` com tabs Pendentes/Aprovadas/Rejeitadas/Todas
* **arsenal:** aprovação executa a ação imediatamente; rejeição exige motivo obrigatório ≥ 5 chars
* **arsenal:** armeiro recebe notificação push/in-app ao ter solicitação aprovada ou rejeitada
* **militares:** clicar em militar abre sheet com perfil, status biométrico e dedos cadastrados
* **saidas:** "Registrar Saída" exige verificação de identidade antes do submit (biometria ou TOTP)
* **db:** migration `admin_approval_requests` com RLS, índices, trigger de auditoria
* **bff:** rotas `/api/arsenal/requests` — POST/GET/approve/reject com notificação automática
* **ui:** dropdowns/popovers com fundo sólido corrigido via `@theme inline {}` no globals.css

---

# Releases anteriores (pré-2026-06-17)

Consultar git log completo: `git log --oneline` — histórico disponível desde o commit inicial de 2026-05-x.

Marcos principais:
- **2026-06-17:** Arsenal enterprise — solicitações, detail sheet, biometria
- **2026-06-16:** SSA sistema completo + UI/UX polish
- **2026-06-15:** Security hardening — CSP nonces, CSRF, body limit, fail2ban, super admin spec
- **2026-06-14:** BFF Hono + Docker Compose VPS + ZKTeco bridge + PWA manifest
- **2026-06-13:** Next.js 16 Turbopack + CF Pages edge runtime + auth flows completos
- **2026-06-12:** Scaffold inicial — Next.js 15, shadcn/ui, TanStack Query, Zustand, Supabase
