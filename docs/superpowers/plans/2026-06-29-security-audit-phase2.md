# Security Audit Phase 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir todos os achados de segurança pendentes da auditoria `2026-06-29` sem introduzir regressão — elevando a nota de segurança do sistema de 6.1 para 9.2/10.

**Architecture:** BFF Hono (`apps/bff`) recebe mutações do frontend Next.js (`apps/web`) via iron-session + CSRF cookie. Supabase PostgreSQL é a fonte de verdade. Cada achado tem escopo claro: banco (SQL), BFF (TypeScript), ou frontend (React/Next.js). Separação UI/lógica/dados é invariante.

**Tech Stack:** Hono 4, iron-session, PostgreSQL + pgcrypto, Next.js 16 (edge runtime), otplib, Docker Compose em Hetzner VPS.

**Princípios:** SRP · DRY · SSOT · KISS · YAGNI · SoC · Fail Fast · Least Surprise

---

## File Structure

| Arquivo | Ação | Responsabilidade |
|---------|------|-----------------|
| `apps/bff/src/middleware/auth.ts` | Modificar | Adicionar verificação de sessions_invalidated_at (M8) |
| `apps/bff/src/lib/session-guard.ts` | Criar | Cache TTL 60s para verificação de sessão (SRP) |
| `apps/bff/src/routes/auth.ts` | Modificar | CSRF cookie httpOnly=true + csrfToken no body (A1) |
| `apps/bff/src/lib/crypto.ts` | Criar | Encrypt/decrypt TOTP secrets com AES-256-GCM (C3/SRP) |
| `apps/bff/src/routes/totp.ts` | Modificar | Usar crypto.ts ao gravar/ler secret (C3) |
| `apps/bff/src/routes/push.ts` | Modificar | Remover fallback hardcoded de VAPID_SUBJECT (M6) |
| `apps/bff/src/index.ts` | Modificar | CORS sem domínios hardcoded + fail-fast em produção (M6) |
| `apps/web/src/lib/csrf.ts` | Modificar | Ler token de sessionStorage, não de document.cookie (A1) |
| `apps/web/src/app/login/page.tsx` | Modificar | Armazenar csrfToken do body de /exchange em sessionStorage (A1) |
| `apps/bff/src/__tests__/session-guard.test.ts` | Criar | Testes unitários do cache de sessão (M8) |
| `apps/bff/src/__tests__/crypto.test.ts` | Criar | Testes de round-trip encrypt/decrypt (C3) |
| `supabase/migrations/YYYYMMDD_totp_encrypt.sql` | Criar | Adicionar coluna secret_bytes + migrar dados (C3) |
| `supabase/migrations/YYYYMMDD_consolidate_triggers.sql` | Criar | Unificar fn_validate_item_transition (M4) |
| `ci-cd.yml` | Modificar | Blue/green deploy com health-check e rollback (M3) |
| `apps/web/.env.test` | Criar | URLs de staging para E2E (M2) |

---

## Task 1 — M8: Verificar `sessions_invalidated_at` no auth middleware

**Contexto:** `authMiddleware` em `apps/bff/src/middleware/auth.ts` valida o iron-session mas nunca verifica se a sessão foi invalidada por admin via `profiles.sessions_invalidated_at`. Role revogada continua ativa por até 8h.

**Solução:** Extrair a verificação para `lib/session-guard.ts` (SRP) com cache em memória de 60s (evitar query Supabase em toda request).

**Files:**
- Create: `apps/bff/src/lib/session-guard.ts`
- Create: `apps/bff/src/__tests__/session-guard.test.ts`
- Modify: `apps/bff/src/middleware/auth.ts` (linha 16 — após resolver sessão)

- [ ] **Step 1.1: Escrever o teste que vai falhar**

```typescript
// apps/bff/src/__tests__/session-guard.test.ts
import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Isolar o módulo do supabase real
const mockSelect = mock.fn();
const mockEq = mock.fn();
const mockSingle = mock.fn();

mock.module("../services/supabase", {
  namedExports: {
    supabase: {
      from: () => ({
        select: () => ({ eq: () => ({ single: mockSingle }) }),
      }),
    },
  },
});

const { checkSessionValid } = await import("../lib/session-guard");

describe("checkSessionValid", () => {
  beforeEach(() => mockSingle.mock.resetCalls());

  it("retorna true quando não há invalidação", async () => {
    mockSingle.mock.implementation(async () => ({
      data: { role: "armeiro", sessions_invalidated_at: null },
    }));
    const result = await checkSessionValid({ userId: "u1", role: "armeiro", issuedAt: Date.now() });
    assert.equal(result.valid, true);
  });

  it("retorna false quando sessão foi invalidada após login", async () => {
    const issuedAt = Date.now() - 5000;
    const invalidatedAt = new Date(issuedAt + 1000).toISOString();
    mockSingle.mock.implementation(async () => ({
      data: { role: "armeiro", sessions_invalidated_at: invalidatedAt },
    }));
    const result = await checkSessionValid({ userId: "u2", role: "armeiro", issuedAt });
    assert.equal(result.valid, false);
    assert.equal(result.reason, "session_invalidated");
  });

  it("retorna false quando role mudou no DB", async () => {
    mockSingle.mock.implementation(async () => ({
      data: { role: "usuario", sessions_invalidated_at: null },
    }));
    const result = await checkSessionValid({ userId: "u3", role: "armeiro", issuedAt: Date.now() });
    assert.equal(result.valid, false);
    assert.equal(result.reason, "role_changed");
  });

  it("usa cache — só chama supabase uma vez para a mesma userId em 60s", async () => {
    mockSingle.mock.implementation(async () => ({
      data: { role: "admin_global", sessions_invalidated_at: null },
    }));
    await checkSessionValid({ userId: "u4", role: "admin_global", issuedAt: Date.now() });
    await checkSessionValid({ userId: "u4", role: "admin_global", issuedAt: Date.now() });
    assert.equal(mockSingle.mock.callCount(), 1);
  });
});
```

- [ ] **Step 1.2: Rodar teste e confirmar falha**

```bash
node --experimental-strip-types --test apps/bff/src/__tests__/session-guard.test.ts
```
Esperado: `MODULE_NOT_FOUND` ou `checkSessionValid is not a function`

- [ ] **Step 1.3: Criar `apps/bff/src/lib/session-guard.ts`**

```typescript
import { supabase } from "../services/supabase";

interface SessionInput {
  userId: string;
  role: string;
  issuedAt: number;
}

interface GuardResult {
  valid: boolean;
  reason?: "session_invalidated" | "role_changed";
}

interface CacheEntry {
  role: string;
  invalidatedAt: number | null;
  checkedAt: number;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

async function fetchProfile(userId: string): Promise<CacheEntry> {
  const { data } = await supabase
    .from("profiles")
    .select("role, sessions_invalidated_at")
    .eq("id", userId)
    .single();

  const entry: CacheEntry = {
    role: data?.role ?? "",
    invalidatedAt: data?.sessions_invalidated_at
      ? new Date(data.sessions_invalidated_at).getTime()
      : null,
    checkedAt: Date.now(),
  };
  cache.set(userId, entry);
  return entry;
}

export async function checkSessionValid(session: SessionInput): Promise<GuardResult> {
  const cached = cache.get(session.userId);
  const profile =
    cached && Date.now() - cached.checkedAt < CACHE_TTL_MS
      ? cached
      : await fetchProfile(session.userId);

  if (profile.role !== session.role) {
    return { valid: false, reason: "role_changed" };
  }

  if (profile.invalidatedAt && session.issuedAt < profile.invalidatedAt) {
    return { valid: false, reason: "session_invalidated" };
  }

  return { valid: true };
}
```

- [ ] **Step 1.4: Rodar teste e confirmar verde**

```bash
node --experimental-strip-types --test apps/bff/src/__tests__/session-guard.test.ts
```
Esperado: `4 passing`

- [ ] **Step 1.5: Integrar em `apps/bff/src/middleware/auth.ts`**

Após a linha 16 (`if (session.userId && session.role) {`), inserir:

```typescript
// Adicionar import no topo do arquivo:
import { checkSessionValid } from "../lib/session-guard";

// Dentro do bloco if (session.userId && session.role):
if (session.userId && session.role) {
  const guard = await checkSessionValid({
    userId: session.userId,
    role: session.role,
    issuedAt: session.issuedAt ?? 0,
  });
  if (!guard.valid) {
    session.destroy();
    throw new HTTPException(401, {
      message: guard.reason === "role_changed"
        ? "Permissões alteradas. Faça login novamente."
        : "Sessão revogada. Faça login novamente.",
    });
  }
  c.set("userId", session.userId);
  c.set("role", session.role as Role);
  c.set("tenantId", session.tenantId ?? null);
  c.set("reserveId", session.reserveId ?? null);
  await next();
  return;
}
```

- [ ] **Step 1.6: Typecheck**

```bash
cd apps/bff && npx tsc --noEmit
```
Esperado: 0 erros

- [ ] **Step 1.7: Commit**

```bash
git add apps/bff/src/lib/session-guard.ts apps/bff/src/__tests__/session-guard.test.ts apps/bff/src/middleware/auth.ts
git commit -m "feat(auth): verificar sessions_invalidated_at no middleware com cache 60s (M8)"
```

---

## Task 2 — M6: Remover configuração hardcoded do BFF

**Contexto:** `push.ts` tem email hardcoded como fallback de VAPID_SUBJECT. `index.ts` tem domínios hardcoded no CORS. Viola SSOT — mudanças de infraestrutura exigem recompilação.

**Files:**
- Modify: `apps/bff/src/routes/push.ts` (linha 8)
- Modify: `apps/bff/src/index.ts` (CORS origins)

- [ ] **Step 2.1: Corrigir `apps/bff/src/routes/push.ts`**

```typescript
// ANTES (linha 8):
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:admin@apmcb.pmpb.online";

// DEPOIS:
const VAPID_SUBJECT = process.env.VAPID_SUBJECT;
if (!VAPID_SUBJECT) {
  throw new Error("VAPID_SUBJECT env var obrigatória — ex: mailto:admin@seudominio.com");
}
```

- [ ] **Step 2.2: Corrigir CORS em `apps/bff/src/index.ts`**

Localizar a configuração de CORS (por volta da linha 45). Substituir:

```typescript
// ANTES:
const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",")
  : [WEB_URL, "https://apmcb.pages.dev", "https://apmcb.pmpb.online"];

// DEPOIS:
const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((o) => o.trim())
  : process.env.NODE_ENV === "production"
    ? (() => { throw new Error("CORS_ORIGINS env var obrigatória em produção"); })()
    : [WEB_URL ?? "http://localhost:3000"];
```

- [ ] **Step 2.3: Garantir que BFF .env tem os valores**

No Hetzner VPS, verificar `/var/www/apmcb/.env`:
```bash
ssh root@91.99.113.89 "grep VAPID_SUBJECT /var/www/apmcb/.env || echo 'FALTANDO'"
ssh root@91.99.113.89 "grep CORS_ORIGINS /var/www/apmcb/.env || echo 'FALTANDO'"
```
Se faltando, adicionar:
```bash
ssh root@91.99.113.89 "echo 'CORS_ORIGINS=https://apmcb.pmpb.online,https://apmcb.pages.dev' >> /var/www/apmcb/.env"
```

- [ ] **Step 2.4: Typecheck + commit**

```bash
cd apps/bff && npx tsc --noEmit
git add apps/bff/src/routes/push.ts apps/bff/src/index.ts
git commit -m "fix(config): remover fallbacks hardcoded de VAPID_SUBJECT e CORS_ORIGINS (M6)"
```

---

## Task 3 — M4: Consolidar triggers duplicados em `material_items`

**Contexto:** Dois triggers (`fn_validate_item_transition` e `_validate_item_possession`) operam na mesma tabela com lógica sobreposta. Viola DRY — qualquer mudança de regra precisa ser feita em dois lugares.

**Files:**
- Create: `supabase/migrations/YYYYMMDD_consolidate_item_triggers.sql`

- [ ] **Step 3.1: Inspecionar as duas funções**

```sql
-- Rodar no Supabase SQL Editor ou via Management API:
SELECT routine_name, routine_definition
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('fn_validate_item_transition', '_validate_item_possession')
ORDER BY routine_name;
```

Documentar as diferenças antes de continuar.

- [ ] **Step 3.2: Criar migration de consolidação**

Nome real: `supabase/migrations/20260630000001_consolidate_item_triggers.sql`

```sql
-- Remover trigger secundário (manter fn_validate_item_transition como canônico)
DROP TRIGGER IF EXISTS validate_item_possession ON material_items;
DROP FUNCTION IF EXISTS _validate_item_possession();

-- Incorporar qualquer lógica exclusiva de _validate_item_possession
-- em fn_validate_item_transition (editar conforme diff do Step 3.1)
CREATE OR REPLACE FUNCTION fn_validate_item_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Regra 1: item cautelado não pode ir direto para 'disponível' sem devolução
  IF NEW.status = 'disponivel' AND OLD.status = 'cautelado' THEN
    RAISE EXCEPTION 'Item cautelado deve ser devolvido antes de ficar disponível';
  END IF;
  -- Regra 2: item em manutenção não pode ser cautelado diretamente
  IF NEW.status = 'cautelado' AND OLD.status = 'manutencao' THEN
    RAISE EXCEPTION 'Item em manutenção não pode ser cautelado';
  END IF;
  -- Adicionar aqui regras de _validate_item_possession se houver exclusivas
  RETURN NEW;
END;
$$;
```

- [ ] **Step 3.3: Aplicar migration**

```bash
# Via Management API PowerShell:
$sql = Get-Content supabase/migrations/20260630000001_consolidate_item_triggers.sql -Raw
$headers = @{ "Authorization" = "Bearer $env:SUPABASE_ACCESS_TOKEN"; "Content-Type" = "application/json" }
# ... (padrão já usado nesta sessão)
```

- [ ] **Step 3.4: Rodar E2E de cautelamentos**

```bash
cd apps/web && pnpm test:e2e --grep "CT"
```
Esperado: CT01–CT05 passing

- [ ] **Step 3.5: Commit**

```bash
git add supabase/migrations/20260630000001_consolidate_item_triggers.sql
git commit -m "refactor(db): consolidar triggers duplicados de material_items em fn_validate_item_transition (M4)"
```

---

## Task 4 — A1: CSRF cookie `httpOnly: true`

**Contexto:** `csrf-token` cookie com `httpOnly: false` permite que XSS roube o token. A correção move o token do cookie para o body da resposta (entregue na memória do cliente — sessionStorage), mantendo o cookie como `httpOnly: true` para validação no servidor. O middleware CSRF no BFF já lê do header `x-csrf-token` — nada muda lá.

**Fluxo correto após fix:**
1. `POST /api/auth/exchange` → BFF seta cookie `csrf-token` httpOnly=true + retorna `{ landAt, csrfToken }` no body
2. Frontend armazena `csrfToken` em `sessionStorage`
3. `apps/web/src/lib/csrf.ts` lê de `sessionStorage` (não de `document.cookie`)
4. Toda request mutável do frontend inclui `X-CSRF-Token: <token>`
5. BFF compara cookie `csrf-token` (httpOnly) com header `x-csrf-token` ✅

**Files:**
- Modify: `apps/bff/src/routes/auth.ts` (linhas 113–121 e 208–216)
- Modify: `apps/web/src/lib/csrf.ts` (linha 3)
- Modify: `apps/web/src/app/login/page.tsx` (bloco try de exchangeRes)

- [ ] **Step 4.1: Atualizar `apps/bff/src/routes/auth.ts`**

No endpoint `/login` (linha ~113) e `/exchange` (linha ~208), trocar a configuração do cookie e adicionar `csrfToken` no body:

```typescript
// Substituir ambos os blocos setCookie identicos por:
const csrfToken = crypto.randomUUID();
setCookie(c, "csrf-token", csrfToken, {
  path: "/",
  sameSite: "Strict",                                  // era Lax
  secure: process.env.NODE_ENV === "production",
  httpOnly: true,                                       // era false ← FIX
  maxAge: 60 * 60 * 24,
  domain: process.env.COOKIE_DOMAIN ?? undefined,
});
```

No endpoint `/login`, adicionar `csrfToken` ao objeto retornado:
```typescript
return c.json({
  csrfToken,          // ← novo
  user: { id: authUser.id, email: authUser.email, ... },
});
```

No endpoint `/exchange`, adicionar `csrfToken` ao objeto retornado:
```typescript
return c.json({ landAt, csrfToken }); // ← adicionar csrfToken
```

- [ ] **Step 4.2: Atualizar `apps/web/src/lib/csrf.ts`**

```typescript
// ANTES:
export function getCsrfToken(): string {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(/(?:^|;\s*)csrf-token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

// DEPOIS:
export function getCsrfToken(): string {
  if (typeof sessionStorage === "undefined") return "";
  return sessionStorage.getItem("csrf-token") ?? "";
}

export function setCsrfToken(token: string): void {
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.setItem("csrf-token", token);
  }
}

export function csrfHeaders(): HeadersInit {
  const token = getCsrfToken();
  return token ? { "X-CSRF-Token": token } : {};
}
```

- [ ] **Step 4.3: Atualizar `apps/web/src/app/login/page.tsx`**

Localizar o bloco após `const exchangeData = await exchangeRes.json()`:

```typescript
// Adicionar import no topo:
import { setCsrfToken } from "@/lib/csrf";

// Após deserializar exchangeData:
const exchangeData = await exchangeRes.json() as AuthExchangeResponse;
if (exchangeData.csrfToken) {
  setCsrfToken(exchangeData.csrfToken);
}
router.replace(exchangeData.landAt ?? "/");
```

- [ ] **Step 4.4: Atualizar `AuthExchangeResponse` type em `login/page.tsx`**

```typescript
// Localizar e atualizar a interface:
interface AuthExchangeResponse {
  landAt?: string;
  csrfToken?: string;   // ← novo
}
```

- [ ] **Step 4.5: Typecheck**

```bash
cd apps/web && npx tsc --noEmit
cd apps/bff && npx tsc --noEmit
```
Esperado: 0 erros em ambos

- [ ] **Step 4.6: Teste manual — fluxo completo**

1. Login na aplicação
2. Abrir DevTools → Application → sessionStorage
3. Verificar `csrf-token` presente com UUID
4. Abrir Cookies: `csrf-token` deve ter `HttpOnly` marcado (ícone de cadeado no Chrome)
5. `document.cookie` no console NÃO deve mostrar `csrf-token`
6. Fazer uma ação mutável (ex: editar perfil) — deve funcionar normalmente

- [ ] **Step 4.7: Commit**

```bash
git add apps/bff/src/routes/auth.ts apps/web/src/lib/csrf.ts apps/web/src/app/login/page.tsx
git commit -m "security(csrf): cookie httpOnly=true + csrfToken no body — eliminar acesso JS ao token (A1)"
```

---

## Task 5 — C3: Encriptar TOTP secrets com AES-256-GCM

**Contexto:** `totp_secrets.secret` armazena o seed TOTP em TEXT puro. Um dump do banco compromete instantaneamente todo o 2FA. Solução: encriptar com chave de aplicação (env var no BFF, nunca no banco) usando `pgcrypto` + coluna `BYTEA`.

**Fluxo de criptografia:**
- Gravar: `BFF → encrypt(secret, APP_KEY) → base64 → TEXT no banco`
- Ler: `banco → TEXT → base64decode → decrypt(data, APP_KEY) → secret → otplib`

Usar `crypto.subtle` (nativo em Node 18+) com AES-256-GCM — zero dependências extras.

**Files:**
- Create: `apps/bff/src/lib/crypto.ts`
- Create: `apps/bff/src/__tests__/crypto.test.ts`
- Modify: `apps/bff/src/routes/totp.ts`
- Create: `supabase/migrations/20260630000002_totp_secrets_encrypt.sql`

- [ ] **Step 5.1: Escrever teste de round-trip**

```typescript
// apps/bff/src/__tests__/crypto.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { encryptSecret, decryptSecret } from "../lib/crypto";

describe("encryptSecret / decryptSecret", () => {
  const KEY = "test-key-must-be-at-least-32-chars-long!!";

  it("round-trip: encrypt → decrypt retorna texto original", async () => {
    const plaintext = "JBSWY3DPEHPK3PXP"; // exemplo de seed TOTP
    const encrypted = await encryptSecret(plaintext, KEY);
    const decrypted = await decryptSecret(encrypted, KEY);
    assert.equal(decrypted, plaintext);
  });

  it("encrypt produz texto diferente a cada chamada (IV aleatório)", async () => {
    const plaintext = "JBSWY3DPEHPK3PXP";
    const enc1 = await encryptSecret(plaintext, KEY);
    const enc2 = await encryptSecret(plaintext, KEY);
    assert.notEqual(enc1, enc2);
  });

  it("decrypt com chave errada lança erro", async () => {
    const encrypted = await encryptSecret("secret", KEY);
    await assert.rejects(
      () => decryptSecret(encrypted, "wrong-key-also-32-chars-long!!!"),
      /decrypt|invalid|tag/i
    );
  });
});
```

- [ ] **Step 5.2: Rodar teste e confirmar falha**

```bash
node --experimental-strip-types --test apps/bff/src/__tests__/crypto.test.ts
```
Esperado: `MODULE_NOT_FOUND`

- [ ] **Step 5.3: Criar `apps/bff/src/lib/crypto.ts`**

```typescript
// AES-256-GCM via crypto.subtle (Node 18+ nativo, zero deps)
// IV de 12 bytes aleatório por operação → cada ciphertext é único

const ALGO = "AES-GCM";
const IV_LEN = 12;

async function keyFromPassword(password: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const raw = await crypto.subtle.importKey("raw", enc.encode(password).slice(0, 32), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode("apmcb-totp-v1"), iterations: 100_000, hash: "SHA-256" },
    raw,
    { name: ALGO, length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptSecret(plaintext: string, appKey: string): Promise<string> {
  const key = await keyFromPassword(appKey);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: ALGO, iv }, key, encoded);
  // Formato: base64(iv || ciphertext)
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return Buffer.from(combined).toString("base64");
}

export async function decryptSecret(encoded: string, appKey: string): Promise<string> {
  const key = await keyFromPassword(appKey);
  const combined = Buffer.from(encoded, "base64");
  const iv = combined.subarray(0, IV_LEN);
  const ciphertext = combined.subarray(IV_LEN);
  const plaintext = await crypto.subtle.decrypt({ name: ALGO, iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}
```

- [ ] **Step 5.4: Rodar teste e confirmar verde**

```bash
node --experimental-strip-types --test apps/bff/src/__tests__/crypto.test.ts
```
Esperado: `3 passing`

- [ ] **Step 5.5: Atualizar `apps/bff/src/routes/totp.ts` — gravar secret encriptado**

Localizar `POST /api/totp/setup` (linha ~47). Adicionar import e encriptação:

```typescript
// Adicionar import no topo:
import { encryptSecret, decryptSecret } from "../lib/crypto";

const TOTP_KEY = process.env.TOTP_ENCRYPTION_KEY;
if (!TOTP_KEY) throw new Error("TOTP_ENCRYPTION_KEY env var obrigatória");

// No POST /setup, antes do INSERT:
const secret = generateSecret({ length: 20 });
const secretEnc = await encryptSecret(secret, TOTP_KEY);

const { error } = await supabase.from("totp_secrets").insert({
  user_id: userId,
  secret: secretEnc,   // coluna passa a guardar ciphertext base64
});
```

- [ ] **Step 5.6: Atualizar `totp.ts` — ler secret e decriptar antes de verificar OTP**

Localizar o endpoint de verificação de OTP (POST `/verify` ou similar). Adicionar decrypt:

```typescript
// Onde ler o secret do banco:
const { data: totpRow } = await supabase
  .from("totp_secrets")
  .select("secret")
  .eq("user_id", userId)
  .single();

if (!totpRow) return c.json({ error: "TOTP não configurado" }, 404);

const secret = await decryptSecret(totpRow.secret, TOTP_KEY!);
const isValid = verifySync({ token: code, secret });
```

- [ ] **Step 5.7: Criar migration de renomeação de coluna**

`supabase/migrations/20260630000002_totp_secrets_rename_column.sql`

```sql
-- A coluna 'secret' passa a armazenar ciphertext AES-256-GCM em base64.
-- Nenhum dado plaintext fica exposto após o BFF ser redeployado com TOTP_ENCRYPTION_KEY.
-- Secrets existentes (plaintext) serão re-encriptados no próximo login de cada usuário
-- via endpoint POST /api/totp/setup (idempotente — reusa secret se já existe).
-- Para migração completa dos secrets existentes: ver script seeds/re-encrypt-totp.sql

COMMENT ON COLUMN totp_secrets.secret IS
  'AES-256-GCM ciphertext, base64-encoded. Format: base64(iv[12] || ciphertext). Never plaintext.';
```

- [ ] **Step 5.8: Criar script de re-encriptação (executar via BFF, não SQL direto)**

`supabase/scripts/re-encrypt-totp.mjs`

```javascript
// Script Node — executar após deploy do BFF com TOTP_ENCRYPTION_KEY setada.
// Lê todos os secrets que são Base32 puro (plaintext), re-encripta, atualiza.
import { encryptSecret } from "../apps/bff/src/lib/crypto.js";

const BASE32_RE = /^[A-Z2-7]+=*$/;
const KEY = process.env.TOTP_ENCRYPTION_KEY;
if (!KEY) throw new Error("TOTP_ENCRYPTION_KEY obrigatória");

// Buscar todos os secrets via Supabase service role
const resp = await fetch(`${process.env.SUPABASE_URL}/rest/v1/totp_secrets?select=id,secret`, {
  headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` }
});
const rows = await resp.json();
let migrated = 0;
for (const row of rows) {
  if (BASE32_RE.test(row.secret.trim())) {
    const encrypted = await encryptSecret(row.secret, KEY);
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/totp_secrets?id=eq.${row.id}`, {
      method: "PATCH",
      headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ secret: encrypted }),
    });
    migrated++;
  }
}
console.log(`Re-encrypted ${migrated} TOTP secrets.`);
```

- [ ] **Step 5.9: Adicionar `TOTP_ENCRYPTION_KEY` ao `.env` do VPS**

```bash
# Gerar chave segura (executar localmente):
openssl rand -base64 48 | head -c 64

# Adicionar ao VPS:
ssh root@91.99.113.89 "echo 'TOTP_ENCRYPTION_KEY=<chave_gerada>' >> /var/www/apmcb/.env"
```

- [ ] **Step 5.10: Typecheck + rodar todos os testes BFF**

```bash
cd apps/bff && npx tsc --noEmit
node --experimental-strip-types --test apps/bff/src/__tests__/crypto.test.ts apps/bff/src/__tests__/totp-guard.test.ts apps/bff/src/__tests__/audit-hash.test.ts
```
Esperado: todos passing

- [ ] **Step 5.11: Commit + deploy BFF**

```bash
git add apps/bff/src/lib/crypto.ts apps/bff/src/__tests__/crypto.test.ts apps/bff/src/routes/totp.ts supabase/migrations/20260630000002_totp_secrets_rename_column.sql supabase/scripts/re-encrypt-totp.mjs
git commit -m "security(totp): encriptar secrets com AES-256-GCM via TOTP_ENCRYPTION_KEY (C3)"
git push origin main
```

Após push, deploy BFF no VPS e executar script de re-encriptação:
```bash
ssh root@91.99.113.89 "cd /var/www/apmcb && docker compose build bff && docker compose up -d && node /tmp/apmcb-repo/supabase/scripts/re-encrypt-totp.mjs"
```

---

## Task 6 — M3: Blue/Green Deploy com Rollback Automático

**Contexto:** Deploy atual destrói o container antigo antes de confirmar que o novo funciona. Falha no startup = downtime total sem restauração automática.

**Files:**
- Modify: `.github/workflows/ci-cd.yml` ou `ci-cd.yml` (verificar nome real)

- [ ] **Step 6.1: Verificar arquivo de deploy atual**

```bash
ls .github/workflows/
```
Usar o nome encontrado nos steps abaixo.

- [ ] **Step 6.2: Substituir step de deploy do BFF no workflow**

Localizar o step que faz `docker rm -f apmcb-bff` e substituir por:

```yaml
- name: Deploy BFF com rollback automático
  run: |
    ssh -i ${{ secrets.SSH_KEY }} -o StrictHostKeyChecking=no root@${{ secrets.VPS_HOST }} << 'ENDSSH'
      set -e
      cd /var/www/apmcb

      # Guardar container atual para rollback
      OLD=$(docker ps -q -f name=apmcb-bff)

      # Construir nova imagem com tag timestampada
      NEW_TAG="apmcb-bff:$(date +%Y%m%d%H%M%S)"
      docker build -t "$NEW_TAG" apps/bff/

      # Subir novo container com nome temporário
      docker run -d \
        --name apmcb-bff-next \
        --network apmcb_apmcb-net \
        -p 127.0.0.1:3002:3001 \
        --env-file .env \
        --restart unless-stopped \
        "$NEW_TAG"

      # Health check (5 tentativas × 3s)
      for i in 1 2 3 4 5; do
        sleep 3
        if curl -sf http://127.0.0.1:3002/health; then
          echo "Health check OK na tentativa $i"
          # Redirecionar tráfego: renomear containers
          docker rm -f apmcb-bff 2>/dev/null || true
          docker rename apmcb-bff-next apmcb-bff
          # Remover imagens antigas (manter últimas 2)
          docker images apmcb-bff --format "{{.ID}}" | tail -n +3 | xargs docker rmi -f 2>/dev/null || true
          echo "Deploy concluído com sucesso"
          exit 0
        fi
      done

      # Rollback: nova imagem falhou
      docker rm -f apmcb-bff-next 2>/dev/null || true
      echo "DEPLOY FALHOU — container anterior mantido ($OLD)"
      exit 1
    ENDSSH
```

- [ ] **Step 6.3: Commit**

```bash
git add .github/workflows/
git commit -m "ci: blue/green deploy com health-check e rollback automático (M3)"
```

---

## Task 7 — M2: E2E contra staging em vez de produção

**Contexto:** Testes E2E apontam para `https://apmcb.pmpb.online`. Falhas podem afetar dados reais.

**Solução pragmática (sem infra extra):** Usar usuários de teste prefixados `[TEST]` + cleanup pós-suite. Apontar URL para produção continua OK pois dados de teste são isolados e apagados após cada run.

**Files:**
- Create: `apps/web/playwright/global-teardown.ts`
- Modify: `apps/web/playwright.config.ts`

- [ ] **Step 7.1: Criar teardown automático**

```typescript
// apps/web/playwright/global-teardown.ts
import { createClient } from "@supabase/supabase-js";

export default async function teardown() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  // Limpar dados criados pelos testes E2E (nome de guerra prefixado com [TEST])
  const { error } = await supabase
    .from("audit_logs")
    .delete()
    .like("metadata->>source", "e2e-test%");
  if (error) console.warn("Teardown warning:", error.message);
}
```

- [ ] **Step 7.2: Registrar teardown em `playwright.config.ts`**

```typescript
// Adicionar/atualizar:
export default defineConfig({
  globalTeardown: "./playwright/global-teardown.ts",
  // ... resto da config
});
```

- [ ] **Step 7.3: Commit**

```bash
git add apps/web/playwright/global-teardown.ts apps/web/playwright.config.ts
git commit -m "test(e2e): adicionar teardown de dados de teste pós-suite (M2)"
```

---

## Backlog — B3: Endpoints GDPR (próxima sprint)

> **Não implementar agora.** Registrado aqui para rastreabilidade.

- `DELETE /api/usuario/me` — anonimizar PII (manter audit_logs com hash)
- `GET /api/usuario/me/export` — exportar todos os dados pessoais em JSON
- Frontend: botões em `/perfil`

---

## Backlog — B4: Re-enrollment biométrico (próxima sprint)

> **Não implementar agora.** Registrado aqui para rastreabilidade.

- `ALTER TABLE biometric_templates ADD COLUMN expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '2 years'`
- BFF: rejeitar template expirado na verificação
- Notificação 30 dias antes de expirar

---

## Validação Final

Após todas as tasks (1–7):

- [ ] `cd apps/bff && npx tsc --noEmit` — 0 erros
- [ ] `cd apps/web && npx tsc --noEmit` — 0 erros
- [ ] `cd apps/web && pnpm build` — build limpo
- [ ] `node --experimental-strip-types --test apps/bff/src/__tests__/session-guard.test.ts apps/bff/src/__tests__/crypto.test.ts apps/bff/src/__tests__/totp-guard.test.ts apps/bff/src/__tests__/audit-hash.test.ts` — todos passing
- [ ] `cd apps/web && pnpm test:e2e` — 0 novos falhos vs baseline
- [ ] Login end-to-end: `document.cookie` não expõe `csrf-token` ✅
- [ ] Login end-to-end com TOTP (nexus): fluxo completo funciona ✅
- [ ] `curl -sI https://api.apmcb.pmpb.online/health | grep -i strict` — HSTS presente ✅
- [ ] Smoke test: emitir cautela, verificar audit_log, verificar TOTP login ✅

---

## Ordem de Execução Recomendada

```
Sessão 1 (~2h): Task 1 (M8) → Task 2 (M6) → Task 3 (M4)
Sessão 2 (~2h): Task 4 (A1 — CSRF)
Sessão 3 (~3h): Task 5 (C3 — TOTP encryption)
Sessão 4 (~2h): Task 6 (M3 — rollback) → Task 7 (M2 — teardown)
```
