# IDOR Defense Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden critical BFF custody mutations so writes are scoped by session tenant, and add a regression test that blocks future `id`-only writes in these routes.

**Architecture:** This slice implements the anti-IDOR spec's BFF/service_role rule for the highest-risk custody routes. It does not attempt the full repository inventory yet; it creates a focused regression gate for `lendings`, `saidas`, and `cautelamentos`, then updates the affected writes to include `tenant_id` in the write query when the table has that field.

**Tech Stack:** Node test runner with `node --experimental-strip-types`, TypeScript BFF routes, Supabase query builder.

---

## File Structure

- Create: `apps/bff/src/__tests__/idor-write-scope.test.ts` - static regression tests for critical scoped writes.
- Modify: `apps/bff/src/routes/lendings.ts` - require `tenantId` before returning a lending and scope the write by tenant.
- Modify: `apps/bff/src/routes/saidas.ts` - scope critical lending/material item writes by tenant.
- Modify: `apps/bff/src/routes/cautelamentos.ts` - scope critical cautelamento/material item writes and rollback writes by tenant.
- Modify: `CHANGELOG.md` - record implemented hardening after validation.

## Task 1: Regression Test for Scoped Writes

**Files:**
- Create: `apps/bff/src/__tests__/idor-write-scope.test.ts`

- [x] **Step 1: Write the failing test**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const route = (name: string) =>
  readFileSync(resolve(process.cwd(), "src", "routes", name), "utf8");

function assertContains(file: string, snippet: string, message: string) {
  assert.ok(file.includes(snippet), message);
}

describe("IDOR scoped writes in custody routes", () => {
  it("scopes lending return updates by tenant_id", () => {
    const file = route("lendings.ts");
    assertContains(
      file,
      '.eq("id", id)\n      .eq("tenant_id", tenantId)\n      .eq("status_legacy", "ativo")',
      "PATCH /api/lendings/:id/return must update by id + tenant_id + active status",
    );
  });

  it("scopes saida lending writes by tenant_id", () => {
    const file = route("saidas.ts");
    for (const snippet of [
      '.eq("id", body.item_id)\n      .eq("tenant_id", tenantId);',
      '.delete().eq("id", saida.id).eq("tenant_id", tenantId);',
      '.eq("id", id)\n      .eq("tenant_id", tenantId);',
      '.eq("id", id)\n      .eq("tenant_id", tenantId)\n      .not("item_id", "is", null);',
      '.eq("id", saida.item_id)\n        .eq("tenant_id", tenantId);',
    ]) {
      assertContains(file, snippet, `Missing scoped saida write: ${snippet}`);
    }
  });

  it("scopes cautelamento writes by tenant_id", () => {
    const file = route("cautelamentos.ts");
    for (const snippet of [
      '.eq("id", body.item_id)\n      .eq("tenant_id", tenantId);',
      '.delete().eq("id", cautela.id).eq("tenant_id", tenantId);',
      '.update({ armeiro_signature_id: sig.id })\n      .eq("id", id)\n      .eq("tenant_id", tenantId);',
      '.update({ militar_signature_id: sig.id })\n      .eq("id", id)\n      .eq("tenant_id", tenantId);',
      '.eq("id", id)\n      .eq("tenant_id", tenantId);',
      '.eq("id", cautela.item_id)\n      .eq("tenant_id", tenantId);',
      '.eq("id", antiga.item_id)\n      .eq("tenant_id", tenantId);',
      '.eq("id", body.novo_item_id)\n      .eq("tenant_id", tenantId);',
      '.delete().eq("id", nova.id).eq("tenant_id", tenantId);',
    ]) {
      assertContains(file, snippet, `Missing scoped cautelamento write: ${snippet}`);
    }
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
cd apps/bff
node --experimental-strip-types --test src/__tests__/idor-write-scope.test.ts
```

Result: FAIL reproduced before implementation, including the later reviewer finding for `lendings` bulk-return.

## Task 2: Implement Tenant-Scoped Writes

**Files:**
- Modify: `apps/bff/src/routes/lendings.ts`
- Modify: `apps/bff/src/routes/saidas.ts`
- Modify: `apps/bff/src/routes/cautelamentos.ts`

- [x] **Step 1: Require tenantId before operational mutations**

Add an early guard in affected handlers:

```typescript
const tenantId = c.get("tenantId");
if (!tenantId) return c.json({ error: "Tenant nao identificado na sessao" }, 400);
```

- [x] **Step 2: Scope writes by tenant**

Update every tested write chain to include `.eq("tenant_id", tenantId)` before success is accepted. After code review, also require affected-row confirmation for custody `material_items` writes, move operational preconditions (`status`, signature fields and active item links) into the write query where the flow depends on them, scope body IDs used by creation flows before insert, and rollback document status when item release fails after a return write.

- [x] **Step 3: Run test to verify it passes**

Run:

```bash
cd apps/bff
node --experimental-strip-types --test src/__tests__/idor-write-scope.test.ts
```

Result: PASS.

## Task 3: Validation and Commit

**Files:**
- Modify: `CHANGELOG.md`

- [x] **Step 1: Run focused BFF tests**

```bash
cd apps/bff
node --experimental-strip-types --test src/__tests__/idor-write-scope.test.ts src/__tests__/session-guard.test.ts
```

Result: PASS, 11 tests.

- [x] **Step 2: Run BFF typecheck**

```bash
pnpm --filter @apmcb/bff typecheck
```

Result: exit 0.

- [x] **Step 3: Update changelog**

Add an implementation note under 2026-07-11 security documenting scoped writes in `lendings`, `saidas`, and `cautelamentos`.

- [x] **Step 4: Commit**

```bash
git add apps/bff/src/__tests__/idor-write-scope.test.ts apps/bff/src/routes/lendings.ts apps/bff/src/routes/saidas.ts apps/bff/src/routes/cautelamentos.ts CHANGELOG.md docs/superpowers/plans/2026-07-11-idor-defense-slice-1.md
git commit -m "security(idor): scope custody writes by tenant"
```
