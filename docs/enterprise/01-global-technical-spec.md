# Especificação Técnica Global — Plataforma de Governança de Bens Sensíveis

> **Versão:** 1.0  
> **Data:** 2026-06-20  
> **Repositório:** `c:\projetos\apmcb` (branch `main`)  
> **Supabase Project:** `jepitcrkicwmvzrmllpn` (AWS sa-east-1)

---

## 1. Arquitetura Atual

```
┌─────────────────────────────────────────────────────────────────┐
│                    USUÁRIO FINAL (Browser / PWA)                │
└──────────────────────────────┬──────────────────────────────────┘
                               │ HTTPS
┌──────────────────────────────▼──────────────────────────────────┐
│              CLOUDFLARE PAGES (Edge CDN)                        │
│              Next.js 16.2.9 — App Router — edge runtime         │
│              React 19 · Tailwind 4 · Serwist PWA               │
│              apps/web/src/                                      │
└────────────┬────────────────────────────────┬───────────────────┘
             │ supabase-js anon key            │ BFF fetch (cookie)
             │ wss:// (Realtime)              │ HTTPS + iron-session
┌────────────▼────────────┐     ┌─────────────▼───────────────────┐
│  SUPABASE (AWS sa-east-1)│     │   BFF — Hono 4.7 + Bun         │
│  PostgreSQL + Auth       │     │   Hetzner VPS 91.99.113.89     │
│  Realtime + Storage      │◄────┤   Docker container              │
│  jepitcrkicwmvzrmllpn   │     │   apps/bff/src/                 │
└─────────────────────────┘     └─────────────────────────────────┘
```

### Componentes e responsabilidades atuais

| Componente | Tecnologia | Versão | Responsabilidade |
|---|---|---|---|
| Frontend | Next.js / React / Tailwind | 16.2.9 / 19 / 4 | UI, server components, proxies edge |
| BFF | Hono / Bun | 4.7 / 1.x | Auth, sessão, validação, lógica de negócio |
| Database | Supabase PostgreSQL | 15 | Dados, RLS, triggers, realtime |
| Auth | Supabase Auth | — | JWT, OAuth, email magic link |
| Sessão | iron-session | 8.0 | Cookie httpOnly `apmcb_session` (8h) |
| CDN | Cloudflare Pages | — | Deploy, edge caching, TLS |
| CAPTCHA | Cloudflare Turnstile | — | Anti-bot no login |
| Biometria | ZKTeco SDK | — | Identificação 1:N por impressão digital |
| Push | Web Push API | — | Notificações em background |
| Storage | Supabase Storage | — | Fotos de perfil (`profile-photos` bucket) |

---

## 2. Arquitetura Alvo (após Fases 0-8)

Mesma estrutura, com adição de:

```
┌────────────────────────────────────────────────────────────────┐
│  SUPABASE (AWS sa-east-1)                                      │
│  PostgreSQL + Auth + Realtime + Storage                         │
│  Tabelas: tenants, unidades, profiles (com tenant_id),         │
│  lendings, material_requests, service_handovers,               │
│  document_signatures, audit_events, inventory_campaigns, ...   │
└────────────────────────────────────────────────────────────────┘
           │                        │
           │ RLS (tenant_id)        │ service_role (BFF)
           ▼                        ▼
┌──────────────────────┐  ┌──────────────────────────────────────┐
│  Supabase Realtime   │  │  BFF (Hono + Bun, Hetzner)           │
│  audit_events CDC    │  │  SessionData: tenantId, unidadeId    │
│  /nexus stream       │  │  roleGuard: 6 roles institucionais   │
└──────────────────────┘  │  audit middleware: audit_events      │
                          │  document-hash.ts, signature-proof   │
                          └──────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────┐
│  Next.js 16 (CF Pages)                                        │
│  /nexus: super admin isolado                                  │
│  /(dashboard)/admin/: admin_global e admin_reserva           │
│  /(dashboard)/reserva/: armeiro                              │
│  /(dashboard)/cadete/: militar                               │
│  /v/[document_id]: verificação pública de documentos         │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. Frontend

**Localização:** `apps/web/`  
**Framework:** Next.js 16.2.9, App Router, edge runtime (Cloudflare Pages)  
**UI:** React 19, Tailwind 4, shadcn/ui (34 componentes em `src/components/ui/`)  
**Estado:** React Query (TanStack Query) para server state, `useState` para local state  
**Forms:** react-hook-form + Zod  
**Icons:** lucide-react  
**Toasts:** sonner  
**Charts:** recharts  
**PWA:** Serwist (service worker, cache, offline parcial)  
**Deploy:** Cloudflare Pages (automático via GitHub Actions)

### Rotas principais

| Rota | Role | Módulo |
|---|---|---|
| `/login` | público | Autenticação |
| `/auth/*` | público | OAuth callbacks |
| `/nexus/login` | público | Nexus 2FA step 1 |
| `/nexus` | superadmin | Nexus super admin |
| `/(dashboard)/admin/*` | admin | Painel do administrador |
| `/(dashboard)/reserva/*` | master/armeiro | Painel do armeiro |
| `/(dashboard)/cadete/*` | usuario/militar | Painel do militar |
| `/v/[document_id]` | público | Verificação de documento |

### Arquivos críticos do frontend

| Arquivo | Propósito |
|---|---|
| `apps/web/src/middleware.ts` | CSP + security headers em todas as rotas |
| `apps/web/src/app/layout.tsx` | Root layout (Providers, Sonner) |
| `apps/web/src/components/providers.tsx` | AuthListener + QueryClient + ThemeProvider |
| `apps/web/src/app/(dashboard)/layout.tsx` | Auth guard + perfil + AppShell |
| `apps/web/src/app/page.tsx` | Redirect por role |
| `apps/web/src/lib/supabase/client.ts` | Supabase browser client (anon key) |
| `apps/web/src/lib/supabase/server.ts` | Supabase server client (SSR, edge) |
| `apps/web/src/lib/csrf.ts` | `csrfHeaders()` helper para mutations |
| `apps/web/src/hooks/use-auth.ts` | Hook de autenticação |
| `apps/web/src/hooks/use-role.ts` | Hook de role |

---

## 4. Backend / BFF

**Localização:** `apps/bff/`  
**Framework:** Hono 4.7  
**Runtime:** Bun 1.x  
**Deploy:** Docker container no Hetzner VPS (91.99.113.89)  
**Processo:** `bun run src/index.ts` via docker-compose

### Pipeline de middleware

```typescript
// apps/bff/src/index.ts
app.use("*", cors(...))        // CORS controlado por CORS_ORIGINS env
app.use("*", secureHeaders())  // headers de segurança
app.use("*", rateLimitGeneral) // 120 req/min por IP
app.use("/api/*", authMiddleware)  // valida sessão ou Bearer
app.use("/api/*", csrfMiddleware)  // valida x-csrf-token em mutations
// routes registradas por módulo
```

### Rotas BFF existentes

| Arquivo | Rotas |
|---|---|
| `routes/auth.ts` | POST /api/auth/login, /logout, GET /api/auth/me |
| `routes/totp.ts` | GET /api/totp/status, POST /api/totp/setup, /validate, /self-validate |
| `routes/lendings.ts` | GET, POST /api/lendings, PATCH /api/lendings/:id/return |
| `routes/arsenal.ts` | GET, POST, PATCH, DELETE /api/arsenal |
| `routes/ssa.ts` | GET, POST /api/ssa, PATCH /api/ssa/:id/approve, /reject, /expire |
| `routes/profiles.ts` | GET, PATCH /api/profiles, GET /api/profiles/:id |
| `routes/dashboard.ts` | GET /api/dashboard/summary |
| `routes/biometric.ts` | POST /api/biometric/identify, /enroll, DELETE /api/biometric/:id |
| `routes/ocorrencias.ts` | GET, POST /api/ocorrencias, PATCH /api/ocorrencias/:id |
| `routes/notifications.ts` | GET, POST /api/notifications, PATCH /api/notifications/:id/read |
| `routes/push.ts` | POST /api/push/subscribe, /unsubscribe |
| `routes/nexus.ts` | GET /api/nexus/health, /metrics, /events, /errors, POST /clear-rate-limit, /logout |

### Arquivos críticos do BFF

| Arquivo | Propósito |
|---|---|
| `apps/bff/src/index.ts` | Entry point, pipeline de middleware, registro de rotas |
| `apps/bff/src/lib/session.ts` | `SessionData` interface e `sessionOptions` |
| `apps/bff/src/middleware/auth.ts` | Guard: iron-session ou Bearer token |
| `apps/bff/src/middleware/role-guard.ts` | `roleGuard()` helper |
| `apps/bff/src/middleware/csrf.ts` | Validação de CSRF em mutations |
| `apps/bff/src/middleware/rate-limit.ts` | Sliding window por IP (3 níveis) |
| `apps/bff/src/middleware/audit.ts` | Fire-and-forget insert em audit_logs |
| `apps/bff/src/services/supabase.ts` | Client Supabase service_role |
| `apps/bff/src/services/fingerprint/` | ZKTeco SDK abstraction |
| `apps/bff/src/types/hono.ts` | `HonoVariables` type |

---

## 5. Supabase Auth

**Projeto:** `jepitcrkicwmvzrmllpn` (AWS sa-east-1)  
**Métodos suportados:** Email + senha, Google OAuth  
**Email:** Supabase built-in (Mailtrap em dev)  
**CAPTCHA:** Cloudflare Turnstile integrado no login

### Fluxo de autenticação

```
1. Usuário: email/matrícula + senha no /login
2. Se matrícula: RPC get_email_by_matricula() → resolve email
3. Frontend: supabase.auth.signInWithPassword(email, password)
   → Supabase retorna access_token + refresh_token (cookies automáticos)
4. Frontend: POST /api/auth/login → BFF
   BFF: supabase.auth.getUser(token) → busca role em profiles
   BFF: getIronSession() → salva {userId, role, supabaseAccessToken}
   BFF: seta cookie apmcb_session (httpOnly) + csrf-token (não httpOnly)
5. Redirect por role: admin→/admin, master→/reserva, usuario→/cadete
```

---

## 6. Supabase Database

**PostgreSQL 15** com extensions: `uuid-ossp`, `pgcrypto`  
**26 migrations** em `supabase/migrations/` (ordem cronológica)

### Migrations críticas

| Migration | Propósito |
|---|---|
| `20260611000001_initial_schema.sql` | Schema base: profiles, lendings, material_types, audit_logs, notifications, biometric_templates |
| `20260611000002_rls_policies.sql` | RLS policies iniciais |
| `20260614000004_totp_antireplay.sql` | Anti-replay TOTP via last_used_token |
| `20260615000001_ssa_schema.sql` | Material requests + items + totp_secrets (12KB) |
| `20260617000006_ocorrencias.sql` | Tabela de incidentes |
| `20260619000002_nexus_realtime.sql` | REPLICA IDENTITY FULL em audit_logs; Nexus realtime |

### Tabelas existentes

| Tabela | Propósito | Status enterprise |
|---|---|---|
| `profiles` | Usuários (estende auth.users) | Falta tenant_id, unidade_id |
| `material_types` | Catálogo de bens sensíveis | Falta tenant_id |
| `material_availability` | View: qtd disponível | Derivada |
| `lendings` | **SAÍDA DIÁRIA** — armamento de turno de serviço (check-out/in) | Falta assinatura, status machine completa |
| `material_requests` | SSA — cabeçalho | Falta tenant_id |
| `material_request_items` | SSA — itens | Falta tenant_id |
| `totp_secrets` | Segredos TOTP por usuário | Seguro, sem RLS anon |
| `biometric_templates` | Templates biométricos ZKTeco | Falta criptografia em repouso |
| `ocorrencias` | Incidentes reportados | Falta tenant_id |
| `notifications` | Notificações push | Falta tenant_id |
| `audit_logs` | Trilha de auditoria básica | Falta hash, before/after, tenant_id |

### Tabelas a criar (Fases 1-8)

| Tabela | Fase | Propósito |
|---|---|---|
| `tenants` | 1 | Multi-tenant |
| `unidades` | 1 | Unidades por tenant |
| `material_items` | 1 | **Rastreamento de item físico individual** — estado operacional, identificação, posse atual |
| `audit_events` | 3 | Auditoria imutável com hash encadeado |
| `document_signatures` | 4 | Assinaturas eletrônicas Nível 1 |
| `cautelamentos` | 5 | Cautela por tempo indeterminado — Termo de Cautela assinado, conferência periódica |
| `service_handovers` | 6 | Passagem de serviço digital |
| `handover_attachments` | 6 | Anexos da passagem |
| `inventory_campaigns` | 8 | Campanhas de inventário |
| `inventory_unit_checks` | 8 | Conferência por unidade |
| `inventory_item_checks` | 8 | Conferência por item |
| `api_keys` | 12 | Chaves de API pública |

### Regra Central: Um Item, Uma Posse Ativa

> Esta é a regra de integridade mais crítica da plataforma.

Um item sensível só pode ter **uma posse operacional ativa por vez**. Garantido por trigger de banco (`trg_validate_item_transition` em `material_items`), não apenas pelo backend.

| Status | Pode iniciar saída? | Pode iniciar cautela? |
|---|---|---|
| `disponivel` | ✅ Sim | ✅ Sim |
| `em_saida` | ❌ Bloqueado (P0001) | ❌ Bloqueado (P0001) |
| `cautelado` | ❌ Bloqueado (P0001) | ❌ Bloqueado (P0001) |
| `manutencao` | ❌ Bloqueado (P0002) | ❌ Bloqueado (P0002) |
| `extraviado` | ❌ Bloqueado (P0002) | ❌ Bloqueado (P0002) |
| `baixado` | ❌ Estado final | ❌ Estado final |
| `inapto` | ❌ Estado final | ❌ Estado final |

### Distinção de Domínio: Saída Diária vs Cautela por Tempo Indeterminado

| | `lendings` (Saída Diária) | `cautelamentos` (Cautela por Tempo Indeterminado) |
|---|---|---|
| **Propósito** | Armamento para turno de serviço | Responsabilidade pessoal; conferência periódica |
| **Prazo** | Retorno ao fim do turno | Sem prazo — devolve quando quiser/vencer/substituir |
| **Documento** | Comprovante de saída + PDF | Termo de Cautela assinado + PDF |
| **Assinatura** | Dupla (armeiro + militar) | Dupla + assume responsabilidade legal |
| **Retorno** | Obrigatório ao fim do turno | Voluntário, por substituição ou vencimento do item |
| **Item físico** | `lendings.item_id → material_items.id` | `cautelamentos.item_id → material_items.id` |
| **Exemplo** | "Pego pistola para o serviço, devolvo quando terminar" | "Estou cautelado com esta Glock e este colete no meu nome" |
| **Fase** | Existente (enterprise na Fase 5) | Nova tabela na Fase 5 |

---

## 7. Iron Session

**Biblioteca:** `iron-session` v8  
**Cookie:** `apmcb_session` (httpOnly, secure, sameSite=strict, 8h TTL)  
**Arquivo:** `apps/bff/src/lib/session.ts`

### SessionData atual

```typescript
export interface SessionData {
  userId: string;
  role: "admin" | "master" | "usuario";
  supabaseAccessToken: string;
  nexusAuthorized?: boolean;
  nexusAuthorizedAt?: number;
}
```

### SessionData alvo (após Fases 1-2)

```typescript
export interface SessionData {
  userId: string;
  role: Role;                    // role expandido: 6 valores
  tenantId: string;              // Fase 1: obrigatório após MT
  unidadeId?: string;            // Fase 1: para admin_reserva e armeiro
  supabaseAccessToken: string;
  nexusAuthorized?: boolean;
  nexusAuthorizedAt?: number;
}

type Role =
  | "superadmin"
  | "admin_global"
  | "admin_reserva"
  | "armeiro"
  | "usuario"
  | "auditor";
```

---

## 8. Cloudflare Turnstile

**Propósito:** Anti-bot no formulário de login  
**Integração:** Widget no frontend (`/login`); verificação no BFF via secret key  
**Variável de ambiente frontend:** `NEXT_PUBLIC_TURNSTILE_SITE_KEY`  
**Variável de ambiente BFF:** `TURNSTILE_SECRET_KEY`  
**Quando ignorar:** Em testes E2E (modo bypass via token especial da Cloudflare)

---

## 9. Storage / Anexos

**Bucket atual:** `profile-photos` (fotos de perfil)  
**Configuração:** público para leitura (anon pode ver foto via URL assinada)

### Buckets a criar (Fases 5-8)

| Bucket | Fase | Propósito | Acesso |
|---|---|---|---|
| `custody-docs` | 5 | PDFs de cautela | Privado, acesso via service_role |
| `handover-docs` | 6 | PDFs de passagem de serviço | Privado |
| `handover-attachments` | 6 | Fotos de divergência | Privado |
| `inventory-docs` | 8 | PDFs de inventário | Privado |

**Path pattern:** `tenants/{tenant_id}/{year}/{document_type}/{document_id}.pdf`

---

## 10. Multi-tenant

**Princípio:** Isolamento completo via `tenant_id` em todas as tabelas sensíveis + RLS.

### Abordagem técnica

O `tenant_id` é propagado via:
1. `auth.jwt()->'app_metadata'->>'tenant_id'` no Supabase (setado pelo BFF na criação do usuário)
2. `session.tenantId` no iron-session (setado no login)
3. Filtro explícito `eq("tenant_id", tenantId)` em cada query do BFF

A RLS é a segunda linha de defesa — nunca a única.

### RLS pattern universal (após Fase 1)

```sql
-- Para toda tabela com tenant_id
CREATE POLICY "tenant_isolation" ON <tabela>
  USING (tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid);

-- Superadmin: usa service_role, sem RLS aplicável
```

### Hierarquia

```
tenants (1)
  └── unidades (N por tenant)
        └── profiles (N por unidade)
              └── lendings, material_requests, service_handovers, ...
```

---

## 11. RBAC

**Atual:** 3 roles (admin, master, usuario)  
**Alvo (Fase 2):** 6 roles institucionais

### Roles e rotas de acesso

| Role | Rota principal | Nexus |
|---|---|---|
| `superadmin` | `/nexus` | ✅ |
| `admin_global` | `/(dashboard)/admin` | ❌ |
| `admin_reserva` | `/(dashboard)/admin` (escopo unidade) | ❌ |
| `armeiro` | `/(dashboard)/reserva` | ❌ |
| `usuario` | `/(dashboard)/cadete` | ❌ |
| `auditor` | `/(dashboard)/admin` (leitura) | ❌ |

### RoleGuard no BFF

```typescript
// apps/bff/src/middleware/role-guard.ts
export const roleGuard = (...allowedRoles: Role[]) => {
  return async (c: Context, next: Next) => {
    const role = c.get("role") as Role;
    if (!allowedRoles.includes(role)) {
      return c.json({ error: "Forbidden" }, 403);
    }
    await next();
  };
};

// Uso
nexusRoutes.get("/events", requireNexusSession, roleGuard("superadmin"), ...)
lendingsRoutes.post("/", roleGuard("armeiro", "admin_reserva", "admin_global"), ...)
```

---

## 12. RLS (Row Level Security)

**Princípio:** RLS como segunda camada de defesa. BFF sempre filtra por tenant_id explicitamente.

### Patterns de RLS existentes

```sql
-- profiles: usuário vê apenas seu próprio perfil via anon key
CREATE POLICY "users_see_own_profile" ON profiles
  FOR SELECT USING (id = auth.uid());

-- audit_logs: apenas admin pode SELECT (via service_role no BFF)
CREATE POLICY "admin_reads_audit_logs" ON audit_logs
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );
```

### Patterns a implementar (Fase 1)

```sql
-- Isolamento de tenant em todas as tabelas sensíveis
CREATE POLICY "tenant_isolation" ON lendings
  USING (tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid);

-- Admin_reserva vê apenas sua unidade
CREATE POLICY "unit_isolation" ON lendings
  USING (
    unidade_id = (auth.jwt()->'app_metadata'->>'unidade_id')::uuid
    OR (auth.jwt()->'app_metadata'->>'role') IN ('admin_global', 'superadmin')
  );
```

---

## 13. Auditoria

### Estado atual (`audit_logs`)

```sql
-- Tabela atual (básica)
CREATE TABLE audit_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id      UUID REFERENCES profiles(id),
  action        TEXT NOT NULL,
  resource_type TEXT,
  resource_id   UUID,
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Imutabilidade via RULE SQL (mais forte que RLS — bypassa service_role)
CREATE RULE no_update AS ON UPDATE TO audit_logs DO INSTEAD NOTHING;
CREATE RULE no_delete AS ON DELETE TO audit_logs DO INSTEAD NOTHING;
```

### Alvo (Fase 3 — `audit_events`)

```sql
CREATE TABLE audit_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seq             BIGSERIAL NOT NULL,
  tenant_id       UUID REFERENCES tenants(id),
  unidade_id      UUID REFERENCES unidades(id),
  actor_id        UUID REFERENCES profiles(id),
  actor_role      TEXT NOT NULL,
  action          TEXT NOT NULL,      -- namespace.verb: "lending.created"
  resource_type   TEXT NOT NULL,
  resource_id     UUID,
  before_snapshot JSONB,
  after_snapshot  JSONB,
  metadata        JSONB DEFAULT '{}',
  ip              INET,
  user_agent      TEXT,
  device_id       TEXT,
  event_hash      TEXT NOT NULL,      -- SHA-256(seq||actor||action||before||after||ts)
  previous_hash   TEXT,               -- hash do evento anterior (cadeia)
  created_at      TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE RULE no_update AS ON UPDATE TO audit_events DO INSTEAD NOTHING;
CREATE RULE no_delete AS ON DELETE TO audit_events DO INSTEAD NOTHING;
```

### Função de hash (Fase 3)

```typescript
// apps/bff/src/lib/audit-hash.ts
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
  const payload = JSON.stringify(params, Object.keys(params).sort());
  return createHash("sha256").update(payload, "utf8").digest("hex");
}
```

---

## 14. Assinatura Eletrônica

### Nível 1 — TOTP + Hash Documental (Fase 4)

```typescript
// apps/bff/src/lib/document-hash.ts
import { createHash } from "crypto";

export function hashDocument(content: {
  document_type: string;
  document_id: string;
  data: Record<string, unknown>;
}): string {
  const canonical = JSON.stringify(content, Object.keys(content).sort());
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

// apps/bff/src/lib/signature-proof.ts
export function computeSignatureProof(params: {
  document_hash: string;
  signer_id: string;
  signed_at: string;
  ip: string;
}): string {
  const payload = JSON.stringify(params, Object.keys(params).sort());
  return createHash("sha256").update(payload, "utf8").digest("hex");
}
```

### Tabela `document_signatures` (Fase 4)

```sql
CREATE TABLE document_signatures (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signer_id        UUID NOT NULL REFERENCES profiles(id),
  document_type    TEXT NOT NULL,   -- "lending", "handover", "inventory"
  document_id      UUID NOT NULL,
  document_hash    TEXT NOT NULL,   -- SHA-256 do conteúdo canônico
  signature_proof  TEXT NOT NULL,   -- SHA-256(hash+signer+ts+ip)
  signed_at        TIMESTAMPTZ DEFAULT now(),
  ip               INET NOT NULL,
  user_agent       TEXT,
  totp_verified    BOOLEAN DEFAULT false,
  signature_level  INT DEFAULT 1,   -- 1=TOTP, 2=WebAuthn(futuro), 3=Gov.br(futuro)
  revoked_at       TIMESTAMPTZ,
  revocation_reason TEXT,
  replaced_by      UUID REFERENCES document_signatures(id)
);

CREATE RULE no_update_signatures AS ON UPDATE TO document_signatures DO INSTEAD NOTHING;
CREATE RULE no_delete_signatures AS ON DELETE TO document_signatures DO INSTEAD NOTHING;
```

### Níveis futuros (NÃO implementar no MVP)

- **Nível 2:** WebAuthn/Passkey — biometria do dispositivo (Fase 10+)
- **Nível 3:** Gov.br OAuth2 — identidade governamental (Fase 12+)
- **Nível 4:** ICP-Brasil A1/A3 — apenas quando regulamento exigir

---

## 15. Documentos e PDFs

**Biblioteca:** `@react-pdf/renderer` (Next.js compatible) ou `puppeteer` headless  
**Geração:** no BFF, retorna Buffer, salva em Supabase Storage  
**Path:** `tenants/{tenant_id}/docs/{year}/{type}/{document_id}.pdf`  
**QR Code:** URL pública `https://[dominio]/v/{document_id}?hash={document_hash}`

### Rota de verificação pública (Fase 4)

```typescript
// apps/web/src/app/v/[document_id]/page.tsx
// Página pública, sem autenticação
// Recebe document_id + hash como query param
// Exibe: tipo, data, signatários, status (válido/revogado/não encontrado)
// Não exibe dados sensíveis do documento
```

---

## 16. Relatórios

Tabela de relatórios planejados:

| # | Documento | Fase | Assinatura | PDF | QR |
|---|---|---|---|---|---|
| 1 | Termo de Cautela | 5 | ✅ Dupla | ✅ | ✅ |
| 2 | Comprovante de Devolução | 5 | ✅ | ✅ | ✅ |
| 3 | Livro Digital de Serviço | 6 | ✅ Dupla | ✅ | ✅ |
| 4 | Relatório de Inventário | 8 | ✅ | ✅ | ✅ |
| 5 | Histórico de Item | 5+ | ❌ | ✅ | ❌ |
| 6 | Histórico de Militar | 5+ | ❌ | ✅ | ❌ |
| 7 | Relatório de Conformidade | 8 | ✅ | ✅ | ❌ |

---

## 17. Dashboard

### Cards existentes (ativas em produção)
- Contagem de usuários por status
- Cautelas ativas
- Solicitações pendentes (SSA)
- Ocorrências abertas

### Cards a criar (Fase 7)
14 cards de exceção e conformidade. Ver `phases/phase-7-command-dashboard.md` para lista completa.

**Fontes de dados:**
- `service_handovers` — passagens pendentes/em atraso
- `lendings` — cautelas ativas/vencidas
- `inventory_campaigns` — inventários pendentes
- `audit_events` — movimentações críticas recentes
- `ocorrencias` — divergências abertas

---

## 18. Inventário

### Entidades (Fase 8)

```sql
CREATE TABLE inventory_campaigns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  nome            TEXT NOT NULL,
  escopo_categorias TEXT[],     -- null = todas as categorias
  unidades_ids    UUID[],
  prazo_inicio    TIMESTAMPTZ,
  prazo_fim       TIMESTAMPTZ NOT NULL,
  anexo_obrigatorio BOOLEAN DEFAULT false,
  status          TEXT DEFAULT 'planejado',
  criado_por      UUID NOT NULL REFERENCES profiles(id),
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

---

## 19. Saída Diária Enterprise + Cautela Permanente (Fase 5)

> **Atenção:** São dois domínios SEPARADOS — ver seção "Distinção crítica de domínio" acima.

### Saída Diária — Status machine de `lendings` (Fase 5)

```
emitida → aguardando_confirmacao → ativa → devolvida
                                         → divergencia
                                  → cancelada (antes de ativa)
```

### ALTER TABLE lendings (Fase 5) — Saída Diária Enterprise

A Fase 1 já renomeia `status` → `status_legacy`. A Fase 5 adiciona `status` canônico e `item_id`:

```sql
-- Fase 1 (já aplicado): RENAME COLUMN status TO status_legacy
-- Fase 5 adiciona:
ALTER TABLE lendings
  ADD COLUMN item_id UUID REFERENCES material_items(id),   -- item físico individual
  ADD COLUMN status TEXT DEFAULT 'emitida'
    CHECK (status IN ('emitida','aguardando_confirmacao','ativa','devolvida','divergencia','cancelada')),
  ADD COLUMN unidade_id UUID REFERENCES unidades(id),
  ADD COLUMN prazo_devolucao TIMESTAMPTZ,
  ADD COLUMN observacao_emissao TEXT,
  ADD COLUMN observacao_devolucao TEXT,
  ADD COLUMN armeiro_signature_id UUID REFERENCES document_signatures(id),
  ADD COLUMN militar_signature_id UUID REFERENCES document_signatures(id),
  ADD COLUMN document_hash TEXT,
  ADD COLUMN pdf_storage_path TEXT;
-- Toda criação/devolução de saída atualiza material_items.status_operacional atomicamente.
-- O trigger trg_validate_item_transition garante integridade de posse.
```

### Cautela por Tempo Indeterminado — Nova tabela `cautelamentos` (Fase 5)

```sql
-- Cautela referencia o item físico individual via item_id
-- material_type_id e numero_serie ficam em material_items — não duplicar aqui
CREATE TABLE cautelamentos (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id),
  unidade_id            UUID NOT NULL REFERENCES unidades(id),
  item_id               UUID NOT NULL REFERENCES material_items(id),  -- item físico individual
  militar_id            UUID NOT NULL REFERENCES profiles(id),
  armeiro_id            UUID NOT NULL REFERENCES profiles(id),
  condicao_emissao      TEXT NOT NULL DEFAULT 'bom',
  condicao_devolucao    TEXT,
  motivo_emissao        TEXT NOT NULL,
  data_emissao          TIMESTAMPTZ NOT NULL DEFAULT now(),
  data_devolucao        TIMESTAMPTZ,
  data_ultima_conferencia TIMESTAMPTZ,
  prazo_proxima_conferencia DATE,
  status                TEXT NOT NULL DEFAULT 'ativa'
    CHECK (status IN ('ativa','devolvida','substituida','em_revisao','cancelada')),
  substituido_por       UUID REFERENCES cautelamentos(id),
  substitui             UUID REFERENCES cautelamentos(id),
  militar_signature_id  UUID REFERENCES document_signatures(id),
  armeiro_signature_id  UUID REFERENCES document_signatures(id),
  document_hash         TEXT NOT NULL,
  pdf_storage_path      TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Toda criação/encerramento de cautela atualiza material_items.status_operacional atomicamente.
```

### Status machine de `cautelamentos`

```
ativa → devolvida          (devolução normal → item volta para disponivel)
ativa → substituida        (substituição → nova cautela criada com substitui=id_antiga)
ativa → em_revisao → ativa (conferência periódica, retorna ativa)
```

### Estado operacional de `material_items` — máquina de estados global

```
disponivel
  ├──→ em_saida (saída diária iniciada)     ──→ disponivel (devolução)
  │                                         ──→ manutencao / extraviado / inapto
  └──→ cautelado (cautela iniciada)         ──→ disponivel (encerramento normal)
                                            ──→ manutencao / extraviado / inapto

manutencao ──→ disponivel (resolvido)
             ──→ baixado / inapto
extraviado ──→ disponivel (recuperado)
             ──→ baixado
baixado    (estado final)
inapto     ──→ baixado (estado final)
```

---

## 20. Livro Digital de Serviço

### Tabela (Fase 6)

```sql
CREATE TABLE service_handovers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  unidade_id        UUID NOT NULL REFERENCES unidades(id),
  saindo_id         UUID NOT NULL REFERENCES profiles(id),
  entrando_id       UUID REFERENCES profiles(id),
  status            TEXT DEFAULT 'rascunho',
  report_snapshot   JSONB NOT NULL,   -- snapshot automático do turno
  observacao_saindo TEXT,
  observacao_entrada TEXT,
  divergencia_descricao TEXT,
  prazo_assumcao    TIMESTAMPTZ,
  saindo_signature_id  UUID REFERENCES document_signatures(id),
  entrada_signature_id UUID REFERENCES document_signatures(id),
  document_hash     TEXT,
  pdf_storage_path  TEXT,
  created_at        TIMESTAMPTZ DEFAULT now()
);
```

### Campos do snapshot (JSONB automático)

```json
{
  "data_referencia": "ISO timestamp",
  "unidade": "nome da unidade",
  "carga_total": { "armas": N, "coletes": N, "radios": N },
  "cautelas_ativas": [...],
  "devolucoes_turno": [...],
  "saidas_turno": [...],
  "solicitacoes_pendentes": [...],
  "ocorrencias_abertas": [...]
}
```

---

## 21. Segurança de Sessão

### Camadas de proteção

| Camada | Mecanismo | Arquivo |
|---|---|---|
| 1 | Supabase Auth (JWT) | Supabase gerencia |
| 2 | iron-session (httpOnly cookie) | `apps/bff/src/lib/session.ts` |
| 3 | CSRF duplo token | `apps/bff/src/middleware/csrf.ts` |
| 4 | Rate limiting | `apps/bff/src/middleware/rate-limit.ts` |
| 5 | TOTP anti-replay | `supabase/migrations/20260614*` |
| 6 | RLS por role e tenant | `supabase/migrations/` |
| 7 | CSP estrita | `apps/web/src/middleware.ts` |
| 8 | Nexus session isolada (2h TTL) | `apps/bff/src/routes/nexus.ts` |

### Bearer token fallback

Quando não há cookie de sessão (server components Next.js), o BFF aceita `Authorization: Bearer <token>` e valida via `supabase.auth.getUser(token)`. Usado apenas internamente.

---

## 22. Logs

### O que é logado hoje (audit_logs)
- Ações de autenticação (login_failed, logout)
- Ações em lendings (create, return)
- Ações em SSA (create, approve, reject)
- Ações do Nexus (nexus.login, clear_rate_limit)

### O que será logado (audit_events, Fase 3)
- Todo o acima + before_snapshot e after_snapshot
- Leituras sensíveis (export de dados)
- Assinaturas eletrônicas
- Passagens de serviço
- Inventários
- Alterações de configuração de tenant

### O que NUNCA é logado
- Senhas (nem hash)
- Tokens TOTP
- Session secrets
- Tokens de API
- Templates biométricos

---

## 23. Tratamento de Erro

### Padrão de resposta de erro no BFF

```typescript
// Status codes obrigatórios
// 400 — Bad Request (validação)
// 401 — Unauthorized (sem sessão)
// 403 — Forbidden (role insuficiente)
// 404 — Not Found
// 409 — Conflict (ex: material já cautelado)
// 422 — Unprocessable Entity (regra de negócio)
// 429 — Too Many Requests (rate limit)
// 500 — Internal Server Error (inesperado)

return c.json({ error: "Mensagem clara para o cliente" }, statusCode);
```

### Padrão no Frontend

- Erros de API: toast via sonner
- Erros de formulário: FormMessage abaixo do campo
- Erros de carregamento: Alert component
- Erros fatais (não recuperáveis): ErrorBoundary (a implementar)

---

## 24. Deploy Atual

### Frontend (CF Pages)
- Trigger: push para `main` → GitHub Actions → `pnpm build` → CF Pages deploy
- Build: `pnpm --filter web build`
- Arquivo: `.github/workflows/` (CF Pages automático via integração)
- Tempo médio de deploy: 2-4 minutos

### BFF (Hetzner)
- Trigger: manual via script ou SSH
- Script: `infra/scripts/deploy-bff.sh` (em `/opt/apmcb/scripts/` no Hetzner)
- Processo: `docker compose pull && docker compose up -d`
- Dockerfile: `apps/bff/Dockerfile`
- Nginx: `nginx/` com configuração de reverse proxy e SSL

---

## 25. Portabilidade Futura para Cloud Run (Fase 11)

O BFF é agnóstico de plataforma — roda em qualquer container. A migração para Google Cloud Run sa-east-1 requer:

1. `Dockerfile` de produção (já existe em `apps/bff/Dockerfile`)
2. Variáveis de ambiente via Google Secret Manager
3. `CORS_ORIGINS` via env var (já parametrizado)
4. Health check em `GET /health` (já existe via `/api/nexus/health`)
5. Logging JSON estruturado (adicionar em Fase 10/11)
6. DNS cutover: `bff.dominio.com.br` → Cloud Run URL

---

## 26. Resend (Fase 9)

**Biblioteca:** `resend` SDK v3  
**Uso:** E-mails transacionais (convite, setup TOTP, pendências, cautelas)  
**Variáveis:** `RESEND_API_KEY`, `FROM_EMAIL`, `FROM_NAME`  
**Atual:** Supabase built-in email para autenticação (magic link, reset)  
**Não migrar** os e-mails de autenticação do Supabase para Resend — apenas e-mails transacionais da aplicação.

---

## 27. API Segura Futura (Fase 12)

**Base path:** `/v1/` (separado do BFF atual em `/api/`)  
**Autenticação:** API keys por tenant (hash SHA-256 armazenado, nunca plaintext)  
**Escopos:** `militares:read`, `cautelas:read`, `inventarios:read`, etc.  
**Rate limit:** por API key, não por IP  
**Webhooks:** HMAC-SHA256 com secret por cliente  
**Documentação:** OpenAPI 3.0 gerado automaticamente

---

## 28. Diagrama Textual de Fluxo de Autenticação

```
Browser                BFF (Hono)              Supabase
   |                      |                       |
   |-- POST /api/auth/login -->                   |
   |   {email, password, turnstileToken}          |
   |                      |-- getUser(token) -->  |
   |                      |<-- {user, role} --    |
   |                      |                       |
   |                      |-- getIronSession() ---+
   |                      |   save {userId, role, |
   |                      |         tenantId, ...} |
   |                      |-- set cookie (httpOnly)|
   |                      |-- set csrf-token ------|
   |<-- 200 {user, role} -|                       |
   |                      |                       |
   |-- GET /api/resource --|   (com apmcb_session + x-csrf-token)
   |                      |-- authMiddleware: lê session
   |                      |-- roleGuard: verifica role
   |                      |-- query Supabase (service_role)
   |<-- 200 {data} -------|                       |
```

---

## 29. Principais Tabelas (Inventário Completo)

| Tabela | Status | tenant_id | Fases que tocam |
|---|---|---|---|
| `profiles` | ✅ Existente | ❌ Falta | 1 |
| `material_types` | ✅ Existente | ❌ Falta | 1 |
| `material_availability` | ✅ View existente | — | — |
| `lendings` | ✅ Existente | ❌ Falta | 1, 5 |
| `material_requests` | ✅ Existente | ❌ Falta | 1 |
| `material_request_items` | ✅ Existente | — | 1 |
| `totp_secrets` | ✅ Existente | ❌ Falta | 1 |
| `biometric_templates` | ✅ Existente | ❌ Falta | 1 |
| `ocorrencias` | ✅ Existente | ❌ Falta | 1 |
| `notifications` | ✅ Existente | ❌ Falta | 1 |
| `audit_logs` | ✅ Existente | ❌ Falta | 1, 3 |
| `tenants` | ❌ A criar | — | 1 |
| `unidades` | ❌ A criar | ✅ tem tenant_id | 1 |
| `audit_events` | ❌ A criar | ✅ | 3 |
| `document_signatures` | ❌ A criar | ✅ | 4 |
| `service_handovers` | ❌ A criar | ✅ | 6 |
| `handover_attachments` | ❌ A criar | ✅ | 6 |
| `inventory_campaigns` | ❌ A criar | ✅ | 8 |
| `inventory_unit_checks` | ❌ A criar | ✅ | 8 |
| `inventory_item_checks` | ❌ A criar | ✅ | 8 |
| `api_keys` | ❌ A criar | ✅ | 12 |

---

## 30. Principais Endpoints (Inventário)

| Método | Path | Role | Status |
|---|---|---|---|
| POST | `/api/auth/login` | público | ✅ |
| GET | `/api/auth/me` | autenticado | ✅ |
| GET | `/api/lendings` | armeiro, admin | ✅ |
| POST | `/api/lendings` | armeiro, admin | ✅ |
| PATCH | `/api/lendings/:id/return` | armeiro, admin | ✅ |
| POST | `/api/lendings/:id/confirm` | usuario | Fase 5 |
| POST | `/api/lendings/:id/sign` | armeiro, usuario | Fase 5 |
| GET | `/api/lendings/:id/pdf` | armeiro, admin | Fase 5 |
| GET | `/api/ssa` | armeiro, usuario | ✅ |
| POST | `/api/ssa` | usuario | ✅ |
| PATCH | `/api/ssa/:id/approve` | armeiro, admin | ✅ |
| POST | `/api/handovers` | armeiro | Fase 6 |
| POST | `/api/handovers/:id/sign-exit` | armeiro | Fase 6 |
| POST | `/api/handovers/:id/sign-entry` | armeiro | Fase 6 |
| GET | `/api/dashboard/command` | admin_global | Fase 7 |
| GET | `/api/nexus/health` | superadmin (nexus) | ✅ |
| POST | `/api/nexus/tenants` | superadmin (nexus) | Fase 1 |
| GET | `/v/[document_id]` | público | Fase 4 |

---

## 31. Principais Componentes de UI

| Componente | Caminho | Propósito |
|---|---|---|
| `AppShell` | `components/layout/app-shell.tsx` | Layout base |
| `Sidebar` | `components/layout/sidebar.tsx` | Navegação desktop |
| `BottomNav` | `components/layout/bottom-nav.tsx` | Navegação mobile |
| `LendingChart` | `components/dashboard/lending-chart.tsx` | Gráfico de cautelas |
| `SSARequestCard` | `components/ssa/request-card.tsx` | Card de solicitação |
| `RealtimeSync` | `components/cadete/realtime-sync.tsx` | Sync em tempo real |
| `OcorrenciaForm` | `components/cadete/ocorrencia-form.tsx` | Form de incidente |
| `Button`, `Card`, `Table`, etc. | `components/ui/*.tsx` | Design system (34 componentes) |

---

## 32. Dependências Técnicas

### Produção

| Pacote | Versão | Propósito |
|---|---|---|
| `next` | 16.2.9 | Framework frontend |
| `react` | 19 | UI library |
| `@supabase/supabase-js` | 2.x | Supabase client |
| `hono` | 4.7 | BFF framework |
| `iron-session` | 8.x | Sessão segura |
| `@hono/zod-validator` | — | Validação de input |
| `zod` | 3.x | Schema validation |
| `otplib` | 13.x | TOTP RFC 6238 |
| `tailwindcss` | 4.x | CSS utility |
| `sonner` | 1.x | Toasts |
| `react-hook-form` | 7.x | Forms |
| `recharts` | 2.x | Charts |
| `lucide-react` | — | Icons |
| `@tanstack/react-query` | 5.x | Server state |
| `serwist` | — | PWA/Service Worker |

### Dev / Testes

| Pacote | Propósito |
|---|---|
| `@playwright/test` | E2E testing |
| `typescript` | Type safety |
| `turbo` | Monorepo pipeline |
| `pnpm` | Package manager |

---

## 33. Riscos Técnicos

| # | Risco | Impacto | Mitigação |
|---|---|---|---|
| RT01 | Migration de tenant_id em produção sem downtime | Alto | Usar DEFAULT com valor de tenant padrão + deploy gradual |
| RT02 | RLS não bloqueia service_role | Alto | RULE SQL como segunda camada (já implementado para audit_logs) |
| RT03 | Performance de hash encadeado em audit_events com alto volume | Médio | Index em seq; calcular hash assíncrono |
| RT04 | Geração de PDF com @react-pdf em edge runtime CF Pages | Alto | Gerar no BFF (Bun), não no edge; retornar URL do Storage |
| RT05 | Realtime Supabase com múltiplos tenants | Médio | Filtrar por tenant_id no subscribe do realtime |
| RT06 | TOTP anti-replay com múltiplos armeiros simultâneos | Médio | `last_used_token` por user_id; concorrência é por usuário |
| RT07 | iron-session inválida após mudança de role | Médio | Expirar sessão e forçar re-login ao mudar role |

---

## 34. Estratégia de Migração Incremental

O sistema está em produção. Toda migração deve ser:

1. **Backwards compatible:** nova coluna com DEFAULT — não quebra código antigo
2. **Sem downtime:** ALTER ADD COLUMN é instantâneo no PostgreSQL (não bloqueia)
3. **Verificada em branch:** testar migration em Supabase branch antes de produção
4. **Com rollback documentado:** todo harness tem plano de rollback
5. **Com seed de dados:** migração de dados existentes para nova estrutura (ex: todos os registros antigos recebem tenant_id = tenant_default)

### Ordem de segurança para Fase 1 (exemplo)

```
Step 1: Criar tenants + unidades (sem quebra)
Step 2: INSERT tenant padrão (APMCB/PM-PB)
Step 3: ALTER TABLE profiles ADD COLUMN tenant_id DEFAULT = [tenant_padrão]
Step 4: Adicionar RLS (ainda não bloqueia nada — todos no mesmo tenant)
Step 5: Atualizar BFF SessionData para incluir tenantId
Step 6: Verificar testes E2E com tenant padrão
Step 7: Provisionar tenant de teste via Nexus
Step 8: Rodar TT01-TT08 (isolamento)
```

---

*Spec técnica v1.0 — 2026-06-20*  
*Documento base para todas as fases enterprise — atualizar conforme a arquitetura evolui*
