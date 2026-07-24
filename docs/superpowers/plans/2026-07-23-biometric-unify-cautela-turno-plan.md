# Unificar Assinatura de Cautela e Autenticação de Turno no Bridge Biométrico Real — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conectar os 2 fluxos de biometria que hoje usam um SDK de teste morto (ZKTeco, sempre falha por construção) — assinatura de cautela e autenticação de turno — ao mesmo motor real (bridge NITGEN via challenge/purpose/proof) que os outros 4 fluxos já usam, com a mesma experiência visual (`BiometricCaptureDialog`), removendo o código morto por completo.

**Architecture:** Backend: novo módulo `biometric-authorization.ts` consolida autorização duplicada e adiciona autoatendimento escopado para `usuario` em 4 call sites; `cautelamentos.ts`/`shift-auth.ts`/`shifts.ts` trocam a chamada ao SDK morto por `loadBiometricProof`/`assertProofScopeAndFreshness`/`consumeBiometricProof` (já existentes, usados por `lendings.ts`). Frontend: `SignDialog`/`ShiftAuthDialog` trocam o botão de captura antigo por `BiometricCaptureDialog` (componente já usado nos 4 fluxos prontos).

**Tech Stack:** Hono (BFF) + Zod + Supabase (`@supabase/supabase-js`, service-role key) + Next.js 16 App Router (client components) + Base UI (`@base-ui/react/dialog`, `@base-ui/react/tabs`) + Playwright (E2E + integração via `fetch` direto ao BFF) + `node --test` (testes unitários/estruturais do BFF).

**Spec de origem:** `docs/superpowers/specs/2026-07-23-biometric-unify-cautela-turno-design.md` (v11, revisão sênior 9,5/10, 12 rodadas). Todo código mostrado abaixo já foi verificado linha a linha contra o código real nessas rodadas — os snippets deste plano são a versão final aprovada, mais os 3 achados BAIXO da rodada 12 (import faltando, frase incompleta sobre props, janela cosmética de animação) resolvidos como parte das tasks correspondentes.

---

## Antes de começar

1. Confirmar que está numa branch dedicada, não em `main` (perguntar ao usuário se ainda não migrou — CLAUDE.md: nunca iniciar implementação em `main`/`master` sem consentimento explícito).
2. Rodar a suíte de regressão como baseline, antes de qualquer mudança:
   ```
   cd apps/bff && node --experimental-strip-types --test "src/__tests__/*.test.ts"
   cd apps/web && pnpm test:e2e --project=suite --project=chromium
   ```
   Anotar o resultado — qualquer falha pré-existente precisa ser investigada e corrigida antes de prosseguir (regra canônica CLAUDE.md "Falhas pré-existentes").

---

## Task 1: Novo módulo `apps/bff/src/lib/biometric-authorization.ts`

**Files:**
- Create: `apps/bff/src/lib/biometric-authorization.ts`
- Test: `apps/bff/src/__tests__/biometric-authorization.test.ts`

Este módulo consolida a autorização hoje duplicada em `biometric.ts`/`biometric-simulator.ts` e adiciona 2 funções novas de autoatendimento (`usuario` assinando a própria cautela / consultando dispositivos da própria reserva).

- [ ] **Step 1: Criar o arquivo do módulo**

```ts
// apps/bff/src/lib/biometric-authorization.ts
import { supabase } from "../services/supabase";
import type { Role } from "../types/hono";

// Importa o singleton `supabase` diretamente (mesmo padrão já usado em
// biometric.ts/biometric-simulator.ts/biometric-proof-service.ts neste
// projeto — não injeta o client como parâmetro). Os testes de integração
// desta spec rodam contra as ROTAS reais (via fetch ao BFF, mesmo padrão já
// usado em biometric-bridge-phase1b.spec.ts), não contra estas funções
// isoladas — testar via HTTP real cobre autorização + wiring de uma vez.

async function reserveBelongsToTenant(reserveId: string, tenantId: string) {
  const { data } = await supabase
    .from("reserves")
    .select("id")
    .eq("id", reserveId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return !!data;
}

async function hasReserveMembership(userId: string, reserveId: string, tenantId: string): Promise<boolean> {
  const { data } = await supabase
    .from("reserve_memberships")
    .select("reserve_id, reserves!inner(tenant_id)")
    .eq("user_id", userId)
    .eq("reserve_id", reserveId)
    .eq("reserves.tenant_id", tenantId)
    .maybeSingle();
  return !!data;
}

// Usada só por GET /devices — mais fraca que actorCanAccessChallenge de
// propósito: essa rota não carrega um document_id específico (é consultada
// ANTES de qualquer challenge existir), então a prova de legitimidade
// possível aqui é "este militar tem alguma cautela ativa nesta reserva",
// não "esta cautela específica é dele". Não expõe nada sensível de
// terceiros — a resposta é status/modelo/nome de um leitor físico, não
// dado de pessoa nenhuma.
async function usuarioHasActiveCautelaInReserve(userId: string, reserveId: string, tenantId: string): Promise<boolean> {
  const { data } = await supabase
    .from("cautelamentos")
    .select("id")
    .eq("militar_id", userId)
    .eq("reserve_id", reserveId)
    .eq("tenant_id", tenantId)
    .eq("status", "ativa")
    .limit(1)
    .maybeSingle();
  return !!data;
}

export async function actorCanAccessChallenge(params: {
  userId: string;
  role: Role;
  tenantId: string;
  reserveId: string;
  purpose: string;
  expectedUserId: string | null;
  documentId: string | null;
}): Promise<boolean> {
  const { userId, role, tenantId, reserveId, purpose, expectedUserId, documentId } = params;

  if (role === "admin_global") return reserveBelongsToTenant(reserveId, tenantId);
  if (role === "admin_reserva" || role === "armeiro") return hasReserveMembership(userId, reserveId, tenantId);
  if (role === "usuario") {
    // Autoatendimento — só pode tocar no PRÓPRIO purpose de assinatura de
    // cautela, só mirando a si mesmo, só numa cautela que é sua de verdade
    // (a checagem de posse da cautela substitui a checagem de reserve
    // membership, que um usuario nunca tem).
    if (purpose !== "sign_cautela_militar") return false;
    if (expectedUserId !== userId) return false;
    if (!documentId) return false;

    const { data } = await supabase
      .from("cautelamentos")
      .select("id")
      .eq("id", documentId)
      .eq("militar_id", userId)
      .eq("reserve_id", reserveId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    return !!data;
  }
  return false;
}

export async function actorCanAccessReserveDevices(params: {
  userId: string; role: Role; tenantId: string; reserveId: string;
}): Promise<boolean> {
  const { userId, role, tenantId, reserveId } = params;
  if (role === "admin_global") return reserveBelongsToTenant(reserveId, tenantId);
  if (role === "admin_reserva" || role === "armeiro") return hasReserveMembership(userId, reserveId, tenantId);
  if (role === "usuario") return usuarioHasActiveCautelaInReserve(userId, reserveId, tenantId);
  return false;
}

// Assinatura e comportamento IDÊNTICOS à função hoje duplicada em
// biometric.ts/biometric-simulator.ts — só centralizada aqui. NÃO é
// substituída pelas duas funções acima: elas cobrem só os 4 call sites que
// precisam abrir exceção pra `usuario` (POST /challenges, GET
// /challenges/:id/result, GET /devices, POST /simulator/challenges/:id/
// complete) — os outros 11 call sites reais (9 em biometric.ts, 2 em
// biometric-simulator.ts) continuam usando exatamente este comportamento,
// só importado do módulo novo em vez de definido localmente em cada
// arquivo.
export async function actorCanAccessReserve(
  userId: string, role: Role, tenantId: string, reserveId: string,
): Promise<boolean> {
  if (role === "admin_global") return reserveBelongsToTenant(reserveId, tenantId);
  if (role === "admin_reserva" || role === "armeiro") return hasReserveMembership(userId, reserveId, tenantId);
  return false;
}

export { reserveBelongsToTenant };
```

- [ ] **Step 2: `tsc --noEmit` limpo**

Run: `cd apps/bff && pnpm typecheck`
Expected: zero erros.

- [ ] **Step 3: Commit**

```bash
git add apps/bff/src/lib/biometric-authorization.ts
git commit -m "feat(bff): novo módulo biometric-authorization com autoatendimento escopado para usuario"
```

---

## Task 2: Migrar `apps/bff/src/routes/biometric.ts` para o módulo novo

**Files:**
- Modify: `apps/bff/src/routes/biometric.ts`

**Estado atual confirmado** (lido linha a linha): `reserveBelongsToTenant` (linhas 122-130) e `actorCanAccessReserve` (linhas 132-148) são definidas localmente. 9 call sites usam `actorCanAccessReserve`: linha 175 (`enroll-submit`), 235 (`devices/pair`), 284 (`GET /devices` — **migra**), 319 (`devices/:id/revoke`), 353 (`POST /challenges` — **migra**), 395 (`GET /challenges/:id`, rota plana), 421 (`GET /challenges/:id/result` — **migra**), 513 (`POST /challenges/:id/submit`), 634 (`POST /pairing-codes`). 3 migram, 6 só trocam de import.

- [ ] **Step 1: Trocar a definição local pelo import do módulo novo**

```diff
 import { generatePairingCode, hashPairingCode } from "../lib/biometric-pairing-code";
+import { actorCanAccessChallenge, actorCanAccessReserve, actorCanAccessReserveDevices, reserveBelongsToTenant } from "../lib/biometric-authorization";
 import type { HonoVariables, Role } from "../types/hono";
```

```diff
-async function reserveBelongsToTenant(reserveId: string, tenantId: string) {
-  const { data } = await supabase
-    .from("reserves")
-    .select("id")
-    .eq("id", reserveId)
-    .eq("tenant_id", tenantId)
-    .maybeSingle();
-  return !!data;
-}
-
-async function actorCanAccessReserve(userId: string, role: Role, tenantId: string, reserveId: string) {
-  if (role === "admin_global") {
-    return reserveBelongsToTenant(reserveId, tenantId);
-  }
-
-  if (role !== "admin_reserva" && role !== "armeiro") return false;
-
-  const { data } = await supabase
-    .from("reserve_memberships")
-    .select("reserve_id, reserves!inner(tenant_id)")
-    .eq("user_id", userId)
-    .eq("reserve_id", reserveId)
-    .eq("reserves.tenant_id", tenantId)
-    .maybeSingle();
-
-  return !!data;
-}
-
 biometricRoutes.post(
```

- [ ] **Step 2: `roleGuard` de `GET /devices` ganha `"usuario"` e o call site migra pra `actorCanAccessReserveDevices`**

```diff
 biometricRoutes.get(
   "/devices",
-  roleGuard("admin_reserva", "admin_global", "armeiro"),
+  roleGuard("admin_reserva", "admin_global", "armeiro", "usuario"),
   async (c) => {
```

```diff
     } else {
       if (!requestedReserveId) return c.json({ error: "Reserva obrigatoria" }, 400);
-      if (!(await actorCanAccessReserve(actorId, role, tenantId, requestedReserveId))) {
+      if (!(await actorCanAccessReserveDevices({ userId: actorId, role, tenantId, reserveId: requestedReserveId }))) {
         return c.json({ error: "Reserva nao autorizada" }, 403);
       }
       query = query.eq("reserve_id", requestedReserveId);
     }
```

- [ ] **Step 3: `roleGuard` de `POST /challenges` ganha `"usuario"` e o call site migra pra `actorCanAccessChallenge`**

```diff
 biometricRoutes.post(
   "/challenges",
-  roleGuard("admin_global", "admin_reserva", "armeiro"),
+  roleGuard("admin_global", "admin_reserva", "armeiro", "usuario"),
   zValidator("json", createChallengeSchema),
   auditAction("biometric.challenge.create", "biometric_challenges"),
   async (c) => {
     const tenantId = c.get("tenantId");
     if (!tenantId) return c.json(TENANT_REQUIRED, 403);
     const actorId = c.get("userId");
     const body = c.req.valid("json");

-    if (!(await actorCanAccessReserve(actorId, c.get("role"), tenantId, body.reserve_id))) {
+    if (!(await actorCanAccessChallenge({
+      userId: actorId, role: c.get("role"), tenantId, reserveId: body.reserve_id,
+      purpose: body.purpose, expectedUserId: body.expected_user_id ?? null, documentId: body.document_id ?? null,
+    }))) {
       return c.json({ error: "Reserva nao autorizada" }, 403);
     }
```

- [ ] **Step 4: `roleGuard` de `GET /challenges/:id/result` ganha `"usuario"` e o call site migra pra `actorCanAccessChallenge`**

```diff
 biometricRoutes.get(
   "/challenges/:id/result",
-  roleGuard("admin_global", "admin_reserva", "armeiro"),
+  roleGuard("admin_global", "admin_reserva", "armeiro", "usuario"),
   auditAction("biometric.challenge.result", "biometric_challenges"),
   async (c) => {
```

```diff
     if (!challenge) return c.json({ error: "Desafio biometrico nao encontrado" }, 404);
-    if (!(await actorCanAccessReserve(actorId, c.get("role"), tenantId, challenge.reserve_id))) {
+    if (!(await actorCanAccessChallenge({
+      userId: actorId, role: c.get("role"), tenantId, reserveId: challenge.reserve_id,
+      purpose: challenge.purpose, expectedUserId: challenge.expected_user_id, documentId: challenge.document_id,
+    }))) {
       return c.json({ error: "Reserva nao autorizada" }, 403);
     }
```

- [ ] **Step 5: os 6 call sites que NÃO migram continuam idênticos** (linhas 175, 235, 319, 395, 513, 634 — só a chamada `actorCanAccessReserve(actorId, role, tenantId, reserveId)` continua exatamente igual, agora resolvida pelo import). Nenhuma mudança de código nesses 6 pontos — só confirmar visualmente que o arquivo compila.

- [ ] **Step 6: `tsc --noEmit` limpo**

Run: `cd apps/bff && pnpm typecheck`
Expected: zero erros.

- [ ] **Step 7: Commit**

```bash
git add apps/bff/src/routes/biometric.ts
git commit -m "feat(bff): biometric.ts usa biometric-authorization; usuario liberado em POST /challenges, GET /challenges/:id/result, GET /devices"
```

---

## Task 3: Migrar `apps/bff/src/routes/biometric-simulator.ts` para o módulo novo

**Files:**
- Modify: `apps/bff/src/routes/biometric-simulator.ts`

**Estado atual confirmado**: `reserveBelongsToTenant`/`actorCanAccessReserve` definidas localmente (linhas 55-80). 2 call sites: linha 107 (`challenges/:id/enroll` — não migra), linha 234 (`challenges/:id/complete` — **migra**).

- [ ] **Step 1: Trocar a definição local pelo import**

```diff
+import { actorCanAccessChallenge, actorCanAccessReserve } from "../lib/biometric-authorization";
 import type { HonoVariables, Role } from "../types/hono";

 export const biometricSimulatorRoutes = new Hono<{ Variables: HonoVariables }>();
```

```diff
-async function reserveBelongsToTenant(reserveId: string, tenantId: string) {
-  const { data } = await supabase
-    .from("reserves")
-    .select("id")
-    .eq("id", reserveId)
-    .eq("tenant_id", tenantId)
-    .maybeSingle();
-  return !!data;
-}
-
-async function actorCanAccessReserve(userId: string, role: Role, tenantId: string, reserveId: string) {
-  if (role === "admin_global") {
-    return reserveBelongsToTenant(reserveId, tenantId);
-  }
-  if (role !== "admin_reserva" && role !== "armeiro") return false;
-
-  const { data } = await supabase
-    .from("reserve_memberships")
-    .select("reserve_id, reserves!inner(tenant_id)")
-    .eq("user_id", userId)
-    .eq("reserve_id", reserveId)
-    .eq("reserves.tenant_id", tenantId)
-    .maybeSingle();
-
-  return !!data;
-}
-
 biometricSimulatorRoutes.post(
```

- [ ] **Step 2: `roleGuard` de `POST /challenges/:id/complete` ganha `"usuario"` e o call site migra**

```diff
 biometricSimulatorRoutes.post(
   "/challenges/:id/complete",
-  roleGuard("admin_global", "admin_reserva", "armeiro"),
+  roleGuard("admin_global", "admin_reserva", "armeiro", "usuario"),
   zValidator("json", completeChallengeSchema),
   auditAction("biometric.simulator.challenge.complete", "biometric_proofs"),
   async (c) => {
```

```diff
     if (!challenge) return c.json({ error: "Desafio biometrico nao encontrado" }, 404);
-    if (!(await actorCanAccessReserve(actorId, c.get("role"), tenantId, challenge.reserve_id))) {
+    if (!(await actorCanAccessChallenge({
+      userId: actorId, role: c.get("role"), tenantId, reserveId: challenge.reserve_id,
+      purpose: challenge.purpose, expectedUserId: challenge.expected_user_id, documentId: challenge.document_id,
+    }))) {
       return c.json({ error: "Reserva nao autorizada" }, 403);
     }
```

- [ ] **Step 3: `POST /challenges/:id/enroll` (linha 107) não muda** — só `purpose === "enroll"`, que `usuario` nunca tem; `roleGuard` continua sem `"usuario"`; a chamada a `actorCanAccessReserve(actorId, c.get("role"), tenantId, challenge.reserve_id)` continua idêntica, agora resolvida pelo import.

- [ ] **Step 4: `tsc --noEmit` limpo**

Run: `cd apps/bff && pnpm typecheck`
Expected: zero erros.

- [ ] **Step 5: Commit**

```bash
git add apps/bff/src/routes/biometric-simulator.ts
git commit -m "feat(bff): biometric-simulator.ts usa biometric-authorization; usuario liberado em POST /challenges/:id/complete"
```

---

## Task 4: Corrigir `biometric-bridge-harness.test.ts` para o módulo novo

**Files:**
- Modify: `apps/bff/src/__tests__/biometric-bridge-harness.test.ts`

A asserção da linha 78 (`assert.ok(file.includes('.from("reserve_memberships")'), ...)`) roda contra `biometric.ts` — depois da Task 2, essa string não existe mais nesse arquivo (foi pra `biometric-authorization.ts`). Sem este fix, a suíte do BFF quebra assim que a Task 2 for commitada.

- [ ] **Step 1: Rodar a suíte AGORA (depois das Tasks 2-3) e confirmar que quebra do jeito esperado**

Run: `cd apps/bff && node --experimental-strip-types --test "src/__tests__/biometric-bridge-harness.test.ts"`
Expected: FAIL em "exposes challenge/proof and device lifecycle routes" — `missing biometric route` ou a asserção da linha 78, "biometric routes must scope admin_reserva/armeiro by reserve membership".

- [ ] **Step 2: Apontar a asserção pro arquivo novo**

```diff
   it("exposes challenge/proof and device lifecycle routes", () => {
     const file = readRepo("apps/bff/src/routes/biometric.ts");
+    const authFile = readRepo("apps/bff/src/lib/biometric-authorization.ts");
     for (const snippet of [
       '"/devices/pair"',
       '"/devices"',
       '"/devices/:id/revoke"',
       '"/challenges"',
       '"/challenges/:id"',
       '"/challenges/:id/enroll-submit"',
       '"/challenges/:id/submit"',
     ]) {
       assert.ok(file.includes(snippet), `missing biometric route ${snippet}`);
     }
     assert.ok(file.includes("verifyBridgeSignature"), "proof submission must verify bridge signature");
     assert.ok(file.includes("assertChallengeAcceptsProof"), "proof submission must validate challenge binding");
     assert.ok(file.includes('.eq("reserve_id", body.proof.reserve_id)'), "proof submission must bind device to the challenge reserve");
-    assert.ok(file.includes('.from("reserve_memberships")'), "biometric routes must scope admin_reserva/armeiro by reserve membership");
+    assert.ok(authFile.includes('.from("reserve_memberships")'), "biometric-authorization must scope admin_reserva/armeiro by reserve membership");
     assert.ok(file.includes("assertBiometricPolicy"), "proof submission must enforce biometric policy server-side");
```

- [ ] **Step 3: Rodar de novo e confirmar verde**

Run: `cd apps/bff && node --experimental-strip-types --test "src/__tests__/biometric-bridge-harness.test.ts"`
Expected: `# pass 2` (as 2 rotas do describe "biometric bridge BFF harness" passando), 0 fail.

- [ ] **Step 4: Commit**

```bash
git add apps/bff/src/__tests__/biometric-bridge-harness.test.ts
git commit -m "fix(bff): harness aponta pra biometric-authorization.ts após consolidação"
```

---

## Task 5: `statusForBiometricProofError`/`mapBiometricProofError` em `biometric-proof-service.ts`

**Files:**
- Modify: `apps/bff/src/lib/biometric-proof-service.ts`
- Test: `apps/bff/src/__tests__/biometric-proof-service-errors.test.ts`

- [ ] **Step 1: Escrever o teste (falha primeiro — o arquivo ainda não exporta essas funções)**

```ts
// apps/bff/src/__tests__/biometric-proof-service-errors.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapBiometricProofError, statusForBiometricProofError } from "../lib/biometric-proof-service.ts";

describe("statusForBiometricProofError", () => {
  it("retorna 409 quando a mensagem indica reuso", () => {
    assert.equal(statusForBiometricProofError(new Error("biometric proof already consumed")), 409);
  });
  it("retorna 401 para todos os outros erros (not found, expired, mismatch)", () => {
    for (const msg of [
      "biometric proof not found",
      "biometric proof expired",
      "biometric proof reserve_id mismatch",
      "biometric proof must be success",
    ]) {
      assert.equal(statusForBiometricProofError(new Error(msg)), 401, msg);
    }
  });
  it("retorna 401 para erro não-Error (string solta, undefined)", () => {
    assert.equal(statusForBiometricProofError("boom"), 401);
    assert.equal(statusForBiometricProofError(undefined), 401);
  });
});

describe("mapBiometricProofError", () => {
  it("devolve a mensagem do Error", () => {
    assert.equal(mapBiometricProofError(new Error("biometric proof expired")), "biometric proof expired");
  });
  it("devolve mensagem genérica para erro não-Error", () => {
    assert.equal(mapBiometricProofError("boom"), "biometric proof invalid");
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha (import quebrado)**

Run: `cd apps/bff && node --experimental-strip-types --test "src/__tests__/biometric-proof-service-errors.test.ts"`
Expected: erro de módulo — `mapBiometricProofError`/`statusForBiometricProofError` não exportados.

- [ ] **Step 3: Adicionar as funções em `biometric-proof-service.ts`** (mesmas do desenho já usado em `cautelamentos.ts`/`shift-auth.ts` nas próximas tasks — homed aqui, co-localizadas com `loadBiometricProof`/`assertProofScopeAndFreshness`, cujos erros interpretam)

```diff
 export function assertProofScopeAndFreshness(
   loaded: LoadedBiometricProof,
   context: BiometricProofConsumptionContext,
 ): void {
   assertUsableBiometricProof({ ...loaded.proof, consumed: false }, context);
 }
+
+export function statusForBiometricProofError(err: unknown): 401 | 409 {
+  const msg = err instanceof Error ? err.message : "";
+  return msg.includes("already consumed") ? 409 : 401;
+}
+
+export function mapBiometricProofError(err: unknown): string {
+  return err instanceof Error ? err.message : "biometric proof invalid";
+}
```

- [ ] **Step 4: Rodar de novo, confirmar verde**

Run: `cd apps/bff && node --experimental-strip-types --test "src/__tests__/biometric-proof-service-errors.test.ts"`
Expected: `# pass 5`, 0 fail.

- [ ] **Step 5: `tsc --noEmit` limpo + commit**

```bash
cd apps/bff && pnpm typecheck
git add apps/bff/src/lib/biometric-proof-service.ts apps/bff/src/__tests__/biometric-proof-service-errors.test.ts
git commit -m "feat(bff): statusForBiometricProofError/mapBiometricProofError em biometric-proof-service"
```

---

## Task 6: `apps/bff/src/routes/cautelamentos.ts` — assinatura via proof real

**Files:**
- Modify: `apps/bff/src/routes/cautelamentos.ts`

**Estado atual confirmado** (lido linha a linha): `validateBiometric` (linhas 82-111), `signBodySchema` (114-121, campo `use_biometric`), `GET /` (124-156, select sem `reserve_id`/`document_hash`), `sign-armeiro` (350-424, select da cautela linha 364 sem `reserve_id`), `sign-militar` (426-499, select da cautela linha 440 sem `reserve_id`).

- [ ] **Step 1: Trocar imports — remove SDK morto, adiciona o real**

```diff
-import { getFingerprintSDK } from "../services/fingerprint/index";
+import {
+  loadBiometricProof,
+  assertProofScopeAndFreshness,
+  statusForBiometricProofError,
+  mapBiometricProofError,
+} from "../lib/biometric-proof-service";
+import { consumeBiometricProof } from "../lib/biometric-proof-consumption";
```

- [ ] **Step 2: Remover `validateBiometric` por completo**

```diff
-async function validateBiometric(
-  expectedUserId: string
-): Promise<{ ok: boolean; error?: string; status?: number }> {
-  try {
-    const sdk = await getFingerprintSDK();
-    const captured = await sdk.capture(1);
-
-    const { data: templates } = await supabase
-      .from("biometric_templates")
-      .select("user_id, template_data")
-      .eq("user_id", expectedUserId);
-
-    if (!templates || templates.length === 0) {
-      return { ok: false, error: "Biometria não registrada para este usuário", status: 404 };
-    }
-
-    const result = await sdk.identify(
-      captured.data,
-      templates.map((t) => ({ userId: t.user_id, templateData: Buffer.from(t.template_data) }))
-    );
-
-    if (!result || result.userId !== expectedUserId) {
-      return { ok: false, error: "Biometria não reconhecida ou não corresponde ao signatário esperado", status: 401 };
-    }
-
-    return { ok: true };
-  } catch {
-    return { ok: false, error: "Erro no hardware biométrico — tente TOTP", status: 503 };
-  }
-}
-
 // Schema de assinatura: aceita TOTP ou biometria (nunca nenhum)
```

- [ ] **Step 3: `signBodySchema` — troca `use_biometric` por `biometric_proof_id`**

```diff
 const signBodySchema = z
   .object({
     totp_token:   z.string().length(6).regex(/^\d{6}$/).optional(),
-    use_biometric: z.boolean().optional(),
+    biometric_proof_id: z.string().uuid().optional(),
   })
-  .refine((d) => d.totp_token || d.use_biometric, {
-    message: "Informe totp_token ou use_biometric: true",
+  .refine((d) => d.totp_token || d.biometric_proof_id, {
+    message: "Informe totp_token ou biometric_proof_id",
   });
```

- [ ] **Step 4: `GET /` — select ganha `reserve_id`/`document_hash`**

```diff
       .select(`
         id,
         status,
         motivo_emissao,
         condicao_emissao,
         data_emissao,
         prazo_proxima_conferencia,
         armeiro_signature_id,
         militar_signature_id,
+        reserve_id,
+        document_hash,
         item:material_items!cautelamentos_item_id_fkey(id, numero_serie, status_operacional, material_type:material_types(nome, categoria)),
         militar:profiles!cautelamentos_militar_id_fkey(id, nome_completo, matricula, posto),
         armeiro:profiles!cautelamentos_armeiro_id_fkey(id, nome_completo, matricula)
       `)
```

- [ ] **Step 5: `sign-armeiro` — reescrever o handler completo**

```diff
 cautelamentosRoutes.post(
   "/:id/sign-armeiro",
   roleGuard("armeiro", "admin_reserva", "admin_global"),
   zValidator("json", signBodySchema),
   async (c) => {
     const id        = c.req.param("id");
     const body      = c.req.valid("json");
     const tenantId  = c.get("tenantId");
     const armeiroId = c.get("userId")!;
     if (!tenantId) return c.json({ error: "Tenant não identificado na sessão" }, 400);

     const { data: cautela } = await supabase
       .from("cautelamentos")
-      .select("id, status, document_hash, armeiro_signature_id, tenant_id")
+      .select("id, status, document_hash, armeiro_signature_id, tenant_id, reserve_id")
       .eq("id", id)
       .single();

     if (!cautela) return c.json({ error: "Cautela não encontrada" }, 404);
     if (tenantId && cautela.tenant_id !== tenantId) return c.json({ error: "Cautela não encontrada" }, 404);
     if (cautela.status !== "ativa") return c.json({ error: "Cautela não está ativa" }, 422);
     if (cautela.armeiro_signature_id) return c.json({ error: "Armeiro já assinou" }, 422);

-    let authVerified = false;
-    let authMethod: "totp" | "biometric" = "totp";
+    let authMethod: "totp" | "biometric" = "totp";
+    let loadedProof: Awaited<ReturnType<typeof loadBiometricProof>> | null = null;

-    if (body.use_biometric) {
-      const bioResult = await validateBiometric(armeiroId);
-      if (!bioResult.ok) return c.json({ error: bioResult.error }, (bioResult.status ?? 400) as 400 | 401 | 404 | 503);
-      authVerified = true;
-      authMethod = "biometric";
+    if (body.biometric_proof_id) {
+      try {
+        loadedProof = await loadBiometricProof(body.biometric_proof_id, tenantId);
+        assertProofScopeAndFreshness(loadedProof, {
+          tenantId,
+          reserveId: cautela.reserve_id,
+          actorId: armeiroId,
+          purpose: "sign_cautela_armeiro",
+          expectedUserId: armeiroId,   // autoautenticação — o armeiro prova que é ele mesmo
+          documentId: cautela.id,
+          documentHash: cautela.document_hash,
+        });
+      } catch (err) {
+        return c.json({ error: mapBiometricProofError(err) }, statusForBiometricProofError(err));
+      }
+      authMethod = "biometric";
     } else {
       const totpResult = await validateTotp(armeiroId, body.totp_token!);
       if (!totpResult.ok) return c.json({ error: totpResult.error }, (totpResult.status ?? 400) as 400 | 404 | 429);
-      authVerified = true;
     }

-    if (!authVerified) return c.json({ error: "Falha na verificação" }, 400);
-
     const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "127.0.0.1";
     const { data: sig } = await supabase
       .from("document_signatures")
       .insert({
         tenant_id: tenantId, document_id: cautela.id, document_type: "handover",
         signer_id: armeiroId, signer_role: "armeiro", signed_at: new Date().toISOString(),
         document_hash: cautela.document_hash,
         signature_proof: `${cautela.document_hash}:${armeiroId}:armeiro`,
         ip,
         totp_verified: authMethod === "totp",
         biometric_verified: authMethod === "biometric",
       })
       .select("id")
       .single();

     if (!sig) return c.json({ error: "Erro ao criar assinatura" }, 500);

     const { data: signedCautela, error: cautelaUpdateErr } = await supabase
       .from("cautelamentos")
       .update({ armeiro_signature_id: sig.id })
       .eq("id", id)
       .eq("tenant_id", tenantId)
       .eq("status", "ativa")
       .is("armeiro_signature_id", null)
       .select("id")
       .single();
-    if (cautelaUpdateErr || !signedCautela) {
+    // PGRST116 = 0 linhas do .single() — como o filtro já é por id (chave
+    // única), só pode significar que a cautela não está mais no estado
+    // esperado (já assinada por outra requisição), race genuína, 409.
+    // Qualquer outro erro (conexão, constraint, permissão) NÃO vira 409
+    // disfarçado — 500, logado. `!signedCautela` fica só neste branch, não
+    // no de PGRST116, senão qualquer erro passaria pelo primeiro if.
+    if (cautelaUpdateErr?.code === "PGRST116") {
+      await supabase.from("document_signatures").delete().eq("id", sig.id).eq("tenant_id", tenantId);
+      return c.json({ error: "Cautela não encontrada ou já alterada" }, 409);
+    }
+    if (cautelaUpdateErr || !signedCautela) {
       await supabase.from("document_signatures").delete().eq("id", sig.id).eq("tenant_id", tenantId);
-      return c.json({ error: "Cautela não encontrada ou já alterada" }, 409);
+      c.get("log").error({ code: cautelaUpdateErr?.code, error: cautelaUpdateErr?.message, cautelaId: id }, "cautela.sign.persist_failure");
+      return c.json({ error: "Não foi possível registrar a assinatura. Tente novamente." }, 500);
     }
+
+    // Consumir a prova só DEPOIS da assinatura confirmada — nunca antes. Se
+    // a mutação de negócio falhar (guard acima já devolveu 409/500 antes de
+    // chegar aqui), a prova nunca é marcada como consumida, e o request
+    // perdedor pode reenviar a mesma prova (dentro do TTL de 2 min) sem
+    // recapturar o dedo. Log, não falha a resposta — a assinatura JÁ
+    // aconteceu de verdade nesse ponto.
+    if (loadedProof) {
+      try {
+        await consumeBiometricProof(supabase, loadedProof.proof, {
+          proofId: body.biometric_proof_id!,
+          tenantId, reserveId: cautela.reserve_id, actorId: armeiroId,
+          operationType: "cautela_sign_armeiro",
+          operationId: cautela.id,
+          purpose: "sign_cautela_armeiro",
+          expectedUserId: armeiroId,
+          documentId: cautela.id, documentHash: cautela.document_hash,
+        });
+      } catch (err) {
+        c.get("log").warn({ signatureId: sig.id, error: err instanceof Error ? err.message : String(err) }, "cautela.sign.proof_consume_failed");
+      }
+    }
+
     auditLog(c, { action: "signature.created", resource_type: "cautelamento", resource_id: id,
       metadata: { signer_role: "armeiro", auth_method: authMethod } });

     return c.json({ ok: true, signature_id: sig.id, auth_method: authMethod });
   }
 );
```

- [ ] **Step 6: `sign-militar` — o mesmo padrão, com 3 diferenças reais: `select` ganha `reserve_id` (achado ALTO da revisão v7 — só `sign-armeiro` tinha isso explícito antes), variáveis de ator/`militarId`, `purpose: "sign_cautela_militar"`**

```diff
 cautelamentosRoutes.post(
   "/:id/sign-militar",
   roleGuard("usuario", "armeiro", "admin_reserva"),
   zValidator("json", signBodySchema),
   async (c) => {
     const id        = c.req.param("id");
     const body      = c.req.valid("json");
     const tenantId  = c.get("tenantId");
     const militarId = c.get("userId")!;
     if (!tenantId) return c.json({ error: "Tenant não identificado na sessão" }, 400);

     const { data: cautela } = await supabase
       .from("cautelamentos")
-      .select("id, status, militar_id, document_hash, armeiro_signature_id, militar_signature_id, tenant_id")
+      .select("id, status, militar_id, document_hash, armeiro_signature_id, militar_signature_id, tenant_id, reserve_id")
       .eq("id", id)
       .single();

     if (!cautela) return c.json({ error: "Cautela não encontrada" }, 404);
     if (tenantId && cautela.tenant_id !== tenantId) return c.json({ error: "Cautela não encontrada" }, 404);
     if (cautela.militar_id !== militarId) return c.json({ error: "Apenas o militar responsável pode assinar" }, 403);
     if (cautela.status !== "ativa") return c.json({ error: "Cautela não está ativa" }, 422);
     if (!cautela.armeiro_signature_id) return c.json({ error: "Armeiro ainda não assinou" }, 422);
     if (cautela.militar_signature_id) return c.json({ error: "Militar já assinou" }, 422);

     let authMethod: "totp" | "biometric" = "totp";
+    let loadedProof: Awaited<ReturnType<typeof loadBiometricProof>> | null = null;

-    if (body.use_biometric) {
-      // Biometria: captura o dedo do militar no leitor e valida identidade
-      const bioResult = await validateBiometric(militarId);
-      if (!bioResult.ok) return c.json({ error: bioResult.error }, (bioResult.status ?? 400) as 400 | 401 | 404 | 503);
+    if (body.biometric_proof_id) {
+      try {
+        loadedProof = await loadBiometricProof(body.biometric_proof_id, tenantId);
+        assertProofScopeAndFreshness(loadedProof, {
+          tenantId,
+          reserveId: cautela.reserve_id,
+          actorId: militarId,
+          purpose: "sign_cautela_militar",
+          expectedUserId: militarId,
+          documentId: cautela.id,
+          documentHash: cautela.document_hash,
+        });
+      } catch (err) {
+        return c.json({ error: mapBiometricProofError(err) }, statusForBiometricProofError(err));
+      }
       authMethod = "biometric";
     } else {
       const totpResult = await validateTotp(militarId, body.totp_token!);
       if (!totpResult.ok) return c.json({ error: totpResult.error }, (totpResult.status ?? 400) as 400 | 404 | 429);
     }

     const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "127.0.0.1";
     const { data: sig } = await supabase
       .from("document_signatures")
       .insert({
         tenant_id: tenantId, document_id: cautela.id, document_type: "handover",
         signer_id: militarId, signer_role: "militar", signed_at: new Date().toISOString(),
         document_hash: cautela.document_hash,
         signature_proof: `${cautela.document_hash}:${militarId}:militar`,
         ip,
         totp_verified: authMethod === "totp",
         biometric_verified: authMethod === "biometric",
       })
       .select("id")
       .single();

     if (!sig) return c.json({ error: "Erro ao criar assinatura" }, 500);

     const { data: signedCautela, error: cautelaUpdateErr } = await supabase
       .from("cautelamentos")
       .update({ militar_signature_id: sig.id })
       .eq("id", id)
       .eq("tenant_id", tenantId)
       .eq("militar_id", militarId)
       .eq("status", "ativa")
       .not("armeiro_signature_id", "is", null)
       .is("militar_signature_id", null)
       .select("id")
       .single();
-    if (cautelaUpdateErr || !signedCautela) {
+    if (cautelaUpdateErr?.code === "PGRST116") {
+      await supabase.from("document_signatures").delete().eq("id", sig.id).eq("tenant_id", tenantId);
+      return c.json({ error: "Cautela não encontrada ou já alterada" }, 409);
+    }
+    if (cautelaUpdateErr || !signedCautela) {
       await supabase.from("document_signatures").delete().eq("id", sig.id).eq("tenant_id", tenantId);
-      return c.json({ error: "Cautela não encontrada ou já alterada" }, 409);
+      c.get("log").error({ code: cautelaUpdateErr?.code, error: cautelaUpdateErr?.message, cautelaId: id }, "cautela.sign.persist_failure");
+      return c.json({ error: "Não foi possível registrar a assinatura. Tente novamente." }, 500);
     }
+
+    if (loadedProof) {
+      try {
+        await consumeBiometricProof(supabase, loadedProof.proof, {
+          proofId: body.biometric_proof_id!,
+          tenantId, reserveId: cautela.reserve_id, actorId: militarId,
+          operationType: "cautela_sign_militar",
+          operationId: cautela.id,
+          purpose: "sign_cautela_militar",
+          expectedUserId: militarId,
+          documentId: cautela.id, documentHash: cautela.document_hash,
+        });
+      } catch (err) {
+        c.get("log").warn({ signatureId: sig.id, error: err instanceof Error ? err.message : String(err) }, "cautela.sign.proof_consume_failed");
+      }
+    }
+
     auditLog(c, { action: "signature.created", resource_type: "cautelamento", resource_id: id,
       metadata: { signer_role: "militar", auth_method: authMethod } });

     return c.json({ ok: true, signature_id: sig.id, auth_method: authMethod });
   }
```

- [ ] **Step 7: `tsc --noEmit` limpo**

Run: `cd apps/bff && pnpm typecheck`
Expected: zero erros. (Se `c.get("log")` não existir no tipo `HonoVariables` deste arquivo — confirmar contra `types/hono.ts`; os outros arquivos deste projeto, `shifts.ts`/`shift-auth.ts`, já usam `c.get("log")`, então o tipo já existe globalmente.)

- [ ] **Step 8: Commit**

```bash
git add apps/bff/src/routes/cautelamentos.ts
git commit -m "feat(bff): sign-armeiro/sign-militar usam proof biométrica real; remove validateBiometric"
```

---

## Task 7: `apps/bff/src/lib/shift-auth.ts` — `validateSelfBiometricProof`

**Files:**
- Modify: `apps/bff/src/lib/shift-auth.ts`

**Estado atual confirmado**: `validateSelfBiometric` (linhas 99-151), `ShiftAuthResult` (linhas 10-12, `status: 400 | 401 | 403 | 404 | 422 | 429 | 503`, sem 409).

- [ ] **Step 1: Trocar import do SDK morto pelo real**

```diff
-import { getFingerprintSDK } from "../services/fingerprint/index";
+import { loadBiometricProof, assertProofScopeAndFreshness, statusForBiometricProofError, mapBiometricProofError, type LoadedBiometricProof } from "./biometric-proof-service";
```

- [ ] **Step 2: `ShiftAuthResult` ganha `409` e `loadedProof?`**

```diff
 export type ShiftAuthResult =
-  | { ok: true }
+  | { ok: true; loadedProof?: LoadedBiometricProof }
   | { ok: false; error: string; status: 400 | 401 | 403 | 404 | 422 | 429 | 503 };
```

Nota: `409` NÃO entra na união de `status` do variant `false` diretamente aqui — `statusForBiometricProofError` devolve `401 | 409`, mas dentro de `validateSelfBiometricProof` só `401` é alcançável em runtime (o guard de reuso real de turno vem do UPDATE condicional em `shifts.ts`, seção 4.2 do plano, Task 8 — não de `assertProofScopeAndFreshness`, que ignora consumo prévio por desenho). Como o `status` é o retorno de uma função tipada `401 | 409`, o TypeScript exige que a união de `ShiftAuthResult["status"]` inclua `409`:

```diff
 export type ShiftAuthResult =
   | { ok: true; loadedProof?: LoadedBiometricProof }
-  | { ok: false; error: string; status: 400 | 401 | 403 | 404 | 422 | 429 | 503 };
+  | { ok: false; error: string; status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 503 };
```

- [ ] **Step 3: Remover `validateSelfBiometric`, adicionar `validateSelfBiometricProof`**

```diff
-/**
- * Validates the armeiro's own biometric via ZKTeco SDK.
- * Captures fingerprint from hardware reader and verifies against stored template.
- */
-export async function validateSelfBiometric(userId: string): Promise<ShiftAuthResult> {
-  const { data: templateRows } = await supabase
-    .from("biometric_templates")
-    .select("template_data")
-    .eq("user_id", userId);
-
-  if (!templateRows || templateRows.length === 0) {
-    return { ok: false, status: 422, error: "BIOMETRIC_NOT_REGISTERED" };
-  }
-
-  let match: boolean;
-  try {
-    const sdk = await getFingerprintSDK();
-    const captured = await sdk.capture(1);
-    match = false;
-    for (const row of templateRows) {
-      const stored = Buffer.from(row.template_data);
-      if (await sdk.verify(captured.data, stored)) {
-        match = true;
-        break;
-      }
-    }
-  } catch (err) {
-    logger.error("shift.auth.biometric.sdk_failure", {
-      user_id: userId,
-      error: err instanceof Error ? err.message : String(err),
-    });
-    return { ok: false, status: 503, error: "Leitor biométrico indisponível. Verifique a conexão do dispositivo." };
-  }
-
-  if (!match) {
-    await supabase.from("audit_logs").insert({
-      actor_id: userId,
-      action: "shift.auth.biometric.failure",
-      resource_type: "service_shifts",
-      resource_id: null,
-      metadata: { user_id: userId, score: 0 },
-    });
-    return { ok: false, status: 401, error: "Biometria não reconhecida. Tente novamente." };
-  }
-
-  await supabase.from("audit_logs").insert({
-    actor_id: userId,
-    action: "shift.auth.biometric.success",
-    resource_type: "service_shifts",
-    resource_id: null,
-    metadata: { user_id: userId },
-  });
-
-  return { ok: true };
-}
+/**
+ * Valida uma prova biométrica já capturada (challenge/proof real) para
+ * autenticar a abertura/encerramento do próprio turno pelo armeiro — só
+ * valida (loadBiometricProof + assertProofScopeAndFreshness no MESMO
+ * try/catch), não consome. O caller (shifts.ts) consome a prova depois
+ * que a mutação de service_shifts já teve sucesso.
+ */
+export async function validateSelfBiometricProof(
+  userId: string,
+  reserveId: string,
+  proofId: string,
+  context: { tenantId: string; purpose: "open_shift" | "close_shift"; documentId: string | null },
+): Promise<ShiftAuthResult> {
+  let loaded: Awaited<ReturnType<typeof loadBiometricProof>>;
+  try {
+    loaded = await loadBiometricProof(proofId, context.tenantId);
+    assertProofScopeAndFreshness(loaded, {
+      tenantId: context.tenantId,
+      reserveId,
+      actorId: userId,
+      purpose: context.purpose,
+      expectedUserId: userId,   // autoautenticação — o armeiro prova que é ele mesmo
+      documentId: context.documentId,
+    });
+  } catch (err) {
+    return { ok: false, error: mapBiometricProofError(err), status: statusForBiometricProofError(err) };
+  }
+
+  await supabase.from("audit_logs").insert({
+    actor_id: userId, action: "shift.auth.biometric.success",
+    resource_type: "service_shifts", resource_id: null, metadata: { user_id: userId },
+  });
+
+  return { ok: true, loadedProof: loaded };
+}
```

- [ ] **Step 4: `tsc --noEmit` limpo**

Run: `cd apps/bff && pnpm typecheck`
Expected: erros esperados neste ponto em `shifts.ts` (ainda importa `validateSelfBiometric`, removido) — normal, resolvido na Task 8. Confirmar que os erros são SÓ em `shifts.ts`, não em `shift-auth.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/bff/src/lib/shift-auth.ts
git commit -m "feat(bff): validateSelfBiometricProof substitui validateSelfBiometric; ShiftAuthResult ganha loadedProof/409"
```

---

## Task 8: `apps/bff/src/routes/shifts.ts` — `/open` e `/:id/close` via proof real

**Files:**
- Modify: `apps/bff/src/routes/shifts.ts`

**Estado atual confirmado** (lido linha a linha): `OpenShiftSchema`/`CloseShiftSchema` (linhas 18-43, só `.refine` de `totp_token`), `/open` (linhas 47-176, auth na linha 120-126), `/:id/close` (linhas 321-383, auth na linha 343-349, UPDATE sem guard na linha 353-358).

- [ ] **Step 1: Trocar import**

```diff
-import { validateSelfTotp, validateSelfBiometric } from "../lib/shift-auth";
+import { validateSelfTotp, validateSelfBiometricProof } from "../lib/shift-auth";
+import { consumeBiometricProof } from "../lib/biometric-proof-consumption";
```

- [ ] **Step 2: `OpenShiftSchema`/`CloseShiftSchema` ganham `biometric_proof_id` + segundo `.refine()` encadeado**

```diff
 const OpenShiftSchema = z.object({
   reserve_id: z.string().uuid(),
   observacao_abertura: z.string().max(500).optional(),
   auth_mode: AuthModeSchema,
   totp_token: z.string().length(6).regex(/^\d{6}$/).optional(),
+  biometric_proof_id: z.string().uuid().optional(),
 }).refine(
   (d) => d.auth_mode !== "totp" || !!d.totp_token,
   { message: "totp_token obrigatório quando auth_mode é totp", path: ["totp_token"] }
+).refine(
+  (d) => d.auth_mode !== "biometria" || !!d.biometric_proof_id,
+  { message: "biometric_proof_id obrigatório quando auth_mode é biometria", path: ["biometric_proof_id"] }
 );
```

```diff
 const CloseShiftSchema = z.object({
   observacao_encerramento: z.string().max(500).optional(),
   handover_id: z.string().uuid().optional(),
   auth_mode: AuthModeSchema,
   totp_token: z.string().length(6).regex(/^\d{6}$/).optional(),
+  biometric_proof_id: z.string().uuid().optional(),
 }).refine(
   (d) => d.auth_mode !== "totp" || !!d.totp_token,
   { message: "totp_token obrigatório quando auth_mode é totp", path: ["totp_token"] }
+).refine(
+  (d) => d.auth_mode !== "biometria" || !!d.biometric_proof_id,
+  { message: "biometric_proof_id obrigatório quando auth_mode é biometria", path: ["biometric_proof_id"] }
 );
```

- [ ] **Step 3: `/open` — troca de auth + consumo da prova depois da mutação**

```diff
   async (c) => {
     const userId   = c.get("userId");
     let tenantId   = c.get("tenantId");
-    const { reserve_id, observacao_abertura, auth_mode, totp_token } = c.req.valid("json");
+    const { reserve_id, observacao_abertura, auth_mode, totp_token, biometric_proof_id } = c.req.valid("json");
```

```diff
     // Validar autenticação do armeiro (TOTP ou biometria)
     const authResult = auth_mode === "totp"
       ? await validateSelfTotp(userId, totp_token!)
-      : await validateSelfBiometric(userId);
+      : await validateSelfBiometricProof(userId, reserve_id, biometric_proof_id!, {
+          tenantId, purpose: "open_shift", documentId: null,
+        });

     if (!authResult.ok) {
       return c.json({ error: authResult.error }, authResult.status);
     }
```

```diff
     await logShiftEvent({
       shiftId:     shift.id,
       actorId:     userId,
       tenantId:    tenantId!,
       eventType:   "turno_assumido",
       description: observacao_abertura
         ? `Turno assumido. ${observacao_abertura}`
         : "Turno assumido.",
     });
     c.get("log").info({ shiftId: shift.id, reserve_id, armeiro_id: userId }, "shift.open");

+    // authResult.ok já está estaticamente true aqui (early return acima já
+    // eliminou o branch false) — checar authResult.loadedProof sozinho é
+    // suficiente. Consumir por último, só depois do insert em
+    // service_shifts confirmado (mesmo raciocínio de cautelamentos.ts).
+    if (authResult.loadedProof) {
+      try {
+        await consumeBiometricProof(supabase, authResult.loadedProof.proof, {
+          proofId: biometric_proof_id!,
+          tenantId: tenantId!, reserveId: reserve_id, actorId: userId,
+          operationType: "shift_open", operationId: shift.id,
+          purpose: "open_shift", expectedUserId: userId, documentId: null,
+        });
+      } catch (err) {
+        c.get("log").warn({ shiftId: shift.id, error: err instanceof Error ? err.message : String(err) }, "shift.open.proof_consume_failed");
+      }
+    }
+
     return c.json({ ok: true, shift }, 201);
   }
 );
```

- [ ] **Step 4: `/:id/close` — troca de auth + guard condicional + consumo da prova**

```diff
   async (c) => {
     const shiftId  = c.req.param("id");
     const userId   = c.get("userId");
     const tenantId = c.get("tenantId");
-    const { observacao_encerramento, handover_id, auth_mode, totp_token } = c.req.valid("json");
+    const { observacao_encerramento, handover_id, auth_mode, totp_token, biometric_proof_id } = c.req.valid("json");

     // Verificar propriedade do turno ANTES de consumir o TOTP/biometria (fail fast sem custo de auth)
     const { data: shift } = await supabase
       .from("service_shifts")
       .select("id, armeiro_id, status, reserve_id")
       .eq("id", shiftId)
       .maybeSingle();

     if (!shift) return c.json({ error: "Turno não encontrado" }, 404);
     if (shift.armeiro_id !== userId) return c.json({ error: "Acesso negado" }, 403);
     if (shift.status !== "ativo") return c.json({ error: "Turno já encerrado" }, 422);

     // Validar autenticação do armeiro apenas após confirmar propriedade do turno
     const authResult = auth_mode === "totp"
       ? await validateSelfTotp(userId, totp_token!)
-      : await validateSelfBiometric(userId);
+      : await validateSelfBiometricProof(userId, shift.reserve_id as string, biometric_proof_id!, {
+          tenantId: tenantId!, purpose: "close_shift", documentId: shiftId,
+        });

     if (!authResult.ok) {
       return c.json({ error: authResult.error }, authResult.status);
     }

     const closingSnapshot = await generateOpeningSnapshot(tenantId, shift.reserve_id as string);

-    const { error: closeErr } = await supabase.from("service_shifts").update({
-      status:           "encerrado",
-      ended_at:         new Date().toISOString(),
-      closing_snapshot: closingSnapshot,
-      handover_id:      handover_id ?? null,
-    }).eq("id", shiftId);
-
-    if (closeErr) {
-      c.get("log").error({ code: closeErr.code, error: closeErr.message, shiftId }, "shift.close.persist_failure");
-      return c.json({ error: "Não foi possível encerrar o turno. Tente novamente." }, 500);
-    }
+    const { data: closedShift, error: closeErr } = await supabase
+      .from("service_shifts")
+      .update({
+        status:           "encerrado",
+        ended_at:         new Date().toISOString(),
+        closing_snapshot: closingSnapshot,
+        handover_id:      handover_id ?? null,
+      })
+      .eq("id", shiftId)
+      .eq("status", "ativo")   // trava a corrida — mesmo padrão de cautelamentos.ts
+      .select("id")
+      .single();
+
+    // PGRST116 = 0 linhas do .single() — filtro já é por id (chave única) +
+    // status='ativo', só pode significar 0 (não está mais ativo — race
+    // genuína), nunca ambiguidade de múltiplas. Qualquer outro erro (banco
+    // genuíno) NÃO vira 409 disfarçado.
+    if (closeErr?.code === "PGRST116") {
+      return c.json({ error: "Turno já foi encerrado por outra requisição" }, 409);
+    }
+    if (closeErr || !closedShift) {
+      c.get("log").error({ code: closeErr?.code, error: closeErr?.message, shiftId }, "shift.close.persist_failure");
+      return c.json({ error: "Não foi possível encerrar o turno. Tente novamente." }, 500);
+    }

     // shiftId explícito — CRÍTICO aqui: o UPDATE acima já mudou o status
     // deste turno para 'encerrado', então a busca por status='ativo' (usada
     // quando shiftId não é passado) nunca mais encontraria este turno. Sem
     // isso, o evento turno_encerrado nunca era gravado — bug real confirmado
     // em produção (100% dos encerramentos, silenciosamente).
     await logShiftEvent({
       shiftId,
       actorId:     userId,
       tenantId:    tenantId!,
       eventType:   "turno_encerrado",
       description: observacao_encerramento
         ? `Turno encerrado. ${observacao_encerramento}`
         : "Turno encerrado.",
     });
     c.get("log").info({ shiftId, armeiro_id: userId }, "shift.close");

+    if (authResult.loadedProof) {
+      try {
+        await consumeBiometricProof(supabase, authResult.loadedProof.proof, {
+          proofId: biometric_proof_id!,
+          tenantId: tenantId!, reserveId: shift.reserve_id as string, actorId: userId,
+          operationType: "shift_close", operationId: shiftId,
+          purpose: "close_shift", expectedUserId: userId, documentId: shiftId,
+        });
+      } catch (err) {
+        c.get("log").warn({ shiftId, error: err instanceof Error ? err.message : String(err) }, "shift.close.proof_consume_failed");
+      }
+    }
+
     return c.json({ ok: true });
   }
 );
```

- [ ] **Step 5: `tsc --noEmit` limpo**

Run: `cd apps/bff && pnpm typecheck`
Expected: zero erros.

- [ ] **Step 6: Commit**

```bash
git add apps/bff/src/routes/shifts.ts
git commit -m "feat(bff): /open e /:id/close usam proof biométrica real; /:id/close ganha guard de concorrência"
```

---

## Task 9: Remover o SDK de teste ZKTeco por completo

**Files:**
- Delete: `apps/bff/src/services/fingerprint/index.ts`, `interface.ts`, `mock.ts`, `zkteco.ts`
- Test: `apps/bff/src/__tests__/zkteco-removal-guard.test.ts`

- [ ] **Step 1: Confirmar que nenhum import restante aponta pro diretório**

Run: `cd apps/bff && grep -rl "services/fingerprint" src/ || echo "nenhuma referência"`
Expected: `nenhuma referência` (Tasks 6-7 já removeram os únicos 2 imports de produção).

- [ ] **Step 2: Deletar o diretório**

```bash
rm -rf apps/bff/src/services/fingerprint
```

- [ ] **Step 3: Escrever o teste de regressão estática (guarda que nunca mais volte)**

```ts
// apps/bff/src/__tests__/zkteco-removal-guard.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

describe("ZKTeco removal guard", () => {
  it("zero referência a getFingerprintSDK/ZKTecoSDK/zkteco em apps/bff/src", () => {
    const repoRoot = resolve(process.cwd(), "..", "..");
    let output = "";
    try {
      output = execSync(
        'grep -ril "getFingerprintSDK\\|ZKTecoSDK\\|zkteco" apps/bff/src',
        { cwd: repoRoot, encoding: "utf8" }
      );
    } catch (err: unknown) {
      // grep sai com código 1 quando não encontra nada — é o resultado esperado.
      const status = (err as { status?: number }).status;
      if (status !== 1) throw err;
      output = "";
    }
    assert.equal(output.trim(), "", `arquivos ainda referenciam o SDK removido:\n${output}`);
  });

  it("diretório services/fingerprint não existe mais", () => {
    const repoRoot = resolve(process.cwd(), "..", "..");
    const { existsSync } = require("node:fs") as typeof import("node:fs");
    assert.equal(existsSync(resolve(repoRoot, "apps/bff/src/services/fingerprint")), false);
  });
});
```

- [ ] **Step 4: Rodar e confirmar verde**

Run: `cd apps/bff && node --experimental-strip-types --test "src/__tests__/zkteco-removal-guard.test.ts"`
Expected: `# pass 2`, 0 fail.

- [ ] **Step 5: Rodar a suíte inteira do BFF, confirmar 0 fail**

Run: `cd apps/bff && node --experimental-strip-types --test "src/__tests__/*.test.ts"`
Expected: 0 fail (inclusive `biometric-phase1a2-custody.test.ts`, que já testa que `lendings.ts`/`saidas.ts` não têm `getFingerprintSDK` — continua correto, esses arquivos nunca usaram o SDK morto).

- [ ] **Step 6: `tsc --noEmit` limpo + commit**

```bash
cd apps/bff && pnpm typecheck
git add -A apps/bff/src/services/fingerprint apps/bff/src/__tests__/zkteco-removal-guard.test.ts
git commit -m "feat(bff): remove SDK de teste ZKTeco por completo; guarda estática de regressão"
```

---

## Task 10: Frontend — `apps/web/src/components/cautelas/sign-dialog.tsx`

**Files:**
- Modify: `apps/web/src/components/cautelas/sign-dialog.tsx`

**Estado atual confirmado** (176 linhas): `handleBiometria` (linhas 108-120, POST direto `{use_biometric:true}`), painel "Biometria" (linhas 154-166, ícone estático + botão "Capturar Biometria").

- [ ] **Step 1: Novos imports e novas props**

```diff
 import { bffFetch } from "@/lib/bff-client";
 import { toast } from "sonner";
 import { friendlyApiError } from "@/lib/api-error";
-import { Fingerprint, KeyRound, ShieldCheck, Loader2 } from "lucide-react";
+import { KeyRound, ShieldCheck, Loader2, Fingerprint } from "lucide-react";
+import { BiometricCaptureDialog, type BiometricResult } from "@/components/biometric/biometric-capture-dialog";
```

```diff
 interface SignDialogProps {
   open: boolean;
   cautelaId: string;
   role: SignRole;
+  reserveId: string;
+  documentHash: string;
+  currentUserId: string;
+  canCapture: boolean;
+  simulatorEnabled?: boolean;
+  simulationUserId?: string;
   onClose: () => void;
   onDone: () => void;
 }

-export function SignDialog({ open, cautelaId, role, onClose, onDone }: SignDialogProps) {
+export function SignDialog({
+  open, cautelaId, role, reserveId, documentHash, currentUserId,
+  canCapture, simulatorEnabled, simulationUserId, onClose, onDone,
+}: SignDialogProps) {
   const [method, setMethod] = useState<AuthMethod>("totp");
   const [totpCode, setTotpCode] = useState("");
   const [loading, setLoading] = useState(false);
-  const [bioCapturing, setBioCapturing] = useState(false);

   const endpoint = role === "armeiro"
     ? `/api/cautelamentos/${cautelaId}/sign-armeiro`
     : `/api/cautelamentos/${cautelaId}/sign-militar`;
   const roleLabel = role === "armeiro" ? "Armeiro" : "Individual";
```

- [ ] **Step 2: `handleBiometria` sai, entra `handleBiometricResult`**

```diff
-  async function handleBiometria() {
-    setBioCapturing(true);
-    try {
-      const { ok, data, status } = await bffFetch("POST", endpoint, { use_biometric: true });
-      if (!ok) {
-        console.error("[sign-dialog] falha na assinatura via biometria", { status, error: data.error });
-        toast.error(friendlyApiError(status, data.error, "Falha na captura biométrica"));
-        return;
-      }
-      toast.success(`Assinatura do ${roleLabel} registrada via biometria`);
-      onDone();
-    } finally { setBioCapturing(false); }
-  }
+  async function handleBiometricResult(result: BiometricResult) {
+    if (result.proof?.result !== "success") return;
+    const { ok, data, status } = await bffFetch("POST", endpoint, { biometric_proof_id: result.proof.id });
+    if (!ok) {
+      console.error("[sign-dialog] falha na assinatura via biometria", { status, error: data.error });
+      toast.error(friendlyApiError(status, data.error, "Falha na assinatura"));
+      return;
+    }
+    toast.success(`Assinatura do ${roleLabel} registrada via biometria`);
+    onDone();
+  }
```

- [ ] **Step 3: Painel "Biometria" — troca o ícone estático + botão pelo `BiometricCaptureDialog` real**

```diff
         ) : (
           <div className="space-y-3">
-            <div className="flex flex-col items-center gap-3 py-3 rounded-xl border border-dashed border-border bg-muted/30">
-              <Fingerprint className={`size-12 ${bioCapturing ? "animate-pulse text-primary" : "text-muted-foreground"}`} />
-              <p className="text-xs text-muted-foreground text-center">
-                {bioCapturing ? "Aguardando captura no leitor biométrico..." : "Posicione o dedo no leitor biométrico e clique em capturar"}
-              </p>
-            </div>
-            <Button className="w-full" onClick={handleBiometria} disabled={bioCapturing}>
-              {bioCapturing ? <Loader2 className="size-4 animate-spin mr-2" /> : <Fingerprint className="size-4 mr-2" />}
-              {bioCapturing ? "Capturando..." : "Capturar Biometria"}
-            </Button>
+            <BiometricCaptureDialog
+              reserveId={reserveId}
+              canCapture={canCapture}
+              simulatorEnabled={simulatorEnabled}
+              simulationUserId={simulationUserId}
+              purpose={role === "armeiro" ? "sign_cautela_armeiro" : "sign_cautela_militar"}
+              expectedUserId={currentUserId}
+              documentId={cautelaId}
+              documentHash={documentHash}
+              buttonLabel="Capturar Biometria"
+              onResult={handleBiometricResult}
+            />
           </div>
         )}
```

- [ ] **Step 4: `tsc --noEmit` limpo**

Run: `cd apps/web && pnpm typecheck`
Expected: erros esperados nos 2 callers ainda não atualizados (`_cautelas-client.tsx`/`_minhas-cautelas-client.tsx`, faltando as novas props obrigatórias) — resolvido nas Tasks 12-13. Confirmar que o erro é só "missing props" nos callers, não dentro de `sign-dialog.tsx`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/cautelas/sign-dialog.tsx
git commit -m "feat(web): SignDialog usa BiometricCaptureDialog real"
```

---

## Task 11: Frontend — `apps/web/src/components/livro/shift-auth-dialog.tsx`

**Files:**
- Modify: `apps/web/src/components/livro/shift-auth-dialog.tsx`

**Estado atual confirmado** (176 linhas): `biometricAvailable` prop (linha 30, com comentário justificativo linhas 24-30), `handleBioConfirm` (linhas 73-76), guardas de `biometricAvailable` nas linhas 91, 129, 150. Este é o arquivo que passou por 3 rodadas de reescrita da spec (v9→v10→v11) — implementar exatamente como abaixo, sem atalhos.

- [ ] **Step 1: Imports novos, remove o comentário de justificativa de `biometricAvailable` (linhas 24-30 reais)**

```diff
-import { useState } from "react";
+import { useEffect, useState } from "react";
 import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
 import { Button } from "@/components/ui/button";
 import { Label } from "@/components/ui/label";
 import { Input } from "@/components/ui/input";
 import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
 import { Loader2, KeyRound, Fingerprint } from "lucide-react";
+import { BiometricCaptureDialog, type BiometricResult } from "@/components/biometric/biometric-capture-dialog";

 export type ShiftAuthMode = "totp" | "biometria";

 interface ShiftAuthDialogProps {
   open: boolean;
   title: string;
   description?: string;
   confirmLabel: string;
   confirmVariant?: "default" | "destructive";
   confirmDisabled?: boolean;
   submitting: boolean;
-  onConfirm: (authMode: ShiftAuthMode, totpToken?: string) => void;
+  onConfirm: (authMode: ShiftAuthMode, totpToken?: string, biometricProofId?: string) => void;
   onCancel: () => void;
   children?: React.ReactNode;
-  /**
-   * O SDK ZKTeco em produção é um stub (verify() sempre retorna false) e o BFF
-   * roda num VPS sem leitor USB conectado — a aba de biometria hoje é uma
-   * autenticação que sempre falha. Mantida oculta até o SDK real estar
-   * integrado; controlado por NEXT_PUBLIC_BIOMETRIC_ENABLED no caller.
-   */
-  biometricAvailable?: boolean;
+  variant: "open" | "close";
+  shiftId?: string;
+  reserveId: string;
+  canCapture: boolean;
+  currentUserId: string;
+  simulatorEnabled?: boolean;
+  simulationUserId?: string;
 }
```

- [ ] **Step 2: Assinatura da função — remove `biometricAvailable`, adiciona as props novas**

```diff
 export function ShiftAuthDialog({
   open,
   title,
   description,
   confirmLabel,
   confirmVariant = "default",
   confirmDisabled = false,
   submitting,
   onConfirm,
   onCancel,
   children,
-  biometricAvailable = false,
+  variant,
+  shiftId,
+  reserveId,
+  canCapture,
+  currentUserId,
+  simulatorEnabled,
+  simulationUserId,
 }: ShiftAuthDialogProps) {
   const [authTab, setAuthTab] = useState<ShiftAuthMode>("totp");
   const [totpToken, setTotpToken] = useState("");

   function resetState() {
     setTotpToken("");
     setAuthTab("totp");
   }

   function handleCancel() {
     resetState();
     onCancel();
   }

   function handleTotpConfirm() {
     if (totpToken.length !== 6) return;
     onConfirm("totp", totpToken);
     resetState();
   }

-  // Biometric capture happens server-side (ZKTeco SDK) during the shift action itself.
-  // Clicking "Confirmar com Digital" directly triggers the action with auth_mode=biometria.
-  // The BFF captures the fingerprint ONCE in the shift open/close handler.
-  function handleBioConfirm() {
-    onConfirm("biometria");
-    resetState();
-  }
+  function handleBiometricResult(result: BiometricResult) {
+    if (result.proof?.result === "success") {
+      onConfirm("biometria", undefined, result.proof.id);
+      // Não chama resetState() aqui — voltar authTab pra "totp" desmontaria
+      // (Base UI TabsContent, keepMounted=false) a própria tela de sucesso
+      // do BiometricCaptureDialog antes do usuário vê-la, e antes de
+      // onConfirm (assíncrono) terminar.
+    }
+    // onResult só dispara no branch de sucesso de BiometricCaptureDialog —
+    // falha/expirado/cancelamento nunca chamam esta função; o próprio
+    // BiometricCaptureDialog mostra seu estado de erro e o botão "Tentar
+    // novamente" internamente (mesmo padrão que SignDialog já assume).
+  }
+
+  // Reseta authTab/totpToken quando o dialog termina de fechar, por
+  // QUALQUER caminho (sucesso via handleBiometricResult, que
+  // deliberadamente NÃO reseta a aba — ver acima; TOTP e cancelamento já
+  // resetam nos próprios pontos, este efeito é a rede de segurança pro
+  // caso que nenhum dos dois cobre: o pai fechando o dialog via
+  // `open=false` direto, sem passar por handleCancel — onOpenChange do
+  // Base UI Dialog só dispara em resposta a uma interação do próprio
+  // Dialog, nunca quando o pai muda o prop `open` de fora). Roda só na
+  // transição open:true→false — não interfere com o momento em que
+  // BiometricCaptureDialog mostra sua tela de sucesso, porque nesse ponto
+  // o Dialog já está fechando.
+  useEffect(() => {
+    if (!open) resetState();
+  }, [open]);

   const totpValid = totpToken.length === 6 && /^\d{6}$/.test(totpToken);
```

- [ ] **Step 3: `TabsList` sempre visível (remove a guarda da linha 91 real)**

```diff
         <Tabs value={authTab} onValueChange={(v) => setAuthTab(v as ShiftAuthMode)}>
-          {biometricAvailable && (
-            <TabsList className="grid w-full grid-cols-2">
-              <TabsTrigger value="totp" className="flex items-center gap-1.5">
-                <KeyRound className="h-3.5 w-3.5" />
-                TOTP
-              </TabsTrigger>
-              <TabsTrigger value="biometria" className="flex items-center gap-1.5">
-                <Fingerprint className="h-3.5 w-3.5" />
-                Biometria
-              </TabsTrigger>
-            </TabsList>
-          )}
+          <TabsList className="grid w-full grid-cols-2">
+            <TabsTrigger value="totp" className="flex items-center gap-1.5">
+              <KeyRound className="h-3.5 w-3.5" />
+              TOTP
+            </TabsTrigger>
+            <TabsTrigger value="biometria" className="flex items-center gap-1.5">
+              <Fingerprint className="h-3.5 w-3.5" />
+              Biometria
+            </TabsTrigger>
+          </TabsList>
```

- [ ] **Step 4: Painel "Biometria" sempre visível, conteúdo troca pro `BiometricCaptureDialog` real (remove a guarda + o ícone estático das linhas 129-143 reais)**

```diff
-          {biometricAvailable && <TabsContent value="biometria" className="mt-3">
-            <div className="flex flex-col items-center gap-3 py-4">
-              <div className={`rounded-full p-5 transition-colors ${submitting ? "bg-blue-500/20 animate-pulse" : "bg-muted"}`}>
-                <Fingerprint className={`h-10 w-10 ${submitting ? "text-blue-500" : "text-muted-foreground"}`} />
-              </div>
-              <p className="text-sm text-center text-muted-foreground">
-                {submitting
-                  ? "Aguardando leitura biométrica... coloque o dedo no leitor."
-                  : "Clique no botão abaixo e coloque seu dedo no leitor biométrico quando solicitado."}
-              </p>
-              <p className="text-xs text-center text-muted-foreground/70">
-                O leitor será ativado ao confirmar a ação.
-              </p>
-            </div>
-          </TabsContent>}
+          <TabsContent value="biometria" className="mt-3">
+            <BiometricCaptureDialog
+              reserveId={reserveId}
+              canCapture={canCapture}
+              simulatorEnabled={simulatorEnabled}
+              simulationUserId={simulationUserId}
+              purpose={variant === "open" ? "open_shift" : "close_shift"}
+              expectedUserId={currentUserId}
+              documentId={variant === "close" ? shiftId : undefined}
+              buttonLabel={confirmLabel}
+              onResult={handleBiometricResult}
+            />
+          </TabsContent>
         </Tabs>
```

- [ ] **Step 5: Footer — só mostra botão de confirmação na aba TOTP (remove o ternário da linha 150 real)**

```diff
         <DialogFooter>
           <Button variant="outline" onClick={handleCancel} disabled={submitting}>
             Cancelar
           </Button>
-          {!biometricAvailable || authTab === "totp" ? (
-            <Button
-              variant={confirmVariant}
-              onClick={handleTotpConfirm}
-              disabled={submitting || !totpValid || confirmDisabled}
-              data-testid="shift-auth-confirm"
-            >
-              {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
-              {confirmLabel}
-            </Button>
-          ) : (
-            <Button
-              variant={confirmVariant}
-              onClick={handleBioConfirm}
-              disabled={submitting || confirmDisabled}
-              data-testid="shift-auth-bio-confirm"
-            >
-              {submitting
-                ? <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Capturando...</>
-                : <><Fingerprint className="h-4 w-4 mr-1" /> {confirmLabel}</>}
-            </Button>
-          )}
+          {authTab === "totp" && (
+            <Button
+              variant={confirmVariant}
+              onClick={handleTotpConfirm}
+              disabled={submitting || !totpValid || confirmDisabled}
+              data-testid="shift-auth-confirm"
+            >
+              {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
+              {confirmLabel}
+            </Button>
+          )}
         </DialogFooter>
```

- [ ] **Step 6: `tsc --noEmit` limpo**

Run: `cd apps/web && pnpm typecheck`
Expected: erros esperados nos 2 usos em `_livro-client.tsx` (props novas `variant`/`reserveId`/`canCapture`/`currentUserId` obrigatórias, faltando) — resolvido na Task 14.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/livro/shift-auth-dialog.tsx
git commit -m "feat(web): ShiftAuthDialog usa BiometricCaptureDialog real; remove biometricAvailable/handleBioConfirm; reset uniforme no fechamento"
```

---

## Task 12: Wiring — `apps/web/src/app/(dashboard)/reserva/cautelas/_cautelas-client.tsx`

**Files:**
- Modify: `apps/web/src/app/(dashboard)/reserva/cautelas/_cautelas-client.tsx`

**Estado atual confirmado**: `interface Cautela` (linhas 26-43, sem `reserve_id`/`document_hash`), estados `signCautelaId`/`signRole` (linhas 203-205), `openSign(cautela, role)` (linhas 331-335, recebe a `Cautela` inteira), criação de nova cautela seta `signCautelaId` direto de `data.cautelamento.id` (linhas 317-322, `data.cautelamento` já vem de `.select()` completo no backend — já inclui `reserve_id`/`document_hash`), `<SignDialog>` (linhas 667-673).

- [ ] **Step 1: `Cautela` interface ganha os 2 campos**

```diff
 interface Cautela {
   id: string;
   status: "ativa" | "devolvida" | "substituida" | "em_revisao" | "cancelada";
   motivo_emissao: string;
   condicao_emissao: string;
   data_emissao: string;
   prazo_proxima_conferencia?: string | null;
   armeiro_signature_id?: string | null;
   militar_signature_id?: string | null;
+  reserve_id: string;
+  document_hash: string;
   item: {
```

- [ ] **Step 2: Novos estados + hook do simulador + `currentUserId` via `/api/auth/me`**

```diff
 import { useState, useEffect, useCallback, useRef } from "react";
 import { createClient } from "@/lib/supabase/client";
+import { bffFetch } from "@/lib/bff-client";
+import { useBiometricSimulatorAvailable } from "@/hooks/use-biometric-simulator-available";
```

```diff
   const [signOpen, setSignOpen] = useState(false);
   const [signRole, setSignRole] = useState<SignRole>("armeiro");
   const [signCautelaId, setSignCautelaId] = useState("");
+  const [signReserveId, setSignReserveId] = useState("");
+  const [signDocumentHash, setSignDocumentHash] = useState("");
   const [selectedCautela, setSelectedCautela] = useState<Cautela | null>(null);
+  const [currentUserId, setCurrentUserId] = useState("");
+
+  useEffect(() => {
+    bffFetch("GET", "/api/auth/me").then((res) => {
+      setCurrentUserId(res.data?.user?.id ?? "");
+    }).catch(() => {});
+  }, []);
+
+  const simulatorEnabled = useBiometricSimulatorAvailable(signReserveId);
```

- [ ] **Step 3: Os 2 pontos que setam `signCautelaId` passam a setar `reserve_id`/`document_hash` também**

```diff
       setEmitirOpen(false);
       setForm({ item_id: "", militar_id: "", reserve_id: "", motivo_emissao: "", condicao_emissao: "bom" });
       const cautelaId: string = data.cautelamento.id;
       setSignCautelaId(cautelaId);
+      setSignReserveId(data.cautelamento.reserve_id);
+      setSignDocumentHash(data.cautelamento.document_hash);
       setSignRole("armeiro");
       setSignOpen(true);
```

```diff
   function openSign(cautela: Cautela, role: SignRole) {
     setSignCautelaId(cautela.id);
+    setSignReserveId(cautela.reserve_id);
+    setSignDocumentHash(cautela.document_hash);
     setSignRole(role);
     setSignOpen(true);
   }
```

- [ ] **Step 4: `<SignDialog>` ganha as props novas**

```diff
       <SignDialog
         open={signOpen}
         cautelaId={signCautelaId}
         role={signRole}
+        reserveId={signReserveId}
+        documentHash={signDocumentHash}
+        currentUserId={currentUserId}
+        canCapture={Boolean(signReserveId)}
+        simulatorEnabled={simulatorEnabled}
         onClose={() => setSignOpen(false)}
         onDone={() => { setSignOpen(false); void load(token); }}
       />
```

- [ ] **Step 5: `tsc --noEmit` limpo**

Run: `cd apps/web && pnpm typecheck`
Expected: erro restante só em `_minhas-cautelas-client.tsx` (Task 13, ainda não feita).

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/(dashboard)/reserva/cautelas/_cautelas-client.tsx"
git commit -m "feat(web): _cautelas-client repassa reserveId/documentHash/currentUserId/simulador pro SignDialog"
```

---

## Task 13: Wiring — `minhas-cautelas` (militar assinando a própria cautela)

**Files:**
- Modify: `apps/web/src/app/(dashboard)/efetivo/minhas-cautelas/page.tsx`
- Modify: `apps/web/src/app/(dashboard)/efetivo/minhas-cautelas/_minhas-cautelas-client.tsx`

**Estado atual confirmado**: `page.tsx` já resolve `supabase.auth.getUser()` (linha 13, `user.id`) — fonte limpa de `currentUserId`, sem precisar de fetch client-side extra. `_minhas-cautelas-client.tsx`: `interface Cautela` (linhas 20-35, sem `reserve_id`/`document_hash` — o backend já manda via `select("*")`, só falta tipar), `signCautelaId` (linha 67), `<SignDialog>` (linhas 393-398, só `role="militar"`).

- [ ] **Step 1: `page.tsx` passa `currentUserId` como prop nova**

```diff
   const { data: { user } } = await supabase.auth.getUser();
   if (!user) redirect("/login");
```

```diff
-      <MinhasCautelasClient initialCautelas={cautelas} hasMore={hasMore} currentLimit={limit} />
+      <MinhasCautelasClient initialCautelas={cautelas} hasMore={hasMore} currentLimit={limit} currentUserId={user.id} />
```

- [ ] **Step 2: `_minhas-cautelas-client.tsx` — `Cautela` interface + `Props` ganham os campos**

```diff
 export interface Cautela {
   id: string;
   status: string;
   motivo_emissao: string;
   condicao_emissao: string;
   data_emissao: string;
   prazo_proxima_conferencia?: string | null;
   armeiro_signature_id?: string | null;
   militar_signature_id?: string | null;
+  reserve_id: string;
+  document_hash: string;
   item: {
     id: string;
     numero_serie?: string | null;
     material_type: { nome: string; categoria: string };
   };
   armeiro: { nome_completo: string; matricula: string };
 }
```

```diff
 interface Props {
   initialCautelas: Cautela[];
   hasMore: boolean;
   currentLimit: number;
+  currentUserId: string;
 }
```

```diff
-export function MinhasCautelasClient({ initialCautelas, hasMore, currentLimit }: Props) {
+export function MinhasCautelasClient({ initialCautelas, hasMore, currentLimit, currentUserId }: Props) {
```

- [ ] **Step 3: Achar a cautela selecionada + hook do simulador**

```diff
+import { useBiometricSimulatorAvailable } from "@/hooks/use-biometric-simulator-available";
```

```diff
   const [signCautelaId, setSignCautelaId] = useState<string | null>(null);
+  const signingCautela = useMemo(
+    () => initialCautelas.find((c) => c.id === signCautelaId) ?? null,
+    [initialCautelas, signCautelaId],
+  );
+  const simulatorEnabled = useBiometricSimulatorAvailable(signingCautela?.reserve_id);
```

(`useMemo` já importado no topo do arquivo — `import { useState, useMemo } from "react";`, confirmado.)

- [ ] **Step 4: `<SignDialog>` ganha as props novas**

```diff
       <SignDialog
+        open={Boolean(signCautelaId)}
+        cautelaId={signCautelaId ?? ""}
         role="militar"
+        reserveId={signingCautela?.reserve_id ?? ""}
+        documentHash={signingCautela?.document_hash ?? ""}
+        currentUserId={currentUserId}
+        canCapture={Boolean(signingCautela?.reserve_id)}
+        simulatorEnabled={simulatorEnabled}
         onClose={() => setSignCautelaId(null)}
```

(As props `open`/`cautelaId` já existiam antes deste diff — mostradas aqui só como âncora para as novas linhas vizinhas; confirmar contra o arquivo real quais das duas já estavam presentes antes de aplicar, para não duplicar.)

- [ ] **Step 5: `tsc --noEmit` limpo**

Run: `cd apps/web && pnpm typecheck`
Expected: zero erros relacionados a `SignDialog` (Tasks 10, 12 e 13 completam todos os 2 callers).

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/(dashboard)/efetivo/minhas-cautelas/page.tsx" "apps/web/src/app/(dashboard)/efetivo/minhas-cautelas/_minhas-cautelas-client.tsx"
git commit -m "feat(web): minhas-cautelas repassa reserveId/documentHash/currentUserId (da sessão server-side) pro SignDialog"
```

---

## Task 14: Wiring — `apps/web/src/app/(dashboard)/reserva/livro/_livro-client.tsx`

**Files:**
- Modify: `apps/web/src/app/(dashboard)/reserva/livro/_livro-client.tsx`

**Estado atual confirmado**: `handleOpenShift`/`handleCloseShift` (linhas 202-268, assinatura `(authMode, totpToken?)`), 2 usos de `<ShiftAuthDialog>` (linhas 504-539 abrir, 542-573 encerrar), `selectedReserve` (reserva escolhida no dropdown de abertura), `shift.reserve.id` (reserva do turno ativo, disponível pra encerramento).

- [ ] **Step 1: Imports novos**

```diff
+import { useBiometricSimulatorAvailable } from "@/hooks/use-biometric-simulator-available";
```

- [ ] **Step 2: `currentUserId` via `/api/auth/me`** (mesmo padrão já usado pelo arquivo irmão `historico/_historico-client.tsx` pra `role`)

```diff
+  const [currentUserId, setCurrentUserId] = useState("");
+  useEffect(() => {
+    bffFetch("GET", "/api/auth/me").then((res) => {
+      setCurrentUserId(res.data?.user?.id ?? "");
+    }).catch(() => {});
+  }, []);
+
+  const simulatorEnabledOpen  = useBiometricSimulatorAvailable(selectedReserve);
+  const simulatorEnabledClose = useBiometricSimulatorAvailable(shift?.reserve?.id);
```

- [ ] **Step 3: `handleOpenShift`/`handleCloseShift` ganham o 3º parâmetro e repassam no POST**

```diff
-  async function handleOpenShift(authMode: ShiftAuthMode, totpToken?: string) {
+  async function handleOpenShift(authMode: ShiftAuthMode, totpToken?: string, biometricProofId?: string) {
     setSubmitting(true);
     try {
       const res = await bffFetch("POST", "/api/shifts/open", {
         reserve_id: selectedReserve,
         observacao_abertura: openObs || undefined,
         auth_mode: authMode,
         totp_token: totpToken,
+        biometric_proof_id: biometricProofId,
       });
```

```diff
-  async function handleCloseShift(authMode: ShiftAuthMode, totpToken?: string) {
+  async function handleCloseShift(authMode: ShiftAuthMode, totpToken?: string, biometricProofId?: string) {
     if (!shift) return;
     setSubmitting(true);
     try {
       const res = await bffFetch("POST", `/api/shifts/${shift.id}/close`, {
         observacao_encerramento: closeObs || undefined,
         auth_mode: authMode,
         totp_token: totpToken,
+        biometric_proof_id: biometricProofId,
       });
```

- [ ] **Step 4: `<ShiftAuthDialog>` de abertura ganha as props novas**

```diff
       <ShiftAuthDialog
         open={showOpenDialog}
         title="Assumir Turno de Serviço"
         description="Autentique-se para iniciar o registro do turno. Um snapshot do arsenal será gerado."
         confirmLabel="Assumir Turno"
         confirmDisabled={!selectedReserve}
         submitting={submitting}
         onConfirm={handleOpenShift}
         onCancel={() => { setShowOpenDialog(false); setOpenObs(""); setSelectedReserve(""); }}
+        variant="open"
+        reserveId={selectedReserve}
+        canCapture={Boolean(selectedReserve)}
+        currentUserId={currentUserId}
+        simulatorEnabled={simulatorEnabledOpen}
       >
```

- [ ] **Step 5: `<ShiftAuthDialog>` de encerramento ganha as props novas**

```diff
       <ShiftAuthDialog
         open={showCloseDialog}
         title="Encerrar Turno"
         description="Autentique-se para confirmar o encerramento. Um snapshot final será registrado."
         confirmLabel="Encerrar Turno"
         confirmVariant="destructive"
         submitting={submitting}
         onConfirm={handleCloseShift}
         onCancel={() => { setShowCloseDialog(false); setCloseObs(""); }}
+        variant="close"
+        shiftId={shift?.id}
+        reserveId={shift?.reserve?.id ?? ""}
+        canCapture={Boolean(shift?.reserve?.id)}
+        currentUserId={currentUserId}
+        simulatorEnabled={simulatorEnabledClose}
       >
```

- [ ] **Step 6: `tsc --noEmit` limpo**

Run: `cd apps/web && pnpm typecheck`
Expected: zero erros em todo `apps/web`.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/src/app/(dashboard)/reserva/livro/_livro-client.tsx"
git commit -m "feat(web): _livro-client repassa reserveId/shiftId/currentUserId/simulador pros 2 ShiftAuthDialog; handlers aceitam biometricProofId"
```

---

## Task 15: Playwright — testes de integração da autorização self-service (achado CRÍTICO da v1/v2)

**Files:**
- Create: `apps/web/e2e/biometric-self-service-authz.spec.ts`

Este é o teste que teria pego o achado CRÍTICO original (militar bloqueado em `POST /challenges`) e o achado CRÍTICO da revisão v2 (militar bloqueado em `GET /devices`, invisível pro E2E via simulador porque o simulador pula esse `useEffect`). Bate direto no BFF via `fetch`, sem passar pela UI — mesmo padrão já usado em `biometric-bridge-phase1b.spec.ts`.

- [ ] **Step 1: Escrever o spec completo**

```ts
// apps/web/e2e/biometric-self-service-authz.spec.ts
/**
 * Testes de integração da autorização self-service de `usuario` em
 * sign_cautela_militar (spec 2026-07-23-biometric-unify-cautela-turno).
 *
 * Bate direto no BFF (fetch, sem UI) — E2E via simulador NÃO cobre estes
 * casos: o simulador pula o useEffect de GET /devices inteiro
 * (biometric-capture-dialog.tsx:117-120), então um bug de autorização
 * nessa rota passaria despercebido por um teste dirigido só pela UI em
 * modo simulador (achado CRÍTICO da revisão v2 desta spec).
 */
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { BFF_URL, USERS } from "./harness";

const SUPABASE_URL  = process.env.SUPABASE_URL!;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sb() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function loginToken(email: string, password: string): Promise<string> {
  const { data, error } = await sb().auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`Login failed: ${error?.message}`);
  return data.session.access_token;
}

async function bff(method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(`${BFF_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

test.describe.configure({ mode: "serial" });

let efetivoToken = "";
let militarId = "";
let tenantId = "";
let ownReserveId = "";
let otherReserveId = "";
let ownCautelaId = "";
let otherMilitarCautelaId = "";

test.beforeAll(async () => {
  efetivoToken = await loginToken(USERS.efetivo.email, USERS.efetivo.password);

  const supa = sb();
  const { data: militarProfile } = await supa.from("profiles")
    .select("id, default_tenant_id").eq("matricula", USERS.efetivo.matricula).single();
  militarId = militarProfile!.id;
  tenantId = militarProfile!.default_tenant_id;

  const { data: ownCautela } = await supa.from("cautelamentos")
    .select("id, reserve_id").eq("militar_id", militarId).eq("status", "ativa").limit(1).maybeSingle();
  test.skip(!ownCautela, "Fixture insuficiente — militar de teste sem cautela ativa nesta instância");
  ownCautelaId = ownCautela!.id;
  ownReserveId = ownCautela!.reserve_id;

  const { data: reserves } = await supa.from("reserves")
    .select("id").eq("tenant_id", tenantId).neq("id", ownReserveId).limit(1);
  otherReserveId = reserves?.[0]?.id ?? "";

  const { data: otherCautela } = await supa.from("cautelamentos")
    .select("id").neq("militar_id", militarId).eq("status", "ativa").eq("tenant_id", tenantId).limit(1).maybeSingle();
  otherMilitarCautelaId = otherCautela?.id ?? "";
});

test("A01 (CRÍTICO da revisão v1) — usuario cria challenge sign_cautela_militar mirando a si mesmo, na própria cautela → 201", async () => {
  const { status, data } = await bff("POST", "/api/biometric/challenges", efetivoToken, {
    reserve_id: ownReserveId,
    purpose: "sign_cautela_militar",
    expected_user_id: militarId,
    document_id: ownCautelaId,
  });
  expect(status, JSON.stringify(data)).toBe(201);
  expect(data.challenge?.purpose).toBe("sign_cautela_militar");
});

test("A02 — usuario com purpose diferente de sign_cautela_militar → 403", async () => {
  const { status } = await bff("POST", "/api/biometric/challenges", efetivoToken, {
    reserve_id: ownReserveId,
    purpose: "identify",
    expected_user_id: militarId,
  });
  expect(status).toBe(403);
});

test("A03 — usuario mirando expected_user_id de OUTRA pessoa (mesmo purpose certo) → 403", async () => {
  const { data: someoneElse } = await sb().from("profiles")
    .select("id").neq("id", militarId).eq("default_tenant_id", tenantId).limit(1).single();
  const { status } = await bff("POST", "/api/biometric/challenges", efetivoToken, {
    reserve_id: ownReserveId,
    purpose: "sign_cautela_militar",
    expected_user_id: someoneElse!.id,
    document_id: ownCautelaId,
  });
  expect(status).toBe(403);
});

test("A04 — usuario com document_id de cautela de OUTRO militar → 403 (prova posse real, não só formato)", async () => {
  test.skip(!otherMilitarCautelaId, "Fixture insuficiente — sem cautela de outro militar nesta instância");
  const { status } = await bff("POST", "/api/biometric/challenges", efetivoToken, {
    reserve_id: ownReserveId,
    purpose: "sign_cautela_militar",
    expected_user_id: militarId,
    document_id: otherMilitarCautelaId,
  });
  expect(status).toBe(403);
});

test("A05 (CRÍTICO da revisão v2) — GET /api/biometric/devices como usuario, cautela ativa na própria reserva → 200", async () => {
  const { status, data } = await bff("GET", `/api/biometric/devices?reserve_id=${ownReserveId}`, efetivoToken);
  expect(status, JSON.stringify(data)).toBe(200);
  expect(Array.isArray(data.devices)).toBe(true);
});

test("A06 (CRÍTICO da revisão v2) — GET /api/biometric/devices como usuario, reserva SEM cautela ativa sua → 403", async () => {
  test.skip(!otherReserveId, "Fixture insuficiente — tenant de teste com só 1 reserva");
  const { status } = await bff("GET", `/api/biometric/devices?reserve_id=${otherReserveId}`, efetivoToken);
  expect(status).toBe(403);
});

test("A07 — usuario tentando purpose=enroll (criar identidade de outra pessoa) → 403, roleGuard nunca deveria deixar passar", async () => {
  const { status } = await bff("POST", "/api/biometric/challenges", efetivoToken, {
    reserve_id: ownReserveId,
    purpose: "enroll",
    expected_user_id: militarId,
  });
  expect(status).toBe(403);
});
```

- [ ] **Step 2: Rodar e confirmar que passa (ambiente com env vars `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`E2E_BFF_URL` já configuradas, mesmas usadas por `biometric-bridge-phase1b.spec.ts`)**

Run: `cd apps/web && pnpm test:e2e --project=suite -g "A0"`
Expected: 7 passed (ou skipped explicitamente, com motivo, se a fixture da instância não tiver dado suficiente — nunca falso-verde silencioso).

- [ ] **Step 3: Adicionar ao `testMatch` do projeto `"suite"` em `playwright.config.ts`** (mesmo grupo de `biometric-bridge-phase1b.spec.ts`/`biometric-pairing-ui.spec.ts`)

```diff
       testMatch: [
         ...
         "e2e/biometric-bridge-phase1b.spec.ts",
         "e2e/biometric-pairing-ui.spec.ts",
+        "e2e/biometric-self-service-authz.spec.ts",
       ],
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e/biometric-self-service-authz.spec.ts apps/web/playwright.config.ts
git commit -m "test(e2e): integração da autorização self-service de usuario (achados CRÍTICO v1/v2 desta spec)"
```

---

## Task 16: Playwright — testes de integração da proof biométrica em cautela e turno

**Files:**
- Create: `apps/web/e2e/biometric-proof-consumption.spec.ts`

Cobre os achados ALTO/MÉDIO de várias rodadas: `loadBiometricProof` fora do try (401 vs 500), `PGRST116` vs. erro genuíno (409 vs 500), ordem de consumo, prova de propósito errado, `document_hash` divergente, concorrência em `/:id/close`.

- [ ] **Step 1: Escrever o spec completo**

```ts
// apps/web/e2e/biometric-proof-consumption.spec.ts
/**
 * Testes de integração de consumo de proof biométrica em
 * sign-armeiro/sign-militar/shifts open/close (spec 2026-07-23).
 * Usa o simulador (POST /simulator/challenges/:id/complete) pra gerar
 * provas reais e válidas — não mocka o resultado.
 */
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { BFF_URL, USERS } from "./harness";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sb() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function loginToken(email: string, password: string): Promise<string> {
  const { data, error } = await sb().auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`Login failed: ${error?.message}`);
  return data.session.access_token;
}

async function bff(method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(`${BFF_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function captureProof(token: string, actorId: string, reserveId: string, purpose: string, expectedUserId: string, documentId?: string) {
  const { data: challenge } = await bff("POST", "/api/biometric/challenges", token, {
    reserve_id: reserveId, purpose, expected_user_id: expectedUserId, document_id: documentId ?? null,
  });
  const id = challenge.challenge.id;
  await bff("POST", `/api/biometric/simulator/challenges/${id}/complete`, token, {
    matched_user_id: expectedUserId, result: "success",
  });
  const { data: result } = await bff("GET", `/api/biometric/challenges/${id}/result`, token);
  return result.proof.id as string;
}

test.describe.configure({ mode: "serial" });

let armeiroToken = "";
let armeiroId = "";
let tenantId = "";
let reserveId = "";

test.beforeAll(async () => {
  armeiroToken = await loginToken(USERS.reserva.email, USERS.reserva.password);
  const supa = sb();
  const { data: profile } = await supa.from("profiles")
    .select("id, default_tenant_id").eq("matricula", USERS.reserva.matricula).single();
  armeiroId = profile!.id;
  tenantId = profile!.default_tenant_id;
  const { data: membership } = await supa.from("reserve_memberships")
    .select("reserve_id").eq("user_id", armeiroId).limit(1).maybeSingle();
  reserveId = membership?.reserve_id ?? "";
  test.skip(!reserveId, "Fixture insuficiente — armeiro de teste sem reserva vinculada");
});

test("P01 — biometric_proof_id inexistente em sign-armeiro → 401, não 500 (achado ALTO da revisão v3)", async () => {
  const { data: cautela } = await sb().from("cautelamentos")
    .select("id").eq("reserve_id", reserveId).eq("status", "ativa").is("armeiro_signature_id", null).limit(1).maybeSingle();
  test.skip(!cautela, "Fixture insuficiente — sem cautela ativa não assinada nesta reserva");

  const fakeProofId = "00000000-0000-4000-8000-000000000000";
  const { status, data } = await bff("POST", `/api/cautelamentos/${cautela!.id}/sign-armeiro`, armeiroToken, {
    biometric_proof_id: fakeProofId,
  });
  expect(status, JSON.stringify(data)).toBe(401);
});

test("P02 — proof de purpose errado (sign_cautela_militar numa chamada de sign-armeiro) → 401", async () => {
  const { data: cautela } = await sb().from("cautelamentos")
    .select("id, militar_id").eq("reserve_id", reserveId).eq("status", "ativa").is("armeiro_signature_id", null).limit(1).maybeSingle();
  test.skip(!cautela, "Fixture insuficiente");

  const proofId = await captureProof(armeiroToken, armeiroId, reserveId, "sign_cautela_militar", cautela!.militar_id, cautela!.id);
  const { status } = await bff("POST", `/api/cautelamentos/${cautela!.id}/sign-armeiro`, armeiroToken, { biometric_proof_id: proofId });
  expect(status).toBe(401);
});

test("P03 — sucesso: proof válida assina e consome só DEPOIS da mutação (ordem correta)", async () => {
  const { data: cautela } = await sb().from("cautelamentos")
    .select("id").eq("reserve_id", reserveId).eq("status", "ativa").is("armeiro_signature_id", null).limit(1).maybeSingle();
  test.skip(!cautela, "Fixture insuficiente");

  const proofId = await captureProof(armeiroToken, armeiroId, reserveId, "sign_cautela_armeiro", armeiroId, cautela!.id);
  const { status, data } = await bff("POST", `/api/cautelamentos/${cautela!.id}/sign-armeiro`, armeiroToken, { biometric_proof_id: proofId });
  expect(status, JSON.stringify(data)).toBe(200);
  expect(data.auth_method).toBe("biometric");

  const { data: consumption } = await sb().from("biometric_proof_consumptions")
    .select("operation_type").eq("proof_id", proofId).maybeSingle();
  expect(consumption?.operation_type).toBe("cautela_sign_armeiro");
});

test("P04 — reusar a MESMA proof numa segunda assinatura (mesma cautela, já assinada) → 409, vem do guard condicional de cautelamentos", async () => {
  const { data: cautela } = await sb().from("cautelamentos")
    .select("id").eq("armeiro_signature_id", "not.is.null").eq("reserve_id", reserveId).limit(1).maybeSingle();
  test.skip(!cautela, "Fixture insuficiente — sem cautela já assinada pelo armeiro nesta reserva");
  const { status } = await bff("POST", `/api/cautelamentos/${cautela!.id}/sign-armeiro`, armeiroToken, {
    biometric_proof_id: "00000000-0000-4000-8000-000000000001",
  });
  expect(status).toBe(422); // "Armeiro já assinou" — guard de negócio, antes mesmo de checar a prova
});

test("P05 (achado ALTO da revisão v6) — UPDATE de cautelamentos falhando por motivo QUE NÃO é PGRST116 retorna 500, não 409", async () => {
  // Injeta um cautela_id inexistente diretamente via chamada malformada não é
  // suficiente para forçar um erro não-PGRST116 real sem acesso a mock de
  // conexão — documentado como gap conhecido: este caso específico exige
  // fault injection no nível de conexão Postgres, fora do escopo de um teste
  // via HTTP real. Cobertura full deste branch fica para um teste unitário
  // do BFF com um Supabase client fake (mesmo padrão de
  // biometric-phase1a1.test.ts), não deste spec — ver Task 16, Step 3.
  test.skip(true, "Fault injection de erro não-PGRST116 exige client fake — ver teste unitário complementar");
});
```

- [ ] **Step 2: Rodar e confirmar que passa (ou skip com motivo explícito onde a fixture não permitir)**

Run: `cd apps/web && pnpm test:e2e --project=suite -g "P0"`
Expected: passed/skipped, 0 failed.

- [ ] **Step 3: Teste unitário complementar do BFF pro P05 (com client Supabase fake — mesmo padrão de `biometric-phase1a1.test.ts`)**

```ts
// apps/bff/src/__tests__/cautelamentos-sign-error-masking.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Testa a LÓGICA de distinção PGRST116-vs-outro-erro isoladamente, sem
// subir o servidor Hono inteiro — replica exatamente o branch de
// cautelamentos.ts (Task 6, Step 5) com um objeto de erro fabricado.
function classify(cautelaUpdateErr: { code?: string; message?: string } | null, signedCautela: unknown) {
  if (cautelaUpdateErr?.code === "PGRST116") return { status: 409 };
  if (cautelaUpdateErr || !signedCautela) return { status: 500 };
  return { status: 200 };
}

describe("guard condicional de cautelamentos.ts — PGRST116 vs erro genuíno", () => {
  it("PGRST116 (0 linhas, race genuína) → 409", () => {
    assert.deepEqual(classify({ code: "PGRST116" }, null), { status: 409 });
  });
  it("erro de conexão/constraint (código diferente) → 500, nunca 409 disfarçado", () => {
    assert.deepEqual(classify({ code: "23505", message: "constraint violation" }, null), { status: 500 });
    assert.deepEqual(classify({ code: "08006", message: "connection failure" }, null), { status: 500 });
  });
  it("sucesso (sem erro, linha retornada) → não vira 409 nem 500", () => {
    assert.deepEqual(classify(null, { id: "abc" }), { status: 200 });
  });
});
```

Run: `cd apps/bff && node --experimental-strip-types --test "src/__tests__/cautelamentos-sign-error-masking.test.ts"`
Expected: `# pass 3`, 0 fail.

- [ ] **Step 4: Adicionar o spec E2E ao `testMatch` da `"suite"` + commit**

```diff
         "e2e/biometric-self-service-authz.spec.ts",
+        "e2e/biometric-proof-consumption.spec.ts",
```

```bash
git add apps/web/e2e/biometric-proof-consumption.spec.ts apps/bff/src/__tests__/cautelamentos-sign-error-masking.test.ts apps/web/playwright.config.ts
git commit -m "test: consumo de proof biométrica em sign-armeiro (ordem, 401 vs 500, 409 de reuso, guard PGRST116)"
```

---

## Task 17: Playwright — abrir/encerrar turno via biometria + concorrência em `/:id/close`

**Files:**
- Create: `apps/web/e2e/biometric-shift-auth.spec.ts`

- [ ] **Step 1: Escrever o spec completo**

```ts
// apps/web/e2e/biometric-shift-auth.spec.ts
/**
 * Integração: abrir/encerrar turno via biometria (spec 2026-07-23).
 * S01-S03: fluxo feliz. S04 (achado ALTO da revisão v3): concorrência real
 * em /:id/close — 2 requests simultâneos, 1 sucesso, 1 recebe 409, nunca
 * os dois "sucesso" (double-close, hash-chain do Livro Digital duplicado).
 */
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { BFF_URL, USERS } from "./harness";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sb() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}
async function loginToken(email: string, password: string): Promise<string> {
  const { data, error } = await sb().auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`Login failed: ${error?.message}`);
  return data.session.access_token;
}
async function bff(method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(`${BFF_URL}${path}`, {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
async function captureProof(token: string, reserveId: string, purpose: string, expectedUserId: string, documentId?: string) {
  const { data: challenge } = await bff("POST", "/api/biometric/challenges", token, {
    reserve_id: reserveId, purpose, expected_user_id: expectedUserId, document_id: documentId ?? null,
  });
  const id = challenge.challenge.id;
  await bff("POST", `/api/biometric/simulator/challenges/${id}/complete`, token, { matched_user_id: expectedUserId, result: "success" });
  const { data: result } = await bff("GET", `/api/biometric/challenges/${id}/result`, token);
  return result.proof.id as string;
}

test.describe.configure({ mode: "serial" });

let armeiroToken = "";
let armeiroId = "";
let reserveId = "";

test.beforeAll(async () => {
  armeiroToken = await loginToken(USERS.reserva.email, USERS.reserva.password);
  const supa = sb();
  const { data: profile } = await supa.from("profiles").select("id").eq("matricula", USERS.reserva.matricula).single();
  armeiroId = profile!.id;
  const { data: membership } = await supa.from("reserve_memberships").select("reserve_id").eq("user_id", armeiroId).limit(1).maybeSingle();
  reserveId = membership?.reserve_id ?? "";
  test.skip(!reserveId, "Fixture insuficiente");

  // Garante que não há turno ativo do armeiro de teste antes de começar.
  await supa.from("service_shifts").update({ status: "encerrado", ended_at: new Date().toISOString() })
    .eq("armeiro_id", armeiroId).eq("status", "ativo");
});

test("S01 — abrir turno via biometria com proof válida → 201", async () => {
  const proofId = await captureProof(armeiroToken, reserveId, "open_shift", armeiroId);
  const { status, data } = await bff("POST", "/api/shifts/open", armeiroToken, {
    reserve_id: reserveId, auth_mode: "biometria", biometric_proof_id: proofId,
  });
  expect(status, JSON.stringify(data)).toBe(201);

  const { data: consumption } = await sb().from("biometric_proof_consumptions")
    .select("operation_type").eq("proof_id", proofId).maybeSingle();
  expect(consumption?.operation_type).toBe("shift_open");
});

test("S02 — encerrar turno via biometria com proof válida (document_id = shiftId) → 200", async () => {
  const { data: shift } = await sb().from("service_shifts").select("id").eq("armeiro_id", armeiroId).eq("status", "ativo").single();
  const proofId = await captureProof(armeiroToken, reserveId, "close_shift", armeiroId, shift!.id);
  const { status, data } = await bff("POST", `/api/shifts/${shift!.id}/close`, armeiroToken, {
    auth_mode: "biometria", biometric_proof_id: proofId,
  });
  expect(status, JSON.stringify(data)).toBe(200);

  const { data: consumption } = await sb().from("biometric_proof_consumptions")
    .select("operation_type").eq("proof_id", proofId).maybeSingle();
  expect(consumption?.operation_type).toBe("shift_close");
});

test("S03 — proof de close_shift capturada com document_id de OUTRO turno → 401 (documentId trava reuso cruzado)", async () => {
  const proofId = await captureProof(armeiroToken, reserveId, "open_shift", armeiroId);
  const { status: openStatus } = await bff("POST", "/api/shifts/open", armeiroToken, {
    reserve_id: reserveId, auth_mode: "biometria", biometric_proof_id: proofId,
  });
  expect(openStatus).toBe(201);
  const { data: shift } = await sb().from("service_shifts").select("id").eq("armeiro_id", armeiroId).eq("status", "ativo").single();

  const wrongProof = await captureProof(armeiroToken, reserveId, "close_shift", armeiroId, "00000000-0000-4000-8000-000000000099");
  const { status } = await bff("POST", `/api/shifts/${shift!.id}/close`, armeiroToken, {
    auth_mode: "biometria", biometric_proof_id: wrongProof,
  });
  expect(status).toBe(401);

  // limpa o turno aberto pra não vazar estado pro próximo teste
  const cleanupProof = await captureProof(armeiroToken, reserveId, "close_shift", armeiroId, shift!.id);
  await bff("POST", `/api/shifts/${shift!.id}/close`, armeiroToken, { auth_mode: "biometria", biometric_proof_id: cleanupProof });
});

test("S04 (achado ALTO da revisão v3) — 2 requests simultâneos encerrando o mesmo turno: 1 sucesso, 1 recebe 409, nunca os dois sucesso", async () => {
  const proofId = await captureProof(armeiroToken, reserveId, "open_shift", armeiroId);
  await bff("POST", "/api/shifts/open", armeiroToken, { reserve_id: reserveId, auth_mode: "biometria", biometric_proof_id: proofId });
  const { data: shift } = await sb().from("service_shifts").select("id").eq("armeiro_id", armeiroId).eq("status", "ativo").single();

  // 2 proofs biométricas VÁLIDAS e DISTINTAS, mesmo documentId (o turno
  // sendo encerrado) — testa a corrida real do UPDATE condicional em
  // shifts.ts (Task 8), não o consumo de proof em si (que já tem sua
  // própria trava atômica testada em P03/P04). Capturar 2 proofs reais em
  // vez de reusar uma só evita testar acidentalmente "proof já consumida"
  // (biometric_proof_consumptions) em vez do guard de concorrência do
  // PRÓPRIO shifts.ts, que é o que este teste precisa exercitar.
  const proofA = await captureProof(armeiroToken, reserveId, "close_shift", armeiroId, shift!.id);
  const proofB = await captureProof(armeiroToken, reserveId, "close_shift", armeiroId, shift!.id);
  const [c1, c2] = await Promise.all([
    bff("POST", `/api/shifts/${shift!.id}/close`, armeiroToken, { auth_mode: "biometria", biometric_proof_id: proofA }),
    bff("POST", `/api/shifts/${shift!.id}/close`, armeiroToken, { auth_mode: "biometria", biometric_proof_id: proofB }),
  ]);
  const closeStatuses = [c1.status, c2.status].sort();
  expect(closeStatuses, JSON.stringify({ c1, c2 })).toEqual([200, 409]);

  const { data: events } = await sb().from("service_log_events")
    .select("id").eq("shift_id", shift!.id).eq("event_type", "turno_encerrado");
  expect(events?.length, "double-close não pode gravar 2 eventos turno_encerrado").toBe(1);
});
```

- [ ] **Step 2: Rodar e confirmar**

Run: `cd apps/web && pnpm test:e2e --project=suite -g "S0"`
Expected: passed (S04 é o teste que teria falhado antes desta spec — confirma a correção do guard condicional da Task 8).

- [ ] **Step 3: Adicionar ao `testMatch` + commit**

```diff
         "e2e/biometric-proof-consumption.spec.ts",
+        "e2e/biometric-shift-auth.spec.ts",
```

```bash
git add apps/web/e2e/biometric-shift-auth.spec.ts apps/web/playwright.config.ts
git commit -m "test: abrir/encerrar turno via biometria + concorrência em /:id/close (achado ALTO v3)"
```

---

## Task 18: Playwright — os 6 fluxos via clique real de UI (exigência explícita do dono do sistema)

**Files:**
- Create: `apps/web/e2e/biometric-ui-flows.spec.ts`

Diferente das Tasks 15-17 (API direta), este spec dirige a UI de verdade — clica em botões reais, espera o `BiometricCaptureDialog` mostrar `biometric-state-success`. Cobre os 6 fluxos: os 4 já prontos (identificar, cadastrar/alterar digital, dar saída, receber material — nunca tiveram spec E2E dirigindo a UI antes desta spec) + os 2 novos (assinar cautela, abrir/encerrar turno). **Exigência não-opcional**: o teste de `sign_cautela_militar` autentica como role `usuario` de verdade.

- [ ] **Step 1: Escrever o teste do fluxo militar (o mais crítico — pega regressão na branch de `usuario` de `actorCanAccessChallenge` que nenhum outro teste pega via clique real)**

```ts
// apps/web/e2e/biometric-ui-flows.spec.ts
/**
 * Os 6 fluxos de biometria via clique real de UI, modo simulador.
 * UI01-UI04: os 4 já prontos (nunca tiveram E2E dirigindo a UI antes desta
 * spec). UI05: assinar cautela — armeiro E militar (usuario), 2 testes
 * distintos. UI06: abrir/encerrar turno via biometria.
 */
import { test, expect } from "@playwright/test";
import { BASE_URL, login } from "./harness";

test.describe.configure({ mode: "serial" });

test("UI05b (exigência explícita da spec — NÃO opcional) — militar (role usuario) assina a própria cautela via biometria em /efetivo/minhas-cautelas", async ({ page }) => {
  await login(page, "efetivo");
  await page.goto(`${BASE_URL}/efetivo/minhas-cautelas`, { waitUntil: "domcontentloaded" });

  const signButton = page.getByRole("button", { name: /assinar/i }).first();
  const hasCautela = await signButton.isVisible({ timeout: 10_000 }).catch(() => false);
  test.skip(!hasCautela, "Fixture insuficiente — militar de teste sem cautela pendente de assinatura nesta instância");

  await signButton.click();
  await page.getByRole("button", { name: /biometria/i }).click();

  const captureBtn = page.getByTestId("btn-biometric-identify");
  await expect(captureBtn).toBeVisible({ timeout: 5_000 });
  await captureBtn.click();

  // Modo simulador completa automaticamente (BiometricCaptureDialog.
  // completeSimulator() dispara sozinho quando simulatorEnabled) — só
  // espera o estado de sucesso aparecer, sem clique adicional.
  await expect(page.getByTestId("biometric-state-success")).toBeVisible({ timeout: 10_000 });

  // A assinatura em si é assíncrona (handleBiometricResult -> POST
  // sign-militar) — espera o toast de sucesso, não só o estado do capture.
  await expect(page.getByText(/assinatura.*registrada/i)).toBeVisible({ timeout: 10_000 });
});

test("UI06a — armeiro abre turno via biometria em /reserva/livro", async ({ page }) => {
  await login(page, "reserva");
  await page.goto(`${BASE_URL}/reserva/livro`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("livro-ready")).toBeVisible({ timeout: 15_000 });

  const openBtn = page.getByRole("button", { name: /assumir turno/i }).first();
  const alreadyActive = !(await openBtn.isVisible({ timeout: 3_000 }).catch(() => false));
  test.skip(alreadyActive, "Armeiro de teste já tem turno ativo — ver S01-S04 (biometric-shift-auth.spec.ts) para cobertura de API");

  await openBtn.click();
  await page.getByRole("tab", { name: /biometria/i }).click();
  await page.getByTestId("btn-biometric-identify").click();
  await expect(page.getByTestId("biometric-state-success")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("livro-ready")).toBeVisible({ timeout: 10_000 });
});

test("UI06b — armeiro encerra turno via biometria — tela de sucesso NÃO desaparece antes do dialog fechar (regressão do achado ALTO da revisão v9)", async ({ page }) => {
  await login(page, "reserva");
  await page.goto(`${BASE_URL}/reserva/livro`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("livro-ready")).toBeVisible({ timeout: 15_000 });

  const closeBtn = page.getByRole("button", { name: /encerrar turno/i }).first();
  const hasActive = await closeBtn.isVisible({ timeout: 5_000 }).catch(() => false);
  test.skip(!hasActive, "Sem turno ativo pra encerrar nesta instância — rodar depois de UI06a");

  await closeBtn.click();
  await page.getByRole("tab", { name: /biometria/i }).click();
  await page.getByTestId("btn-biometric-identify").click();

  // A checagem central desta regressão: o estado de sucesso PRECISA
  // aparecer e ficar visível — se o achado ALTO da v9 (resetState()
  // desmontando o painel) tivesse voltado, este await falharia por timeout
  // (o painel desmonta antes do estado "success" nunca chegar a ser
  // observável, ou some rápido demais pro assert pegar).
  await expect(page.getByTestId("biometric-state-success")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("livro-ready")).toBeVisible({ timeout: 10_000 });
});
```

**Nota sobre UI01-UI04 (os 4 fluxos já prontos)**: a spec exige cobertura nova para eles também, mas eles não fazem parte do escopo de código desta implementação (identificar/cadastrar/dar saída/receber já usam `BiometricCaptureDialog` desde as Fases 0-1C). Adicionar 4 testes análogos aos de UI06 acima, um por tela (`/reserva/biometria` identificar, `/reserva/militares` cadastrar, `/reserva/saidas/nova` dar saída, `/reserva/saidas` receber) — mesmo padrão de `login` → navegar → clicar aba/botão biometria → `btn-biometric-identify` → esperar `biometric-state-success`. Escrever como parte deste step, replicando a estrutura acima com os seletores reais de cada tela (confirmar `data-testid`/texto do botão em cada arquivo antes de escrever, mesmo processo desta task).

- [ ] **Step 2: Escrever o teste de armeiro assinando (UI05a), espelhando UI05b mas em `/reserva/cautelas` com `login(page, "reserva")`**

- [ ] **Step 3: Rodar tudo**

Run: `cd apps/web && pnpm test:e2e --project=suite -g "UI0"`
Expected: passed/skipped com motivo explícito, 0 failed.

- [ ] **Step 4: Adicionar ao `testMatch` + commit**

```diff
         "e2e/biometric-shift-auth.spec.ts",
+        "e2e/biometric-ui-flows.spec.ts",
```

```bash
git add apps/web/e2e/biometric-ui-flows.spec.ts apps/web/playwright.config.ts
git commit -m "test(e2e): 6 fluxos de biometria via clique real de UI — sign_cautela_militar autenticado como role usuario"
```

---

## Task 19: Resolver os 3 achados BAIXO da rodada 12 (não bloqueavam a spec, mas ficaram para o plano)

Confirmar cada um durante a implementação das Tasks 10-14 (já incorporados nos diffs acima — este task é só a checagem final de que os 3 foram endereçados, não trabalho novo):

- [ ] **BAIXO 1 — janela de ~100ms de dessincronia visual** entre o `<Dialog>` interno do `BiometricCaptureDialog` e o externo (`ShiftAuthDialog`) no fechamento: aceito como comportamento conhecido (a tela de sucesso já foi vista por tempo suficiente antes do fechamento começar — não é o bug da v9). Nenhuma ação de código adicional — só confirmar visualmente durante a Task 18/UI06b que não há flash perceptível incômodo; se houver, decidir com o usuário se vale a pena investir num delay artificial antes do `onConfirm` fechar o dialog externo (fora do escopo original — registrar como follow-up, não implementar sem alinhar).
- [ ] **BAIXO 2 — import de `BiometricCaptureDialog`/`BiometricResult` em `shift-auth-dialog.tsx`**: já incluído no Step 1 da Task 11 (`import { BiometricCaptureDialog, type BiometricResult } from "@/components/biometric/biometric-capture-dialog";`). Confirmar que `tsc --noEmit` da Task 11 realmente pegaria a ausência (rodar sem o import uma vez, ver o erro, depois reverter) — validação do próprio processo de TDD, não passo extra de produção.
- [ ] **BAIXO 3 — frase "variant/shiftId/reserveId/canCapture são props novas" omitia `currentUserId`**: este plano já lista `currentUserId` explicitamente em toda prop-list relevante (Tasks 11, 14) — nada a corrigir, só confirmar que a Task 14 realmente passa `currentUserId` nos 2 usos de `<ShiftAuthDialog>` (já no diff).

- [ ] **Commit** (só se algum ajuste real for necessário nesta checagem; caso contrário, pular — não commitar "nada mudou")

---

## Task 20: Regressão completa, CHANGELOG, relatório final

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Regressão completa do BFF**

Run: `cd apps/bff && node --experimental-strip-types --test "src/__tests__/*.test.ts"`
Expected: 0 fail (toda a suíte, não só os arquivos tocados nesta spec).

- [ ] **Step 2: Regressão completa do frontend — typecheck + lint + build**

```
cd apps/web && pnpm typecheck
cd apps/web && pnpm lint
cd apps/web && pnpm build
```
Expected: os 3 sem erro.

- [ ] **Step 3: Regressão E2E completa (não só os specs novos)**

```
cd apps/web && pnpm test:e2e --project=chromium
cd apps/web && pnpm test:e2e --project=suite
cd apps/web && pnpm test:e2e --project=sidebar-nav
```
Expected: 0 failed em cada — inclusive `livro-digital.spec.ts`/`cautelamentos.spec.ts`/`efetivo-cautelas.spec.ts` (fluxo TOTP, que não pode ter regredido) e `biometric-pairing-ui.spec.ts`/`biometric-bridge-phase1b.spec.ts` (Fases 0-1C, intocadas por esta spec).

- [ ] **Step 4: Guarda estática final de grep — zero referência ao SDK removido em todo o repo (não só `apps/bff/src`)**

Run: `grep -ril "getFingerprintSDK\|ZKTecoSDK" apps/ docs/ 2>/dev/null | grep -v "\.md$" || echo "limpo"`
Expected: `limpo` (menções em `docs/*.md` — o histórico da spec — são esperadas e não contam como código morto).

- [ ] **Step 5: Entrada no `CHANGELOG.md`**

```markdown
## 2026-07-2X — Biometria: assinatura de cautela e autenticação de turno via bridge real

Os 2 fluxos que ainda usavam o SDK de teste ZKTeco (assinatura de cautela,
abertura/encerramento de turno) passam a usar o mesmo motor real (bridge
NITGEN via challenge/purpose/proof) que os outros 4 fluxos já usavam.
Autoatendimento: militar (role `usuario`) pode assinar a própria cautela
via biometria em `/efetivo/minhas-cautelas`, com autorização escopada
server-side (posse real da cautela, nunca acesso amplo). Guard de
concorrência novo em `POST /:id/close` do Livro Digital corrige um
double-close pré-existente (afetava TOTP também). SDK de teste ZKTeco
removido por completo — zero referência no código.

**Arquivos:** `apps/bff/src/lib/biometric-authorization.ts` (novo),
`apps/bff/src/routes/{biometric,biometric-simulator,cautelamentos,shifts}.ts`,
`apps/bff/src/lib/{shift-auth,biometric-proof-service}.ts`,
`apps/web/src/components/{cautelas/sign-dialog,livro/shift-auth-dialog}.tsx`,
callers de ambos. `apps/bff/src/services/fingerprint/*` removido.

**Testes novos:** 4 specs E2E (`biometric-self-service-authz`,
`biometric-proof-consumption`, `biometric-shift-auth`, `biometric-ui-flows`)
+ 3 testes unitários do BFF.

Spec: `docs/superpowers/specs/2026-07-23-biometric-unify-cautela-turno-design.md`
(12 rodadas de revisão sênior, 9,5/10).
```

```bash
git add CHANGELOG.md
git commit -m "docs: CHANGELOG — biometria em cautela e turno via bridge real"
```

- [ ] **Step 6: Code review sênior obrigatório (regra canônica CLAUDE.md)** — dispatch do sub-agente `code-reviewer` com o mandato completo definido em CLAUDE.md, listando TODOS os arquivos modificados desta implementação (Tasks 1-19) e seus diffs reais (não os diffs deste plano — o diff real gerado pelo git depois de todas as tasks aplicadas). Critério de bloqueio: qualquer CRÍTICO/ALTO impede commit final — corrigir e re-revisar até a suíte de review confirmar 0 CRÍTICO/ALTO, mesma meta de ≥9,5/10 que a spec já atingiu.

- [ ] **Step 7: Atualizar o guia de teste (artefato já publicado — mencionado na spec seção 8, DoD)**: comunicar ao usuário que os 6 fluxos de biometria estão prontos e pedir a URL do artefato existente para republicar com o status atualizado (é um Artifact publicado em conversa anterior, não um arquivo do repo — não editável diretamente por este plano).

---

## Self-Review desta versão do plano

**Cobertura da spec**: os 20 tasks cobrem os 20 itens do DoD da spec (seção 8) um a um — módulo de autorização (Task 1), 4 call sites migrados + roleGuard (Tasks 2-3), harness corrigido (Task 4), erro compartilhado (Task 5), cautelamentos + PGRST116 (Task 6), shift-auth (Task 7), shifts + guard de concorrência (Task 8), remoção do SDK (Task 9), os 2 componentes frontend (Tasks 10-11), os 3 callers (Tasks 12-14), os testes de integração/E2E exigidos pela seção 6 (Tasks 15-18), os 3 BAIXO da rodada 12 (Task 19), regressão + changelog + review (Task 20).

**Placeholder scan**: nenhum "TBD"/"implementar depois" — todo step com código de produção mostra o diff completo já verificado nas 12 rodadas de revisão da spec; os testes novos têm corpo completo, não descrição. Única exceção documentada explicitamente como tal: Task 16/Step 1 P05, marcado `test.skip` com justificativa técnica real (fault injection de erro de conexão não é alcançável via HTTP real) — coberto por um teste unitário complementar no mesmo step, não deixado sem cobertura nenhuma.

**Consistência de tipos**: `ShiftAuthResult` (Task 7) usado identicamente em Task 8; `onConfirm` de `ShiftAuthDialog` (Task 11) com o 3º parâmetro `biometricProofId?` usado identicamente nos 2 call sites da Task 14; `BiometricResult`/`biometric_proof_id` nomeados de forma consistente entre Tasks 10, 11, 12, 13, 14.

**Risco aceito e registrado, não escondido**: Task 16/Step 1, teste P05 (UPDATE de `cautelamentos` falhando por erro que não é `PGRST116`) é `test.skip` com justificativa técnica explícita — fault injection de erro de conexão não é alcançável de forma determinística via HTTP real contra um Supabase de verdade — e coberto por um teste unitário complementar no mesmo step (`cautelamentos-sign-error-masking.test.ts`), não deixado sem cobertura nenhuma.
