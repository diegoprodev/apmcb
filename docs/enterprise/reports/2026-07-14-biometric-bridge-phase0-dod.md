# DoD Report — Biometric Bridge Phase 0

Date: 2026-07-14
Branch: `biometric-bridge-phase0`
Scope: backend foundation for NITGEN/eNBioBSP biometric bridge in cloud architecture.

## Delivered

- Supabase migration `20260714000001_biometric_bridge_foundation.sql`.
- New tables: `biometric_devices`, `biometric_challenges`, `biometric_proofs`.
- RLS enabled on all new biometric bridge tables.
- Immutable proof model with `challenge_id` unique and no update/delete rules.
- Hardened `biometric_templates` metadata for future tenant-wide 1:N matching.
- BFF challenge/proof/device endpoints under `/api/biometric`.
- Legacy `/api/biometric/identify` and `/api/biometric/register` fail closed with `BIOMETRIC_BRIDGE_REQUIRED`.
- Ed25519 proof canonicalization and verification helper.
- Challenge/proof validation helper.
- Biometric policy helper for tenant/reserve, expected user, score and user status.
- Dedicated `/api/biometric/*` rate limit: 30 requests/minute.
- Logger redaction for bridge signature, public/private keys, raw fingerprint and template artifacts.
- Post-review hardening: reserve-membership authorization, server-side biometric policy enforcement, pending challenge consumption check, defensive `tenant_id` migration and SQL scope triggers.
- Security documentation and changelog updated.

## Validation Evidence

Commands already executed successfully:

```powershell
cd C:\projetos\apmcb\.claude\worktrees\biometric-bridge-phase0\apps\bff
node --experimental-strip-types --test src/__tests__/biometric-bridge-harness.test.ts src/__tests__/biometric-proof.test.ts src/__tests__/rate-limit-hardening-harness.test.ts src/__tests__/logger-biometric-redaction.test.ts
```

Result: 23 tests passed, 0 failed.

```powershell
cd C:\projetos\apmcb\.claude\worktrees\biometric-bridge-phase0
pnpm --filter bff typecheck
```

Result: TypeScript passed with `tsc --noEmit`.

```powershell
cd C:\projetos\apmcb\.claude\worktrees\biometric-bridge-phase0
pnpm --filter bff test
```

Result: 106 tests passed, 0 failed.

## Residual Risk

- Windows bridge executable is not implemented in this slice.
- UI integration for enrollment/identification is not implemented in this slice.
- Operational flows still need to replace legacy boolean biometric flags with `proof_id`.
- Persistent lockout per device/actor/user is still pending; current protection is IP/session rate limit plus proof policy enforcement.
- Liveness/LFD support depends on the actual NITGEN/eNBioBSP hardware and SDK mode used at each reserve.
- A future RPC/transaction should atomically consume a challenge and insert proof; Phase 0 now verifies pending challenge consumption before proof insert, with `challenge_id unique` and SQL triggers as replay/scope guardrails.
- Existing UI/operational flows still call legacy biometric contracts in places. This branch is a backend foundation and should not be treated as the final user-facing biometric rollout until the Windows bridge and UI are wired.

## Code Review

Initial impartial reviews:

- Carson: 5/10, blocked on reserve scope, policy enforcement, legacy compatibility, challenge consumption and migration/RLS hardening.
- Planck: 2/10, blocked on defensive `tenant_id`, reserve scope, policy enforcement, DB consistency and challenge consumption.
- Euler: not approved, blocked on cross-reserve access.

Corrections applied after review:

- `actorCanAccessReserve()` enforces `reserve_memberships` for `admin_reserva` and `armeiro`.
- Device pair/list/revoke and challenge create/get/submit now scope by authorized reserve.
- Proof submit enforces `BIOMETRIC_MIN_SCORE`, expected user, tenant membership, user status and liveness requirements.
- Challenge submit requires the authenticated actor that created the challenge.
- Pending challenge consumption now uses `.select("id, status, consumed_at").single()` and returns conflict when nothing is consumed.
- Migration now adds `biometric_templates.tenant_id` defensively, fails with a clear preflight exception for orphan templates, and installs SQL scope triggers.

Final post-fix review:

- Hume: 8/10, no CRITICAL/HIGH. One MEDIUM: SQL proof trigger did not require `new.device_id` to match `biometric_challenges.device_id` when a challenge was already bound to a device.
- Correction applied: `assert_biometric_bridge_scope()` now enforces `(ch.device_id is null or ch.device_id = new.device_id)` and the schema harness asserts this guard.

Status: no known CRITICAL/HIGH blockers after final review.

## DoD Checklist

- [x] Scope documented.
- [x] Tests written before implementation for the main security contracts.
- [x] Targeted security harness passed.
- [x] BFF test suite passed.
- [x] BFF typecheck passed.
- [x] Security documentation updated.
- [x] Changelog updated.
- [x] Impartial code review completed.
- [x] Final post-fix review completed.
- [x] Final `git diff --check` passed.
- [x] Commit created and branch pushed.
