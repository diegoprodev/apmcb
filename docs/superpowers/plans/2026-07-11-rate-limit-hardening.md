# Rate Limit Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an enterprise regression harness and canonical documentation for BFF rate limiting against brute force from one client, credential-stuffing volume reduction and DoS.

**Architecture:** Keep the runtime behavior stable, centralize rate limit numbers in an exported contract, and test the real Hono middleware. Document Turnstile as an anti-bot layer that complements but does not replace BFF throttling.

**Tech Stack:** Hono, Node test runner with `node --experimental-strip-types`, TypeScript, BFF middleware.

---

## File Structure

- Create: `apps/bff/src/__tests__/rate-limit-hardening-harness.test.ts` - behavioral and structural rate limit harness.
- Modify: `apps/bff/src/middleware/rate-limit.ts` - export `RATE_LIMIT_PROFILES` and reuse it in limiters.
- Create: `docs/superpowers/specs/2026-07-11-rate-limit-hardening-design.md` - design spec and prompt mestre.
- Create: `docs/superpowers/plans/2026-07-11-rate-limit-hardening.md` - implementation plan.
- Modify: `docs/security.md` - canonical rate limiting section.
- Modify: `CHANGELOG.md` - implementation record.

## Task 1: RED Harness

- [x] **Step 1: Write failing test**

Create `rate-limit-hardening-harness.test.ts` importing `RATE_LIMIT_PROFILES`,
`routeRateLimiter`, `clearRateLimitForIp` and `getClientIp`.

- [x] **Step 2: Run RED**

```bash
cd apps/bff
node --experimental-strip-types --test src/__tests__/rate-limit-hardening-harness.test.ts
```

Expected failure: `RATE_LIMIT_PROFILES` is not exported by `rate-limit.ts`.

## Task 2: GREEN Runtime Contract

- [x] **Step 1: Export explicit profiles**

Add `RATE_LIMIT_PROFILES` with `login`, `exchange`, `sensitive`, `general`,
`authMe` and `publicVerify` settings.

- [x] **Step 2: Reuse profiles in limiter construction**

Replace duplicated numeric arguments in `createRateLimiter(...)` calls with the
profile constants.

- [x] **Step 3: Run GREEN**

```bash
cd apps/bff
node --experimental-strip-types --test src/__tests__/rate-limit-hardening-harness.test.ts
```

Expected: all harness checks pass.

## Task 3: Documentation

- [x] **Step 1: Add spec**

Save the design and prompt mestre in
`docs/superpowers/specs/2026-07-11-rate-limit-hardening-design.md`.

- [x] **Step 2: Update security inventory**

Update `docs/security.md` with current route-specific limits, Turnstile
relationship, headers, and multi-instance residual risk.

- [x] **Step 3: Update changelog**

Record the harness, exported profiles and security docs update in `CHANGELOG.md`.

## Task 4: Validation, Review, Commit

- [x] **Step 1: Run focused tests**

```bash
cd apps/bff
node --experimental-strip-types --test src/__tests__/rate-limit-hardening-harness.test.ts src/__tests__/owasp-input-safety-harness.test.ts src/__tests__/idor-write-scope.test.ts src/__tests__/session-guard.test.ts
```

- [x] **Step 2: Run typechecks**

```bash
pnpm --filter @apmcb/bff typecheck
pnpm --filter @apmcb/web typecheck
```

- [x] **Step 3: Request impartial review**

Ask a subagent to review only this task's files and report severity + score.

First review scored 7/10 and blocked commit on proxy header trust and
credential-stuffing overclaim. Fixes added fail-closed proxy trust, stronger
middleware-order harness, and explicit NAT/distributed-attack residual risk.
Second review scored 9.2/10 and released commit/push.

- [x] **Step 4: Commit and push**

```bash
git add apps/bff/src/__tests__/rate-limit-hardening-harness.test.ts apps/bff/src/middleware/rate-limit.ts docs/superpowers/specs/2026-07-11-rate-limit-hardening-design.md docs/superpowers/plans/2026-07-11-rate-limit-hardening.md docs/security.md CHANGELOG.md
git commit -m "security(rate-limit): add hardening harness"
git push origin main
```
