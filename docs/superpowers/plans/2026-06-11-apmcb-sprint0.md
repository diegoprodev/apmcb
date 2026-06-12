# APMCB Control System — Sprint 0: Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold completo do monorepo APMCB com frontend Next.js 15, BFF Bun+Hono, schema Supabase com RLS, design system e CI/CD — tudo conectado e funcionando antes de qualquer feature.

**Architecture:** Monorepo Turborepo com dois apps (`web` e `bff`) e um package `shared` para tipos/schemas Zod compartilhados. O frontend em Next.js 15 App Router é deployado na Cloudflare Pages; o BFF em Bun+Hono roda no Hetzner via PM2. O Supabase gerencia auth, database, realtime e storage com RLS em todas as tabelas.

**Tech Stack:** pnpm + Turborepo · Next.js 15.3 App Router · TypeScript 5 · Tailwind CSS v4 · shadcn/ui (Radix) · Serwist (PWA) · TanStack Query v5 · Zustand · Supabase JS SDK · Bun + Hono · Zod · Vitest · GitHub Actions

---

## Estrutura de arquivos final

```
apmcb/
├── .github/
│   └── workflows/
│       ├── ci.yml                  # lint + typecheck + test em PRs
│       └── deploy-bff.yml          # deploy BFF no Hetzner via SSH
├── apps/
│   ├── web/                        # Next.js 15 frontend (→ CF Pages)
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── (auth)/
│   │   │   │   │   ├── login/page.tsx
│   │   │   │   │   └── layout.tsx
│   │   │   │   ├── (admin)/
│   │   │   │   │   ├── dashboard/page.tsx
│   │   │   │   │   └── layout.tsx
│   │   │   │   ├── (master)/
│   │   │   │   │   ├── armar/page.tsx
│   │   │   │   │   └── layout.tsx
│   │   │   │   ├── (military)/
│   │   │   │   │   ├── perfil/page.tsx
│   │   │   │   │   └── layout.tsx
│   │   │   │   ├── layout.tsx      # root layout com providers
│   │   │   │   └── page.tsx        # redirect por role
│   │   │   ├── components/
│   │   │   │   ├── ui/             # shadcn components (gerados)
│   │   │   │   ├── layout/
│   │   │   │   │   ├── sidebar.tsx
│   │   │   │   │   ├── header.tsx
│   │   │   │   │   └── bottom-nav.tsx
│   │   │   │   └── providers.tsx   # QueryClient + ThemeProvider + SupabaseProvider
│   │   │   ├── lib/
│   │   │   │   ├── supabase/
│   │   │   │   │   ├── client.ts   # browser client
│   │   │   │   │   └── server.ts   # server client (RSC/actions)
│   │   │   │   └── bff.ts          # typed BFF HTTP client
│   │   │   ├── hooks/
│   │   │   │   ├── use-auth.ts
│   │   │   │   └── use-role.ts
│   │   │   └── store/
│   │   │       └── ui.store.ts     # Zustand: sidebar, theme
│   │   ├── public/
│   │   │   ├── manifest.webmanifest
│   │   │   └── icons/              # PWA icons
│   │   ├── next.config.ts
│   │   ├── tailwind.config.ts
│   │   ├── components.json         # shadcn config
│   │   └── package.json
│   └── bff/                        # Bun + Hono BFF (→ Hetzner)
│       ├── src/
│       │   ├── index.ts            # Hono app entry
│       │   ├── middleware/
│       │   │   ├── auth.ts         # JWT Supabase validation
│       │   │   ├── role-guard.ts   # role check factory
│       │   │   ├── audit.ts        # audit_log writer
│       │   │   └── rate-limit.ts   # in-memory rate limiter
│       │   ├── routes/
│       │   │   ├── auth.ts
│       │   │   ├── biometric.ts    # USB fingerprint routes
│       │   │   ├── lendings.ts
│       │   │   ├── reports.ts
│       │   │   ├── notifications.ts
│       │   │   └── dashboard.ts
│       │   ├── services/
│       │   │   ├── supabase.ts     # service-role client singleton
│       │   │   ├── fingerprint/
│       │   │   │   ├── interface.ts   # IFingerprintSDK — contrato plugável
│       │   │   │   ├── zkteco.ts      # implementação ZKTeco (stub inicial)
│       │   │   │   └── index.ts       # factory — troca SDK sem mudar rotas
│       │   │   ├── pdf.ts
│       │   │   └── push.ts
│       │   └── types/
│       │       └── hono.ts         # type extension para c.var (user, role)
│       ├── ecosystem.config.cjs    # PM2 config
│       └── package.json
├── packages/
│   └── shared/                     # types + schemas Zod compartilhados
│       ├── src/
│       │   ├── schemas/
│       │   │   ├── profile.ts
│       │   │   ├── material.ts
│       │   │   ├── lending.ts
│       │   │   └── index.ts
│       │   └── index.ts
│       └── package.json
├── supabase/
│   ├── migrations/
│   │   ├── 20260611000001_initial_schema.sql
│   │   ├── 20260611000002_rls_policies.sql
│       └── 20260611000003_seed_dev.sql
│   └── config.toml
├── .env.example
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

---

## Task 1: Monorepo scaffold (git + Turborepo + pnpm)

**Files:**
- Create: `package.json` (root)
- Create: `turbo.json`
- Create: `pnpm-workspace.yaml`
- Create: `.gitignore`
- Create: `.env.example`

- [ ] **Step 1.1: Inicializar git e estrutura de pastas**

```bash
cd c:\projetos\apmcb
git init
mkdir -p apps/web apps/bff packages/shared supabase/migrations .github/workflows docs/superpowers/plans
```

- [ ] **Step 1.2: Criar root package.json**

```json
{
  "name": "apmcb",
  "private": true,
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "format": "prettier --write \"**/*.{ts,tsx,json,md}\""
  },
  "devDependencies": {
    "turbo": "^2.5.0",
    "prettier": "^3.5.0",
    "typescript": "^5.8.0"
  },
  "engines": {
    "node": ">=20",
    "pnpm": ">=9"
  }
}
```

- [ ] **Step 1.3: Criar turbo.json**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "ui": "tui",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {},
    "typecheck": {},
    "test": {
      "cache": false
    }
  }
}
```

- [ ] **Step 1.4: Criar pnpm-workspace.yaml**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 1.5: Criar .gitignore**

```gitignore
node_modules/
.next/
dist/
.env
.env.local
.env.*.local
*.tsbuildinfo
.turbo/
supabase/.temp/
```

- [ ] **Step 1.6: Criar .env.example**

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# BFF
BFF_URL=https://bff.apmcb.com.br
BFF_SECRET=change-this-secret-32-chars-min

# Biometrics
FINGERPRINT_SDK=zkteco
ZKTECO_LIB_PATH=/usr/lib/libzkfp.so

# Push Notifications
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:admin@apmcb.com.br
```

- [ ] **Step 1.7: Commit**

```bash
git add .
git commit -m "chore: monorepo scaffold (Turborepo + pnpm workspaces)"
```

---

## Task 2: Package shared — tipos e schemas Zod

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/src/schemas/profile.ts`
- Create: `packages/shared/src/schemas/material.ts`
- Create: `packages/shared/src/schemas/lending.ts`
- Create: `packages/shared/src/schemas/index.ts`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/tsconfig.json`

- [ ] **Step 2.1: package.json do shared**

```json
{
  "name": "@apmcb/shared",
  "version": "0.0.1",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "typescript": "^5.8.0"
  }
}
```

- [ ] **Step 2.2: tsconfig.json do shared**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true
  }
}
```

- [ ] **Step 2.3: schemas/profile.ts**

```typescript
import { z } from "zod";

export const PostoEnum = z.enum([
  "cadete",
  "aspirante",
  "segundo_tenente",
  "primeiro_tenente",
  "capitao",
  "major",
  "tenente_coronel",
  "coronel",
]);

export const RoleEnum = z.enum(["admin", "master", "military"]);

export const RegistrationStatusEnum = z.enum([
  "pending_biometric",
  "complete",
  "inactive",
]);

export const ProfileSchema = z.object({
  id: z.string().uuid(),
  matricula: z.string().min(1).max(20),
  nome_completo: z.string().min(2).max(120),
  posto: PostoEnum,
  turma: z.string().max(20).nullable(),
  foto_url: z.string().url().nullable(),
  role: RoleEnum,
  registration_status: RegistrationStatusEnum,
  created_by: z.string().uuid().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const CreateProfileSchema = ProfileSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
  foto_url: true,
}).extend({
  temp_password: z.string().min(8).optional(),
});

export type Profile = z.infer<typeof ProfileSchema>;
export type CreateProfile = z.infer<typeof CreateProfileSchema>;
export type Posto = z.infer<typeof PostoEnum>;
export type Role = z.infer<typeof RoleEnum>;
export type RegistrationStatus = z.infer<typeof RegistrationStatusEnum>;
```

- [ ] **Step 2.4: schemas/material.ts**

```typescript
import { z } from "zod";

export const MaterialCategoryEnum = z.enum([
  "arma",
  "farda",
  "acessorio",
  "equipamento",
]);

export const MaterialTypeSchema = z.object({
  id: z.string().uuid(),
  nome: z.string().min(1).max(100),
  categoria: MaterialCategoryEnum,
  quantidade_total: z.number().int().min(0),
  descricao: z.string().nullable(),
  ativo: z.boolean(),
  created_at: z.string().datetime(),
});

export const CreateMaterialTypeSchema = MaterialTypeSchema.omit({
  id: true,
  created_at: true,
});

export type MaterialType = z.infer<typeof MaterialTypeSchema>;
export type CreateMaterialType = z.infer<typeof CreateMaterialTypeSchema>;
export type MaterialCategory = z.infer<typeof MaterialCategoryEnum>;
```

- [ ] **Step 2.5: schemas/lending.ts**

```typescript
import { z } from "zod";

export const LendingStatusEnum = z.enum(["ativo", "devolvido"]);

export const LendingSchema = z.object({
  id: z.string().uuid(),
  material_type_id: z.string().uuid(),
  military_id: z.string().uuid(),
  master_id: z.string().uuid(),
  quantidade: z.number().int().min(1).default(1),
  status: LendingStatusEnum,
  issued_at: z.string().datetime(),
  returned_at: z.string().datetime().nullable(),
  notes: z.string().nullable(),
  // joins opcionais
  material_type: z
    .object({ nome: z.string(), categoria: z.string() })
    .optional(),
  military: z
    .object({ nome_completo: z.string(), matricula: z.string(), posto: z.string() })
    .optional(),
});

export const CreateLendingSchema = z.object({
  material_type_id: z.string().uuid(),
  military_id: z.string().uuid(),
  quantidade: z.number().int().min(1).default(1),
  notes: z.string().optional(),
});

export const ReturnLendingSchema = z.object({
  returned_at: z.string().datetime().optional(),
  notes: z.string().optional(),
});

export type Lending = z.infer<typeof LendingSchema>;
export type CreateLending = z.infer<typeof CreateLendingSchema>;
export type LendingStatus = z.infer<typeof LendingStatusEnum>;
```

- [ ] **Step 2.6: schemas/index.ts + src/index.ts**

```typescript
// schemas/index.ts
export * from "./profile";
export * from "./material";
export * from "./lending";
```

```typescript
// src/index.ts
export * from "./schemas/index";
```

- [ ] **Step 2.7: Verificar tipos**

```bash
cd packages/shared && pnpm typecheck
```

Esperado: `0 errors`

- [ ] **Step 2.8: Commit**

```bash
cd c:\projetos\apmcb
git add packages/shared
git commit -m "feat(shared): zod schemas for profile, material and lending"
```

---

## Task 3: Supabase — schema SQL (migration 1)

**Files:**
- Create: `supabase/config.toml`
- Create: `supabase/migrations/20260611000001_initial_schema.sql`

Pré-requisito: `supabase` CLI instalado (`npm i -g supabase`).

- [ ] **Step 3.1: Inicializar projeto Supabase local**

```bash
cd c:\projetos\apmcb
supabase init
```

Isso cria `supabase/config.toml`. Aceite os defaults.

- [ ] **Step 3.2: Criar migration inicial**

Crie o arquivo `supabase/migrations/20260611000001_initial_schema.sql`:

```sql
-- ============================================================
-- ENUMS
-- ============================================================
CREATE TYPE posto_enum AS ENUM (
  'cadete','aspirante','segundo_tenente','primeiro_tenente',
  'capitao','major','tenente_coronel','coronel'
);

CREATE TYPE role_enum AS ENUM ('admin','master','military');

CREATE TYPE registration_status_enum AS ENUM (
  'pending_biometric','complete','inactive'
);

CREATE TYPE material_category_enum AS ENUM (
  'arma','farda','acessorio','equipamento'
);

CREATE TYPE lending_status_enum AS ENUM ('ativo','devolvido');

CREATE TYPE notification_type_enum AS ENUM (
  'material_issued','material_returned',
  'account_created','biometric_registered'
);

-- ============================================================
-- PROFILES (extends auth.users)
-- ============================================================
CREATE TABLE profiles (
  id                  UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  matricula           TEXT NOT NULL UNIQUE,
  nome_completo       TEXT NOT NULL,
  posto               posto_enum NOT NULL DEFAULT 'cadete',
  turma               TEXT,
  foto_url            TEXT,
  role                role_enum NOT NULL DEFAULT 'military',
  registration_status registration_status_enum NOT NULL DEFAULT 'pending_biometric',
  created_by          UUID REFERENCES profiles(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- BIOMETRIC TEMPLATES (nunca exposto ao militar)
-- ============================================================
CREATE TABLE biometric_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  template_data BYTEA NOT NULL,
  finger_index  SMALLINT NOT NULL CHECK (finger_index BETWEEN 1 AND 10),
  registered_by UUID NOT NULL REFERENCES profiles(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, finger_index)
);

-- ============================================================
-- MATERIAL TYPES
-- ============================================================
CREATE TABLE material_types (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome             TEXT NOT NULL,
  categoria        material_category_enum NOT NULL,
  quantidade_total INTEGER NOT NULL DEFAULT 0 CHECK (quantidade_total >= 0),
  descricao        TEXT,
  ativo            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- LENDINGS
-- ============================================================
CREATE TABLE lendings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_type_id UUID NOT NULL REFERENCES material_types(id),
  military_id      UUID NOT NULL REFERENCES profiles(id),
  master_id        UUID NOT NULL REFERENCES profiles(id),
  quantidade       SMALLINT NOT NULL DEFAULT 1 CHECK (quantidade > 0),
  status           lending_status_enum NOT NULL DEFAULT 'ativo',
  issued_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  returned_at      TIMESTAMPTZ,
  notes            TEXT
);

CREATE INDEX lendings_military_id_idx ON lendings(military_id);
CREATE INDEX lendings_status_idx ON lendings(status);
CREATE INDEX lendings_issued_at_idx ON lendings(issued_at DESC);

-- view: quantidade disponível por material
CREATE VIEW material_availability AS
SELECT
  mt.id,
  mt.nome,
  mt.categoria,
  mt.quantidade_total,
  COALESCE(SUM(l.quantidade) FILTER (WHERE l.status = 'ativo'), 0)::INTEGER AS quantidade_armada,
  mt.quantidade_total - COALESCE(SUM(l.quantidade) FILTER (WHERE l.status = 'ativo'), 0)::INTEGER AS quantidade_disponivel
FROM material_types mt
LEFT JOIN lendings l ON l.material_type_id = mt.id
WHERE mt.ativo = TRUE
GROUP BY mt.id;

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
CREATE TABLE notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type       notification_type_enum NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  read_at    TIMESTAMPTZ,
  metadata   JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX notifications_user_id_unread_idx
  ON notifications(user_id) WHERE read_at IS NULL;

-- ============================================================
-- AUDIT LOGS (imutável)
-- ============================================================
CREATE TABLE audit_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id      UUID REFERENCES profiles(id),
  action        TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id   UUID,
  metadata      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX audit_logs_created_at_idx ON audit_logs(created_at DESC);
CREATE INDEX audit_logs_actor_id_idx ON audit_logs(actor_id);

-- impedir UPDATE e DELETE em audit_logs
CREATE RULE no_update_audit AS ON UPDATE TO audit_logs DO INSTEAD NOTHING;
CREATE RULE no_delete_audit AS ON DELETE TO audit_logs DO INSTEAD NOTHING;
```

- [ ] **Step 3.3: Iniciar Supabase local e aplicar migration**

```bash
supabase start
supabase db push
```

Esperado: migration aplicada sem erros.

- [ ] **Step 3.4: Verificar tabelas criadas**

```bash
supabase db execute --sql "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;"
```

Esperado: `audit_logs, biometric_templates, lendings, material_types, notifications, profiles`

- [ ] **Step 3.5: Commit**

```bash
git add supabase/
git commit -m "feat(db): initial schema — profiles, arsenal, lendings, notifications, audit"
```

---

## Task 4: Supabase — RLS policies (migration 2)

**Files:**
- Create: `supabase/migrations/20260611000002_rls_policies.sql`

- [ ] **Step 4.1: Criar migration de RLS**

```sql
-- ============================================================
-- Habilitar RLS em todas as tabelas
-- ============================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE biometric_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE lendings ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Helper: retorna role do usuário autenticado
-- ============================================================
CREATE OR REPLACE FUNCTION auth_role()
RETURNS role_enum
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$;

-- ============================================================
-- PROFILES
-- ============================================================
-- Leitura: próprio perfil, ou admin/master veem todos
CREATE POLICY "profiles_select" ON profiles
  FOR SELECT USING (
    auth.uid() = id
    OR auth_role() IN ('admin', 'master')
  );

-- Inserção: apenas admin (via BFF service-role bypassa RLS)
CREATE POLICY "profiles_insert" ON profiles
  FOR INSERT WITH CHECK (
    auth_role() = 'admin'
  );

-- Atualização: admin atualiza qualquer; military atualiza só os próprios campos não-sensíveis
CREATE POLICY "profiles_update" ON profiles
  FOR UPDATE USING (
    auth_role() = 'admin'
    OR (auth.uid() = id AND auth_role() = 'military')
  );

-- ============================================================
-- BIOMETRIC TEMPLATES — militar NUNCA acessa
-- ============================================================
CREATE POLICY "biometric_admin_master" ON biometric_templates
  FOR ALL USING (
    auth_role() IN ('admin', 'master')
  );

-- ============================================================
-- MATERIAL TYPES — todos leem; admin/master escrevem
-- ============================================================
CREATE POLICY "materials_select" ON material_types
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "materials_write" ON material_types
  FOR ALL USING (auth_role() IN ('admin', 'master'));

-- ============================================================
-- LENDINGS
-- ============================================================
-- Militar lê apenas os próprios; master/admin leem todos
CREATE POLICY "lendings_select" ON lendings
  FOR SELECT USING (
    military_id = auth.uid()
    OR auth_role() IN ('admin', 'master')
  );

-- Apenas master e admin criam/atualizam (service-role bypassa para BFF)
CREATE POLICY "lendings_write" ON lendings
  FOR ALL USING (
    auth_role() IN ('admin', 'master')
  );

-- ============================================================
-- NOTIFICATIONS — apenas o destinatário lê; service-role escreve
-- ============================================================
CREATE POLICY "notifications_select" ON notifications
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "notifications_update_read" ON notifications
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============================================================
-- AUDIT LOGS — apenas admin lê; service-role escreve
-- ============================================================
CREATE POLICY "audit_admin_only" ON audit_logs
  FOR SELECT USING (auth_role() = 'admin');
```

- [ ] **Step 4.2: Aplicar migration**

```bash
supabase db push
```

Esperado: 0 erros.

- [ ] **Step 4.3: Testar RLS básico via SQL**

```bash
supabase db execute --sql "
  -- simula um military tentando ler biometric_templates (deve retornar 0 linhas)
  SET LOCAL role = authenticated;
  SELECT COUNT(*) FROM biometric_templates;
"
```

Esperado: `0` (RLS bloqueando).

- [ ] **Step 4.4: Commit**

```bash
git add supabase/migrations/20260611000002_rls_policies.sql
git commit -m "feat(db): RLS policies — role-based access on all tables"
```

---

## Task 5: Supabase — seed de desenvolvimento (migration 3)

**Files:**
- Create: `supabase/migrations/20260611000003_seed_dev.sql`

- [ ] **Step 5.1: Criar seed**

```sql
-- ATENÇÃO: apenas para ambiente local de desenvolvimento
-- Em produção, este seed NÃO deve ser aplicado

-- Inserir usuário admin de teste diretamente em auth.users + profiles
-- (em produção, o admin é criado manualmente no Supabase dashboard)
DO $$
DECLARE
  admin_id UUID := '00000000-0000-0000-0000-000000000001';
  master_id UUID := '00000000-0000-0000-0000-000000000002';
  mil_id UUID := '00000000-0000-0000-0000-000000000003';
BEGIN
  -- admin
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at)
  VALUES (admin_id, 'admin@apmcb.dev', crypt('Admin@123', gen_salt('bf')), NOW())
  ON CONFLICT DO NOTHING;

  INSERT INTO profiles (id, matricula, nome_completo, posto, role, registration_status)
  VALUES (admin_id, 'ADM001', 'Administrador APMCB', 'coronel', 'admin', 'complete')
  ON CONFLICT DO NOTHING;

  -- master (armeiro)
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at)
  VALUES (master_id, 'armeiro@apmcb.dev', crypt('Armeiro@123', gen_salt('bf')), NOW())
  ON CONFLICT DO NOTHING;

  INSERT INTO profiles (id, matricula, nome_completo, posto, role, registration_status, created_by)
  VALUES (master_id, 'ARM001', 'Sgt. Silva - Armeiro', 'segundo_tenente', 'master', 'complete', admin_id)
  ON CONFLICT DO NOTHING;

  -- militar cadete (cadastro pendente de biometria)
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at)
  VALUES (mil_id, 'cadete@apmcb.dev', crypt('Cadete@123', gen_salt('bf')), NOW())
  ON CONFLICT DO NOTHING;

  INSERT INTO profiles (id, matricula, nome_completo, posto, turma, role, registration_status, created_by)
  VALUES (mil_id, '2026001', 'Cd. João Pereira', 'cadete', '2026-A', 'military', 'pending_biometric', admin_id)
  ON CONFLICT DO NOTHING;
END $$;

-- Materiais de exemplo
INSERT INTO material_types (nome, categoria, quantidade_total, descricao)
VALUES
  ('Espadim', 'arma', 20, 'Espadim de cerimônia padrão PMBA'),
  ('Túnica de Gala Nº1', 'farda', 30, 'Farda de gala completa número 1'),
  ('Túnica de Gala Nº2', 'farda', 25, 'Farda de gala completa número 2'),
  ('Quepe de Cerimônia', 'acessorio', 40, 'Quepe padrão cerimônia'),
  ('Cinto Branco', 'acessorio', 50, 'Cinto branco de cerimônia'),
  ('Luvas Brancas', 'acessorio', 60, 'Luvas brancas par'),
  ('Dragonas', 'acessorio', 35, 'Dragonas de posto');
```

- [ ] **Step 5.2: Aplicar seed**

```bash
supabase db push
```

- [ ] **Step 5.3: Verificar seed**

```bash
supabase db execute --sql "SELECT matricula, nome_completo, role, registration_status FROM profiles;"
supabase db execute --sql "SELECT nome, categoria, quantidade_total FROM material_types;"
```

Esperado: 3 perfis + 7 materiais.

- [ ] **Step 5.4: Commit**

```bash
git add supabase/migrations/20260611000003_seed_dev.sql
git commit -m "feat(db): dev seed — 3 test users + 7 material types"
```

---

## Task 6: Next.js — scaffold do app web

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/next.config.ts`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/tailwind.config.ts`
- Create: `apps/web/components.json`

- [ ] **Step 6.1: Criar app Next.js via CLI**

```bash
cd apps/web
pnpm dlx create-next-app@latest . \
  --typescript \
  --tailwind \
  --app \
  --src-dir \
  --no-import-alias \
  --no-turbopack
```

Quando perguntar sobre alias, responda `No` (usaremos paths do tsconfig).

- [ ] **Step 6.2: Adicionar dependências**

```bash
pnpm add @supabase/supabase-js @supabase/ssr \
  @tanstack/react-query @tanstack/react-query-devtools \
  zustand \
  react-hook-form @hookform/resolvers zod \
  recharts \
  lucide-react \
  next-themes \
  serwist @serwist/next \
  @apmcb/shared

pnpm add -D @types/node vitest @vitejs/plugin-react jsdom \
  @testing-library/react @testing-library/jest-dom
```

- [ ] **Step 6.3: Configurar paths no tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"],
      "@apmcb/shared": ["../../packages/shared/src/index.ts"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 6.4: Configurar next.config.ts**

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
    ],
  },
  experimental: {
    serverActions: { allowedOrigins: ["localhost:3000"] },
  },
};

export default nextConfig;
```

- [ ] **Step 6.5: Instalar shadcn/ui**

```bash
pnpm dlx shadcn@latest init
```

Responda ao prompt:
- Style: `Default`
- Base color: `Slate`
- CSS variables: `Yes`

Em seguida, adicionar componentes base:

```bash
pnpm dlx shadcn@latest add button card input label select \
  dialog sheet table badge avatar dropdown-menu \
  separator skeleton toast sonner
```

- [ ] **Step 6.6: Commit**

```bash
cd c:\projetos\apmcb
git add apps/web
git commit -m "feat(web): Next.js 15 scaffold with shadcn/ui, TanStack Query, Zustand"
```

---

## Task 7: Design system — tokens, tema dark/light

**Files:**
- Modify: `apps/web/src/app/globals.css`
- Create: `apps/web/src/components/providers.tsx`
- Create: `apps/web/src/store/ui.store.ts`

- [ ] **Step 7.1: CSS variables (globals.css)**

Substitua o conteúdo de `apps/web/src/app/globals.css`:

```css
@import "tailwindcss";

@layer base {
  :root {
    /* APMCB brand */
    --brand-blue: 220 91% 37%;      /* #1E40AF */
    --brand-red: 0 72% 51%;         /* #DC2626 */
    --brand-white: 0 0% 100%;

    /* Surfaces */
    --background: 0 0% 98%;
    --foreground: 222 47% 11%;
    --card: 0 0% 100%;
    --card-foreground: 222 47% 11%;
    --popover: 0 0% 100%;
    --popover-foreground: 222 47% 11%;

    /* Primary = brand blue */
    --primary: 220 91% 37%;
    --primary-foreground: 0 0% 100%;

    /* Destructive = brand red */
    --destructive: 0 72% 51%;
    --destructive-foreground: 0 0% 100%;

    /* Muted */
    --muted: 220 14% 96%;
    --muted-foreground: 220 9% 46%;

    /* Borders & inputs */
    --border: 220 13% 91%;
    --input: 220 13% 91%;
    --ring: 220 91% 37%;

    /* Layout */
    --radius: 0.75rem;              /* 12px */
    --shadow-card: 0 1px 6px rgba(0,0,0,0.08);
  }

  .dark {
    --background: 222 47% 7%;
    --foreground: 210 40% 96%;
    --card: 222 47% 11%;
    --card-foreground: 210 40% 96%;
    --popover: 222 47% 11%;
    --popover-foreground: 210 40% 96%;

    --primary: 213 93% 67%;         /* azul mais claro no dark */
    --primary-foreground: 222 47% 7%;

    --destructive: 0 63% 60%;
    --destructive-foreground: 0 0% 100%;

    --muted: 217 33% 17%;
    --muted-foreground: 215 20% 65%;

    --border: 217 33% 20%;
    --input: 217 33% 20%;
    --ring: 213 93% 67%;
  }
}

@layer base {
  * { border-color: hsl(var(--border)); }
  body {
    background-color: hsl(var(--background));
    color: hsl(var(--foreground));
    font-family: var(--font-inter), system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
}
```

- [ ] **Step 7.2: Zustand store para UI**

```typescript
// apps/web/src/store/ui.store.ts
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UIState {
  sidebarOpen: boolean;
  theme: "light" | "dark" | "system";
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setTheme: (theme: "light" | "dark" | "system") => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      theme: "system",
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setTheme: (theme) => set({ theme }),
    }),
    { name: "apmcb-ui" }
  )
);
```

- [ ] **Step 7.3: Providers**

```typescript
// apps/web/src/components/providers.tsx
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { ThemeProvider } from "next-themes";
import { useState } from "react";
import { Toaster } from "@/components/ui/sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            retry: 1,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        {children}
        <Toaster richColors closeButton />
      </ThemeProvider>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
```

- [ ] **Step 7.4: Root layout com providers**

Substitua `apps/web/src/app/layout.tsx`:

```typescript
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "APMCB — Sistema de Controle",
  description: "Academia de Polícia Militar do Cabo Branco",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1117" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body className={inter.variable}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

- [ ] **Step 7.5: Verificar build**

```bash
cd apps/web && pnpm build
```

Esperado: build sem erros.

- [ ] **Step 7.6: Commit**

```bash
cd c:\projetos\apmcb
git add apps/web/src
git commit -m "feat(web): design system tokens, dark/light theme, providers"
```

---

## Task 8: Supabase client — browser e server (RSC)

**Files:**
- Create: `apps/web/src/lib/supabase/client.ts`
- Create: `apps/web/src/lib/supabase/server.ts`
- Create: `apps/web/src/hooks/use-auth.ts`
- Create: `apps/web/src/hooks/use-role.ts`

- [ ] **Step 8.1: Variáveis de ambiente do web**

Crie `apps/web/.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<cole a anon key do supabase start>
NEXT_PUBLIC_BFF_URL=http://localhost:3001
```

Para obter as keys locais:
```bash
supabase status
```

- [ ] **Step 8.2: Supabase browser client**

```typescript
// apps/web/src/lib/supabase/client.ts
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

- [ ] **Step 8.3: Supabase server client (RSC + Server Actions)**

```typescript
// apps/web/src/lib/supabase/server.ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            toSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {} // ignorado em Server Components — cookies apenas em middleware/actions
        },
      },
    }
  );
}
```

- [ ] **Step 8.4: Hook useAuth**

```typescript
// apps/web/src/hooks/use-auth.ts
"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  return { user, loading };
}
```

- [ ] **Step 8.5: Hook useRole**

```typescript
// apps/web/src/hooks/use-role.ts
"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Role } from "@apmcb/shared";

export function useRole() {
  const supabase = createClient();

  return useQuery({
    queryKey: ["auth", "role"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data } = await supabase
        .from("profiles")
        .select("role, registration_status")
        .eq("id", user.id)
        .single();

      return data as { role: Role; registration_status: string } | null;
    },
    staleTime: 5 * 60 * 1000,
  });
}
```

- [ ] **Step 8.6: Commit**

```bash
git add apps/web/src/lib apps/web/src/hooks apps/web/.env.local
git commit -m "feat(web): Supabase browser/server clients + auth hooks"
```

---

## Task 9: Layout components — sidebar, header, bottom nav

**Files:**
- Create: `apps/web/src/components/layout/sidebar.tsx`
- Create: `apps/web/src/components/layout/header.tsx`
- Create: `apps/web/src/components/layout/bottom-nav.tsx`
- Create: `apps/web/src/components/layout/app-shell.tsx`

- [ ] **Step 9.1: Sidebar**

```typescript
// apps/web/src/components/layout/sidebar.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Users, Package, FileText,
  Shield, ChevronLeft, ChevronRight
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/store/ui.store";
import { Button } from "@/components/ui/button";
import type { Role } from "@apmcb/shared";

const navByRole: Record<Role, { href: string; label: string; icon: React.ElementType }[]> = {
  admin: [
    { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/admin/usuarios", label: "Usuários", icon: Users },
    { href: "/admin/arsenal", label: "Arsenal", icon: Package },
    { href: "/admin/relatorios", label: "Relatórios", icon: FileText },
    { href: "/admin/auditoria", label: "Auditoria", icon: Shield },
  ],
  master: [
    { href: "/master/armar", label: "Armar", icon: Shield },
    { href: "/master/painel", label: "Painel", icon: LayoutDashboard },
    { href: "/master/militares", label: "Militares", icon: Users },
    { href: "/master/relatorios", label: "Relatórios", icon: FileText },
  ],
  military: [
    { href: "/militar/perfil", label: "Meu Perfil", icon: Users },
    { href: "/militar/materiais", label: "Meus Materiais", icon: Package },
    { href: "/militar/historico", label: "Histórico", icon: FileText },
  ],
};

interface SidebarProps {
  role: Role;
}

export function Sidebar({ role }: SidebarProps) {
  const pathname = usePathname();
  const { sidebarOpen, toggleSidebar } = useUIStore();
  const items = navByRole[role];

  return (
    <aside
      className={cn(
        "hidden md:flex flex-col border-r bg-card transition-all duration-300",
        "[box-shadow:var(--shadow-card)]",
        sidebarOpen ? "w-56" : "w-16"
      )}
    >
      <div className="flex items-center justify-between p-4 border-b">
        {sidebarOpen && (
          <span className="font-semibold text-sm text-primary">APMCB</span>
        )}
        <Button variant="ghost" size="icon" onClick={toggleSidebar} className="ml-auto">
          {sidebarOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
        </Button>
      </div>

      <nav className="flex-1 p-2 space-y-1">
        {items.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
              "hover:bg-muted hover:text-foreground",
              pathname.startsWith(href)
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground"
            )}
          >
            <Icon size={18} className="shrink-0" />
            {sidebarOpen && <span>{label}</span>}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 9.2: Header**

```typescript
// apps/web/src/components/layout/header.tsx
"use client";

import { Bell, Moon, Sun, LogOut, Menu } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { useUIStore } from "@/store/ui.store";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

interface HeaderProps {
  userName: string;
  userPhoto?: string | null;
  unreadCount?: number;
}

export function Header({ userName, userPhoto, unreadCount = 0 }: HeaderProps) {
  const { theme, setTheme } = useTheme();
  const { toggleSidebar } = useUIStore();
  const router = useRouter();
  const supabase = createClient();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <header className="h-14 border-b bg-card flex items-center px-4 gap-3 [box-shadow:var(--shadow-card)]">
      <Button variant="ghost" size="icon" onClick={toggleSidebar} className="md:hidden">
        <Menu size={18} />
      </Button>

      <span className="font-semibold text-sm text-primary md:hidden">APMCB</span>

      <div className="ml-auto flex items-center gap-2">
        {/* Notificações */}
        <Button variant="ghost" size="icon" className="relative">
          <Bell size={18} />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-4 w-4 p-0 flex items-center justify-center text-[10px]"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </Badge>
          )}
        </Button>

        {/* Toggle tema */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </Button>

        {/* Avatar + menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="relative h-8 w-8 rounded-full p-0">
              <Avatar className="h-8 w-8">
                <AvatarImage src={userPhoto ?? undefined} alt={userName} />
                <AvatarFallback className="text-xs bg-primary text-primary-foreground">
                  {userName.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={handleSignOut} className="text-destructive">
              <LogOut size={14} className="mr-2" />
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
```

- [ ] **Step 9.3: Bottom nav (mobile)**

```typescript
// apps/web/src/components/layout/bottom-nav.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Users, Package, FileText, Shield
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Role } from "@apmcb/shared";

const navByRole: Record<Role, { href: string; label: string; icon: React.ElementType }[]> = {
  admin: [
    { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/admin/usuarios", label: "Usuários", icon: Users },
    { href: "/admin/arsenal", label: "Arsenal", icon: Package },
    { href: "/admin/relatorios", label: "Relatórios", icon: FileText },
  ],
  master: [
    { href: "/master/armar", label: "Armar", icon: Shield },
    { href: "/master/painel", label: "Painel", icon: LayoutDashboard },
    { href: "/master/militares", label: "Militares", icon: Users },
  ],
  military: [
    { href: "/militar/perfil", label: "Perfil", icon: Users },
    { href: "/militar/materiais", label: "Materiais", icon: Package },
    { href: "/militar/historico", label: "Histórico", icon: FileText },
  ],
};

export function BottomNav({ role }: { role: Role }) {
  const pathname = usePathname();
  const items = navByRole[role];

  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 bg-card border-t safe-area-pb z-50">
      <div className="flex">
        {items.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex-1 flex flex-col items-center gap-1 py-3 text-[10px] transition-colors",
              pathname.startsWith(href)
                ? "text-primary"
                : "text-muted-foreground"
            )}
          >
            <Icon size={20} />
            <span>{label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
```

- [ ] **Step 9.4: App Shell (wrapper de layout autenticado)**

```typescript
// apps/web/src/components/layout/app-shell.tsx
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { BottomNav } from "./bottom-nav";
import type { Role } from "@apmcb/shared";

interface AppShellProps {
  children: React.ReactNode;
  role: Role;
  userName: string;
  userPhoto?: string | null;
  unreadCount?: number;
}

export function AppShell({ children, role, userName, userPhoto, unreadCount }: AppShellProps) {
  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar role={role} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header userName={userName} userPhoto={userPhoto} unreadCount={unreadCount} />
        <main className="flex-1 overflow-y-auto p-4 md:p-6 pb-20 md:pb-6">
          {children}
        </main>
      </div>
      <BottomNav role={role} />
    </div>
  );
}
```

- [ ] **Step 9.5: Commit**

```bash
git add apps/web/src/components/layout
git commit -m "feat(web): app shell — sidebar, header, bottom nav with role-based nav"
```

---

## Task 10: BFF — scaffold Bun + Hono

**Files:**
- Create: `apps/bff/package.json`
- Create: `apps/bff/tsconfig.json`
- Create: `apps/bff/src/index.ts`
- Create: `apps/bff/src/middleware/auth.ts`
- Create: `apps/bff/src/middleware/role-guard.ts`
- Create: `apps/bff/src/middleware/audit.ts`
- Create: `apps/bff/src/middleware/rate-limit.ts`
- Create: `apps/bff/src/services/supabase.ts`
- Create: `apps/bff/src/types/hono.ts`
- Create: `apps/bff/ecosystem.config.cjs`

- [ ] **Step 10.1: package.json do BFF**

```json
{
  "name": "@apmcb/bff",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "bun run --watch src/index.ts",
    "start": "bun run src/index.ts",
    "typecheck": "tsc --noEmit",
    "test": "bun test"
  },
  "dependencies": {
    "@apmcb/shared": "workspace:*",
    "@supabase/supabase-js": "^2.49.0",
    "hono": "^4.7.0",
    "@hono/node-server": "^1.14.0"
  },
  "devDependencies": {
    "typescript": "^5.8.0",
    "bun-types": "latest"
  }
}
```

- [ ] **Step 10.2: tsconfig.json do BFF**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "types": ["bun-types"],
    "paths": {
      "@apmcb/shared": ["../../packages/shared/src/index.ts"]
    }
  }
}
```

- [ ] **Step 10.3: tipos Hono (variáveis de contexto tipadas)**

```typescript
// apps/bff/src/types/hono.ts
import type { Role } from "@apmcb/shared";

export type HonoVariables = {
  userId: string;
  role: Role;
};
```

- [ ] **Step 10.4: Supabase service-role client**

```typescript
// apps/bff/src/services/supabase.ts
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) throw new Error("Missing Supabase env vars");

// singleton — service role bypassa RLS (usado apenas no BFF, nunca no cliente)
export const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});
```

- [ ] **Step 10.5: Middleware auth (valida JWT Supabase)**

```typescript
// apps/bff/src/middleware/auth.ts
import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { supabase } from "../services/supabase";
import type { HonoVariables } from "../types/hono";
import type { Role } from "@apmcb/shared";

export const authMiddleware: MiddlewareHandler<{ Variables: HonoVariables }> =
  async (c, next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      throw new HTTPException(401, { message: "Missing Bearer token" });
    }

    const token = authHeader.slice(7);
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      throw new HTTPException(401, { message: "Invalid token" });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!profile) {
      throw new HTTPException(403, { message: "Profile not found" });
    }

    c.set("userId", user.id);
    c.set("role", profile.role as Role);
    await next();
  };
```

- [ ] **Step 10.6: Middleware role-guard**

```typescript
// apps/bff/src/middleware/role-guard.ts
import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { HonoVariables } from "../types/hono";
import type { Role } from "@apmcb/shared";

export function roleGuard(...allowedRoles: Role[]): MiddlewareHandler<{ Variables: HonoVariables }> {
  return async (c, next) => {
    const role = c.get("role");
    if (!allowedRoles.includes(role)) {
      throw new HTTPException(403, { message: "Insufficient permissions" });
    }
    await next();
  };
}
```

- [ ] **Step 10.7: Middleware rate-limit (in-memory)**

```typescript
// apps/bff/src/middleware/rate-limit.ts
import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";

const store = new Map<string, { count: number; resetAt: number }>();

// 60 requests per minute per IP
export const rateLimitMiddleware: MiddlewareHandler = async (c, next) => {
  const ip = c.req.header("x-forwarded-for") ?? "unknown";
  const now = Date.now();
  const windowMs = 60_000;
  const max = 60;

  const entry = store.get(ip);
  if (!entry || now > entry.resetAt) {
    store.set(ip, { count: 1, resetAt: now + windowMs });
  } else {
    entry.count++;
    if (entry.count > max) {
      throw new HTTPException(429, { message: "Too many requests" });
    }
  }

  await next();
};
```

- [ ] **Step 10.8: Middleware audit**

```typescript
// apps/bff/src/middleware/audit.ts
import type { MiddlewareHandler } from "hono";
import { supabase } from "../services/supabase";
import type { HonoVariables } from "../types/hono";

export function auditAction(action: string, resourceType: string): MiddlewareHandler<{ Variables: HonoVariables }> {
  return async (c, next) => {
    await next();
    // log assíncrono — não bloqueia resposta
    const actorId = c.get("userId");
    if (actorId) {
      supabase.from("audit_logs").insert({
        actor_id: actorId,
        action,
        resource_type: resourceType,
        metadata: { method: c.req.method, path: c.req.path, status: c.res.status },
      }).then(() => {}); // fire and forget
    }
  };
}
```

- [ ] **Step 10.9: Hono app entry**

```typescript
// apps/bff/src/index.ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { HTTPException } from "hono/http-exception";
import { authMiddleware } from "./middleware/auth";
import { rateLimitMiddleware } from "./middleware/rate-limit";
import type { HonoVariables } from "./types/hono";

const app = new Hono<{ Variables: HonoVariables }>();

// Global middleware
app.use("*", logger());
app.use("*", secureHeaders());
app.use(
  "*",
  cors({
    origin: [
      process.env.WEB_URL ?? "http://localhost:3000",
      "https://apmcb.pages.dev",
    ],
    credentials: true,
  })
);
app.use("/api/*", rateLimitMiddleware);
app.use("/api/*", authMiddleware);

// Health check (público)
app.get("/health", (c) => c.json({ ok: true, ts: new Date().toISOString() }));

// Rotas (serão adicionadas nos próximos sprints)
app.get("/api/me", (c) =>
  c.json({ userId: c.get("userId"), role: c.get("role") })
);

// Error handler global
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }
  console.error(err);
  return c.json({ error: "Internal server error" }, 500);
});

const port = Number(process.env.PORT ?? 3001);
console.log(`BFF running on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};
```

- [ ] **Step 10.10: PM2 config (para Hetzner)**

```javascript
// apps/bff/ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: "apmcb-bff",
      script: "bun",
      args: "run src/index.ts",
      cwd: "/var/www/apmcb/apps/bff",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        PORT: 3001,
      },
    },
  ],
};
```

- [ ] **Step 10.11: Testar BFF localmente**

```bash
cd apps/bff
bun run src/index.ts &
curl http://localhost:3001/health
```

Esperado: `{"ok":true,"ts":"..."}`

- [ ] **Step 10.12: Commit**

```bash
cd c:\projetos\apmcb
git add apps/bff
git commit -m "feat(bff): Bun + Hono scaffold — auth, role-guard, audit, rate-limit middleware"
```

---

## Task 11: BFF — ZKTeco fingerprint bridge (plugável)

**Files:**
- Create: `apps/bff/src/services/fingerprint/interface.ts`
- Create: `apps/bff/src/services/fingerprint/zkteco.ts`
- Create: `apps/bff/src/services/fingerprint/index.ts`
- Create: `apps/bff/src/routes/biometric.ts`

- [ ] **Step 11.1: Interface IFingerprintSDK**

```typescript
// apps/bff/src/services/fingerprint/interface.ts

export interface FingerprintTemplate {
  data: Buffer;
  fingerIndex: number;
  quality: number; // 0-100
}

export interface IdentifyResult {
  userId: string;
  score: number; // match score 0-100
}

export interface IFingerprintSDK {
  /** Inicializa conexão com dispositivo USB */
  initialize(): Promise<void>;

  /** Captura template do dedo no leitor */
  capture(fingerIndex: number): Promise<FingerprintTemplate>;

  /**
   * Busca 1:N — compara template capturado contra todos os templates
   * registrados. Retorna null se não encontrar acima do threshold.
   */
  identify(
    capturedTemplate: Buffer,
    templates: Array<{ userId: string; templateData: Buffer }>
  ): Promise<IdentifyResult | null>;

  /** Verifica 1:1 — confirma se template bate com userId específico */
  verify(
    capturedTemplate: Buffer,
    storedTemplate: Buffer
  ): Promise<boolean>;

  /** Libera recursos */
  dispose(): Promise<void>;
}
```

- [ ] **Step 11.2: Implementação ZKTeco (stub — substituir quando SDK disponível)**

```typescript
// apps/bff/src/services/fingerprint/zkteco.ts
import type {
  IFingerprintSDK,
  FingerprintTemplate,
  IdentifyResult,
} from "./interface";

/**
 * Stub da implementação ZKTeco.
 * Em produção: substituir pelos bindings reais do libzkfp.
 * Referência: https://github.com/biometrika/zkfp-node (ou SDK ZKTeco oficial)
 *
 * Para trocar de SDK, basta criar nova classe que implementa IFingerprintSDK
 * e alterar apenas o factory em index.ts.
 */
export class ZKTecoSDK implements IFingerprintSDK {
  private initialized = false;

  async initialize(): Promise<void> {
    // TODO: carregar libzkfp.so / zkfp.dll via FFI (Bun.dlopen)
    // const lib = Bun.dlopen(process.env.ZKTECO_LIB_PATH!, { ... });
    this.initialized = true;
    console.log("[ZKTeco] SDK initialized (stub)");
  }

  async capture(fingerIndex: number): Promise<FingerprintTemplate> {
    if (!this.initialized) throw new Error("SDK not initialized");
    // TODO: chamar ZKFPM_AcquireFingerprint()
    return {
      data: Buffer.from("stub-template"),
      fingerIndex,
      quality: 85,
    };
  }

  async identify(
    capturedTemplate: Buffer,
    templates: Array<{ userId: string; templateData: Buffer }>
  ): Promise<IdentifyResult | null> {
    if (!this.initialized) throw new Error("SDK not initialized");
    // TODO: chamar ZKFPM_GenChar() + ZKFPM_DBMatch() em loop
    // threshold padrão ZKTeco: score >= 65
    console.log(`[ZKTeco] Identifying against ${templates.length} templates`);
    return null; // stub retorna null (nenhum match)
  }

  async verify(
    capturedTemplate: Buffer,
    storedTemplate: Buffer
  ): Promise<boolean> {
    if (!this.initialized) throw new Error("SDK not initialized");
    // TODO: ZKFPM_GenChar() + ZKFPM_DBMatch() para um par
    return false;
  }

  async dispose(): Promise<void> {
    // TODO: ZKFPM_Terminate()
    this.initialized = false;
  }
}
```

- [ ] **Step 11.3: Factory — troca de SDK sem tocar nas rotas**

```typescript
// apps/bff/src/services/fingerprint/index.ts
import type { IFingerprintSDK } from "./interface";
import { ZKTecoSDK } from "./zkteco";

let instance: IFingerprintSDK | null = null;

export async function getFingerprintSDK(): Promise<IFingerprintSDK> {
  if (instance) return instance;

  const sdkName = process.env.FINGERPRINT_SDK ?? "zkteco";

  switch (sdkName) {
    case "zkteco":
      instance = new ZKTecoSDK();
      break;
    // case "digitalpersona":
    //   instance = new DigitalPersonaSDK();
    //   break;
    default:
      throw new Error(`Unknown fingerprint SDK: ${sdkName}`);
  }

  await instance.initialize();
  return instance;
}

export type { IFingerprintSDK, FingerprintTemplate, IdentifyResult } from "./interface";
```

- [ ] **Step 11.4: Rota biometric (esqueleto)**

```typescript
// apps/bff/src/routes/biometric.ts
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { roleGuard } from "../middleware/role-guard";
import { auditAction } from "../middleware/audit";
import { supabase } from "../services/supabase";
import { getFingerprintSDK } from "../services/fingerprint/index";
import type { HonoVariables } from "../types/hono";

export const biometricRoutes = new Hono<{ Variables: HonoVariables }>();

// POST /api/biometric/identify — encosta o dedo → retorna perfil do militar
biometricRoutes.post(
  "/identify",
  roleGuard("admin", "master"),
  auditAction("biometric.identify", "biometric_templates"),
  async (c) => {
    const sdk = await getFingerprintSDK();

    // Captura template do leitor USB conectado ao servidor
    const captured = await sdk.capture(1);

    // Busca todos os templates no banco (service-role, sem RLS)
    const { data: templates, error } = await supabase
      .from("biometric_templates")
      .select("user_id, template_data");

    if (error) return c.json({ error: "Database error" }, 500);

    const result = await sdk.identify(
      captured.data,
      (templates ?? []).map((t) => ({
        userId: t.user_id,
        templateData: Buffer.from(t.template_data),
      }))
    );

    if (!result) return c.json({ found: false }, 404);

    // Busca perfil do militar identificado
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, matricula, nome_completo, posto, turma, foto_url, registration_status")
      .eq("id", result.userId)
      .single();

    return c.json({ found: true, score: result.score, profile });
  }
);

// POST /api/biometric/register — registra digital de um militar
biometricRoutes.post(
  "/register",
  roleGuard("admin", "master"),
  zValidator("json", z.object({
    userId: z.string().uuid(),
    fingerIndex: z.number().int().min(1).max(10),
  })),
  auditAction("biometric.register", "biometric_templates"),
  async (c) => {
    const { userId, fingerIndex } = c.req.valid("json");
    const masterId = c.get("userId");
    const sdk = await getFingerprintSDK();

    const template = await sdk.capture(fingerIndex);

    const { error } = await supabase
      .from("biometric_templates")
      .upsert({
        user_id: userId,
        template_data: template.data,
        finger_index: fingerIndex,
        registered_by: masterId,
      }, { onConflict: "user_id,finger_index" });

    if (error) return c.json({ error: "Failed to save template" }, 500);

    // Atualiza status do perfil para complete
    await supabase
      .from("profiles")
      .update({ registration_status: "complete" })
      .eq("id", userId);

    // Notifica o militar
    await supabase.from("notifications").insert({
      user_id: userId,
      type: "biometric_registered",
      title: "Biometria registrada",
      body: "Seu cadastro biométrico foi concluído com sucesso.",
    });

    return c.json({ ok: true, quality: template.quality });
  }
);
```

- [ ] **Step 11.5: Registrar rotas no app principal**

Edite `apps/bff/src/index.ts` — adicione antes do `app.onError`:

```typescript
import { biometricRoutes } from "./routes/biometric";
// ...
app.route("/api/biometric", biometricRoutes);
```

- [ ] **Step 11.6: Commit**

```bash
git add apps/bff/src/services/fingerprint apps/bff/src/routes/biometric.ts apps/bff/src/index.ts
git commit -m "feat(bff): pluggable fingerprint SDK — ZKTeco stub + identify/register routes"
```

---

## Task 12: PWA — manifest e service worker

**Files:**
- Create: `apps/web/public/manifest.webmanifest`
- Modify: `apps/web/next.config.ts`

- [ ] **Step 12.1: Web manifest**

```json
{
  "name": "APMCB Controle",
  "short_name": "APMCB",
  "description": "Sistema de controle de material — Academia de Polícia Militar do Cabo Branco",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#1E40AF",
  "orientation": "portrait-primary",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

- [ ] **Step 12.2: Adicionar Serwist ao next.config.ts**

```typescript
import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [{ protocol: "https", hostname: "*.supabase.co" }],
  },
};

export default withSerwist(nextConfig);
```

- [ ] **Step 12.3: Service worker base**

Crie `apps/web/src/app/sw.ts`:

```typescript
import { defaultCache } from "@serwist/next/worker";
import { Serwist } from "serwist";

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();
```

- [ ] **Step 12.4: Commit**

```bash
git add apps/web/public/manifest.webmanifest apps/web/src/app/sw.ts apps/web/next.config.ts
git commit -m "feat(web): PWA manifest + Serwist service worker"
```

---

## Task 13: CI/CD — GitHub Actions

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/deploy-bff.yml`

- [ ] **Step 13.1: CI pipeline (lint + typecheck + test)**

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Typecheck
        run: pnpm typecheck

      - name: Lint
        run: pnpm lint

      - name: Test
        run: pnpm test
```

- [ ] **Step 13.2: Deploy BFF no Hetzner**

```yaml
# .github/workflows/deploy-bff.yml
name: Deploy BFF

on:
  push:
    branches: [main]
    paths:
      - "apps/bff/**"
      - "packages/shared/**"

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.HETZNER_HOST }}
          username: ${{ secrets.HETZNER_USER }}
          key: ${{ secrets.HETZNER_SSH_KEY }}
          script: |
            cd /var/www/apmcb
            git pull origin main
            cd apps/bff
            bun install --production
            pm2 reload ecosystem.config.cjs --update-env
```

Secrets necessários no GitHub:
- `HETZNER_HOST` — IP do VPS
- `HETZNER_USER` — ex: `deploy`
- `HETZNER_SSH_KEY` — chave privada SSH

- [ ] **Step 13.3: Commit**

```bash
git add .github/
git commit -m "ci: GitHub Actions — CI pipeline + BFF deploy to Hetzner"
```

---

## Task 14: Verificação final do Sprint 0

- [ ] **Step 14.1: Instalar todas as dependências do monorepo**

```bash
cd c:\projetos\apmcb
pnpm install
```

- [ ] **Step 14.2: Typecheck global**

```bash
pnpm typecheck
```

Esperado: 0 erros em todos os packages.

- [ ] **Step 14.3: Rodar frontend em dev**

```bash
pnpm --filter @apmcb/web dev
```

Esperado: Next.js rodando em `http://localhost:3000` sem erros.

- [ ] **Step 14.4: Rodar BFF em dev**

```bash
pnpm --filter @apmcb/bff dev
```

Testar health check:
```bash
curl http://localhost:3001/health
```

Esperado: `{"ok":true,"ts":"..."}`

- [ ] **Step 14.5: Verificar Supabase local**

```bash
supabase status
```

Esperado: todos os serviços rodando (`API`, `DB`, `Studio`, `Inbucket`).

- [ ] **Step 14.6: Commit final**

```bash
git add .
git commit -m "chore: Sprint 0 complete — monorepo scaffold, schema, BFF, PWA, CI/CD"
```

---

## Checklist de cobertura da spec

| Requisito | Task |
|---|---|
| Monorepo Turborepo + pnpm | Task 1 |
| Tipos compartilhados Zod | Task 2 |
| Schema completo (profiles, arsenal, lendings, notif, audit) | Task 3 |
| RLS em todas as tabelas | Task 4 |
| Seed de desenvolvimento | Task 5 |
| Next.js 15 App Router + TS + Tailwind v4 | Task 6 |
| Design system (tokens, dark/light, branco/azul/vermelho) | Task 7 |
| Supabase client browser + server (RSC) | Task 8 |
| Layout (sidebar, header, bottom-nav, app-shell) | Task 9 |
| BFF Bun + Hono + middleware stack | Task 10 |
| ZKTeco SDK plugável (interface + stub + factory) | Task 11 |
| PWA manifest + Serwist | Task 12 |
| GitHub Actions CI + deploy Hetzner | Task 13 |
