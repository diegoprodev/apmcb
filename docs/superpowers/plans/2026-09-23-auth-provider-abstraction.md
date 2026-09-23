# Auth Provider Abstraction (Fase 2 do MIGRATION_SPEC.md) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o login do apmcb funcionar contra dois back-ends de identidade intercambiáveis — Supabase Auth (modo `SUPABASE`, atual) e uma tabela `public.usuarios` com bcrypt (modo `ON_PREMISE`, novo) — selecionados por uma única variável de ambiente, sem alterar a resposta HTTP de nenhuma rota existente.

**Architecture:** Interface `AuthProvider` (`login` + `verifyAccessToken`) com duas implementações (`SupabaseAuthProvider`, `LocalAuthProvider`), escolhidas por uma factory que lê `AMBIENTE_INFRA` via um validador de env central e fail-closed. `apps/bff/src/routes/auth.ts` e `apps/bff/src/middleware/auth.ts` passam a chamar a interface em vez de fazer `fetch` direto pro REST da Supabase — toda a lógica de sessão (iron-session, tenant/reserve, CSRF, audit log) que já existe hoje **não muda uma linha**. Um bootstrap SQL separado (fora da pasta compartilhada `supabase/migrations/`) cria um schema `auth` mínimo no Postgres on-prem só pra satisfazer o FK `profiles.id → auth.users(id)` e a função `auth.uid()` que as 250 RLS policies já usam — sem isso, a primeira migration (`20260611000001_initial_schema.sql`) falha num Postgres puro.

**Tech Stack:** TypeScript, Hono, Bun (runtime de produção) / Node `--experimental-strip-types --test` (test runner do projeto), `pg` (Postgres driver, novo), `bcryptjs` (novo — não `bcrypt` nativo, que quebra sob Bun; não `Bun.password`, que não existe sob `node --test`), `zod` (já presente).

**Spec:** `MIGRATION_SPEC.md` (raiz do repo), seções 2 (modelo de deployment), 4.2 (shim de RLS), 5 (autenticação e sessão).

## Global Constraints

- Zero mudança de comportamento/resposta HTTP no modo `SUPABASE` — todo teste existente de `auth.ts`/`middleware/auth.ts` continua passando sem edição.
- `AMBIENTE_INFRA` ausente ou inválido no boot **derruba o processo** (fail-closed) — nunca assume um modo default.
- Nenhuma dependência nova pode quebrar `bun run src/index.ts` (produção) nem `node --experimental-strip-types --test` (CI) — por isso `bcryptjs`, não `bcrypt`/`Bun.password`.
- `supabase/migrations/` continua sendo a única fonte de schema compartilhada entre os dois ambientes (invariante da Fase 1, já commitada) — nada específico de um ambiente entra nessa pasta.
- Mensagens de erro para o usuário final em português, idênticas às já existentes (`"Credenciais inválidas"`, `"Token inválido ou expirado"`) — não vazar em qual campo o login falhou.

## Review Focus

- Login on-prem com email certo e senha errada devolve a mesma mensagem genérica `"Credenciais inválidas"` que hoje — não pode indicar "senha errada" vs "usuário não existe". Coberto na Task 4.
- `AMBIENTE_INFRA` ausente/inválido no boot derruba o processo imediatamente, não cai num modo default silencioso. Coberto na Task 2.
- Rota que hoje aceita `Authorization: Bearer <supabase JWT>` (fallback do middleware, usado por rotas edge do Next.js) precisa de um comportamento definido em `ON_PREMISE` — não pode lançar exceção não tratada nem aceitar silenciosamente um token que não valida nada. Coberto na Task 6.
- `public.usuarios.email` precisa normalizar case do mesmo jeito que a Supabase normaliza `auth.users.email` (lowercase) — senão dá pra criar duas contas "Fulano@x.com" e "fulano@x.com" on-prem que nunca colidiriam no Supabase. Coberto na Task 4.
- O bootstrap SQL do schema `auth` on-prem não pode, por engano, tentar rodar contra um projeto Supabase real (onde `auth.users`/`auth.uid()` já existem e são donos da GoTrue) — precisa viver fora de `supabase/migrations/` e ser documentado como on-prem-only. Coberto na Task 1.

---

### Task 1: Bootstrap SQL do schema `auth` para Postgres on-prem

**Files:**
- Create: `supabase/onprem-bootstrap/000_auth_shim.sql`
- Test: `apps/bff/src/__tests__/onprem-auth-shim.test.ts`

**Interfaces:**
- Produces: schema `auth` com tabela `auth.users(id uuid primary key, email text)` e função `auth.uid() returns uuid` — consumido por todas as 250 RLS policies existentes (via as funções `my_tenant_id()` etc., inalteradas) e pelo FK `profiles.id REFERENCES auth.users(id)` já existente em `20260611000001_initial_schema.sql`.

- [ ] **Step 1: Escrever o SQL do bootstrap**

```sql
-- supabase/onprem-bootstrap/000_auth_shim.sql
--
-- ON-PREM ONLY. NUNCA rodar contra um projeto Supabase real — lá o schema
-- `auth` já existe, é gerenciado pela GoTrue, e `auth.uid()` já lê o JWT do
-- PostgREST via `request.jwt.claims`. Este arquivo recria só o suficiente
-- pra satisfazer:
--   1. o FK `profiles.id REFERENCES auth.users(id)` (20260611000001).
--   2. a função `auth.uid()` que ~250 RLS policies chamam via
--      my_tenant_id()/auth_role()/etc — mesma assinatura, mesmo corpo do
--      Supabase (só lê uma GUC de sessão), então nenhuma policy muda.
--
-- Aplicar ANTES de `supabase db push --db-url $ON_PREM_DATABASE_URL`
-- (ver MIGRATION_SPEC.md §4.4). Aplicação: psql -f 000_auth_shim.sql.
--
-- O BFF, em modo ON_PREMISE, executa `SET LOCAL request.jwt.claims =
-- '{"sub":"<uuid>"}'` no início de cada transação autenticada (ver Task 6
-- deste plano + MIGRATION_SPEC.md §4.2) — é isso que auth.uid() lê abaixo.

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text
);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true), '')::json->>'sub'
$$;
```

- [ ] **Step 2: Escrever o teste de guarda estática**

Não há Postgres local disponível neste ambiente (Docker Desktop sem WSL2, ver `CHANGELOG.md` v52) — o teste valida a ESTRUTURA do SQL, não executa contra um banco real. Segue o mesmo padrão já usado em `apps/bff/src/__tests__/auth-me-perf03-parallel.test.ts` (guarda estática via regex sobre o código-fonte).

```typescript
// apps/bff/src/__tests__/onprem-auth-shim.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const shimPath = resolve(process.cwd(), "../../supabase/onprem-bootstrap/000_auth_shim.sql");
const shimSrc = readFileSync(shimPath, "utf-8");

describe("supabase/onprem-bootstrap/000_auth_shim.sql", () => {
  it("cria o schema auth de forma idempotente", () => {
    assert.match(shimSrc, /CREATE SCHEMA IF NOT EXISTS auth/i);
  });

  it("cria auth.users com id uuid PRIMARY KEY (satisfaz o FK de profiles.id)", () => {
    assert.match(shimSrc, /CREATE TABLE IF NOT EXISTS auth\.users/i);
    assert.match(shimSrc, /id\s+uuid PRIMARY KEY/i);
  });

  it("cria auth.uid() lendo request.jwt.claims via current_setting", () => {
    assert.match(shimSrc, /CREATE OR REPLACE FUNCTION auth\.uid\(\)/i);
    assert.match(shimSrc, /current_setting\(\s*'request\.jwt\.claims'/i);
  });

  it("nunca usa DROP ou referencia storage/realtime (escopo mínimo, não é um clone da Supabase)", () => {
    assert.doesNotMatch(shimSrc, /DROP\s+(TABLE|SCHEMA)/i);
    assert.doesNotMatch(shimSrc, /storage\.|realtime\./i);
  });
});
```

- [ ] **Step 3: Rodar o teste e confirmar que passa**

Run: `cd apps/bff && node --experimental-strip-types --test src/__tests__/onprem-auth-shim.test.ts`
Expected: 4 testes, todos PASS.

- [ ] **Step 4: Commit**

```bash
git add supabase/onprem-bootstrap/000_auth_shim.sql apps/bff/src/__tests__/onprem-auth-shim.test.ts
git commit -m "feat(onprem): bootstrap do schema auth (shim) para Postgres on-premise"
```

---

### Task 2: Validação central de `AMBIENTE_INFRA` (fail-closed)

**Files:**
- Create: `apps/bff/src/lib/infra-env.ts`
- Test: `apps/bff/src/__tests__/infra-env.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export type InfraMode = "SUPABASE" | "ON_PREMISE";
  export interface InfraEnv {
    mode: InfraMode;
    supabaseUrl?: string;
    supabaseServiceRoleKey?: string;
    databaseUrl?: string;
  }
  export function loadInfraEnv(source: NodeJS.ProcessEnv): InfraEnv; // throws Error on invalid config
  ```
  Consumido pela Task 5 (`auth-provider-factory.ts`).

- [ ] **Step 1: Escrever os testes que falham**

```typescript
// apps/bff/src/__tests__/infra-env.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadInfraEnv } from "../lib/infra-env";

describe("loadInfraEnv", () => {
  it("lança erro se AMBIENTE_INFRA estiver ausente", () => {
    assert.throws(() => loadInfraEnv({}), /AMBIENTE_INFRA/);
  });

  it("lança erro se AMBIENTE_INFRA tiver valor fora do enum", () => {
    assert.throws(() => loadInfraEnv({ AMBIENTE_INFRA: "AWS" }), /AMBIENTE_INFRA/);
  });

  it("modo SUPABASE exige SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY", () => {
    assert.throws(
      () => loadInfraEnv({ AMBIENTE_INFRA: "SUPABASE" }),
      /SUPABASE_URL/,
    );
  });

  it("modo SUPABASE válido retorna InfraEnv correto", () => {
    const env = loadInfraEnv({
      AMBIENTE_INFRA: "SUPABASE",
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "svc-key",
    });
    assert.equal(env.mode, "SUPABASE");
    assert.equal(env.supabaseUrl, "https://x.supabase.co");
    assert.equal(env.supabaseServiceRoleKey, "svc-key");
  });

  it("modo ON_PREMISE exige DATABASE_URL", () => {
    assert.throws(
      () => loadInfraEnv({ AMBIENTE_INFRA: "ON_PREMISE" }),
      /DATABASE_URL/,
    );
  });

  it("modo ON_PREMISE válido retorna InfraEnv correto", () => {
    const env = loadInfraEnv({
      AMBIENTE_INFRA: "ON_PREMISE",
      DATABASE_URL: "postgres://user:pass@localhost:5432/apmcb",
    });
    assert.equal(env.mode, "ON_PREMISE");
    assert.equal(env.databaseUrl, "postgres://user:pass@localhost:5432/apmcb");
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `cd apps/bff && node --experimental-strip-types --test src/__tests__/infra-env.test.ts`
Expected: FAIL — `Cannot find module '../lib/infra-env'`.

- [ ] **Step 3: Implementar `infra-env.ts`**

```typescript
// apps/bff/src/lib/infra-env.ts
import { z } from "zod";

export type InfraMode = "SUPABASE" | "ON_PREMISE";

export interface InfraEnv {
  mode: InfraMode;
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
  databaseUrl?: string;
}

const baseSchema = z.object({
  AMBIENTE_INFRA: z.enum(["SUPABASE", "ON_PREMISE"], {
    errorMap: () => ({
      message: "AMBIENTE_INFRA deve ser 'SUPABASE' ou 'ON_PREMISE' (variável obrigatória, sem default)",
    }),
  }),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  DATABASE_URL: z.string().optional(),
});

export function loadInfraEnv(source: NodeJS.ProcessEnv): InfraEnv {
  const parsed = baseSchema.parse(source);

  if (parsed.AMBIENTE_INFRA === "SUPABASE") {
    if (!parsed.SUPABASE_URL || !parsed.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error(
        "AMBIENTE_INFRA=SUPABASE exige SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY definidos",
      );
    }
    return {
      mode: "SUPABASE",
      supabaseUrl: parsed.SUPABASE_URL,
      supabaseServiceRoleKey: parsed.SUPABASE_SERVICE_ROLE_KEY,
    };
  }

  if (!parsed.DATABASE_URL) {
    throw new Error("AMBIENTE_INFRA=ON_PREMISE exige DATABASE_URL definido");
  }
  return { mode: "ON_PREMISE", databaseUrl: parsed.DATABASE_URL };
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `cd apps/bff && node --experimental-strip-types --test src/__tests__/infra-env.test.ts`
Expected: 6 testes, todos PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/bff/src/lib/infra-env.ts apps/bff/src/__tests__/infra-env.test.ts
git commit -m "feat(bff): validacao central e fail-closed de AMBIENTE_INFRA"
```

---

### Task 3: `AuthProvider` — interface + `SupabaseAuthProvider`

**Files:**
- Create: `apps/bff/src/lib/auth-provider.ts`
- Test: `apps/bff/src/__tests__/auth-provider-supabase.test.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores diretamente (é standalone).
- Produces:
  ```typescript
  // accessToken só é preenchido pelo SupabaseAuthProvider (o token real da
  // Supabase Auth, que session.supabaseAccessToken já guarda hoje) — fica
  // undefined no LocalAuthProvider, que não tem equivalente nesta fase.
  export interface AuthIdentity { userId: string; email: string | null; accessToken?: string }
  export class AuthError extends Error {
    constructor(message: string, public code: "invalid_credentials" | "invalid_token" | "not_supported")
  }
  export interface AuthProvider {
    login(email: string, password: string): Promise<AuthIdentity>;
    verifyAccessToken(token: string): Promise<AuthIdentity>;
  }
  export class SupabaseAuthProvider implements AuthProvider {
    constructor(opts: { url: string; serviceRoleKey: string; fetchImpl?: typeof fetch })
  }
  ```
  Consumido pela Task 5 (factory) e Task 6 (rotas).

- [ ] **Step 1: Escrever os testes que falham**

```typescript
// apps/bff/src/__tests__/auth-provider-supabase.test.ts
import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { SupabaseAuthProvider, AuthError } from "../lib/auth-provider";

function fakeFetch(responses: Record<string, { status: number; body: unknown }>) {
  return mock.fn(async (input: string | URL) => {
    const url = input.toString();
    for (const [match, res] of Object.entries(responses)) {
      if (url.includes(match)) {
        return new Response(JSON.stringify(res.body), { status: res.status });
      }
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

describe("SupabaseAuthProvider.login", () => {
  it("chama /auth/v1/token com grant_type=password e devolve a identidade", async () => {
    const fetchImpl = fakeFetch({
      "/auth/v1/token": {
        status: 200,
        body: { access_token: "tok", user: { id: "u1", email: "a@x.com" } },
      },
    });
    const provider = new SupabaseAuthProvider({
      url: "https://x.supabase.co",
      serviceRoleKey: "svc",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const identity = await provider.login("a@x.com", "senha123");

    assert.equal(identity.userId, "u1");
    assert.equal(identity.email, "a@x.com");
    assert.equal(identity.accessToken, "tok");
    const [calledUrl] = fetchImpl.mock.calls[0].arguments;
    assert.match(calledUrl.toString(), /grant_type=password/);
  });

  it("lança AuthError(invalid_credentials) quando a Supabase rejeita", async () => {
    const fetchImpl = fakeFetch({
      "/auth/v1/token": { status: 400, body: { error: "invalid_grant" } },
    });
    const provider = new SupabaseAuthProvider({
      url: "https://x.supabase.co",
      serviceRoleKey: "svc",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await assert.rejects(
      () => provider.login("a@x.com", "errada"),
      (err: unknown) => err instanceof AuthError && err.code === "invalid_credentials",
    );
  });
});

describe("SupabaseAuthProvider.verifyAccessToken", () => {
  it("chama /auth/v1/user com Bearer e devolve a identidade", async () => {
    const fetchImpl = fakeFetch({
      "/auth/v1/user": { status: 200, body: { id: "u1", email: "a@x.com" } },
    });
    const provider = new SupabaseAuthProvider({
      url: "https://x.supabase.co",
      serviceRoleKey: "svc",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const identity = await provider.verifyAccessToken("tok");

    assert.equal(identity.userId, "u1");
    const [, init] = fetchImpl.mock.calls[0].arguments as [string, RequestInit];
    assert.equal((init.headers as Record<string, string>).Authorization, "Bearer tok");
  });

  it("lança AuthError(invalid_token) quando o token não valida", async () => {
    const fetchImpl = fakeFetch({ "/auth/v1/user": { status: 401, body: {} } });
    const provider = new SupabaseAuthProvider({
      url: "https://x.supabase.co",
      serviceRoleKey: "svc",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await assert.rejects(
      () => provider.verifyAccessToken("bad"),
      (err: unknown) => err instanceof AuthError && err.code === "invalid_token",
    );
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `cd apps/bff && node --experimental-strip-types --test src/__tests__/auth-provider-supabase.test.ts`
Expected: FAIL — `Cannot find module '../lib/auth-provider'`.

- [ ] **Step 3: Implementar `auth-provider.ts`**

```typescript
// apps/bff/src/lib/auth-provider.ts

export interface AuthIdentity {
  userId: string;
  email: string | null;
}

export class AuthError extends Error {
  constructor(
    message: string,
    public code: "invalid_credentials" | "invalid_token" | "not_supported",
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export interface AuthProvider {
  login(email: string, password: string): Promise<AuthIdentity>;
  verifyAccessToken(token: string): Promise<AuthIdentity>;
}

export class SupabaseAuthProvider implements AuthProvider {
  private readonly url: string;
  private readonly serviceRoleKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: { url: string; serviceRoleKey: string; fetchImpl?: typeof fetch }) {
    this.url = opts.url;
    this.serviceRoleKey = opts.serviceRoleKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async login(email: string, password: string): Promise<AuthIdentity> {
    const res = await this.fetchImpl(`${this.url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: this.serviceRoleKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = (await res.json()) as {
      access_token?: string;
      user?: { id: string; email?: string };
    };
    if (!res.ok || !data.access_token || !data.user) {
      throw new AuthError("Credenciais inválidas", "invalid_credentials");
    }
    return { userId: data.user.id, email: data.user.email ?? null, accessToken: data.access_token };
  }

  async verifyAccessToken(token: string): Promise<AuthIdentity> {
    const res = await this.fetchImpl(`${this.url}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: this.serviceRoleKey },
    });
    if (!res.ok) {
      throw new AuthError("Token inválido ou expirado", "invalid_token");
    }
    const user = (await res.json()) as { id: string; email?: string } | null;
    if (!user?.id) {
      throw new AuthError("Token inválido ou expirado", "invalid_token");
    }
    return { userId: user.id, email: user.email ?? null };
  }
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `cd apps/bff && node --experimental-strip-types --test src/__tests__/auth-provider-supabase.test.ts`
Expected: 4 testes, todos PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/bff/src/lib/auth-provider.ts apps/bff/src/__tests__/auth-provider-supabase.test.ts
git commit -m "feat(bff): interface AuthProvider + SupabaseAuthProvider (extrai fetch de auth.ts)"
```

---

### Task 4: `public.usuarios` + `LocalAuthProvider` (bcrypt)

**Files:**
- Create: `supabase/migrations/20260923120000_usuarios_onprem.sql`
- Create: `apps/bff/src/lib/local-auth-provider.ts`
- Modify: `apps/bff/package.json` (adiciona `pg`, `bcryptjs`, `@types/pg`, `@types/bcryptjs`)
- Test: `apps/bff/src/__tests__/auth-provider-local.test.ts`

**Interfaces:**
- Consumes: `AuthProvider`, `AuthIdentity`, `AuthError` (Task 3).
- Produces:
  ```typescript
  export interface UsuariosRepository {
    findByEmail(email: string): Promise<{ id: string; email: string; senha_hash: string } | null>;
  }
  export class PgUsuariosRepository implements UsuariosRepository {
    constructor(pool: import("pg").Pool)
  }
  export class LocalAuthProvider implements AuthProvider {
    constructor(repo: UsuariosRepository)
  }
  ```
  Consumido pela Task 5 (factory).

- [ ] **Step 1: Escrever a migration**

`public.usuarios` entra na pasta compartilhada — é aditiva e inofensiva em modo `SUPABASE` (fica só sem uso). `email` normalizado em minúsculas via `CITEXT`-like check (usa `lower()` no índice único em vez da extensão `citext`, pra não adicionar dependência de extensão nova): garante que "Fulano@x.com" e "fulano@x.com" colidem, igual a Supabase Auth (`auth.users.email` já é normalizado em minúsculas pela GoTrue).

```sql
-- supabase/migrations/20260923120000_usuarios_onprem.sql
--
-- Tabela de credenciais para o modo ON_PREMISE (ver MIGRATION_SPEC.md §5.2/5.3
-- e docs/superpowers/plans/2026-09-23-auth-provider-abstraction.md). Em modo
-- SUPABASE fica presente mas nunca é escrita nem lida — a mesma pasta de
-- migrations é a fonte única de verdade pros dois ambientes (Fase 1).
--
-- id é o MESMO uuid usado em profiles.id e (on-prem) em auth.users.id — ver
-- Task 7 do plano (script de provisionamento), que insere nas 3 tabelas com
-- o mesmo id numa única transação.
CREATE TABLE IF NOT EXISTS public.usuarios (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL,
  senha_hash  text NOT NULL,
  criado_em   timestamptz NOT NULL DEFAULT now()
);

-- lower(email) em vez da extensão citext: mesma normalização de case que a
-- Supabase Auth já aplica em auth.users.email, sem extensão nova.
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_email_lower_idx
  ON public.usuarios (lower(email));
```

- [ ] **Step 2: Adicionar as dependências novas**

Run: `cd apps/bff && corepack pnpm add pg bcryptjs && corepack pnpm add -D @types/pg @types/bcryptjs`

- [ ] **Step 3: Escrever os testes que falham**

`LocalAuthProvider` é testado com um `UsuariosRepository` falso em memória — não depende de Postgres real (indisponível neste ambiente, ver Task 1). `PgUsuariosRepository` (a implementação real com `pg.Pool`) fica sem teste automatizado aqui por essa mesma razão; validação fica documentada como manual/integração pendente (ver seção "Pendente" no final deste plano).

```typescript
// apps/bff/src/__tests__/auth-provider-local.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { LocalAuthProvider, type UsuariosRepository } from "../lib/local-auth-provider";
import { AuthError } from "../lib/auth-provider";

function fakeRepo(users: Array<{ id: string; email: string; senha_hash: string }>): UsuariosRepository {
  return {
    async findByEmail(email: string) {
      return users.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null;
    },
  };
}

describe("LocalAuthProvider.login", () => {
  it("autentica com email + senha corretos", async () => {
    const hash = await bcrypt.hash("senha123", 10);
    const repo = fakeRepo([{ id: "u1", email: "a@x.com", senha_hash: hash }]);
    const provider = new LocalAuthProvider(repo);

    const identity = await provider.login("a@x.com", "senha123");

    assert.equal(identity.userId, "u1");
    assert.equal(identity.email, "a@x.com");
  });

  it("email é case-insensitive (mesma normalização da Supabase Auth)", async () => {
    const hash = await bcrypt.hash("senha123", 10);
    const repo = fakeRepo([{ id: "u1", email: "a@x.com", senha_hash: hash }]);
    const provider = new LocalAuthProvider(repo);

    const identity = await provider.login("A@X.com", "senha123");

    assert.equal(identity.userId, "u1");
  });

  it("lança AuthError(invalid_credentials) com senha errada — mesma mensagem de usuário inexistente", async () => {
    const hash = await bcrypt.hash("senha123", 10);
    const repo = fakeRepo([{ id: "u1", email: "a@x.com", senha_hash: hash }]);
    const provider = new LocalAuthProvider(repo);

    await assert.rejects(
      () => provider.login("a@x.com", "senha-errada"),
      (err: unknown) => err instanceof AuthError && err.code === "invalid_credentials" && err.message === "Credenciais inválidas",
    );
  });

  it("lança AuthError(invalid_credentials) idêntico para email inexistente (não revela user enumeration)", async () => {
    const repo = fakeRepo([]);
    const provider = new LocalAuthProvider(repo);

    await assert.rejects(
      () => provider.login("naoexiste@x.com", "qualquer"),
      (err: unknown) => err instanceof AuthError && err.code === "invalid_credentials" && err.message === "Credenciais inválidas",
    );
  });
});

describe("LocalAuthProvider.verifyAccessToken", () => {
  it("lança AuthError(not_supported) — bearer fallback não existe no modo on-prem", async () => {
    const provider = new LocalAuthProvider(fakeRepo([]));

    await assert.rejects(
      () => provider.verifyAccessToken("qualquer-token"),
      (err: unknown) => err instanceof AuthError && err.code === "not_supported",
    );
  });
});
```

- [ ] **Step 4: Rodar os testes e confirmar que falham**

Run: `cd apps/bff && node --experimental-strip-types --test src/__tests__/auth-provider-local.test.ts`
Expected: FAIL — `Cannot find module '../lib/local-auth-provider'`.

- [ ] **Step 5: Implementar `local-auth-provider.ts`**

```typescript
// apps/bff/src/lib/local-auth-provider.ts
import bcrypt from "bcryptjs";
import type { Pool } from "pg";
import { type AuthProvider, type AuthIdentity, AuthError } from "./auth-provider";

export interface UsuariosRepository {
  findByEmail(email: string): Promise<{ id: string; email: string; senha_hash: string } | null>;
}

export class PgUsuariosRepository implements UsuariosRepository {
  constructor(private readonly pool: Pool) {}

  async findByEmail(email: string) {
    const { rows } = await this.pool.query<{ id: string; email: string; senha_hash: string }>(
      "SELECT id, email, senha_hash FROM public.usuarios WHERE lower(email) = lower($1)",
      [email],
    );
    return rows[0] ?? null;
  }
}

export class LocalAuthProvider implements AuthProvider {
  constructor(private readonly repo: UsuariosRepository) {}

  async login(email: string, password: string): Promise<AuthIdentity> {
    const user = await this.repo.findByEmail(email);
    // Mesma mensagem/código tanto pra "usuário não existe" quanto pra "senha
    // errada" — evita user enumeration (Review Focus deste plano).
    if (!user) {
      throw new AuthError("Credenciais inválidas", "invalid_credentials");
    }
    const matches = await bcrypt.compare(password, user.senha_hash);
    if (!matches) {
      throw new AuthError("Credenciais inválidas", "invalid_credentials");
    }
    return { userId: user.id, email: user.email };
  }

  async verifyAccessToken(_token: string): Promise<AuthIdentity> {
    // O fallback "Authorization: Bearer <token>" (apps/bff/src/middleware/auth.ts)
    // existe hoje só pra validar um JWT da Supabase Auth — não há equivalente
    // no modo ON_PREMISE nesta fase. Ver Task 6 deste plano: o middleware
    // trata este erro devolvendo 501, nunca deixa a exceção subir sem tratamento.
    throw new AuthError(
      "Autenticação via Bearer token não é suportada no modo ON_PREMISE",
      "not_supported",
    );
  }
}
```

- [ ] **Step 6: Rodar os testes e confirmar que passam**

Run: `cd apps/bff && node --experimental-strip-types --test src/__tests__/auth-provider-local.test.ts`
Expected: 6 testes, todos PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260923120000_usuarios_onprem.sql apps/bff/src/lib/local-auth-provider.ts apps/bff/src/__tests__/auth-provider-local.test.ts apps/bff/package.json apps/bff/../../pnpm-lock.yaml
git commit -m "feat(bff): LocalAuthProvider (bcrypt) + tabela public.usuarios"
```

---

### Task 5: Factory de `AuthProvider` por `AMBIENTE_INFRA`

**Files:**
- Create: `apps/bff/src/lib/auth-provider-factory.ts`
- Test: `apps/bff/src/__tests__/auth-provider-factory.test.ts`

**Interfaces:**
- Consumes: `loadInfraEnv`, `InfraEnv` (Task 2); `AuthProvider`, `SupabaseAuthProvider` (Task 3); `LocalAuthProvider`, `PgUsuariosRepository` (Task 4).
- Produces:
  ```typescript
  export function createAuthProvider(env: InfraEnv): AuthProvider;
  ```
  Consumido pela Task 6 (`routes/auth.ts`, `middleware/auth.ts`).

- [ ] **Step 1: Escrever os testes que falham**

```typescript
// apps/bff/src/__tests__/auth-provider-factory.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createAuthProvider } from "../lib/auth-provider-factory";
import { SupabaseAuthProvider } from "../lib/auth-provider";
import { LocalAuthProvider } from "../lib/local-auth-provider";

describe("createAuthProvider", () => {
  it("modo SUPABASE devolve uma instância de SupabaseAuthProvider", () => {
    const provider = createAuthProvider({
      mode: "SUPABASE",
      supabaseUrl: "https://x.supabase.co",
      supabaseServiceRoleKey: "svc",
    });
    assert.ok(provider instanceof SupabaseAuthProvider);
  });

  it("modo ON_PREMISE devolve uma instância de LocalAuthProvider", () => {
    const provider = createAuthProvider({
      mode: "ON_PREMISE",
      databaseUrl: "postgres://user:pass@localhost:5432/apmcb",
    });
    assert.ok(provider instanceof LocalAuthProvider);
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `cd apps/bff && node --experimental-strip-types --test src/__tests__/auth-provider-factory.test.ts`
Expected: FAIL — `Cannot find module '../lib/auth-provider-factory'`.

- [ ] **Step 3: Implementar a factory**

```typescript
// apps/bff/src/lib/auth-provider-factory.ts
import { Pool } from "pg";
import type { InfraEnv } from "./infra-env";
import type { AuthProvider } from "./auth-provider";
import { SupabaseAuthProvider } from "./auth-provider";
import { LocalAuthProvider, PgUsuariosRepository } from "./local-auth-provider";

let cachedPool: Pool | undefined;

export function createAuthProvider(env: InfraEnv): AuthProvider {
  if (env.mode === "SUPABASE") {
    return new SupabaseAuthProvider({
      url: env.supabaseUrl!,
      serviceRoleKey: env.supabaseServiceRoleKey!,
    });
  }

  // Pool único reaproveitado entre chamadas — evita abrir uma conexão nova
  // por login (mesmo padrão do singleton em apps/bff/src/services/supabase.ts).
  cachedPool ??= new Pool({ connectionString: env.databaseUrl! });
  return new LocalAuthProvider(new PgUsuariosRepository(cachedPool));
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `cd apps/bff && node --experimental-strip-types --test src/__tests__/auth-provider-factory.test.ts`
Expected: 2 testes, todos PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/bff/src/lib/auth-provider-factory.ts apps/bff/src/__tests__/auth-provider-factory.test.ts
git commit -m "feat(bff): factory de AuthProvider selecionada por AMBIENTE_INFRA"
```

---

### Task 6: Ligar `AuthProvider` em `routes/auth.ts` e `middleware/auth.ts`

**Files:**
- Modify: `apps/bff/src/routes/auth.ts:20-216` (handler `POST /login`), `:218-362` (handler `POST /exchange`)
- Modify: `apps/bff/src/middleware/auth.ts:106-157` (fallback Bearer)
- Test: `apps/bff/src/__tests__/auth-routes-provider-wiring.test.ts`

**Interfaces:**
- Consumes: `createAuthProvider` (Task 5), `loadInfraEnv` (Task 2), `AuthError` (Task 3).
- Produces: nenhuma interface nova — este task só substitui a implementação interna, a resposta HTTP de cada rota fica **idêntica** à de hoje.

Este task não introduz uma rota nova pra testar via HTTP real (exigiria subir o app Hono inteiro + mocks profundos de Supabase, fora do padrão de teste do projeto). Em vez disso, segue o mesmo padrão de guarda estática já usado em `auth-me-perf03-parallel.test.ts`: confirma que o handler chama o provider em vez do `fetch` inline, e que a rota de teste comportamental do LocalAuthProvider (Task 4) já cobre a lógica de autenticação em si.

- [ ] **Step 1: Escrever o teste de guarda que falha**

```typescript
// apps/bff/src/__tests__/auth-routes-provider-wiring.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const authRouteSrc = readFileSync(resolve(process.cwd(), "src/routes/auth.ts"), "utf-8");
const middlewareSrc = readFileSync(resolve(process.cwd(), "src/middleware/auth.ts"), "utf-8");

describe("routes/auth.ts usa AuthProvider em vez de fetch inline", () => {
  it("POST /login não chama mais fetch(.../auth/v1/token...) diretamente", () => {
    assert.doesNotMatch(authRouteSrc, /auth\/v1\/token\?grant_type=password/);
  });

  it("POST /exchange não chama mais fetch(.../auth/v1/user...) diretamente", () => {
    const exchangeOnly = authRouteSrc.split('authRoutes.post("/exchange"')[1] ?? "";
    assert.doesNotMatch(exchangeOnly.split('authRoutes.post("/logout"')[0], /fetch\(/);
  });

  it("importa createAuthProvider", () => {
    assert.match(authRouteSrc, /import\s*\{[^}]*createAuthProvider[^}]*\}\s*from\s*["']\.\.\/lib\/auth-provider-factory["']/);
  });
});

describe("middleware/auth.ts usa AuthProvider no fallback Bearer", () => {
  it("não chama mais fetch(.../auth/v1/user...) diretamente", () => {
    assert.doesNotMatch(middlewareSrc, /auth\/v1\/user/);
  });

  it("trata AuthError(not_supported) devolvendo HTTPException, nunca deixa a exceção subir crua", () => {
    assert.match(middlewareSrc, /not_supported/);
    assert.match(middlewareSrc, /HTTPException/);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `cd apps/bff && node --experimental-strip-types --test src/__tests__/auth-routes-provider-wiring.test.ts`
Expected: FAIL nos 5 asserts (código ainda não foi alterado).

- [ ] **Step 3: Editar `routes/auth.ts` — `POST /login`**

Substituir (linhas 45-81 do arquivo atual) o bloco de `fetch` inline por chamada ao provider, preservando 100% do restante do handler (resolução de profile/tenant/reserve, montagem de sessão, audit log, `recordLoginDevice` — nada disso muda):

```typescript
// no topo do arquivo, junto aos outros imports:
import { createAuthProvider } from "../lib/auth-provider-factory";
import { loadInfraEnv } from "../lib/infra-env";
import { AuthError } from "../lib/auth-provider";

// módulo-level, ao lado de COOKIE_DOMAIN — uma única instância reaproveitada
// entre requests, mesmo padrão do singleton `supabase` em services/supabase.ts:
const authProvider = createAuthProvider(loadInfraEnv(process.env));
```

```typescript
  // Substitui o bloco antigo (fetch direto + checagem de loginRes/loginData)
  // por chamada ao provider. authUser/accessToken continuam com o mesmo
  // formato usado no resto do handler.
  let authUser: { id: string; email: string | null };
  let accessToken: string | undefined;
  try {
    const identity = await authProvider.login(email, body.password);
    authUser = identity;
    // Preenchido só pelo SupabaseAuthProvider — LocalAuthProvider (modo
    // ON_PREMISE) não tem token Supabase pra devolver, accessToken fica
    // undefined (ver Task 3 deste plano).
    accessToken = identity.accessToken;
  } catch (err) {
    const ip = getAuditClientIp(c.req.raw, c.get("log"));
    try {
      await supabase.from("audit_logs").insert({
        actor_id: null,
        action: "auth.login_failed",
        resource_type: "auth",
        resource_id: null,
        metadata: { email, ip, reason: err instanceof AuthError ? err.code : "unknown" },
      });
    } catch (auditErr) {
      logger.error("auth.login_failed.audit_insert_failure", {
        ip,
        error: auditErr instanceof Error ? auditErr.message : String(auditErr),
      });
    }
    c.get("log").warn({ ip }, "auth.login.failure");
    return c.json({ error: "Credenciais inválidas" }, 401);
  }
```

Nota: a linha `session.supabaseAccessToken = accessToken;` (linha 159 do arquivo original) precisa de uma pequena adaptação — em modo `ON_PREMISE` não existe token Supabase nenhum pra guardar. Trocar por:

```typescript
  session.supabaseAccessToken = accessToken ?? "";
```

(campo já é lido só condicionalmente por rotas específicas do modo SUPABASE — string vazia é um valor seguro e não quebra `SessionData`'s type, que já é `string` não-opcional hoje).

- [ ] **Step 4: Editar `routes/auth.ts` — `POST /exchange`**

Substituir (linhas 230-244) o `fetch` pro `/auth/v1/user` por `authProvider.verifyAccessToken`:

```typescript
  let user: { id: string; email: string | null };
  try {
    user = await authProvider.verifyAccessToken(access_token);
  } catch (err) {
    c.get("log").warn(
      { reason: err instanceof AuthError ? err.code : "unknown" },
      "auth.exchange.failure",
    );
    return c.json({ error: "Token inválido ou expirado" }, 401);
  }
```

(o resto do handler — resolução de profile, bloqueio de superadmin, montagem de sessão — continua idêntico, só troca a origem de `user.id`/`user.email`).

- [ ] **Step 5: Editar `middleware/auth.ts` — fallback Bearer**

Substituir (linhas 114-130) o `fetch` inline:

```typescript
    // Use REST endpoint directly to avoid corrupting the shared supabase client's
    // in-memory auth state (supabase.auth.getUser caches the session in the singleton).
    const supabaseUrl = process.env.SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: serviceKey,
      },
    });
    if (!userRes.ok) {
      throw new HTTPException(401, { message: "Invalid token" });
    }
    const user = await userRes.json() as { id: string; email?: string } | null;
    if (!user?.id) {
      throw new HTTPException(401, { message: "Invalid token" });
    }
```

por:

```typescript
    let user: { id: string; email: string | null };
    try {
      const identity = await authProvider.verifyAccessToken(token);
      user = { id: identity.userId, email: identity.email };
    } catch (err) {
      if (err instanceof AuthError && err.code === "not_supported") {
        // Modo ON_PREMISE nesta fase: sem equivalente a bearer token da
        // Supabase Auth. 501, não 401 — comunica "rota não implementada
        // neste modo", não "credencial inválida" (ver Review Focus do
        // plano de Auth Provider Abstraction).
        throw new HTTPException(501, {
          message: "Autenticação via Bearer token não suportada em modo ON_PREMISE",
        });
      }
      throw new HTTPException(401, { message: "Invalid token" });
    }
```

E no topo do arquivo, junto aos imports existentes:

```typescript
import { createAuthProvider } from "../lib/auth-provider-factory";
import { loadInfraEnv } from "../lib/infra-env";
import { AuthError } from "../lib/auth-provider";
```

com a mesma instância module-level:

```typescript
const authProvider = createAuthProvider(loadInfraEnv(process.env));
```

- [ ] **Step 6: Rodar o teste de guarda e confirmar que passa**

Run: `cd apps/bff && node --experimental-strip-types --test src/__tests__/auth-routes-provider-wiring.test.ts`
Expected: 5 testes, todos PASS.

- [ ] **Step 7: Rodar a suíte inteira do BFF — regressão**

Run: `cd apps/bff && node --experimental-strip-types --test "src/__tests__/*.test.ts"`
Expected: todos os testes que já existiam antes deste plano continuam PASS — nenhuma edição adicional nesses arquivos. Se algum falhar, o handler mudou algo observável (status/shape de resposta) que não devia mudar — corrigir a implementação, nunca o teste antigo.

- [ ] **Step 8: Commit**

```bash
git add apps/bff/src/routes/auth.ts apps/bff/src/middleware/auth.ts apps/bff/src/__tests__/auth-routes-provider-wiring.test.ts
git commit -m "feat(bff): liga AuthProvider em routes/auth.ts e middleware/auth.ts"
```

---

### Task 7: Script de provisionamento do primeiro usuário on-prem

**Files:**
- Create: `apps/bff/scripts/provision-local-user.ts`
- Test: `apps/bff/src/__tests__/provision-local-user.test.ts`

**Interfaces:**
- Consumes: `PgUsuariosRepository` não é reaproveitado aqui (o script escreve, o repository só lê) — usa `pg.Pool` diretamente.
- Produces: script CLI, sem export consumido por outro task.

- [ ] **Step 1: Escrever o script**

Insere nas 3 tabelas (`auth.users` stub, `public.usuarios`, `public.profiles`) na mesma transação, com o mesmo `id` — condição necessária pro FK `profiles.id → auth.users(id)` e pro login via `LocalAuthProvider` encontrarem o mesmo usuário (ver comentário da Task 4).

```typescript
// apps/bff/scripts/provision-local-user.ts
//
// Provisiona o primeiro usuário admin de uma instalação ON_PREMISE nova.
// Uso: DATABASE_URL=postgres://... bun run scripts/provision-local-user.ts \
//        --email admin@orgao.gov.br --nome "Fulano de Tal" --tenant-slug orgao-x
//
// Gera senha temporária aleatória, imprime uma vez (nunca fica em log
// persistente) — força troca no primeiro login (reaproveita o fluxo já
// existente de "senha temporária" do sistema, não é novo).
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import { randomUUID, randomBytes } from "node:crypto";

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    const value = argv[i + 1];
    if (key && value) out[key] = value;
  }
  return out;
}

export function generateTempPassword(): string {
  return randomBytes(12).toString("base64url");
}

export async function provisionLocalUser(
  pool: Pool,
  opts: { email: string; nome: string; tenantSlug: string; password: string },
): Promise<{ userId: string }> {
  const userId = randomUUID();
  const hash = await bcrypt.hash(opts.password, 10);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [userId, opts.email]);
    await client.query(
      "INSERT INTO public.usuarios (id, email, senha_hash) VALUES ($1, $2, $3)",
      [userId, opts.email, hash],
    );
    const { rows } = await client.query<{ id: string }>(
      "SELECT id FROM public.tenants WHERE slug = $1",
      [opts.tenantSlug],
    );
    if (!rows[0]) {
      throw new Error(`tenant com slug "${opts.tenantSlug}" não existe — crie o tenant antes de provisionar o usuário`);
    }
    await client.query(
      `INSERT INTO public.profiles (id, nome_completo, role, default_tenant_id)
       VALUES ($1, $2, 'admin_global', $3)`,
      [userId, opts.nome, rows[0].id],
    );
    await client.query("COMMIT");
    return { userId };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.email || !args.nome || !args["tenant-slug"]) {
    console.error("Uso: --email <email> --nome <nome> --tenant-slug <slug>");
    process.exit(1);
  }
  const password = generateTempPassword();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  provisionLocalUser(pool, { email: args.email, nome: args.nome, tenantSlug: args["tenant-slug"], password })
    .then(({ userId }) => {
      console.log(`Usuário criado: ${userId}`);
      console.log(`Senha temporária (copie agora, não será mostrada de novo): ${password}`);
    })
    .catch((err) => {
      console.error("Falha ao provisionar usuário:", err.message);
      process.exit(1);
    })
    .finally(() => pool.end());
}
```

- [ ] **Step 2: Escrever o teste que falha**

Testa só a função pura `generateTempPassword` (entropia mínima) e a lógica transacional de `provisionLocalUser` contra um `pg.Pool`/client falso — sem Postgres real disponível (mesma limitação da Task 4).

```typescript
// apps/bff/src/__tests__/provision-local-user.test.ts
import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { generateTempPassword, provisionLocalUser } from "../../scripts/provision-local-user";

describe("generateTempPassword", () => {
  it("gera senha com pelo menos 16 caracteres (12 bytes em base64url)", () => {
    const pw = generateTempPassword();
    assert.ok(pw.length >= 16);
  });

  it("gera senhas diferentes a cada chamada", () => {
    assert.notEqual(generateTempPassword(), generateTempPassword());
  });
});

describe("provisionLocalUser", () => {
  function fakePool(tenantId: string | null) {
    const queries: string[] = [];
    const client = {
      query: mock.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.includes("SELECT id FROM public.tenants")) {
          return { rows: tenantId ? [{ id: tenantId }] : [] };
        }
        return { rows: [] };
      }),
      release: mock.fn(),
    };
    return { connect: async () => client, _queries: queries, _client: client };
  }

  it("insere nas 3 tabelas com o mesmo id, dentro de BEGIN/COMMIT", async () => {
    const pool = fakePool("tenant-1");
    const result = await provisionLocalUser(pool as never, {
      email: "admin@orgao.gov.br",
      nome: "Admin",
      tenantSlug: "orgao-x",
      password: "senha-temp",
    });

    assert.ok(result.userId);
    assert.ok(pool._queries.some((q) => q.includes("BEGIN")));
    assert.ok(pool._queries.some((q) => q.includes("INSERT INTO auth.users")));
    assert.ok(pool._queries.some((q) => q.includes("INSERT INTO public.usuarios")));
    assert.ok(pool._queries.some((q) => q.includes("INSERT INTO public.profiles")));
    assert.ok(pool._queries.some((q) => q.includes("COMMIT")));
  });

  it("dá ROLLBACK e lança erro se o tenant não existir", async () => {
    const pool = fakePool(null);

    await assert.rejects(
      () => provisionLocalUser(pool as never, {
        email: "admin@orgao.gov.br",
        nome: "Admin",
        tenantSlug: "tenant-inexistente",
        password: "senha-temp",
      }),
      /tenant com slug "tenant-inexistente" não existe/,
    );
    assert.ok(pool._queries.some((q) => q.includes("ROLLBACK")));
  });
});
```

- [ ] **Step 3: Rodar os testes e confirmar que falham**

Run: `cd apps/bff && node --experimental-strip-types --test src/__tests__/provision-local-user.test.ts`
Expected: FAIL — `Cannot find module '../../scripts/provision-local-user'`.

- [ ] **Step 4: Confirmar que o script escrito no Step 1 faz os testes passarem**

Run: `cd apps/bff && node --experimental-strip-types --test src/__tests__/provision-local-user.test.ts`
Expected: 4 testes, todos PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/bff/scripts/provision-local-user.ts apps/bff/src/__tests__/provision-local-user.test.ts
git commit -m "feat(bff): script de provisionamento do primeiro usuario on-premise"
```

---

## Pendente (fora do escopo testável neste ambiente)

- **Teste de integração real de `PgUsuariosRepository`/`provisionLocalUser`/`000_auth_shim.sql` contra um Postgres de verdade** — este ambiente de desenvolvimento não tem Docker funcional (WSL2 ausente, ver `CHANGELOG.md` v52) nem acesso a um Postgres on-prem real. Os testes deste plano cobrem a LÓGICA (bcrypt, seleção de provider, transação) com fakes; a query SQL literal (`findByEmail`, os 3 `INSERT`) precisa rodar uma vez contra um Postgres real antes do primeiro go-live on-prem. Recomendo isso entrar como item explícito da Fase 6 (validação) do MIGRATION_SPEC.md, não como débito silencioso.
- **Fases 3-6** (Storage S3 único, Realtime `LISTEN/NOTIFY`, Dockerizar `apps/web`, validação LGPD + disaster recovery) ficam para planos separados, seguindo a mesma metodologia (TDD, tasks pequenas, guarda estática onde não há infra pra testar de verdade) — este plano cobre só a Fase 2 (Auth), que é a que mais bloqueia as outras (sessão e RLS dependem dela).
