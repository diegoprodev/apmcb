# Fase 1 — Multi-tenant Foundation

> **DoD Canônica:** IMPLEMENTADO NÃO É ENTREGUE — só é considerado entregue com validação E2E real (`pnpm test:e2e` 0 falhas)
> **Harness ID:** PH-1
> **Status:** Implementation Slice 1A — VALIDADO (TT01–TT14 passando)
> **Premissa:** Fase 0 concluída com 0 falhas em todas as suites

---

## Correção Arquitetural (em relação ao harness original)

O harness original usava o modelo incorreto. A correção foi aplicada em Slice 1A:

| Campo | Harness Original (ERRADO) | Modelo Correto |
|-------|--------------------------|----------------|
| Tenant | APMCB | **PMPB (Polícia Militar da Paraíba)** |
| Entidade operacional | `unidades` | **`reserves`** (unidade de armamento) |
| Estrutura intermediária | inexistente | **`org_units`** (DEC dentro da PMPB) |
| Modo de estrutura | fixo | **`structure_mode`: 'simple' \| 'structured'** |
| Isolamento | tenant → unidade | **tenant → org_unit (opcional) → reserve** |

---

## Objetivo

Adicionar isolamento multi-tenant real com hierarquia correta:

```
Tenant (PMPB) [structure_mode='structured']
  └── Org Unit (DEC)
        └── Reserve (APMCB)
```

E também suportar modo simples (ex: Guarda Municipal):

```
Tenant (Guarda Municipal) [structure_mode='simple']
  └── Reserve (Reserva Central) [org_unit_id = NULL]
```

---

## Modelo de Dados

### Tabelas criadas em Slice 1A

```
tenants
  id UUID PK
  nome TEXT
  slug TEXT UNIQUE              ← chave natural ('pmpb', 'gm-santa-rita')
  tipo_orgao TEXT DEFAULT 'pm'
  estado CHAR(2)
  structure_mode TEXT           ← 'simple' | 'structured'
  status TEXT DEFAULT 'ativo'
  created_at / updated_at
```

```
org_units                       ← só para structure_mode='structured'
  id UUID PK
  tenant_id UUID → tenants(id)
  parent_org_unit_id UUID → org_units(id)   ← hierarquia futura
  nome TEXT
  acronym TEXT
  type TEXT                     ← diretoria, batalhao, companhia, etc.
  status TEXT
```

```
reserves                        ← unidade operacional de armamento
  id UUID PK
  tenant_id UUID → tenants(id)  ← OBRIGATÓRIO
  org_unit_id UUID → org_units(id)  ← OPCIONAL (NULL para modo simples)
  nome TEXT
  acronym TEXT UNIQUE            ← 'APMCB', 'RC-SMRTA'
  logo_url TEXT
  status TEXT DEFAULT 'ativa'
  CONSTRAINT reserves_org_unit_same_tenant
    (org_unit de outro tenant é rejeitado)
```

```
tenant_memberships              ← usuário pertence ao tenant
  tenant_id → tenants(id)
  user_id → profiles(id)
  role role_enum
  UNIQUE (tenant_id, user_id)
```

```
reserve_memberships             ← staff operacional da reserva
  reserve_id → reserves(id)
  user_id → profiles(id)
  role TEXT                     ← 'admin_reserva' | 'armeiro' | 'auditor_reserva'
  UNIQUE (reserve_id, user_id)
```

```
user_reserve_preferences        ← reserva favorita/recente por usuário
  user_id → profiles(id)
  reserve_id → reserves(id)
  selection_count INT
  is_favorite BOOLEAN
```

### Regra do Militar Comum

> **Militar com `tenant_membership` ativo pode listar e selecionar qualquer
> `reserve` ativa do tenant SEM precisar de `reserve_membership`.**
>
> `reserve_membership` é exclusivo de papéis operacionais (armeiro, admin_reserva,
> auditor_reserva). Um cadete não precisa de reserve_membership para solicitar
> atendimento na APMCB.

### Seed PMPB (20260620000001c_seed_pmpb.sql)

```sql
tenants:    PMPB | slug='pmpb' | structured
org_units:  DEC  | tenant=PMPB | diretoria
reserves:   APMCB | tenant=PMPB | org_unit=DEC
```

---

## Escopo Implementado (Slice 1A)

### Database
- [x] Migration `20260620000001_multitenant_foundation.sql` — tabelas: tenants, org_units, reserves, tenant_memberships, reserve_memberships, user_reserve_preferences + ALTER em: profiles, material_types, lendings, material_requests, material_request_items, totp_secrets, biometric_templates, audit_logs, notifications
- [x] Migration `20260620000001b_material_items.sql` — material_items com status_operacional
- [x] Seed `20260620000001c_seed_pmpb.sql` — PMPB/DEC/APMCB + migração de dados existentes + tenant_memberships para todos os profiles

### BFF
- [x] `session.ts` — SessionData com `tenantId`, `reserveId`
- [x] `auth.ts` — `POST /api/auth/login` popula tenantId/reserveId da sessão; `POST /api/auth/exchange` cria iron-session a partir de token Supabase (magic link/invite sem expor token ao browser)
- [x] `middleware/auth.ts` — iron-session + Bearer token fallback
- [x] `middleware/rate-limit.ts` — separação: login 5/15min, exchange 120/min, geral 120/min
- [x] `routes/nexus.ts` — endpoints: GET/POST /tenants, GET/POST /tenants/:id/org-units, GET/POST /tenants/:id/reserves, GET/POST /nexus/reserves/:id/members
- [x] `routes/admin.ts` — GET /api/admin/estrutura (admin vê org_units + reserves do próprio tenant)
- [x] `index.ts` — authMiddleware para /api/admin/*
- [x] Rotas existentes — filtro tenant_id aplicado

### Frontend
- [x] Remoção de todos os hardcodes "APMCB" do login, sidebar, header, layout, nexus
- [x] `/admin/estrutura` — página de gestão de estrutura (Admin Global)
- [x] `/nexus/tenants` — gestão de tenants (Superadmin)
- [x] `/auth/exchange` — troca de tokens sem armazenar em localStorage (iron-session via BFF)

### Auth Flow (correto)
```
Magic link / Invite → Supabase → /auth/exchange#access_token=...
  → /auth/exchange/page.tsx
  → POST /api/auth/exchange (BFF)          ← tokens validados aqui
  → iron-session criada com userId, role, tenantId, reserveId
  → redirect para /admin | /reserva | /cadete
  [TOKENS NUNCA FICAM NO BROWSER STORAGE]
```

---

## Fora do Escopo (Slice 1A)

- ❌ RBAC enterprise completo (6 roles) — Fase 2
- ❌ audit_events com hash — Fase 3
- ❌ UI de onboarding de novos tenants — pós-Fase 2
- ❌ RLS completa com claims JWT — Fase 2 (atualmente por tenant_memberships lookup)
- ❌ Múltiplos org_units aninhados por tenant — Fase 2

---

## Endpoints

| Método | Path | Auth | Role | Ação |
|--------|------|------|------|------|
| POST | `/api/auth/exchange` | — | — | Troca token Supabase por iron-session |
| GET | `/api/auth/me` | iron-session \| Bearer | — | Sessão atual |
| GET | `/api/admin/estrutura` | iron-session \| Bearer | admin / admin_global | org_units + reserves do tenant |
| GET | `/api/nexus/tenants` | nexus | superadmin | Listar todos os tenants |
| POST | `/api/nexus/tenants` | nexus | superadmin | Criar tenant |
| GET | `/api/nexus/tenants/:id/org-units` | nexus | superadmin | Org units do tenant |
| POST | `/api/nexus/tenants/:id/org-units` | nexus | superadmin | Criar org_unit |
| GET | `/api/nexus/tenants/:id/reserves` | nexus | superadmin | Reserves do tenant |
| POST | `/api/nexus/tenants/:id/reserves` | nexus | superadmin | Criar reserve |
| POST | `/api/nexus/reserves/:id/members` | nexus | superadmin | Adicionar membro operacional |

---

## Testes E2E — Suite multitenant-suite (TT01–TT14)

| ID | Cenário | Resultado |
|----|---------|-----------|
| TT01 | Tenant PMPB existe com structure_mode='structured' | ✅ |
| TT02 | Org Unit DEC existe dentro da PMPB | ✅ |
| TT03 | Reserva APMCB existe dentro da DEC | ✅ |
| TT04 | Reserva com org_unit_id=NULL é permitida (modo simples) | ✅ |
| TT05 | org_unit_id de outro tenant é rejeitado pela constraint | ✅ BLOQUEIO |
| TT06 | APMCB NÃO aparece como tenant na lista nexus | ✅ BLOQUEIO |
| TT07 | GET /api/nexus/tenants retorna PMPB (superadmin nexus) | ✅ |
| TT08 | Admin Global PMPB vê DEC e APMCB via /api/admin/estrutura | ✅ |
| TT09 | Cadete (tenant_member) vê reserves ativas da PMPB | ✅ |
| TT10 | Militar sem reserve_membership pode criar solicitação SSA | ✅ BLOQUEIO |
| TT11 | POST /api/nexus/reserves/:id/members sem auth → 401 | ✅ BLOQUEIO |
| TT12 | GET /api/nexus/tenants/:id/reserves sem nexus session → 401 | ✅ BLOQUEIO |
| TT13 | Página de login não contém texto hardcoded "APMCB" | ✅ |
| TT14 | INSERT de tenant gera evento em audit_logs | ✅ |

---

## Status de Deploy (atualizado 2026-06-22)

| Item | Status |
|------|--------|
| BFF exchange endpoint (`POST /api/auth/exchange`) | ✅ deployado — VPS docker compose build+up |
| Rate limiter split (login 5/15min / exchange 120/min / geral 120/min) | ✅ deployado |
| Invite flow: redirectTo `/auth/exchange` (fix PKCE email-initiated) | ✅ deployado |
| BFF: `registration_status=pending` → landAt `/auth/confirmar-conta` | ✅ deployado |
| SSH hardening VPS (fail2ban 24h + recidive 7d + PasswordAuthentication no) | ✅ concluído |
| CF Pages (exchange page, estrutura page, invite route) | ✅ auto-deploy via GitHub main |

---

## Próximos Passos (Fase 1 Completa)

1. Implementar RLS completa com JWT claims (substituir lookup por tenant_memberships)
2. Implementar RBAC enterprise (6 roles) — Fase 2
3. Onboarding de novos tenants via Nexus UI — Fase 2
4. Configurar Resend SMTP no Supabase (eliminar limite 2 emails/hora)
