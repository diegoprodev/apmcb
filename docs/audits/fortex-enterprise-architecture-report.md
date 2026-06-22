# Fortex Enterprise Architecture Report

> **Gerado em:** 2026-06-20  
> **Autor:** Arquiteto Principal — Diego Rodrigues  
> **Repositório:** `c:\projetos\apmcb` (branch `main`)  
> **Supabase Project:** `jepitcrkicwmvzrmllpn`  
> **Domínio ativo:** `apmcb.pmpb.online`  
> **Versão do produto:** APMCB → Fortex (renomeação comercial em andamento)

---

## Sumário

1. [Visão Executiva do Estado Atual](#1-visão-executiva-do-estado-atual)
2. [Arquitetura Atual do Fortex](#2-arquitetura-atual-do-fortex)
3. [Estrutura do Repositório](#3-estrutura-do-repositório)
4. [Modelo de Domínio Atual](#4-modelo-de-domínio-atual)
5. [Multi-tenant Enterprise](#5-multi-tenant-enterprise)
6. [RBAC e Permissões](#6-rbac-e-permissões)
7. [Segurança Atual e Riscos](#7-segurança-atual-e-riscos)
8. [Auditoria e Rastreabilidade](#8-auditoria-e-rastreabilidade)
9. [Cautela Eletrônica](#9-cautela-eletrônica)
10. [Passagem de Serviço Digital](#10-passagem-de-serviço-digital)
11. [Assinatura Eletrônica](#11-assinatura-eletrônica)
12. [Inventário Periódico](#12-inventário-periódico)
13. [Relatórios e Documentos](#13-relatórios-e-documentos)
14. [Importação em Massa](#14-importação-em-massa)
15. [Dashboard de Comando](#15-dashboard-de-comando)
16. [API Segura Futura](#16-api-segura-futura)
17. [Roadmap Enterprise Fase a Fase](#17-roadmap-enterprise-fase-a-fase)
18. [Plano de Execução para 30 Dias](#18-plano-de-execução-para-30-dias)
19. [Plano de Testes Enterprise](#19-plano-de-testes-enterprise)
20. [Recomendações Finais do Arquiteto](#20-recomendações-finais-do-arquiteto)

---

## 1. Visão Executiva do Estado Atual

### O que o Fortex já faz hoje

O Fortex (atualmente operando como APMCB — Academia de Polícia Militar do Cabo Branco) é um sistema operacional de controle de bens sensíveis que já executa em produção no domínio `apmcb.pmpb.online`. O produto resolve o problema de controle manual de armamento em unidades de segurança pública, onde hoje se usa planilhas e livros físicos.

**Módulos 100% funcionais:**

| Módulo | Descrição | Status |
|---|---|---|
| Autenticação | Email, matrícula militar, Google OAuth, Turnstile | ✅ Completo |
| RBAC básico | 3 roles (admin, master/armeiro, usuario/cadete) | ✅ Funcional |
| SSA — Solicitação Remota | Militar solicita armamento via app, armeiro aprova, expira em 6h | ✅ Completo |
| TOTP 2FA | Setup, validação, anti-replay, rate limit 5/15min | ✅ Completo |
| Saídas e devoluções | Lending de material com status ativo/devolvido | ✅ Funcional |
| Biometria ZKTeco | Identificação 1:N por impressão digital | ✅ Funcional |
| Convites de usuário | Invite tracking + ativação de conta | ✅ Completo |
| Ocorrências | Incidentes reportados por militares com resolução pelo armeiro | ✅ Funcional |
| Notificações push | Web Push via service worker | ✅ Funcional |
| Nexus super admin | Painel 2FA-gated com realtime audit stream, health, métricas | ✅ Completo |
| Auditoria básica | `audit_logs` imutável (RULE no_update/no_delete) | ✅ Básica |
| Segurança de rede | CSP, CSRF, rate limiting sliding-window por IP, secureHeaders | ✅ Sólida |

### Módulos parciais

| Módulo | O que existe | O que falta |
|---|---|---|
| Cautela eletrônica | `lendings` com status ativo/devolvido | Assinatura, hash documental, termo PDF, status machine completa |
| Almoxarifado admin | UI de estoque + aprovação de ajuste parcial | Fluxo de aprovação em dois níveis, relatório de movimentação |
| Relatórios | UI básica de relatórios | Geração de PDF, hash, assinatura eletrônica, exportação auditada |
| RBAC | 3 roles operacionais | Faltam admin_global, admin_reserva, auditor para enterprise |
| Auditoria | Log de ações sem contexto completo | Sem before/after, sem hash de evento, sem cadeia criptográfica |

### Módulos que não existem (intenção futura)

- ❌ **Passagem de Serviço Digital (Livro Digital)** — substituir livro físico de plantão
- ❌ **Assinatura Eletrônica formal** — nível 1 interno com prova criptográfica
- ❌ **Inventário periódico** — campanhas de conferência de carga com conformidade
- ❌ **Importação em massa** — militares, unidades, cargas via CSV/JSON
- ❌ **Dashboard de comando** — visão de exceções e conformidade para gestores
- ❌ **Multi-tenant real** — provisionamento de tenants por superadmin
- ❌ **API pública versionada** — integração com sistemas externos de órgãos
- ❌ **QR Code documental / PDF verificável** — documentos com hash e rastreabilidade
- ❌ **LGPD Art. 18** — export de dados, erasure, consentimento

### Maturidade atual do produto

**Estimativa: 38% de um MVP enterprise apresentável ao comando.**

O sistema resolve o problema operacional diário (controle de saídas e devoluções com autenticação forte), mas carece dos elementos institucionais que um comandante exige: documento assinado, passagem de serviço formal, inventário periódico e rastreabilidade completa de qualquer alteração.

### Distância do MVP enterprise

Com foco e execução disciplinada: **6 a 8 semanas** para chegar num piloto apresentável a um estado maior. As Fases 0-8 do roadmap (seção 17) cobrem esse período.

### Maiores riscos para escalar o produto

1. **Multi-tenant ausente** — vender para um segundo cliente hoje exige duplicação de banco ou isolamento manual frágil
2. **Passagem de serviço não existe** — é o documento central da operação de uma reserva; sem ele o sistema não substitui o processo atual
3. **Assinatura eletrônica sem validade jurídica** — o termo de cautela atual não tem valor probatório
4. **BFF na Alemanha** — LGPD gap de processamento fora do Brasil (dados de militares)
5. **Sem inventário periódico** — comandos exigem conferência formal de carga para prestação de contas

### O que precisa ser estabilizado antes de qualquer nova feature

1. **Adicionar `tenant_id` a todas as tabelas** (Fase 1 do roadmap) — base de toda a evolução enterprise
2. **Expandir RBAC** para 5 roles institucionais
3. **Hash criptográfico em `audit_logs`** para tornar trilha juridicamente válida
4. **Mover BFF para Google Cloud Run sa-east-1** (elimina gap LGPD)

---

## 2. Arquitetura Atual do Fortex

### Stack técnico

```
┌─────────────────────────────────────────────────────────────────┐
│                    USUÁRIO FINAL (Browser / PWA)                │
└──────────────────────────────┬──────────────────────────────────┘
                               │ HTTPS
┌──────────────────────────────▼──────────────────────────────────┐
│              CLOUDFLARE PAGES (Edge CDN)                        │
│              Next.js 16.2.9 — App Router                        │
│              React 19 · Tailwind 4 · Serwist PWA               │
│              apps/web/src/                                      │
└────────────┬────────────────────────────────┬───────────────────┘
             │ Supabase anon key (client)      │ BFF fetch (cookie)
             │ wss:// (Realtime)               │ HTTPS + iron-session
┌────────────▼────────────┐     ┌─────────────▼───────────────────┐
│  SUPABASE (AWS sa-east-1)│     │   BFF — Hono 4 + Bun           │
│  PostgreSQL + Auth       │     │   Hetzner VPS 91.99.113.89     │
│  Realtime + Storage      │◄────┤   Docker container              │
│  jepitcrkicwmvzrmllpn   │     │   apps/bff/src/                 │
└─────────────────────────┘     └─────────────────────────────────┘
```

### Componentes e responsabilidades

| Componente | Tecnologia | Responsabilidade |
|---|---|---|
| Frontend | Next.js 16 / React 19 / Tailwind 4 | UI, server components, edge API proxies |
| BFF | Hono 4.7 / Bun | Auth, sessão, validação, lógica de negócio |
| Database | Supabase PostgreSQL | Dados, RLS, triggers, realtime |
| Auth | Supabase Auth | JWT, OAuth, email magic link |
| Sessão | iron-session | Cookie httpOnly `apmcb_session` (8h) |
| CDN | Cloudflare Pages | Deploy, edge caching, TLS |
| CAPTCHA | Cloudflare Turnstile | Anti-bot no login |
| Biometria | ZKTeco SDK | Identificação 1:N por impressão digital |
| Push | Web Push API | Notificações em background |
| Storage | Supabase Storage | Fotos de perfil (`profile-photos` bucket) |

### Fluxo de autenticação

```
1. Usuário acessa /login
2. Preenche email ou matrícula + senha
3. Se matrícula: RPC get_email_by_matricula() → resolve email
4. Frontend: supabase.auth.signInWithPassword(email, password)
   → Supabase retorna access_token + refresh_token (cookies)
5. Frontend: POST /api/auth/login → BFF
   BFF: supabase.auth.getUser(token) → busca role em profiles
   BFF: getIronSession() → salva {userId, role, supabaseAccessToken}
   BFF: seta cookie apmcb_session (httpOnly) + csrf-token (não httpOnly)
6. Redirect baseado em role: admin→/admin, master→/reserva, usuario→/cadete
```

**Arquivo:** `apps/bff/src/routes/auth.ts` — POST /api/auth/login

### Fluxo de sessão

```
Cookie: apmcb_session  (httpOnly, secure, sameSite=strict, 8h)
  └── {userId, role, supabaseAccessToken, nexusAuthorized?, nexusAuthorizedAt?}

Cookie: csrf-token  (não httpOnly, 24h)
  └── valor aleatório; x-csrf-token header deve coincidir em mutations

SessionData (apps/bff/src/lib/session.ts):
  userId: string
  role: "admin" | "master" | "usuario"
  supabaseAccessToken: string
  nexusAuthorized?: boolean       ← gate do /nexus
  nexusAuthorizedAt?: number      ← TTL 2h
```

### Fluxo de chamada frontend → BFF → Supabase

```
Frontend (browser)
  → fetch(BFF_URL/api/resource, { credentials: "include" })
  → BFF authMiddleware: lê iron-session → extrai userId + role
  → roleGuard("master", "admin"): verifica permissão
  → Handler: supabase.from("tabela").select(...)  ← service_role key
  → Retorna JSON
  → Frontend: atualiza UI via React Query
```

**Fallback Bearer:** Se não há cookie de sessão, o BFF aceita `Authorization: Bearer <token>` e valida via `supabase.auth.getUser(token)`. Usado pelo próprio Next.js (server components) e por chamadas diretas de API.

### Fluxo de permissões

```
RLS (Supabase)
  └── auth.uid() e auth.jwt()->>'role' nas policies
  └── Ex: profiles — usuário vê apenas seu próprio perfil (anon key)
  └── Ex: audit_logs — apenas admin pode SELECT

BFF middleware (apps/bff/src/middleware/)
  ├── auth.ts       → valida sessão iron-session ou Bearer token
  ├── role-guard.ts → roleGuard("admin") → 403 se role diferente
  ├── csrf.ts       → valida x-csrf-token em mutations
  ├── rate-limit.ts → sliding window por IP (3 níveis: 5/15min, 100/min, 120/min)
  └── audit.ts      → fire-and-forget insert em audit_logs após handler
```

### Arquivos arquiteturais críticos

| Arquivo | Responsabilidade |
|---|---|
| `apps/bff/src/index.ts` | Entry point Hono, pipeline de middleware, registro de rotas |
| `apps/bff/src/lib/session.ts` | SessionData interface e sessionOptions |
| `apps/bff/src/middleware/auth.ts` | Validação de sessão (dual: cookie + Bearer) |
| `apps/bff/src/middleware/rate-limit.ts` | Rate limiting + `clearRateLimitForIp()` |
| `apps/bff/src/middleware/csrf.ts` | Proteção CSRF em mutations |
| `apps/bff/src/services/supabase.ts` | Client Supabase service_role (nunca no frontend) |
| `apps/web/src/middleware.ts` | CSP + security headers em todas as rotas |
| `apps/web/src/components/providers.tsx` | AuthListener + QueryClient + ThemeProvider |
| `apps/web/src/lib/supabase/client.ts` | Supabase browser client (anon key) |
| `apps/web/src/lib/supabase/server.ts` | Supabase server client (SSR, edge) |
| `supabase/migrations/` | 26 migrations — fonte de verdade do schema |

### Decisões arquiteturais registradas

1. **BFF obrigatório para qualquer operação sensível** — service_role key nunca no browser
2. **iron-session como camada de sessão** — mais simples e controlável que JWT cookies customizados; evita exposição do access_token Supabase no browser
3. **Bearer token fallback** — necessário para server components Next.js que não têm cookie de sessão BFF
4. **Hono sobre Express** — edge-compatible, sem overhead, tree-shakeable
5. **Supabase Auth como IdP** — delega autenticação, mantém controle de roles no `profiles`
6. **Cloudflare Pages + Hetzner** — CF Pages para frontend (zero-config deploy), Hetzner para BFF (custo baixo, controle total do container)

---

## 3. Estrutura do Repositório

```
apmcb/                            ← raiz do monorepo
├── apps/
│   ├── web/                      ← Next.js 16 frontend
│   │   ├── src/
│   │   │   ├── app/              ← App Router (rotas = pastas)
│   │   │   │   ├── (dashboard)/  ← rotas protegidas com layout
│   │   │   │   │   ├── admin/    ← painel do administrador
│   │   │   │   │   ├── cadete/   ← painel do militar/usuario
│   │   │   │   │   └── reserva/  ← painel do armeiro (master)
│   │   │   │   ├── api/          ← Next.js API routes (proxies edge)
│   │   │   │   ├── auth/         ← callbacks OAuth, reset de senha
│   │   │   │   ├── login/        ← tela de login pública
│   │   │   │   ├── nexus/        ← super admin panel (isolado, 2FA)
│   │   │   │   ├── layout.tsx    ← root layout (Providers)
│   │   │   │   └── globals.css
│   │   │   ├── components/       ← componentes React reutilizáveis
│   │   │   │   ├── layout/       ← AppShell, Sidebar, Header, BottomNav
│   │   │   │   ├── dashboard/    ← LendingChart
│   │   │   │   ├── ssa/          ← componentes SSA (solicitação)
│   │   │   │   ├── cadete/       ← realtime sync, ocorrência form
│   │   │   │   └── ui/           ← shadcn-style components (34 arquivos)
│   │   │   ├── hooks/            ← use-auth.ts, use-role.ts
│   │   │   ├── lib/
│   │   │   │   ├── supabase/     ← client.ts, server.ts
│   │   │   │   └── csrf.ts       ← csrfHeaders() helper
│   │   │   └── middleware.ts     ← CSP + security headers
│   │   ├── e2e/                  ← 28 arquivos de testes Playwright
│   │   ├── playwright.config.ts  ← configuração de suites E2E
│   │   ├── next.config.ts
│   │   └── package.json
│   └── bff/                      ← Hono BFF (Bun runtime)
│       ├── src/
│       │   ├── index.ts          ← entry point, middleware pipeline
│       │   ├── lib/
│       │   │   └── session.ts    ← SessionData + sessionOptions
│       │   ├── middleware/
│       │   │   ├── auth.ts       ← valida sessão/Bearer
│       │   │   ├── csrf.ts       ← valida token CSRF
│       │   │   ├── rate-limit.ts ← sliding window por IP
│       │   │   ├── audit.ts      ← fire-and-forget audit log
│       │   │   └── role-guard.ts ← roleGuard() helper
│       │   ├── routes/
│       │   │   ├── auth.ts       ← login, logout, me
│       │   │   ├── totp.ts       ← setup, validate, self-validate
│       │   │   ├── lendings.ts   ← saídas e devoluções
│       │   │   ├── arsenal.ts    ← estoque de material
│       │   │   ├── ssa.ts        ← solicitações remotas
│       │   │   ├── profiles.ts   ← perfis de usuário
│       │   │   ├── dashboard.ts  ← dados agregados do dashboard
│       │   │   ├── biometric.ts  ← identificação biométrica
│       │   │   ├── ocorrencias.ts← incidentes
│       │   │   ├── notifications.ts← notificações
│       │   │   ├── push.ts       ← web push
│       │   │   └── nexus.ts      ← super admin monitoring
│       │   ├── services/
│       │   │   ├── supabase.ts   ← client service_role
│       │   │   └── fingerprint/  ← ZKTeco SDK abstraction
│       │   └── types/
│       │       └── hono.ts       ← HonoVariables type
│       └── package.json
├── packages/
│   └── shared/                   ← schemas Zod compartilhados (lending, material, profile)
├── supabase/
│   ├── migrations/               ← 26 migrations SQL em ordem cronológica
│   └── config.toml
├── docs/
│   ├── audits/                   ← este relatório
│   ├── security.md               ← política de segurança
│   ├── user-creation-flow.md     ← fluxo de criação de usuários
│   ├── feature-rbac-photo-biometria.md
│   ├── github-secrets.md
│   └── superpowers/              ← specs e planos de desenvolvimento
├── infra/                        ← scripts de backup, deploy, setup Hetzner
├── nginx/                        ← config Nginx + SSL para Hetzner
├── scripts/                      ← scripts de deploy raiz
├── .github/workflows/            ← CI/CD GitHub Actions
├── CLAUDE.md                     ← instruções do projeto para Claude Code
├── DESIGN.md                     ← documento de design arquitetural
├── CHANGELOG.md                  ← histórico de versões
├── docker-compose.yml            ← ambiente local
├── turbo.json                    ← pipeline Turbo (build, dev, test)
└── pnpm-workspace.yaml           ← configuração do monorepo pnpm
```

### Arquivos críticos por categoria

**Autenticação:**
- `apps/bff/src/routes/auth.ts` — login/logout/me
- `apps/bff/src/middleware/auth.ts` — guard de sessão
- `apps/bff/src/lib/session.ts` — estrutura da sessão
- `apps/web/src/app/login/page.tsx` — tela de login

**Rotas BFF:**
- `apps/bff/src/index.ts` — registro e pipeline
- `apps/bff/src/routes/*.ts` — 12 route handlers

**Rotas Web:**
- `apps/web/src/app/(dashboard)/layout.tsx` — auth guard + perfil
- `apps/web/src/app/page.tsx` — redirect por role
- `apps/web/src/middleware.ts` — CSP headers

**Banco de dados:**
- `supabase/migrations/20260611000001_initial_schema.sql` — schema base
- `supabase/migrations/20260615000001_ssa_schema.sql` — SSA (maior migration, 12KB)
- `supabase/migrations/20260617000006_ocorrencias.sql` — incidentes

**Tipos:**
- `apps/bff/src/types/hono.ts` — HonoVariables
- `packages/shared/` — schemas Zod compartilhados

**Scripts de deploy:**
- `infra/scripts/deploy-bff.sh` (em `/opt/apmcb/scripts/` no Hetzner)
- `.github/workflows/` — CI/CD para Cloudflare Pages

---

## 4. Modelo de Domínio Atual

### Usuários / Profiles

| Aspecto | Detalhe |
|---|---|
| **Tabela** | `profiles` (estende `auth.users` do Supabase) |
| **Migration** | `20260611000001_initial_schema.sql` |
| **Campos principais** | `id` (UUID, FK auth.users), `nome_completo`, `matricula` (único), `posto` (enum), `nome_de_guerra`, `role` (admin/master/usuario), `registration_status` (pending_biometric/complete/inactive/impedimento_administrativo), `totp_configured` (bool), `invite_sent_at`, `account_activated_at` |
| **Frontend** | `apps/web/src/app/(dashboard)/admin/usuarios/` + `reserva/militares/` |
| **Backend** | `apps/bff/src/routes/profiles.ts` |
| **Status** | ✅ Completo para MVP single-tenant |
| **Falta para enterprise** | `tenant_id`, `unidade_id`, `deprovisioning_at`, `last_login_at`, campos de conformidade LGPD |

### Material Types (Catálogo de bens)

| Aspecto | Detalhe |
|---|---|
| **Tabela** | `material_types` |
| **Campos** | `id`, `nome`, `categoria` (arma/farda/acessorio/equipamento), `quantidade_total`, `descricao`, `created_at` |
| **View** | `material_availability` — calcula `quantidade_disponivel = total - em_uso - reservada` |
| **Frontend** | `apps/web/src/app/(dashboard)/admin/arsenal/`, `reserva/arsenal/` |
| **Backend** | `apps/bff/src/routes/arsenal.ts` |
| **Status** | ✅ Funcional |
| **Falta** | `tenant_id`, `unidade_id`, campos para viaturas/rádios/munições, `numero_serie`, fotos do item |

### Lendings (Saídas / Cautelas)

| Aspecto | Detalhe |
|---|---|
| **Tabela** | `lendings` |
| **Campos** | `id`, `material_type_id` (FK), `military_id` (FK profiles), `master_id` (FK profiles), `quantidade`, `status` (ativo/devolvido), `issued_at`, `returned_at`, `local` (localização física), `auth_mode` (biometria/totp/manual), `material_request_id` (FK SSA) |
| **Frontend** | `apps/web/src/app/(dashboard)/reserva/saidas/` |
| **Backend** | `apps/bff/src/routes/lendings.ts` |
| **Status** | ⚠ Funcional como saída simples; **não é cautela enterprise** |
| **Falta** | Assinatura eletrônica, hash do documento, termo PDF, status machine completa (entregue→confirmado_pelo_militar), prazo de devolução, divergência, histórico de alterações |

### Material Requests / SSA (Solicitação Remota)

| Aspecto | Detalhe |
|---|---|
| **Tabelas** | `material_requests` + `material_request_items` |
| **Campos (requests)** | `id`, `military_id`, `reserva_id`, `status` (pendente/aprovado/rejeitado/retirado/expirado/cancelado), `totp_validated`, `requested_at`, `approved_at`, `expires_at` (6h), `armeiro_nota` |
| **Campos (items)** | `request_id`, `material_type_id`, `nome_snapshot`, `requested_quantity`, `delivered_quantity` |
| **Frontend** | `apps/web/src/app/(dashboard)/cadete/` (solicitar) + `reserva/solicitacoes/` (aprovar) |
| **Backend** | `apps/bff/src/routes/ssa.ts` |
| **Status** | ✅ Completo e testado (suites ssa-request, ssa-approval, ssa-stress) |
| **Falta** | `tenant_id`, multi-unidade (usuario de uma unidade pedindo em outra) |

### TOTP Secrets

| Aspecto | Detalhe |
|---|---|
| **Tabela** | `totp_secrets` |
| **Acesso** | Exclusivamente via service_role no BFF |
| **Campos** | `user_id` (FK), `secret` (Base32 20 chars), `enabled`, `last_used_token` (anti-replay) |
| **Backend** | `apps/bff/src/routes/totp.ts` |
| **Status** | ✅ Seguro — sem RLS anon, sem exposição no frontend |
| **Falta** | Recovery codes, backup TOTP method, revogação de emergência |

### Biometric Templates

| Aspecto | Detalhe |
|---|---|
| **Tabela** | `biometric_templates` |
| **Campos** | `user_id` (FK), `template_data` (bytea), `finger_index` (int) |
| **Backend** | `apps/bff/src/services/fingerprint/zkteco.ts` |
| **Status** | ✅ Funcional para ZKTeco |
| **Risco** | Template armazenado como bytea sem criptografia em repouso → P1 |
| **Falta** | `tenant_id`, criptografia em repouso (AES-256), hash de integridade do template |

### Ocorrências (Incidentes)

| Aspecto | Detalhe |
|---|---|
| **Tabela** | `ocorrencias` |
| **Campos** | `id`, `military_id`, `lending_id` (nullable), `material_type_id`, `material_nome_snapshot`, `titulo`, `descricao`, `status` (aberta/em_analise/resolvida/improcedente), `resolvida_por`, `resolvida_em`, `resolucao` |
| **Frontend** | `apps/web/src/app/(dashboard)/reserva/ocorrencias/` + cadete |
| **Backend** | `apps/bff/src/routes/ocorrencias.ts` |
| **Status** | ✅ Funcional (migration 20260617000006) |
| **Falta** | `tenant_id`, anexos/fotos, severidade, SLA de resolução |

### Audit Logs

| Aspecto | Detalhe |
|---|---|
| **Tabela** | `audit_logs` |
| **Campos** | `id` (UUID), `actor_id` (FK profiles), `action` (string), `resource_type`, `resource_id`, `metadata` (jsonb), `created_at` |
| **Imutabilidade** | RULE no_update + RULE no_delete no Supabase |
| **Realtime** | Habilitado via REPLICA IDENTITY FULL + supabase_realtime publication |
| **Status** | ⚠ Básico — sem before/after, sem hash, sem tenant_id, sem IP, sem user_agent |
| **Falta** | Tudo listado na Seção 8 |

### Entidades não existentes (a criar para enterprise)

| Entidade | Onde deve existir | Prioridade |
|---|---|---|
| `tenants` | DB + BFF + Frontend | P0 |
| `unidades` | DB + BFF + Frontend | P0 |
| `service_handovers` | DB + BFF + Frontend | P1 |
| `handover_signatures` | DB + BFF | P1 |
| `document_signatures` | DB + BFF | P1 |
| `signed_documents` | DB + BFF + Storage | P1 |
| `inventory_campaigns` | DB + BFF + Frontend | P2 |
| `inventory_items_check` | DB + BFF + Frontend | P2 |
| `import_jobs` | DB + BFF + Frontend | P2 |
| `api_keys` | DB + BFF | P3 |

---

## 5. Multi-tenant Enterprise

### Estado atual (single-tenant implícito)

O sistema nasceu para uma única instituição (APMCB). Não existe `tenant_id` em nenhuma tabela. O isolamento hoje é garantido apenas pelo fato de haver um único banco de dados, com RLS baseado em `auth.uid()` e `role`, não em `tenant_id`.

**Consequência prática:** adicionar um segundo cliente hoje exigiria duplicar o projeto Supabase inteiro ou confiar em isolamento manual via queries — ambas as opções frágeis e não escaláveis.

### Hierarquia de roles enterprise

```
superadmin (Fortex)
  │  ← você, acessa /nexus, cria tenants
  │
  └── admin_global (por tenant)
        │  ← ex: "Admin PM-PB", cria unidades, vê todos os relatórios do tenant
        │
        └── admin_reserva (por unidade)
              │  ← ex: "Admin da 1ª Reserva de Armamento", gerencia sua unidade
              │
              ├── armeiro (operador)
              │     ← executa saídas, devoluções, biometria, passagem de serviço
              │
              └── usuario (militar)
                    ← solicita armamento, recebe materiais, reporta ocorrências
```

### O que precisa mudar para multi-tenant real

**Fase 1 — Tabelas:**
```sql
-- Nova tabela de tenants
CREATE TABLE tenants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,      -- "pm-pb", "pm-sp"
  plano       TEXT DEFAULT 'basic',
  ativo       BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Nova tabela de unidades (reservas de armamento)
CREATE TABLE unidades (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  nome        TEXT NOT NULL,
  sigla       TEXT,
  ativo       BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ALTER em TODAS as tabelas sensíveis:
ALTER TABLE profiles          ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE material_types    ADD COLUMN tenant_id UUID NOT NULL REFERENCES tenants(id);
ALTER TABLE lendings          ADD COLUMN tenant_id UUID NOT NULL REFERENCES tenants(id);
ALTER TABLE material_requests ADD COLUMN tenant_id UUID NOT NULL REFERENCES tenants(id);
ALTER TABLE ocorrencias       ADD COLUMN tenant_id UUID NOT NULL REFERENCES tenants(id);
ALTER TABLE audit_logs        ADD COLUMN tenant_id UUID;
ALTER TABLE notifications     ADD COLUMN tenant_id UUID;
ALTER TABLE biometric_templates ADD COLUMN tenant_id UUID NOT NULL REFERENCES tenants(id);
```

**Fase 1 — JWT claim:**
```sql
-- Supabase app_metadata (setado pelo BFF na criação do usuário)
-- auth.jwt()->>'tenant_id' fica disponível nas RLS policies
```

**Fase 1 — RLS pattern universal:**
```sql
-- Para CADA tabela sensível (exceto superadmin bypass):
CREATE POLICY "tenant_isolation" ON <tabela>
  USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

-- Superadmin (role='superadmin'): sem tenant_id, usa service_role
```

**Fase 1 — BFF:**
```typescript
// session.ts: adicionar tenant_id
interface SessionData {
  userId: string;
  role: Role;
  tenantId: string;           // ← NOVO
  unidadeId?: string;         // ← NOVO (para admin_reserva e armeiro)
  supabaseAccessToken: string;
  nexusAuthorized?: boolean;
  nexusAuthorizedAt?: number;
}

// Middleware: propagar tenant_id em todas as queries
// Nunca confiar no tenant_id vindo do body — sempre da sessão
```

### Onde há risco de vazamento entre tenants

| Risco | Localização | Mitigação |
|---|---|---|
| Query sem `tenant_id` no WHERE | `apps/bff/src/routes/*.ts` | RLS como segunda linha (não confiar apenas no BFF) |
| `audit_logs` sem `tenant_id` | `audit_logs` table | Adicionar coluna + propagar no middleware |
| Nexus lendo audit_logs de todos | `/nexus` usa service_role | Implementar filtro de tenant no Nexus |
| Biometric template de outro tenant | `biometric_templates` | RLS com `tenant_id` |
| Notificações cruzadas | `notifications` | RLS com `tenant_id` |

### Onde há risco de vazamento entre unidades do mesmo tenant

| Risco | Mitigação |
|---|---|
| `admin_reserva` de unidade A vendo lendings de unidade B | RLS com `unidade_id` em lendings |
| `armeiro` executando saída em unidade diferente da sua | Validação no BFF + RLS |
| Relatórios cross-unidade para admin_reserva | Filtro de `unidade_id` no dashboard |

### Proposta técnica de migração segura

```
Passo 1: Criar tabelas tenants + unidades
Passo 2: Inserir tenant default (APMCB/PM-PB)
Passo 3: Adicionar tenant_id a todas as tabelas (DEFAULT = tenant_default_id)
Passo 4: Adicionar RLS policies para tenant_id
Passo 5: Atualizar BFF SessionData + propagação de tenant_id
Passo 6: Atualizar Nexus para filtragem cross-tenant via service_role
Passo 7: Testes de isolamento TT01-TT08 (Seção 19)
Passo 8: Provisioning de segundo tenant de teste no Nexus
Passo 9: Verificação manual + E2E
```

---

## 6. RBAC e Permissões

### Matriz completa de roles enterprise

| Permissão | superadmin | admin_global | admin_reserva | armeiro | usuario | auditor |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **Criar tenants** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Criar unidades** | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Criar usuários (invite)** | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Ver todos os usuários do tenant** | ✅ | ✅ | sua unidade | ❌ | ❌ | ✅ (leitura) |
| **Configurar material types** | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Registrar saída (lending)** | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Aprovar solicitação SSA** | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Solicitar armamento (SSA)** | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| **Gerar passagem de serviço** | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| **Assinar passagem (saindo)** | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| **Assinar passagem (entrando)** | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| **Abrir inventário** | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Executar inventário** | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| **Ver audit logs** | ✅ | seu tenant | sua unidade | ❌ | ❌ | ✅ (leitura) |
| **Exportar relatórios** | ✅ | ✅ | sua unidade | ❌ | ❌ | ✅ |
| **Acessar /nexus** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Importar em massa** | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Revogar sessão de usuário** | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Assinar cautela eletrônica** | ❌ | ❌ | ✅ | ✅ | ✅ (recebimento) | ❌ |
| **Reportar ocorrência** | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| **Resolver ocorrência** | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Excluir dados (LGPD)** | ✅ | ✅ (seu tenant) | ❌ | ❌ | ❌ | ❌ |

### Roles atuais vs. enterprise

| Role atual | Role enterprise equivalente | Gap |
|---|---|---|
| `admin` | `admin_global` | Falta `tenant_id`, sem provisioning |
| `master` | `armeiro` (+ futuro `admin_reserva`) | Sem distinção entre gerente e operador |
| `usuario` | `usuario` | Falta `unidade_id` |
| ❌ não existe | `superadmin` | Apenas via /nexus; não tem role_enum |
| ❌ não existe | `admin_reserva` | Não implementado |
| ❌ não existe | `auditor` | Não implementado |

### Arquivos a modificar para expandir RBAC

- `apps/bff/src/types/hono.ts` — expandir `Role` type
- `apps/bff/src/lib/session.ts` — expandir `SessionData`
- `apps/bff/src/middleware/role-guard.ts` — suporte a roles granulares
- `apps/bff/src/middleware/auth.ts` — incluir `tenantId` + `unidadeId`
- `supabase/migrations/` — nova migration com role_enum atualizado

---

## 7. Segurança Atual e Riscos

### Avaliação das dimensões de segurança

#### ✅ O que está bem implementado

| Dimensão | Implementação | Arquivo |
|---|---|---|
| Autenticação | Supabase Auth + iron-session + TOTP RFC 6238 | `apps/bff/src/routes/auth.ts`, `totp.ts` |
| Sessão | httpOnly cookie, secure, sameSite=strict, 8h TTL | `apps/bff/src/lib/session.ts` |
| CSRF | Token duplo (cookie + header) em mutations | `apps/bff/src/middleware/csrf.ts` |
| Rate limiting | Sliding window 3 níveis por IP (5/15min, 100/min, 120/min) | `apps/bff/src/middleware/rate-limit.ts` |
| CSP | Strict, sem `unsafe-eval`, frame-ancestors none | `apps/web/src/middleware.ts` |
| Headers de segurança | X-Frame-Options, X-Content-Type-Options, Permissions-Policy | `apps/web/src/middleware.ts` |
| RLS | Policies em todas as tabelas sensíveis | `supabase/migrations/20260611000002_rls_policies.sql` |
| Service role key | Nunca no cliente, apenas no BFF | `apps/bff/src/services/supabase.ts` |
| TOTP anti-replay | `last_used_token` evita reutilização de código | `supabase/migrations/20260614000004_totp_antireplay.sql` |
| CORS | Origens explícitas no BFF | `apps/bff/src/index.ts` |
| Audit logs | Imutável via RULE no_update/no_delete | `supabase/migrations/` |

### Tabela de riscos classificados

#### P0 — CRÍTICO (bloqueia compliance enterprise)

| ID | Risco | Impacto | Localização | Correção | Bloqueia piloto? |
|---|---|---|---|---|---|
| S-P0-01 | Sem `tenant_id` nas tabelas — migração multi-tenant pode criar vazamento se feita errado | Vazamento de dados entre clientes | Todas as tabelas | Adicionar `tenant_id` + RLS antes de onboarding de 2º cliente | ✅ Sim |
| S-P0-02 | BFF na Alemanha (Hetzner) — dados de militares processados fora do Brasil | Violação LGPD Art. 33 | `apps/bff/` em Hetzner EU | Migrar para Google Cloud Run sa-east-1 | ✅ Sim (para órgãos federais) |

#### P1 — ALTO (deve ser corrigido antes do piloto)

| ID | Risco | Impacto | Localização | Correção | Bloqueia piloto? |
|---|---|---|---|---|---|
| S-P1-01 | `audit_logs` sem hash de evento | Logs podem ser adulterados (apesar do RULE SQL) | `audit_logs` table | SHA-256 encadeado em cada inserção | ✅ Sim (auditoria judicial) |
| S-P1-02 | Sem workflow de desprovisionamento | Usuário desligado pode manter acesso | `profiles` + `auth.users` | `POST /api/users/{id}/deprovision` com cascata | ✅ Sim |
| S-P1-03 | `biometric_templates` sem criptografia em repouso | Template biométrico exposto em dump do banco | `biometric_templates` (bytea) | AES-256 antes de INSERT, decrypt no BFF | Parcialmente |
| S-P1-04 | Sem IR (Incident Response) plan | Sem procedimento formal em caso de incidente | Documentação | Criar `docs/INCIDENT_RESPONSE.md` com P1-P4, 72h LGPD | ✅ Sim |

#### P2 — MÉDIO (deve ser corrigido antes do scale)

| ID | Risco | Impacto | Localização | Correção | Bloqueia piloto? |
|---|---|---|---|---|---|
| S-P2-01 | `'unsafe-inline'` na CSP | XSS via injeção de style (risco baixo com React, mas presente) | `apps/web/src/middleware.ts` | Migrar para CSS modules + nonce-based CSP | ❌ Não |
| S-P2-02 | Sem LGPD Art. 18 endpoints | Órgão pode ser acionado por militar pedindo dados | BFF | `GET /api/users/export-data`, `DELETE /api/users/{id}/erase` | ❌ Não (curto prazo) |
| S-P2-03 | Sem política de retenção de logs | `audit_logs` cresce indefinidamente | `audit_logs` | Policy de arquivamento + purge após 5 anos | ❌ Não |
| S-P2-04 | Tokens de refresh Supabase no cookie de browser | Refresh token expostos se XSS ocorrer | `supabase-auth-token` cookie | Já mitigado pelo iron-session como camada primária; documentar |  ❌ Não |
| S-P2-05 | Upload de arquivos sem validação de tipo real | Arquivo executável disfarçado de imagem | Quando implementar uploads | `file-type` library para magic bytes | ❌ Não |

#### P3 — BAIXO (backlog de hardening)

| ID | Risco | Impacto | Localização | Correção |
|---|---|---|---|---|
| S-P3-01 | Sem rotação automática de `SESSION_SECRET` | Comprometimento permanente se secret vazar | `.env` do BFF | Rotação semestral + expiração de sessões |
| S-P3-02 | Sem monitoramento de anomalias (SIEM) | Ataques lentos passam despercebidos | — | Integrar alertas de Supabase + log aggregation |
| S-P3-03 | Bearer token fallback sem expiração verificada | Token expirado pode ser aceito se Supabase defer | `apps/bff/src/middleware/auth.ts` | Verificar `exp` no JWT antes de aceitar |

### IDOR (Insecure Direct Object Reference) — análise

O sistema é protegido contra IDOR em duas camadas:
1. **BFF:** queries sempre filtradas por `userId` extraído da sessão (nunca do body)
2. **Supabase RLS:** policies com `auth.uid()` garantem que anon key não expõe dados de terceiros

**Gap:** sem `tenant_id`, um admin de um futuro tenant B poderia, com service_role de um BFF bugado, acessar dados do tenant A. Mitigado pelo Passo S-P0-01.

---

## 8. Auditoria e Rastreabilidade

### Estado atual

**O que é logado hoje:**

| Campo | Existe? | Valor típico |
|---|---|---|
| `id` | ✅ | UUID gerado |
| `actor_id` | ✅ | UUID do usuário (FK profiles) |
| `action` | ✅ | string livre (ex: "auth.login_failed", "nexus.login") |
| `resource_type` | ✅ | string livre (ex: "lending", "user") |
| `resource_id` | ✅ | UUID do recurso afetado |
| `metadata` | ✅ | JSONB com dados adicionais |
| `created_at` | ✅ | timestamp automático |
| `before` snapshot | ❌ | Não existe |
| `after` snapshot | ❌ | Não existe |
| `tenant_id` | ❌ | Não existe |
| `unidade_id` | ❌ | Não existe |
| `ip` | ❌ | Não existe (apenas em metadata às vezes) |
| `user_agent` | ❌ | Não existe |
| `device_id` | ❌ | Não existe |
| `event_hash` | ❌ | Não existe |
| `previous_hash` | ❌ | Não existe (cadeia) |

**Imutabilidade atual:** RULE SQL `no_update` e `no_delete` na tabela `audit_logs` — impede alteração por qualquer role incluindo service_role via SQL direto. É a forma correta no Supabase (não RLS, que pode ser bypassed por service_role).

### O que não é logado

- Leituras sensíveis (GET /api/lendings, GET /api/profiles) — apenas mutations são logadas
- Exportações de dados
- Login bem-sucedido (apenas falhas são logadas atualmente)
- Alterações em `material_types`
- Convites enviados (parcialmente)
- Assinaturas eletrônicas (módulo não existe)

### Proposta de modelo enterprise: `audit_events`

```sql
-- Tabela substituta / complementar a audit_logs
CREATE TABLE audit_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seq             BIGSERIAL NOT NULL,           -- sequência global para cadeia
  tenant_id       UUID REFERENCES tenants(id),
  unidade_id      UUID REFERENCES unidades(id),
  actor_id        UUID REFERENCES profiles(id),
  actor_role      TEXT NOT NULL,
  action          TEXT NOT NULL,                -- namespace.verb (ex: "lending.created")
  resource_type   TEXT NOT NULL,
  resource_id     UUID,
  before_snapshot JSONB,                        -- estado anterior
  after_snapshot  JSONB,                        -- estado posterior
  metadata        JSONB DEFAULT '{}',
  ip              INET,
  user_agent      TEXT,
  device_id       TEXT,
  event_hash      TEXT NOT NULL,                -- SHA-256(seq||actor||action||before||after||ts)
  previous_hash   TEXT,                         -- hash do evento anterior (cadeia)
  created_at      TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Imutabilidade
CREATE RULE no_update AS ON UPDATE TO audit_events DO INSTEAD NOTHING;
CREATE RULE no_delete AS ON DELETE TO audit_events DO INSTEAD NOTHING;

-- Índices
CREATE INDEX ON audit_events (tenant_id, created_at DESC);
CREATE INDEX ON audit_events (actor_id, created_at DESC);
CREATE INDEX ON audit_events (resource_type, resource_id);
```

**Geração do hash:**
```typescript
// BFF: apps/bff/src/lib/audit-hash.ts
import { createHash } from "crypto";

export function computeEventHash(params: {
  seq: number;
  actor_id: string;
  action: string;
  before: unknown;
  after: unknown;
  created_at: string;
  previous_hash: string | null;
}): string {
  const payload = JSON.stringify(params);
  return createHash("sha256").update(payload).digest("hex");
}
```

**Verificação de integridade:** varredura sequencial recalculando o hash de cada evento e comparando com `event_hash` — qualquer divergência indica adulteração.

---

## 9. Cautela Eletrônica

### Estado atual

O que existe hoje como "cautela" é a tabela `lendings` — um registro de saída e devolução sem assinatura, sem hash documental e sem confirmação do militar. Não é uma cautela no sentido jurídico do termo.

**O que a tabela `lendings` tem:**
- Quem saiu (military_id), quem autorizou (master_id)
- Qual material (material_type_id), quantidade
- Quando saiu (issued_at) e quando voltou (returned_at)
- Status (ativo/devolvido)
- Modo de autenticação (auth_mode: biometria/totp/manual)
- Localização (local)
- Vínculo com SSA (material_request_id)

**O que falta para ser cautela enterprise:**
- Assinatura eletrônica do armeiro (emissão) com prova criptográfica
- Confirmação/assinatura do militar (recebimento)
- Status machine completa com confirmação
- Hash do documento de cautela
- PDF gerado e armazenável
- Prazo de devolução configurável
- Status de vencimento
- Campo de observação por item
- Divergência entre quantidade solicitada e entregue

### Fluxo alvo da cautela enterprise

```
1. ARMEIRO inicia saída → preenche militar, material, quantidade
2. Sistema verifica: military_id ativo? material disponível? sem cautela aberta?
3. AUTENTICAÇÃO: armeiro confirma com TOTP ou biometria
4. Cautela criada com status "emitida" + timestamp
5. ARMEIRO assina eletronicamente (Nível 1: TOTP + IP + user_agent + hash)
6. Documento hash SHA-256 gerado + gravado
7. Status → "aguardando_recebimento"
8. MILITAR recebe notificação push + pendência no app
9. MILITAR confirma recebimento dentro do prazo (ex: 30 min)
   → Assina com seu próprio TOTP
   → Status → "ativa"
   → Termo de cautela PDF gerado e armazenado no Storage
10. Cautela permanece ativa até devolução
11. DEVOLUÇÃO: armeiro registra → militar confirma → status "devolvida"
    → quantidade devolvida vs. quantidade emitida verificada
    → se divergência → status "divergência" → ocorrência aberta automaticamente
12. Documento final fechado com hash e assinaturas
```

### Entidades necessárias

```sql
-- Upgrade da tabela lendings:
ALTER TABLE lendings
  ADD COLUMN status_v2 TEXT DEFAULT 'emitida'
    CHECK (status_v2 IN ('emitida','aguardando_recebimento','ativa','devolvida','divergencia','cancelada')),
  ADD COLUMN prazo_devolucao TIMESTAMPTZ,
  ADD COLUMN observacao_emissao TEXT,
  ADD COLUMN military_signature_id UUID,     -- FK document_signatures
  ADD COLUMN armeiro_signature_id UUID,      -- FK document_signatures
  ADD COLUMN document_hash TEXT,
  ADD COLUMN pdf_storage_path TEXT;

-- Nova tabela de assinaturas (ver Seção 11)
-- Ver document_signatures
```

### Rotas BFF necessárias

```
POST   /api/lendings                   → emitir cautela (armeiro)
POST   /api/lendings/:id/confirm       → confirmar recebimento (militar)
POST   /api/lendings/:id/return        → registrar devolução (armeiro)
POST   /api/lendings/:id/sign          → assinar documento
GET    /api/lendings/:id/pdf           → baixar PDF da cautela
GET    /api/lendings/:id/verify        → verificar hash do documento
```

### Eventos de auditoria

```
lending.created          → cautela emitida (com before: null, after: dados da cautela)
lending.signed_armeiro   → assinatura do armeiro
lending.confirmed        → recebimento confirmado pelo militar
lending.signed_military  → assinatura do militar
lending.returned         → devolução registrada
lending.divergence       → divergência aberta
lending.closed           → documento finalizado
```

---

## 10. Passagem de Serviço Digital

### Nome recomendado: **Livro Digital de Serviço**

**Justificativa:** O termo "Passagem" tem ambiguidade em contexto tecnológico (pode ser confundido com passagem de dados, token, etc.). "Livro Digital de Serviço" remete diretamente ao Livro de Ocorrências e ao Livro de Plantão — documentos que qualquer policial militar reconhece imediatamente. É o nome que o comandante vai entender sem explicação.

**Alternativas viáveis:** "Plantão da Reserva" (2º lugar) ou "Controle de Turno" (mais neutro, funciona para bombeiros e GCM).

### Objetivo do módulo

Digitalizar a passagem de plantão entre armeiros responsáveis pela reserva de armamento, substituindo o livro físico por um relatório automático com assinatura dupla, rastreabilidade e acompanhamento do comando.

### Entidades necessárias

```sql
CREATE TYPE handover_status AS ENUM (
  'rascunho',           -- armeiro saindo está montando o relatório
  'assinado_saindo',    -- armeiro que sai assinou, aguarda assumção
  'assinado_ambos',     -- ambos assinaram, documento fechado
  'divergencia',        -- assumção com divergência registrada
  'vencido'             -- prazo de assumção esgotado sem assinatura
);

CREATE TABLE service_handovers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  unidade_id        UUID NOT NULL REFERENCES unidades(id),
  saindo_id         UUID NOT NULL REFERENCES profiles(id),   -- armeiro que sai
  entrando_id       UUID REFERENCES profiles(id),            -- armeiro que entra (pode ser null até assumção)
  status            handover_status DEFAULT 'rascunho',
  report_snapshot   JSONB NOT NULL,   -- snapshot automático: carga, cautelas abertas, pendências
  observacao_saindo TEXT,             -- observações do armeiro que sai
  observacao_entrada TEXT,            -- observações do armeiro que entra
  divergencia_descricao TEXT,
  prazo_assumcao    TIMESTAMPTZ,      -- configurável (ex: início do turno + 30min)
  assinado_saindo_at TIMESTAMPTZ,
  assinado_entrada_at TIMESTAMPTZ,
  saindo_signature_id  UUID,          -- FK document_signatures
  entrada_signature_id UUID,          -- FK document_signatures
  document_hash     TEXT,
  pdf_storage_path  TEXT,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE handover_attachments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handover_id   UUID NOT NULL REFERENCES service_handovers(id),
  uploader_id   UUID NOT NULL REFERENCES profiles(id),
  file_path     TEXT NOT NULL,   -- Supabase Storage path
  file_hash     TEXT NOT NULL,   -- SHA-256 do arquivo
  descricao     TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);
```

### Campos do `report_snapshot` (JSONB automático)

```json
{
  "data_referencia": "2026-06-20T18:00:00Z",
  "unidade": "1ª Reserva de Armamento",
  "carga_total": {
    "armas": 45,
    "coletes": 30,
    "radios": 15
  },
  "cautelas_ativas": [
    { "lending_id": "...", "military_nome": "...", "material": "...", "emissao": "..." }
  ],
  "devolucoes_turno": [...],
  "saidas_turno": [...],
  "solicitacoes_pendentes": [...],
  "ocorrencias_abertas": [...],
  "divergencias_turno": [...],
  "inventario_ultimo": { "data": "...", "percentual_conformidade": 98 }
}
```

### Fluxo detalhado

```
1. Armeiro saindo acessa "Livro Digital" → clica "Iniciar Passagem"
2. Sistema monta snapshot automático (carga atual, cautelas abertas, movimentos do turno)
3. Armeiro revisa relatório, adiciona observações opcionais, anexa foto se houver divergência
4. Armeiro confirma com TOTP → assina eletronicamente → status "assinado_saindo"
5. Sistema notifica armeiro entrante (push) com pendência urgente
6. Dentro do prazo configurado (ex: 30min), armeiro entrante acessa pendência
7. Armeiro entrante revisa relatório
   → Assumir em conformidade: confirma, assina, status "assinado_ambos"
   → Assumir com observação: adiciona nota, assina, status "assinado_ambos" (flag observação)
   → Assumir com divergência: descreve divergência, assina com divergência, status "divergencia"
8. Admin visualiza card "Livros Pendentes" no dashboard com contadores
9. Se prazo vencer sem assumção: status "vencido" + alerta para admin_global
10. Documento final imutável com hash encadeado de ambas as assinaturas
```

### Regras de negócio

- Um armeiro só pode ter uma passagem ativa por vez
- O armeiro entrante deve ser diferente do saindo
- Prazo configurável por unidade (padrão: 60 minutos)
- Passagem vencida gera notificação obrigatória para admin_reserva e admin_global
- Divergência gera ocorrência automática linkada ao handover
- PDF gerado somente após ambas as assinaturas (ou status "vencido")

### Endpoints BFF

```
POST   /api/handovers                     → criar/iniciar passagem
GET    /api/handovers                     → listar (com filtros: unidade, status, data)
GET    /api/handovers/:id                 → detalhe + snapshot
POST   /api/handovers/:id/sign-exit       → assinar como saindo
POST   /api/handovers/:id/sign-entry      → assinar como entrando
POST   /api/handovers/:id/divergence      → registrar divergência
POST   /api/handovers/:id/attachments     → upload de anexo/foto
GET    /api/handovers/:id/pdf             → PDF do documento
```

### Eventos de auditoria

```
handover.created            → passagem iniciada
handover.signed_exit        → armeiro saindo assinou
handover.signed_entry       → armeiro entrando assinou
handover.divergence_filed   → divergência registrada
handover.attachment_added   → anexo adicionado
handover.expired            → prazo vencido sem assumção
handover.closed             → documento finalizado
```

### Card no Dashboard de Comando

```
[Livro Digital]
  3 pendentes
  1 vencido   ← alerta vermelho
  2 divergências este mês
```

---

## 11. Assinatura Eletrônica

### Estratégia em 4 níveis

**Nível 1 — MVP (implementar agora):**
Assinatura interna com autenticação forte. Não substitui ICP-Brasil mas é juridicamente admissível como prova eletrônica em processos administrativos (conforme LGPD Art. 10 e Marco Civil Art. 10).

```
Fluxo:
1. Usuário inicia ação de assinatura
2. Sistema exibe documento renderizado para revisão
3. Usuário insere código TOTP (confirma identidade)
4. BFF valida TOTP + anti-replay
5. BFF coleta: IP, user_agent, timestamp, TOTP_session_id
6. BFF gera: document_hash = SHA-256(conteúdo canônico do documento)
7. BFF gera: signature_proof = SHA-256(document_hash + signer_id + timestamp + ip)
8. INSERT em document_signatures (imutável)
9. Documento marcado como "assinado" com reference ao signature record
```

**Nível 2 — Médio prazo:**
Passkey/WebAuthn — biometria do dispositivo (Face ID, Touch ID) sem armazenar dados biométricos no Fortex. Aprovado pelo W3C, suportado por todos os browsers modernos.

**Nível 3 — Sob demanda:**
Integração com Gov.br via OAuth2. Órgão federal pode exigir. Implementar como módulo plugável.

**Nível 4 — Casos específicos:**
ICP-Brasil (A1/A3) — apenas quando o regulamento do órgão exigir explicitamente.

### Tabelas necessárias

```sql
CREATE TABLE document_signatures (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signer_id        UUID NOT NULL REFERENCES profiles(id),
  document_type    TEXT NOT NULL,  -- "lending", "handover", "inventory", "divergence"
  document_id      UUID NOT NULL,  -- ID do documento assinado
  document_hash    TEXT NOT NULL,  -- SHA-256 do conteúdo canônico
  signature_proof  TEXT NOT NULL,  -- SHA-256(hash+signer+ts+ip)
  signed_at        TIMESTAMPTZ DEFAULT now(),
  ip               INET NOT NULL,
  user_agent       TEXT,
  totp_verified    BOOLEAN DEFAULT false,
  webauthn_used    BOOLEAN DEFAULT false,
  signature_level  INT DEFAULT 1,  -- 1=TOTP, 2=WebAuthn, 3=Gov.br, 4=ICP-Brasil
  revoked_at       TIMESTAMPTZ,    -- null = válida; não nulo = revogada (retificação)
  revocation_reason TEXT,
  replaced_by      UUID REFERENCES document_signatures(id)  -- nova assinatura após retificação
);

-- Imutável
CREATE RULE no_update_signatures AS ON UPDATE TO document_signatures DO INSTEAD NOTHING;
CREATE RULE no_delete_signatures AS ON DELETE TO document_signatures DO INSTEAD NOTHING;
```

### Como gerar hash do documento

```typescript
// apps/bff/src/lib/document-hash.ts
import { createHash } from "crypto";

export function hashDocument(content: {
  document_type: string;
  document_id: string;
  document_version: number;
  data: Record<string, unknown>;
}): string {
  // JSON canônico: chaves ordenadas, sem espaços
  const canonical = JSON.stringify(content, Object.keys(content).sort());
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
```

### Como retificar documento sem apagar histórico

```
1. Documento original marcado como "retificado" (campo retificado_em)
2. Assinatura original: revoked_at = now(), revocation_reason = "retificação"
3. Novo documento criado com conteúdo corrigido
4. Novo documento referencia o original (campo retifica_documento_id)
5. Nova assinatura criada para o documento corrigido
6. Histórico completo visível no audit trail
7. PDF do documento original arquivado com marca d'água "RETIFICADO"
```

---

## 12. Inventário Periódico

### Objetivo

Substituir os inventários físicos trimestrais/anuais por campanhas digitais com execução pelas unidades, consolidação central e conformidade auditável.

### Entidades

```sql
CREATE TYPE inventory_status AS ENUM (
  'planejado', 'em_andamento', 'aguardando_assinatura', 'concluido', 'cancelado'
);

CREATE TYPE item_check_status AS ENUM (
  'presente', 'cautelado', 'em_manutencao', 'transferido',
  'nao_localizado', 'divergente', 'baixado'
);

CREATE TABLE inventory_campaigns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  nome            TEXT NOT NULL,
  escopo_categorias TEXT[],          -- ['arma','colete','radio'] ou null = todos
  unidades_ids    UUID[],            -- unidades participantes
  prazo_inicio    TIMESTAMPTZ,
  prazo_fim       TIMESTAMPTZ NOT NULL,
  anexo_obrigatorio BOOLEAN DEFAULT false,  -- exige foto em divergência
  status          inventory_status DEFAULT 'planejado',
  criado_por      UUID NOT NULL REFERENCES profiles(id),
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE inventory_unit_checks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id      UUID NOT NULL REFERENCES inventory_campaigns(id),
  unidade_id       UUID NOT NULL REFERENCES unidades(id),
  responsavel_id   UUID REFERENCES profiles(id),
  status           inventory_status DEFAULT 'planejado',
  percentual_conformidade NUMERIC(5,2),
  assinatura_id    UUID REFERENCES document_signatures(id),
  fechado_em       TIMESTAMPTZ,
  observacoes      TEXT
);

CREATE TABLE inventory_item_checks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_check_id    UUID NOT NULL REFERENCES inventory_unit_checks(id),
  material_type_id UUID NOT NULL REFERENCES material_types(id),
  quantidade_esperada INT NOT NULL,
  quantidade_conferida INT,
  status_check     item_check_status,
  justificativa    TEXT,              -- obrigatória em divergente/não_localizado
  attachment_path  TEXT,             -- foto obrigatória se campaign.anexo_obrigatorio
  checado_por      UUID REFERENCES profiles(id),
  checado_em       TIMESTAMPTZ
);
```

### Fluxo alvo

```
1. Admin cria campanha → define escopo, unidades, prazo, obrigatoriedade de anexo
2. Sistema notifica unidades participantes
3. Para cada unidade:
   a. admin_reserva ou armeiro abre a conferência
   b. Sistema mostra carga esperada (material_types com quantidade_total)
   c. Responsável marca cada item (presente/cautelado/manutenção/transferido/não localizado/divergente/baixado)
   d. Divergências exigem justificativa + opcional foto
   e. Relatório parcial disponível para admin_global em tempo real
4. Após conferência completa, responsável assina eletronicamente
5. admin_global consolida todas as unidades
6. Relatório consolidado com percentual de conformidade por unidade
7. admin_global assina relatório final
8. Documento arquivado e imutável
```

### Eventos de auditoria

```
inventory.campaign_created     → campanha criada
inventory.unit_check_started   → conferência iniciada na unidade
inventory.item_checked         → item conferido (before: null, after: status_check)
inventory.divergence_flagged   → divergência registrada
inventory.unit_check_signed    → responsável da unidade assinou
inventory.campaign_consolidated → admin consolidou
inventory.campaign_signed      → relatório final assinado
```

---

## 13. Relatórios e Documentos

| # | Documento | Quando Gerado | Quem Gera | Quem Assina | Dados | Hash | QR Code |
|---|---|---|---|---|---|---|---|
| 1 | **Termo de Cautela** | Na emissão da cautela | Armeiro | Armeiro + Militar | Item, qtd, data, auth_mode, militar, armeiro | ✅ | ✅ |
| 2 | **Comprovante de Devolução** | Na devolução | Armeiro | Armeiro | Lending_id, data, qtd devolvida, divergência | ✅ | ✅ |
| 3 | **Livro Digital de Serviço** | Na passagem assinada | Sistema (automático) | Armeiro saindo + Armeiro entrando | Snapshot completo do turno | ✅ | ✅ |
| 4 | **Relatório de Inventário** | Ao fechar campanha | Admin global | Admin global + Responsáveis por unidade | Conformidade por unidade, divergências, itens | ✅ | ✅ |
| 5 | **Relatório de Divergência** | Ao registrar divergência | Sistema | Admin_reserva | Descrição, itens, evidências, resolução | ✅ | ❌ |
| 6 | **Histórico do Item** | Sob demanda | Admin | Não requer assinatura | Todo o ciclo de vida do material_type_id | ❌ | ❌ |
| 7 | **Histórico do Militar** | Sob demanda | Admin | Não requer assinatura | Todas as cautelas, solicitações, ocorrências | ❌ | ❌ |
| 8 | **Mapa de Carga** | Sob demanda | Admin/Armeiro | Não requer assinatura | Snapshot atual de todos os materiais por status | ❌ | ❌ |
| 9 | **Relatório de Conformidade** | Mensal (automático) | Sistema | Admin global | Cautelas por unidade, on-time return, divergências | ❌ | ❌ |
| 10 | **Relatório Executivo** | Sob demanda | Admin global | Não requer assinatura | KPIs, exceções, tendências, conformidade | ❌ | ❌ |

**QR Code documental:** gerado com URL de verificação pública `https://[dominio]/v/[document_id]?hash=[document_hash]`. Quem escaneia vê status de validade, signatários e timestamp — sem expor dados sensíveis.

**Tecnologia de PDF:** `@react-pdf/renderer` (melhor opção para Next.js) ou `puppeteer` headless. Arquivamento em Supabase Storage com path `tenants/{tenant_id}/docs/{year}/{document_type}/{document_id}.pdf`.

---

## 14. Importação em Massa

### Objetivo

Onboarding de uma nova PM com 5.000 militares, 50 unidades e inventário inicial de 2.000 itens — sem processo manual, sem inconsistências, sem dados duplicados.

### Fluxo

```
1. Admin faz upload do CSV/XLSX
2. Sistema detecta tipo: militares / unidades / carga
3. Validação sintática: colunas obrigatórias, tipos, formatos
4. Preview: primeiras 20 linhas com mapeamento de colunas sugerido
5. Admin confirma mapeamento
6. Detecção de duplicidade: matrícula existente? item com mesmo nome?
7. Detecção de inconsistência: posto inválido? unidade não existente?
8. Relatório de preview: X válidos, Y duplicatas, Z erros
9. Admin revisa e decide: importar apenas válidos / cancelar
10. Importação em batch (500 registros por vez, transacional)
11. Relatório final: X importados, Y atualizados, Z ignorados
12. Histórico da importação arquivado
```

### Entidades

```sql
CREATE TABLE import_jobs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id),
  tipo         TEXT NOT NULL CHECK (tipo IN ('militares','unidades','carga')),
  file_name    TEXT NOT NULL,
  file_path    TEXT NOT NULL,   -- Storage path do arquivo original
  status       TEXT DEFAULT 'pendente' CHECK (status IN ('pendente','validando','preview','importando','concluido','erro')),
  total_rows   INT,
  valid_rows   INT,
  imported     INT,
  updated      INT,
  errors       INT,
  error_log    JSONB,           -- array de {row, field, error}
  criado_por   UUID NOT NULL REFERENCES profiles(id),
  created_at   TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);
```

### Riscos

| Risco | Mitigação |
|---|---|
| Matrícula duplicada | Unique constraint em `profiles.matricula` por `tenant_id` |
| Upload de arquivo malicioso | Validar MIME type via magic bytes (`file-type` lib) + limite de tamanho |
| Import parcial em falha | Transação por batch — rollback se qualquer linha do batch falhar |
| Injeção via CSV | Sanitizar todos os campos antes de INSERT |
| Timeout em imports grandes | Processar em background (Supabase Edge Function ou BFF queue) |
| Desativar militares ausentes | Opção "desativar ausentes" na UI com confirmação explícita + audit log |

---

## 15. Dashboard de Comando

### Filosofia

O dashboard de comando não é para gestão operacional — é para **conformidade e exceções**. Um comandante não quer ver gráficos bonitos. Quer saber: o que está fora do padrão? O que pode gerar problema jurídico? Quem não assinou o que deveria?

### Cards e fontes de dados

| Card | Dado | Fonte | Role |
|---|---|---|---|
| **Livros Pendentes** | COUNT handovers WHERE status = 'assinado_saindo' | `service_handovers` | admin_global, admin_reserva |
| **Livros em Atraso** | COUNT handovers WHERE status = 'vencido' AND created_at > -7d | `service_handovers` | admin_global |
| **Divergências Abertas** | COUNT handovers WHERE status = 'divergencia' + ocorrencias abertas | `service_handovers`, `ocorrencias` | admin_global |
| **Cautelas Ativas** | COUNT lendings WHERE status = 'ativa' | `lendings` | admin_reserva, admin_global |
| **Cautelas Vencidas** | COUNT lendings WHERE prazo_devolucao < now() AND status = 'ativa' | `lendings` | admin_global |
| **Inventários Pendentes** | COUNT inventory_campaigns WHERE status != 'concluido' AND prazo_fim < now()+7d | `inventory_campaigns` | admin_global |
| **Unidades sem Fechamento** | Unidades sem handover assinado nas últimas 24h | `service_handovers` | admin_global |
| **Itens em Manutenção** | SUM inventory_item_checks WHERE status = 'em_manutencao' | `inventory_item_checks` | admin_global |
| **Itens Não Localizados** | SUM inventory_item_checks WHERE status = 'nao_localizado' | `inventory_item_checks` | admin_global |
| **Documentos aguardando assinatura** | COUNT (lendings + handovers + inventories) WITH pending signature | múltiplas tabelas | admin_reserva |
| **Conformidade por Unidade** | AVG percentual_conformidade do último inventário | `inventory_unit_checks` | admin_global |
| **Últimas Movimentações Críticas** | audit_events WHERE action LIKE 'divergence%' OR 'handover.expired' ORDER BY created_at DESC LIMIT 10 | `audit_events` | admin_global |
| **Exportações Realizadas** | COUNT audit_events WHERE action LIKE 'export%' AND created_at > -24h | `audit_events` | admin_global |
| **Alertas de Risco** | Soma de P0/P1 pendentes calculada pelo sistema | regras de negócio | superadmin, admin_global |

---

## 16. API Segura Futura

### Princípios

- API separada da BFF atual (base path `/v1/`)
- Autenticação por API keys por tenant (não OAuth2 no MVP — muita complexidade)
- Cada key tem escopos explícitos
- Rate limit por key, não por IP
- Todos os calls logados em `api_call_logs` separado
- Webhooks com assinatura HMAC para eventos críticos

### Endpoints planejados

```
GET    /v1/militares          → listar militares (scope: militares:read)
POST   /v1/militares          → criar militar (scope: militares:write)
GET    /v1/cautelas           → listar cautelas (scope: cautelas:read)
GET    /v1/cautelas/:id       → detalhe de uma cautela
GET    /v1/inventarios        → listar inventários (scope: inventarios:read)
POST   /v1/webhooks           → registrar webhook endpoint
DELETE /v1/webhooks/:id       → remover webhook
```

### Modelo de API keys

```sql
CREATE TABLE api_keys (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  nome        TEXT NOT NULL,
  key_hash    TEXT NOT NULL UNIQUE,   -- SHA-256 da key (nunca armazenar em plaintext)
  key_prefix  TEXT NOT NULL,          -- primeiros 8 chars para identificação visual
  scopes      TEXT[] NOT NULL,
  ip_allowlist INET[],                -- null = qualquer IP
  ativo       BOOLEAN DEFAULT true,
  ultimo_uso  TIMESTAMPTZ,
  criado_por  UUID REFERENCES profiles(id),
  created_at  TIMESTAMPTZ DEFAULT now(),
  expires_at  TIMESTAMPTZ
);
```

### Webhooks HMAC

```
Cada evento → BFF assina o payload com HMAC-SHA256 usando webhook_secret do cliente
Header: X-Fortex-Signature: sha256=<hmac>
Cliente valida antes de processar
```

---

## 17. Roadmap Enterprise Fase a Fase

### Fase 0 — Consolidação (Semana 1)

**Objetivo:** Estabilizar o que existe antes de construir.

| Item | Detalhe |
|---|---|
| **Entregáveis** | Fix do BFF no Brasil, expansão de RBAC, audit logs com tenant_id |
| **Tabelas afetadas** | `profiles`, `audit_logs` |
| **Arquivos** | `apps/bff/src/lib/session.ts`, `apps/bff/src/middleware/auth.ts`, `supabase/migrations/` |
| **Riscos** | Migração de roles pode quebrar guards existentes |
| **Testes** | Smoke tests (suite `chromium`) |
| **Critério de aceite** | 8/8 nexus tests passando + suite principal verde |

### Fase 1 — Multi-tenant Real (Semana 1-2)

**Objetivo:** Adicionar `tenant_id` + `unidade_id` com RLS correta.

| Item | Detalhe |
|---|---|
| **Entregáveis** | Tabelas `tenants` + `unidades`, `tenant_id` em todas as tabelas, RLS policies, provisioning via Nexus |
| **Tabelas afetadas** | TODAS (14 tabelas + 2 novas) |
| **Endpoints** | `POST /api/nexus/tenants`, `POST /api/nexus/tenants/:id/units` |
| **Riscos** | Downtime se migration falhar; dados existentes precisam de tenant_default |
| **Testes obrigatórios** | TT01-TT08 (isolamento de tenant) |
| **Critério de aceite** | Query de tenant A retorna zero resultados com sessão de tenant B |
| **Dependências** | Fase 0 concluída |

### Fase 2 — RBAC Institucional (Semana 2)

**Objetivo:** Expandir de 3 para 6 roles.

| Item | Detalhe |
|---|---|
| **Entregáveis** | `role_enum` expandido, guards atualizados, UI de seleção de role |
| **Arquivos** | `apps/bff/src/types/hono.ts`, `role-guard.ts`, migration SQL |
| **Riscos** | Break em guards existentes (admin = admin_global no novo sistema) |
| **Testes** | Teste de permissão por role (PT01-PT18) |
| **Critério de aceite** | Matrix de RBAC (Seção 6) 100% implementada e testada |
| **Dependências** | Fase 1 |

### Fase 3 — Segurança de Sessão e Auth Forte (Semana 2)

**Objetivo:** Corrigir P1s de segurança.

| Item | Detalhe |
|---|---|
| **Entregáveis** | IR Plan documento, desprovisionamento, criptografia de biometric_templates |
| **Arquivos** | `docs/INCIDENT_RESPONSE.md`, `apps/bff/src/routes/profiles.ts` |
| **Riscos** | Criptografia de biometria exige re-enrollment de todos os usuários |
| **Critério de aceite** | Zero P0 e P1 em aberto |

### Fase 4 — Auditoria Imutável (Semana 2-3)

**Objetivo:** `audit_events` com hash encadeado.

| Item | Detalhe |
|---|---|
| **Entregáveis** | Tabela `audit_events`, `computeEventHash()`, middleware de auditoria atualizado |
| **Arquivos** | `supabase/migrations/`, `apps/bff/src/lib/audit-hash.ts`, `apps/bff/src/middleware/audit.ts` |
| **Testes** | AT01-AT05 (hash, cadeia, imutabilidade) |
| **Critério de aceite** | Impossível alterar log sem invalidar hash; varredura de integridade verde |

### Fase 5 — Modelo de Carga Sensível (Semana 3)

**Objetivo:** Expandir `material_types` para suportar armas, coletes, rádios, viaturas, munições com campos específicos.

| Item | Detalhe |
|---|---|
| **Entregáveis** | Campos específicos por categoria (`numero_serie`, `numero_patrimonio`, `calibre`, etc.) |
| **Tabelas** | `material_types` (ALTER + novos campos nullable por categoria) |
| **Critério de aceite** | Arma tem número de série; viatura tem placa; rádio tem ID de frequência |

### Fase 6 — Cautela Eletrônica (Semana 3)

**Objetivo:** Transformar `lendings` em cautela com assinatura e hash.

| Item | Detalhe |
|---|---|
| **Entregáveis** | Status machine completa, assinatura dupla, hash de documento, PDF básico |
| **Tabelas** | `lendings` (ALTER), `document_signatures` (nova) |
| **Endpoints** | `/api/lendings/:id/confirm`, `/api/lendings/:id/sign` |
| **Critério de aceite** | Cautela assinada por ambas as partes com hash verificável |
| **Dependências** | Fase 4 (document_signatures usa audit_events) |

### Fase 7 — Passagem Operacional / Livro Digital (Semana 3-4)

**Objetivo:** Criar módulo de passagem de serviço.

| Item | Detalhe |
|---|---|
| **Entregáveis** | `service_handovers`, snapshot automático, assinatura dupla, notificações, card no dashboard |
| **Tabelas** | `service_handovers`, `handover_attachments` |
| **Endpoints** | 8 endpoints (Seção 10) |
| **Critério de aceite** | Passagem iniciada → assinada pelo saindo → assumida pelo entrando → PDF gerado |

### Fase 8 — Assinatura Eletrônica Nível 1 (Semana 4)

**Objetivo:** Padronizar assinatura com prova criptográfica.

| Item | Detalhe |
|---|---|
| **Entregáveis** | `document_signatures`, `hashDocument()`, `computeSignatureProof()`, verificação pública |
| **Critério de aceite** | Qualquer documento assinado tem hash verificável por terceiros via URL pública |

### Fases 9-15 (pós-piloto)

| Fase | Objetivo | Semanas estimadas |
|---|---|---|
| 9 | Inventário Periódico | 2 semanas |
| 10 | Relatórios e PDF enterprise | 2 semanas |
| 11 | Importação em massa | 1 semana |
| 12 | Dashboard de comando | 1 semana |
| 13 | API segura v1 | 2 semanas |
| 14 | Hardening enterprise (WebAuthn, LGPD endpoints, SIEM) | 2 semanas |
| 15 | Piloto institucional (PM-PB como primeiro cliente) | ongoing |

---

## 18. Plano de Execução para 30 Dias

### Semana 1 — Base Enterprise

**O que fazer:**
- [ ] Migrar BFF para Google Cloud Run sa-east-1 (elimina gap LGPD — P0)
- [ ] Criar `tenants` + `unidades` + migration de `tenant_id` em todas tabelas
- [ ] RLS policies de tenant isolation
- [ ] Expandir SessionData com `tenantId` + `unidadeId`
- [ ] Expandir role_enum: admin_global, admin_reserva, armeiro, usuario, auditor
- [ ] Atualizar guards e middleware
- [ ] Criar IR Plan (`docs/INCIDENT_RESPONSE.md`)
- [ ] Workflow de desprovisionamento de usuário

**O que NÃO fazer:**
- ❌ Não criar UI nova ainda
- ❌ Não implementar assinatura eletrônica
- ❌ Não tocar no fluxo de SSA

**Entregáveis:**
- Sistema funcionando com 2 tenants de teste sem vazamento entre eles
- TT01-TT08 passando
- Zero P0 e P1 em aberto

**Riscos:**
- Migração de banco com `tenant_id` pode exigir downtime se mal planejada

**Demonstração esperada (dia 7):**
> Criar tenant "PM-PB" e tenant "PM-SP" via Nexus. Logar como admin de PM-PB, mostrar que zero dados de PM-SP aparecem. Logar como admin de PM-SP, confirmar o mesmo.

---

### Semana 2 — Cautela Eletrônica e Carga Sensível

**O que fazer:**
- [ ] `audit_events` com hash SHA-256 encadeado
- [ ] Expandir `material_types` com campos específicos por categoria
- [ ] Status machine completa em `lendings`
- [ ] `document_signatures` tabela
- [ ] Assinatura eletrônica Nível 1 (TOTP + hash + proof)
- [ ] Confirmação de recebimento pelo militar
- [ ] PDF básico de cautela (sem estilização enterprise ainda)

**O que NÃO fazer:**
- ❌ Não implementar WebAuthn
- ❌ Não refatorar frontend existente

**Entregáveis:**
- Cautela emitida → assinada pelo armeiro → confirmada pelo militar → PDF gerado com hash

**Riscos:**
- Geração de PDF pode ter custo de performance — usar renderização assíncrona

**Demonstração esperada (dia 14):**
> Emitir cautela de uma pistola. Armeiro assina com TOTP. Militar recebe notificação, assina confirmando recebimento. Download do PDF da cautela com QR Code de verificação.

---

### Semana 3 — Passagem Operacional e Assinatura

**O que fazer:**
- [ ] `service_handovers` + `handover_attachments`
- [ ] Snapshot automático do turno
- [ ] Fluxo completo: iniciar → assinar saindo → assumir → assinar entrando
- [ ] Notificações push para armeiro entrante
- [ ] Alerta de prazo vencido
- [ ] Card no dashboard admin
- [ ] Upload de anexos/fotos na passagem

**O que NÃO fazer:**
- ❌ Não implementar inventário ainda
- ❌ Não implementar importação

**Entregáveis:**
- Passagem digital completa com assinatura dupla, PDF e trilha de auditoria

**Riscos:**
- Lógica de snapshot automático deve ser performática (sem bloquear a UI)

**Demonstração esperada (dia 21):**
> Armeiro "Silva" inicia passagem às 18h. Sistema monta relatório automático (3 cautelas ativas, 1 devolução no turno, carga atual). Silva assina. Armeiro "Santos" recebe push, revisa, assume em conformidade, assina. PDF gerado com dupla assinatura. Admin vê histórico.

---

### Semana 4 — Inventário, Dashboard e Apresentação

**O que fazer:**
- [ ] `inventory_campaigns` + `inventory_item_checks`
- [ ] Fluxo básico de campanha (criar → executar → assinar → relatório)
- [ ] Dashboard de comando com os 14 cards
- [ ] Seed de dados demo realista (300+ militares, 3 unidades, histórico de 90 dias)
- [ ] Ajustes de UX para apresentação
- [ ] Teste de carga com dados reais

**O que NÃO fazer:**
- ❌ Não implementar importação em massa (semana 4 é para fechar, não abrir)
- ❌ Não mudar infraestrutura na véspera da apresentação

**Demonstração esperada (dia 30):**
> Tour completo do sistema como admin_global da "PM-PB": dashboard de conformidade com exceções reais, cautela eletrônica, livro digital de passagem, inventário parcial em andamento, PDF de relatório assinado.

---

## 19. Plano de Testes Enterprise

### TT — Testes de Isolamento Multi-tenant

| ID | Teste | Como testar | Critério |
|---|---|---|---|
| TT01 | Token de tenant A não acessa dados de tenant B | Usar sessão do admin-B para GET /api/lendings — deve retornar [] | Zero vazamento |
| TT02 | admin_global de tenant A não vê usuários de B | GET /api/profiles com sessão tenant A | Apenas profiles com tenant_id=A |
| TT03 | admin_reserva só aprova saídas da sua unidade | Tentar POST /api/lendings com unidade de outro tenant | 403 |
| TT04 | JWT com tenant_id adulterado é rejeitado | Forjar `app_metadata.tenant_id` e tentar query | Supabase valida assinatura JWT; RLS bloqueia |
| TT05 | Nexus não vaza tenant_id de outros tenants | GET /api/nexus/events sem filtro | Logs apenas do tenant da sessão |
| TT06 | Criação de usuário sem tenant_id bloqueada | INSERT profiles sem tenant_id | NOT NULL constraint rejeita |
| TT07 | SQL injection cross-tenant via parâmetros | Injetar `' OR tenant_id='...'` em querystring | RLS ignora — query parametrizada |
| TT08 | superadmin consegue ver TODOS os tenants | Listar via service_role no Nexus | N tenants retornados sem filtro |

### PT — Testes de Permissão por Role

| ID | Teste | Critério |
|---|---|---|
| PT01 | armeiro NÃO pode criar tenant | 403 |
| PT02 | usuario NÃO pode aprovar SSA | 403 |
| PT03 | admin_reserva NÃO acessa /nexus | 403 |
| PT04 | auditor NÃO pode criar saída | 403 |
| PT05 | usuario PODE solicitar SSA | 200 |
| PT06 | armeiro PODE registrar saída | 200 |
| PT07 | admin_global PODE ver audit_logs do seu tenant | 200 |
| PT08 | auditor PODE exportar relatórios | 200 |

### CT — Testes de Cautela

| ID | Teste | Critério |
|---|---|---|
| CT01 | Cautela emitida sem material disponível é bloqueada | 409 Conflict |
| CT02 | Militar com cautela ativa não pode abrir nova (por tipo) | 409 Conflict |
| CT03 | Hash do documento é verificável após PDF gerado | Hash match |
| CT04 | Assinatura do armeiro registrada em document_signatures | Record criado |
| CT05 | Confirmação do militar registrada | Record criado |
| CT06 | Divergência na devolução cria ocorrência | ocorrencias.count + 1 |

### HT — Testes de Passagem Operacional

| ID | Teste | Critério |
|---|---|---|
| HT01 | Passagem criada com snapshot automático correto | JSON tem cautelas_ativas preenchido |
| HT02 | Prazo vencido marca status = 'vencido' | Status correto após deadline |
| HT03 | Assinatura dupla gera PDF com ambos os signatários | PDF contém nome + timestamp dos 2 |
| HT04 | Divergência gera alerta para admin | Notificação criada |

### AT — Testes de Auditoria

| ID | Teste | Critério |
|---|---|---|
| AT01 | Hash de evento calculado corretamente | Hash match manual |
| AT02 | Alteração de log invalida hash | Varredura de integridade detecta |
| AT03 | Tentativa de DELETE em audit_events falha silenciosamente | Zero rows deleted (RULE) |
| AT04 | Tentativa de UPDATE em audit_events falha silenciosamente | Zero rows updated (RULE) |
| AT05 | Cadeia de hash verificável sequencialmente | Todos os previous_hash corretos |

### ST — Testes de Sessão e Segurança

| ID | Teste | Critério |
|---|---|---|
| ST01 | Cookie sem iron-session retorna 401 | 401 |
| ST02 | Token TOTP reutilizado retorna 429/400 (anti-replay) | Rejeição |
| ST03 | Rate limit de login (5 falhas) bloqueia por 15min | 429 com Retry-After |
| ST04 | CSRF token inválido retorna 403 | 403 |
| ST05 | CORS origin não permitido retorna erro | Bloqueado |
| ST06 | Nexus sem nexusAuthorized retorna 401 | 401 |
| ST07 | Nexus session expirada (>2h) retorna 401 | 401 |

---

## 20. Recomendações Finais do Arquiteto

### O que deve ser feito imediatamente (próximos 7 dias)

1. **Migrar BFF para Google Cloud Run sa-east-1** — elimina o único gap LGPD real; sem isso qualquer órgão federal questiona a conformidade
2. **Adicionar `tenant_id` a todas as tabelas** — base arquitetural de toda a evolução; quanto mais cedo, mais barato
3. **Criar `service_handovers` (Livro Digital)** — é o módulo mais impactante para demonstrar valor ao comando; sem isso o sistema não substitui o processo atual
4. **Criar IR Plan** — exigido por qualquer compliance mínimo; é só documentação

### O que NÃO deve ser implementado ainda

- ❌ WebAuthn / Passkey — complexidade alta, impacto baixo no MVP
- ❌ Integração Gov.br — não é exigência do piloto
- ❌ API pública — sem segundo cliente real, não há demanda
- ❌ SIEM / alertas — nice-to-have, não bloqueia piloto
- ❌ Importação em massa — não é necessária para o piloto com dados seed

### Features essenciais para vender

1. **Livro Digital de Serviço** — substitui o processo manual mais visível e crítico
2. **Cautela eletrônica com assinatura** — dá validade jurídica ao registro
3. **TOTP 2FA** — já existe; é diferencial de segurança comprovável
4. **Dashboard de conformidade** — o comandante precisa ver exceções em tempo real
5. **Multi-tenant** — sem isso, o produto não é escalável para venda

### Features diferenciais (que tornam o produto premium)

- Biometria ZKTeco integrada (já existe — destacar)
- Realtime com Supabase (SSA, Nexus) — já existe
- Inventário periódico com campanha e conformidade
- PDF verificável com QR Code
- Trilha de auditoria com hash encadeado

### Features que podem esperar (backlog futuro)

- Viaturas como categoria específica (com placa, hodômetro)
- Munições com controle de lote e calibre
- Relatório executivo automático para WhatsApp/email
- App mobile nativo (React Native)
- Integração com folha de ponto

### Riscos que podem matar o produto

1. **Incidente de segurança antes do piloto** — um vazamento de dados de militares antes de ter IR plan e compliance LGPD é fatal
2. **Multi-tenant frágil** — um tenant vendo dados de outro é crime e derruba a reputação
3. **Passagem de serviço incompleta** — o comando vai rejeitar se o documento não tiver a mesma força jurídica do livro físico
4. **BFF fora do Brasil** — órgão federal pode não assinar contrato enquanto dados processados no exterior

### Posicionamento técnico do Fortex

> "Plataforma de governança operacional de bens sensíveis para órgãos de segurança pública, com rastreabilidade total, assinatura eletrônica, auditoria imutável e conformidade LGPD."

Não vender como "sistema de estoque". Vender como **plataforma de conformidade e rastreabilidade**. O estoque é consequência. O produto entrega: **prestação de contas digital substituindo papel**.

### Proposta de valor para órgãos de segurança

- **Reduz risco jurídico:** todo material controlado tem assinatura eletrônica rastreável
- **Elimina papel:** livro de plantão, cautelas e inventários 100% digitais
- **Conforma com LGPD:** dados em solo brasileiro, auditados, com direitos de acesso documentados
- **Escala sem operadores extras:** militar solicita remotamente via app, armeiro aprova remotamente
- **Prova de conformidade:** relatórios assinados e verificáveis para inspeções do comando

### Escopo ideal do piloto

- 1 PM estadual (PM-PB como piloto zero)
- 1 batalhão / 2-3 unidades de armamento
- ~200-500 militares ativos
- Módulos: autenticação + SSA + cautela eletrônica + livro digital de serviço
- Duração: 90 dias de operação assistida
- Meta: 100% das cautelas digitais + zero livro físico nessas 3 unidades

### Próximos 10 passos em ordem

1. **Migrar BFF → GCR sa-east-1** (elimina P0 de LGPD)
2. **Migration multi-tenant** (tenant_id em todas as tabelas)
3. **Expandir RBAC** para 6 roles com guards atualizados
4. **`audit_events` com hash encadeado** (base da auditoria enterprise)
5. **`document_signatures`** (base de todos os documentos assinados)
6. **Cautela eletrônica** (status machine + assinatura dupla + PDF)
7. **Livro Digital de Serviço** (`service_handovers` + snapshot automático)
8. **Dashboard de comando** (14 cards de conformidade e exceção)
9. **Seed de dados demo** (300+ militares, histórico de 90 dias)
10. **Apresentação institucional** com tour completo ao comando

---

## Resumo Executivo

**O Fortex já é um sistema funcional** que resolve o controle de saídas de armamento com autenticação forte (biometria + TOTP) e solicitação remota. Para ser uma plataforma enterprise apresentável a um estado maior, faltam 4 módulos centrais: Livro Digital de Serviço, Cautela Eletrônica com assinatura, Inventário Periódico e Dashboard de Conformidade. O multi-tenant real é o pré-requisito arquitetural de toda a evolução. O único gap regulatório crítico (P0) é o BFF na Alemanha, resolvido com a migração para Google Cloud Run São Paulo.

Com 30 dias de desenvolvimento focado nas Fases 0-8 deste roadmap, o Fortex estará apto a apresentação institucional, operação piloto e demonstração de valor para um segundo cliente.

---

*Relatório gerado em: 2026-06-20*  
*Repositório analisado: `c:\projetos\apmcb` (branch `main`)*  
*26 migrations Supabase analisadas | 12 rotas BFF mapeadas | 28 arquivos E2E inventariados*
