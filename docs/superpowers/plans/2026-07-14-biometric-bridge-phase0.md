# Biometric Bridge Phase 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend foundation for NITGEN biometric bridge challenge/proof without enabling production biometric UI yet.

**Architecture:** Phase 0 creates the durable contract: database schema, signed proof verification, static/security harnesses, and BFF challenge/proof endpoints. It does not ship the Windows bridge or tenant-wide UI flow; those start only after this foundation is tested.

**Tech Stack:** Hono/BFF, Supabase PostgreSQL migrations, Node `crypto` Ed25519, Zod, `node --experimental-strip-types --test`.

---

## Scope

This plan implements only Phase 0 from `docs/superpowers/specs/2026-07-14-biometric-bridge-design.md`:

- Add `biometric_devices`, `biometric_challenges`, `biometric_proofs`.
- Harden `biometric_templates` metadata for tenant-wide 1:N later.
- Add proof signing/verification helpers.
- Add validation helpers for challenge/proof payloads.
- Add BFF endpoints for challenge creation, status, device proof submission, and device revocation/pairing skeleton.
- Add harnesses blocking regressions: server-side SDK capture, missing schema, missing redaction, replay/tenant/device mismatch.
- Keep TOTP fallback untouched.

Out of scope:

- Windows bridge executable.
- Playwright UI with real bridge.
- Full replacement of `saidas`, `cautelamentos`, `shifts`, and `handovers` signing flows. Phase 0 adds reusable validation helpers and deprecates direct server capture; later phases wire every operation.

## File Map

- Create `supabase/migrations/20260714000001_biometric_bridge_foundation.sql`: database foundation.
- Create `apps/bff/src/lib/biometric-proof.ts`: canonical payload, Ed25519 verification, challenge expiry/replay validation.
- Create `apps/bff/src/lib/biometric-policy.ts`: expected-user, tenant/reserve, score and purpose checks independent of Hono.
- Modify `apps/bff/src/lib/logger.ts`: redact bridge signatures, public/private keys, biometric raw/template aliases.
- Modify `apps/bff/src/middleware/rate-limit.ts`: add explicit biometric bucket for reviewable dedicated limits.
- Modify `apps/bff/src/routes/biometric.ts`: add challenge/proof/device endpoints and stop using server-side capture for new contract.
- Add `apps/bff/src/__tests__/biometric-proof.test.ts`: unit tests for proof validation.
- Add `apps/bff/src/__tests__/biometric-bridge-harness.test.ts`: static/security harness.
- Update `docs/security.md`, spec, CHANGELOG, and final report after implementation evidence.

## Task 1: Schema Harness and Migration

**Files:**
- Create: `supabase/migrations/20260714000001_biometric_bridge_foundation.sql`
- Create: `apps/bff/src/__tests__/biometric-bridge-harness.test.ts`

- [x] **Step 1: Write failing harness**

Create tests that assert the migration contains all required tables, immutable proof rules, `tenant_id not null` backfill for templates, and no server-side `sdk.capture()` remains in `routes/biometric.ts`.

Run:

```powershell
cd apps/bff
node --experimental-strip-types --test src/__tests__/biometric-bridge-harness.test.ts
```

Expected: fail because migration and code do not exist yet.

- [x] **Step 2: Add migration**

Create the migration with `biometric_devices`, `biometric_challenges`, `biometric_proofs`, `biometric_templates` metadata columns, proof immutability rules, indexes, RLS enabled, and comments documenting service-role ownership.

- [x] **Step 3: Remove direct SDK capture from `routes/biometric.ts`**

Replace `/identify` and `/register` server-side capture behavior with fail-closed challenge guidance until the new endpoints are wired. The old endpoints must not call `getFingerprintSDK()`.

- [x] **Step 4: Verify**

Run the harness again. Expected: pass.

## Task 2: Proof Crypto and Policy TDD

**Files:**
- Create: `apps/bff/src/lib/biometric-proof.ts`
- Create: `apps/bff/src/lib/biometric-policy.ts`
- Create: `apps/bff/src/__tests__/biometric-proof.test.ts`

- [x] **Step 1: Write failing tests**

Cover valid Ed25519 proof verification, tampering rejection, expired/consumed challenge rejection, wrong tenant/reserve/device rejection, expected-user mismatch, low score, and document hash mismatch.

- [x] **Step 2: Implement helpers**

Use deterministic JSON canonicalization for signing payloads. Expose:

- `canonicalizeBiometricPayload(payload)`
- `verifyBridgeSignature(payload, publicKeyPem, signatureBase64)`
- `assertChallengeAcceptsProof(challenge, proof, now)`
- `assertBiometricPolicy(policyInput)`

- [x] **Step 3: Verify**

Run targeted test and `pnpm --filter bff typecheck`.

## Task 3: BFF Challenge/Proof Endpoints

**Files:**
- Modify: `apps/bff/src/routes/biometric.ts`
- Test: `apps/bff/src/__tests__/biometric-bridge-harness.test.ts`

- [x] **Step 1: Extend harness**

Assert `routes/biometric.ts` exposes challenge, proof, pair/list/revoke device routes.

- [x] **Step 2: Implement routes with Supabase query builder**

Use Zod schemas. All browser-facing endpoints use `roleGuard`. Device submission verifies the bridge signature and inserts immutable proof. Do not log templates, raw fingerprint, public/private keys, or signatures.

- [x] **Step 3: Verify**

Run BFF tests and typecheck.

## Task 4: Rate Limit, Redaction, and Static Guardrails

**Files:**
- Modify: `apps/bff/src/middleware/rate-limit.ts`
- Modify: `apps/bff/src/lib/logger.ts`
- Modify: `apps/bff/src/__tests__/rate-limit-hardening-harness.test.ts`
- Modify: `apps/bff/src/__tests__/logger.test.ts`
- Modify: `apps/bff/src/__tests__/biometric-bridge-harness.test.ts`

- [x] **Step 1: Write failing tests**

Add assertions for dedicated biometric limiter, extra redaction, and no server-side fingerprint SDK in production biometric route.

- [x] **Step 2: Implement minimal changes**

Add profile and redaction paths. Keep existing rate limiter behavior for TOTP/SSA.

- [x] **Step 3: Verify**

Run `pnpm --filter bff test` and `pnpm --filter bff typecheck`.

## Task 5: Documentation, Review, and DoD Evidence

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/security.md`
- Create: `docs/enterprise/reports/2026-07-14-biometric-bridge-phase0-dod.md`

- [x] **Step 1: Update docs**

Record implemented Phase 0 boundaries, remaining phases, validation commands, and residual risks.

- [x] **Step 2: Run verification**

Run `pnpm --filter bff test`, `pnpm --filter bff typecheck`, and `git diff --check`.

- [x] **Step 3: Request impartial code review**

Use the project review mandate from `CLAUDE.md`, covering all changed `.ts`, `.sql`, and docs. Fix CRITICAL/HIGH findings before commit.

- [x] **Step 4: Commit and push**

Stage only files from this worktree branch. Commit and push `biometric-bridge-phase0`.

## Self-Review Notes

- The plan maps every Phase 0 spec requirement to a task.
- UI and Windows bridge are intentionally out of scope for this slice.
- Tests are specified before production code.
- Validation includes BFF test suite, BFF typecheck, diff check, and code review.
