# Material Categories UX - DoD Evidence

Date: 2026-06-28
Commit under validation: ab523ed
Scope: Almoxarifado category tab, quick category creation, explicit category dropdown, material metadata fields.

## Scope Verified

- `/reserva/arsenal` exposes `Materiais` and `Categorias` tabs for `armeiro` and `admin_reserva`.
- `admin_reserva` can manage categories directly from the category tab.
- `armeiro` can view categories and use/create a category inside the material addition request, preserving admin-reserva approval.
- Category fields now expose an explicit dropdown arrow for existing categories and a separate `+` action for quick category creation.
- Category metadata continues to activate caliber, validity, serial and vehicle fields.

## Validation Evidence

- BFF unit tests: `node --experimental-strip-types --test apps/bff/src/__tests__/audit-hash.test.ts apps/bff/src/__tests__/totp-guard.test.ts apps/bff/src/__tests__/material-metadata.test.ts` = 24 passed.
- Typecheck: `pnpm typecheck` = 3 workspaces passed.
- Lint: `pnpm lint` = passed with existing warnings, 0 errors.
- Build: `pnpm --filter web build` = passed.
- Remote DB: `supabase migration list` confirmed `20260628000004` applied locally and remotely.
- GitHub Actions for `ab523ed`: CI and CI/CD passed; BFF deploy and smoke passed.
- Production Playwright: `E2E_BASE_URL=https://apmcb.pmpb.online E2E_BFF_URL=https://api.apmcb.pmpb.online pnpm exec playwright test e2e/arsenal-profile-feedback.spec.ts --project=arsenal-profile-feedback --workers=1` = 10 passed.

## Notes

- `superadmin` remains outside internal reserve data management.
- `admin_global` remains without direct mutation action in Almoxarifado.
- Category creation by `armeiro` remains part of the material request payload and only takes effect after `admin_reserva` approval.
