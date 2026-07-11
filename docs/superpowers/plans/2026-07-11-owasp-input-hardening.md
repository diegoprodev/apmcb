# OWASP Input Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an enterprise regression harness for SQLi/XSS/CSRF guardrails and remove the concrete XSS sink found in the PDF export flow.

**Architecture:** Keep the change narrow: static harness in BFF tests, DOM-safe rendering in the shared PDF button, and security documentation/changelog updates. The harness scans application source only (`apps/bff/src`, `apps/web/src`) so migrations and operational seed scripts remain reviewable but not blocked by app-source rules.

**Tech Stack:** Node test runner with `node --experimental-strip-types`, TypeScript, Next.js middleware, Hono BFF middleware, React DOM APIs.

---

## File Structure

- Create: `apps/bff/src/__tests__/owasp-input-safety-harness.test.ts` - static regression harness for SQLi/XSS/CSRF/CSP guardrails.
- Modify: `apps/web/src/components/shared/grid-pdf-button.tsx` - remove HTML string rendering from print/export flow.
- Create: `docs/superpowers/specs/2026-07-11-owasp-input-hardening-design.md` - design spec.
- Create: `docs/superpowers/plans/2026-07-11-owasp-input-hardening.md` - implementation plan.
- Modify: `docs/security.md` - canonical OWASP guardrails.
- Modify: `CHANGELOG.md` - implementation record.

## Task 1: RED Harness

- [x] **Step 1: Write failing test**

Create `apps/bff/src/__tests__/owasp-input-safety-harness.test.ts` with checks that:

- app source does not use raw SQL execution primitives;
- app source does not use raw browser HTML/script sinks;
- production CSP forbids `unsafe-eval`;
- browser CSRF helper uses `X-CSRF-Token` and does not read `document.cookie`;
- BFF CSRF middleware runs before authenticated API routes and has exact path exemptions.

- [x] **Step 2: Run RED**

```bash
cd apps/bff
node --experimental-strip-types --test src/__tests__/owasp-input-safety-harness.test.ts
```

Expected failure: `apps/web/src/components/shared/grid-pdf-button.tsx` uses `document.write` and `clone.outerHTML`.

## Task 2: Remove XSS Sink

- [x] **Step 1: Replace string HTML rendering**

Use `window.open` plus DOM APIs:

- `doc.createElement`
- `textContent`
- `appendChild`
- `replaceChildren`
- safe image URL allowlist

- [x] **Step 2: Run GREEN**

```bash
cd apps/bff
node --experimental-strip-types --test src/__tests__/owasp-input-safety-harness.test.ts
```

Expected: all harness tests pass.

## Task 3: Documentation

- [x] **Step 1: Add spec**

Save the design to `docs/superpowers/specs/2026-07-11-owasp-input-hardening-design.md`.

- [x] **Step 2: Update security inventory**

Add a canonical SQLi/XSS/CSRF guardrails section to `docs/security.md`.

- [x] **Step 3: Update changelog**

Record the harness and PDF sink hardening in `CHANGELOG.md`.

## Task 4: Validation, Review, Commit

- [x] **Step 1: Run focused tests**

```bash
cd apps/bff
node --experimental-strip-types --test src/__tests__/owasp-input-safety-harness.test.ts src/__tests__/idor-write-scope.test.ts src/__tests__/session-guard.test.ts
```

- [x] **Step 2: Run typechecks**

```bash
pnpm --filter @apmcb/bff typecheck
pnpm --filter @apmcb/web typecheck
```

- [x] **Step 3: Request impartial review**

Ask a subagent to review only the files in this task and report severity + score.

- [x] **Step 4: Apply review fixes**

First impartial review scored 7/10 and identified weak SQL bypass coverage, a narrow
CSRF ordering proof, computed XSS sink gaps, and overclaiming in changelog wording.
The harness now includes bypass samples, broader raw SQL sink detection, computed
DOM sink detection, all direct authenticated route ordering checks, and exact CSRF
exemption inventory.

- [x] **Step 5: Final impartial review**

Second impartial review scored 9/10 with no critical/high/medium findings and
released commit/push. Residual risk remains documented as static-regression
coverage, not a replacement for DAST/pentest.

- [x] **Step 6: Commit and push**

```bash
git add apps/bff/src/__tests__/owasp-input-safety-harness.test.ts apps/web/src/components/shared/grid-pdf-button.tsx docs/superpowers/specs/2026-07-11-owasp-input-hardening-design.md docs/superpowers/plans/2026-07-11-owasp-input-hardening.md docs/security.md CHANGELOG.md
git commit -m "security(owasp): add input safety harness"
git push origin main
```
