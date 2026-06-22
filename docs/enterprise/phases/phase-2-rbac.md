# Fase 2 — RBAC Enterprise

> **DoD Canônica:** IMPLEMENTADO NÃO É ENTREGUE — ver `../07-canonical-definition-of-done.md`  
> **Harness ID:** PH-2  
> **Premissa:** Fase 1 concluída — multi-tenant ativo e TT01-TT08 passando

---

## Objetivo

Expandir o sistema de controle de acesso de 3 roles (admin/master/usuario) para 6 roles institucionais (superadmin/admin_global/admin_reserva/armeiro/usuario/auditor), com roleGuard atualizado em todos os endpoints e UI adaptada para esconder/mostrar funcionalidades por role.

---

## Escopo

- Novo tipo `Role` com 6 valores
- `SessionData.role` tipado com novos roles
- `HonoVariables` expandido
- `roleGuard()` atualizado para todos os endpoints
- Migration de atualização de profiles existentes (admin→admin_global, master→armeiro)
- Suite E2E `e2e/rbac.spec.ts` com PT01-PT08+
- UI: sidebar e menus adaptados para esconder itens por role

---

## Fora do Escopo

- ❌ Permissões granulares por feature (apenas role-level nesta fase)
- ❌ UI completa de gestão de usuários e roles (Fase 7+)
- ❌ Onboarding de novos militares via convite (já existe, não alterar)
- ❌ Delegação de permissões (ex: admin_global criar admin_reserva) — Fase 7

---

## Premissas

| # | Premissa | Como verificar |
|---|---|---|
| P1 | Fase 1 completa — TT01-TT08 passando | `pnpm test:e2e --project=multitenant-suite` |
| P2 | Estrutura de tenants e unidades ativa | Nexus: GET /api/nexus/tenants retorna dados |

---

## Arquivos Permitidos

**BFF:**
- `apps/bff/src/types/hono.ts` — expandir tipo Role
- `apps/bff/src/middleware/role-guard.ts` — atualizar roleGuard
- `apps/bff/src/lib/session.ts` — SessionData.role tipado
- `apps/bff/src/middleware/auth.ts` — resolver role no login
- `apps/bff/src/routes/*.ts` — aplicar roleGuard em todos os endpoints

**Frontend:**
- `apps/web/src/components/layout/sidebar.tsx` — esconder itens por role
- `apps/web/src/components/layout/bottom-nav.tsx` — idem
- `apps/web/src/hooks/use-role.ts` — expandir para novos roles
- `apps/web/src/app/(dashboard)/layout.tsx` — guard por role

**Database:**
- `supabase/migrations/20260620000002_rbac_roles.sql` — enum + migration de dados

**Testes:**
- `apps/web/e2e/rbac.spec.ts` — nova suite
- `apps/web/playwright.config.ts` — adicionar `rbac-suite`

## Arquivos Proibidos

| Arquivo | Motivo |
|---|---|
| `apps/bff/src/routes/auth.ts` | Não tocar — auth separada de RBAC |
| `supabase/migrations/20260611*.sql` | Nunca alterar migrations existentes |
| `apps/web/src/components/ui/*.tsx` | Design system — não tocar |

---

## Tabelas Permitidas

| Tabela | Operação | Justificativa |
|---|---|---|
| `profiles` | ALTER — UPDATE role values | Migrar roles existentes para novos valores |

## Tabelas Proibidas

Todas as demais — RBAC é uma mudança de código e enum, não de schema.

---

## Endpoints Envolvidos

Nenhum novo endpoint. Aplicar roleGuard em todos os existentes:

| Método | Path | Roles permitidos |
|---|---|---|
| `POST` | `/api/lendings` | armeiro, admin_reserva, admin_global |
| `PATCH` | `/api/lendings/:id/return` | armeiro, admin_reserva, admin_global |
| `GET` | `/api/lendings` | armeiro, admin_reserva, admin_global, usuario, auditor |
| `POST` | `/api/ssa` | usuario, armeiro |
| `PATCH` | `/api/ssa/:id/approve` | armeiro, admin_reserva |
| `GET` | `/api/dashboard/summary` | admin_reserva, admin_global |
| `GET` | `/api/nexus/*` | superadmin (nexus) |
| `POST` | `/api/nexus/tenants` | superadmin (nexus) |

---

## Componentes de UI Envolvidos

| Componente | Ação |
|---|---|
| `sidebar.tsx` | Esconder itens de menu baseado em role |
| `bottom-nav.tsx` | Idem para mobile |
| `use-role.ts` | Expandir helpers de role |
| `(dashboard)/layout.tsx` | Guard de redirect por role |

---

## Feature Flags

N/A — migração direta, não precisa de feature flag.

---

## Migrações Necessárias

**Arquivo:** `supabase/migrations/20260620000002_rbac_roles.sql`

```sql
-- 1. Adicionar CHECK constraint para novos roles (via cast/update)
-- Nota: não usar ENUM do PostgreSQL — difícil de migrar
-- Usar TEXT com CHECK constraint

ALTER TABLE profiles
  ADD CONSTRAINT profiles_role_check
    CHECK (role IN ('superadmin','admin_global','admin_reserva','armeiro','usuario','auditor'));

-- 2. Migrar roles existentes
UPDATE profiles SET role = 'admin_global' WHERE role = 'admin';
UPDATE profiles SET role = 'armeiro' WHERE role = 'master';
-- 'usuario' → 'usuario' (sem mudança)

-- 3. Inserir superadmin padrão (se não existir)
-- O superadmin do Nexus deve ter role = 'superadmin'
UPDATE profiles SET role = 'superadmin'
WHERE id = (SELECT id FROM profiles WHERE role = 'admin_global' ORDER BY created_at LIMIT 1)
  AND EXISTS (SELECT 1 FROM profiles WHERE role = 'admin_global');
```

**Rollback:**
```sql
-- Rollback de migration
UPDATE profiles SET role = 'admin' WHERE role IN ('admin_global', 'superadmin');
UPDATE profiles SET role = 'master' WHERE role = 'armeiro';
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
```

---

## Plano de Dados / Seed

Criar usuários de teste com cada role:
- `superadmin@teste.com` — role=superadmin
- `admin.global@teste.com` — role=admin_global
- `admin.reserva@teste.com` — role=admin_reserva
- `armeiro@teste.com` — role=armeiro
- `usuario@teste.com` — role=usuario
- `auditor@teste.com` — role=auditor

---

## Testes E2E

**Arquivo:** `apps/web/e2e/rbac.spec.ts`  
**Projeto:** `rbac-suite`

| ID | Teste | Critério |
|---|---|---|
| PT01 | `usuario` tenta POST /api/lendings | 403 Forbidden |
| PT02 | `armeiro` tenta GET /api/nexus/health | 403 Forbidden |
| PT03 | `admin_reserva` tenta criar tenant via Nexus | 403 Forbidden |
| PT04 | `auditor` tenta PATCH em qualquer recurso | 403 Forbidden |
| PT05 | `armeiro` emite cautela da sua unidade | 201 Created |
| PT06 | `admin_global` vê todos os usuários do tenant | 200 com N resultados |
| PT07 | Role forjado no body é ignorado (usa sessão) | Role da sessão é usado |
| PT08 | `superadmin` acessa Nexus após 2FA | 200 |

---

## Testes de Segurança

| ID | Cenário | Resultado esperado |
|---|---|---|
| SEC-2-01 | Role no payload da request forjado | BFF ignora — usa sessão |
| SEC-2-02 | Escalada: armeiro tentando POST /api/nexus/* | 403 |
| SEC-2-03 | Admin_global de tenant A acessando tenant B | 0 resultados (RLS) |
| SEC-2-04 | Usuario sem role em profiles | 401 ou role padrão recusado |

---

## Testes de Regressão

```bash
cd apps/web
pnpm test:e2e --project=chromium
pnpm test:e2e --project=suite
pnpm test:e2e --project=ssa-suite
pnpm test:e2e --project=nexus-suite
pnpm test:e2e --project=rate-limit
pnpm test:e2e --project=multitenant-suite  # Fase 1
pnpm test:e2e --project=rbac-suite         # NOVA
```

---

## Critérios de Aceite

| # | Critério | Bloqueio? |
|---|---|---|
| CA01 | PT01: role insuficiente → 403 | ✅ BLOQUEIO |
| CA02 | PT02-PT08 passando | ✅ Sim |
| CA03 | Nenhuma escalada de privilégio detectada | ✅ BLOQUEIO |
| CA04 | Regressão completa verde | ✅ BLOQUEIO |
| CA05 | Sidebar esconde itens corretamente por role | Sim |
| CA06 | Roles existentes migrados corretamente | ✅ Sim |

---

## Validação sob Estresse — RBAC

1. usuario tenta ação de armeiro → 403
2. armeiro tenta ação de admin → 403
3. admin_reserva tenta ação de admin_global → 403
4. auditor tenta editar dados → 403
5. superadmin sem tenant operacional tenta acessar dado sensível → correto (usa service_role)

---

## Definition of Done da Fase 2

### 1. Critérios Funcionais
- [ ] 6 roles funcionando corretamente
- [ ] UI exibe menu correto por role
- [ ] Roles migrados no banco

### 2. Critérios Técnicos
- [ ] Build passa
- [ ] Typecheck passa (sem `any` em Role)
- [ ] Lint passa
- [ ] Migration aplicada

### 3. Critérios de Segurança
- [ ] roleGuard aplicado em todos os endpoints
- [ ] PT01: role insuficiente → 403 ✅ BLOQUEIO
- [ ] Nenhuma escalada de privilégio

### 4. Auditoria
- [ ] Mudança de role logada em audit_logs

### 5. Multi-tenant
- [ ] RBAC não quebrou isolamento de tenant

### 6. RBAC
- [ ] PT01-PT08 passando ✅ BLOQUEIO

### 7. UI
- [ ] Sidebar/nav correto por role
- [ ] Mobile testado

### 8. Performance
- [ ] roleGuard tem overhead < 5ms

### 9. Regressão
- [ ] `rbac-suite`: 8/8 passando
- [ ] `multitenant-suite`: 8/8 passando (sem regressão)
- [ ] Demais suites passando

### 10. Evidências
- [ ] Screenshot `rbac-suite: 8+/8+ passed`
- [ ] Output `pnpm typecheck` sem erros
- [ ] Relatório em `docs/enterprise/reports/phase-2-final-report.md`

---

*Fase 2 — RBAC Enterprise v1.0 — 2026-06-20*
