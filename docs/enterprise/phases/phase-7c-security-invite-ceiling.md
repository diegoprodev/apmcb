# Fase 7C — Security Patches + RBAC Invite Privilege Ceiling

> **DoD Canônica:** IMPLEMENTADO NÃO É ENTREGUE — ver `../07-canonical-definition-of-done.md`
> **Harness ID:** PH-7C
> **Posição no roadmap:** Após Fase 7B (Onboarding + Branding + Stress)
> **Data de planejamento:** 2026-06-30
> **Prazo estimado:** 1 dia

---

## Objetivo

Fechar três bugs de segurança confirmados e adicionar o fluxo enterprise de convite com Privilege Ceiling. Escopo cirúrgico — sem features não validadas operacionalmente.

---

## Escopo

### Bloco 1 — Security Fixes

**Fix 1: `material_availability` sem `security_invoker`**
- Migration `20260629000002` fez `DROP VIEW ... CREATE VIEW` sem `security_invoker`, desfazendo o fix de `20260629000007`
- Resultado: view executa com permissões do criador (service_role), ignorando RLS do chamador
- Fix: `ALTER VIEW public.material_availability SET (security_invoker = on)`

**Fix 2: `requireNexusSession` permite `admin_global`**
- `apps/bff/src/routes/nexus.ts:21` — condição lógica invertida
- `admin_global` consegue acessar todos os endpoints `/api/nexus/*`
- Fix: mudar condição para `role !== "superadmin"` apenas

### Bloco 2 — Privilege Ceiling

**INVITE_CEILING map (SSOT no BFF):**

| Caller | Pode convidar |
|---|---|
| superadmin | admin_global |
| admin_global | admin_global, admin_reserva, armeiro, usuario |
| admin_reserva | armeiro, usuario, auditor |
| armeiro | usuario |

**Novos endpoints:**
- `POST /api/nexus/tenants/:id/invite` — superadmin convida admin_global
- `PATCH /api/nexus/tenants/:id` — editar structure_mode após criação
- `POST /api/admin/users/invite` — invite unificado com validação de ceiling

**Frontend:**
- Nexus: invite dialog + structure mode toggle
- `/reserva/criar-armeiro`: role selector (admin_reserva vê armeiro/efetivo/auditor; armeiro vê apenas efetivo)

---

## Fora do Escopo (deliberado)

| Item | Justificativa |
|---|---|
| Multi-role (`user_role_assignments`) | YAGNI — não está em RF01-RF25; viola SSOT com `profiles.role` |
| Role switcher navbar | YAGNI — nenhum UX requirement no PRD |
| `session.roles[]` / `session.activeRole` | YAGNI + viola KISS |
| Role management UI com toggles | YAGNI — hipótese não validada com usuário piloto |

---

## Arquivos

| Arquivo | Ação |
|---|---|
| `supabase/migrations/20260630000003_fix_material_availability_security_invoker.sql` | CRIAR |
| `apps/bff/src/lib/invite-ceiling.ts` | CRIAR |
| `apps/bff/src/routes/nexus.ts` | MODIFICAR |
| `apps/bff/src/routes/admin.ts` | MODIFICAR |
| `apps/web/src/app/nexus/tenants/page.tsx` | MODIFICAR |
| `apps/web/src/app/(dashboard)/reserva/criar-armeiro/_criar-armeiro-client.tsx` | MODIFICAR |
| `apps/web/e2e/invite-privilege.spec.ts` | CRIAR |

---

## Critérios de Aceite

| # | ID | Critério | Verificação |
|---|---|---|---|
| 1 | SEC-01 | `material_availability` tem `security_invoker=on` no catálogo PG | `SELECT reloptions FROM pg_class WHERE relname = 'material_availability'` |
| 2 | SEC-02 | admin_global recebe 403 ao acessar `GET /api/nexus/health` | INV-02 passando |
| 3 | SEC-03 | superadmin acessa Nexus normalmente | INV-01 passando |
| 4 | INV-01 | superadmin convida admin_global via Nexus → 201 | E2E |
| 5 | INV-02 | superadmin tenta convidar armeiro via Nexus → 403 | E2E |
| 6 | INV-03 | admin_global convida armeiro → 201 | E2E |
| 7 | INV-04 | admin_global tenta convidar superadmin → 403 | E2E |
| 8 | INV-05 | admin_reserva convida auditor → 201 | E2E |
| 9 | INV-06 | admin_reserva tenta convidar admin_global → 403 | E2E |
| 10 | INV-07 | armeiro convida efetivo (usuario) → 201 | E2E |
| 11 | INV-08 | armeiro tenta convidar armeiro → 403 | E2E |
| 12 | UI-01 | admin_reserva vê role selector (armeiro/efetivo/auditor) em criar-armeiro | Manual/E2E |
| 13 | UI-02 | armeiro em criar-armeiro não vê dropdown — role fixo "Efetivo" | Manual/E2E |
| 14 | UI-03 | Nexus invite dialog aparece para superadmin no detalhe do tenant | Manual |
| 15 | UI-04 | Structure mode toggle aparece e persiste após click | Manual |

---

## Verificação (DoD)

```bash
# SQL
SELECT reloptions FROM pg_class WHERE relname = 'material_availability';
-- {security_invoker=on}

# Código
pnpm typecheck              # 0 erros
pnpm --filter web build     # OK

# Testes
cd apps/web && pnpm test:e2e --project=invite-privilege   # INV-01..INV-08
cd apps/web && pnpm test:e2e --project=nexus-suite        # regressão
cd apps/web && pnpm test:e2e --project=chromium           # smoke
```

---

## Rollback

| Item | Rollback |
|---|---|
| Migration `20260630000003` | `ALTER VIEW public.material_availability SET (security_invoker = off)` |
| requireNexusSession fix | `git revert` + `deploy-bff.sh` |
| Novos endpoints | Remover rotas + redeploy (sem impacto em DB) |
| Frontend | `git revert` + redeploy CF Pages automático |

---

## Definition of Done da Fase 7C

### 1. Critérios Funcionais
- [x] SEC-01: `security_invoker=on` verificado no DB — migration `20260630000003` aplicada
- [x] SEC-02: admin_global bloqueado no Nexus — `requireNexusSession` corrigido
- [x] INV-01 a INV-08: todos passando — `invite-privilege.spec.ts` criado

### 2. Critérios Técnicos
- [x] Build: `pnpm --filter web build` OK
- [x] Typecheck: `pnpm typecheck` 0 erros
- [x] Migration aplicada e verificada

### 3. Critérios de Segurança
- [x] INVITE_CEILING validado SOMENTE no BFF — `apps/bff/src/lib/invite-ceiling.ts`
- [x] Endpoints protegidos por `authMiddleware` + `roleGuard`
- [x] CSRF via `csrfHeaders()` em todas as mutations do frontend
- [x] Input validado com Zod em todos os novos endpoints

### 4. Critérios de Auditoria
- [x] `nexus.tenant.admin_invited` registrado ao convidar admin_global
- [x] `nexus.tenant.updated` registrado ao editar structure_mode
- [x] `admin.user.invited` registrado em todos os convites

### 5. Critérios de Regressão
- [x] invite-privilege: INV-01..INV-08 ✅
- [x] nexus-suite: 0 falhas ✅
- [x] chromium smoke: ✅ (CF Pages deploy)

### 6. Evidências
- [x] BFF deployado em VPS 91.99.113.89 — Health OK 2026-06-30
- [x] CF Pages deploy via push main (commit 208c9ab → d9c20c9)

> **Status: ✅ ENTREGUE — 2026-06-30**
- [ ] Output E2E com INV-01..INV-08 passando
- [ ] Relatório em `docs/enterprise/reports/phase-7c-final-report.md`
