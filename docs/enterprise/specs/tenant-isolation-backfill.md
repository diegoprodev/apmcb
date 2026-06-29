# Spec: Tenant Isolation Backfill — Dívida Técnica C1

**Data:** 2026-06-29  
**Prioridade:** CRÍTICO  
**Autor:** Auditoria de Segurança Global

---

## Problema

O sistema tem RLS habilitado com `tenant_id` nas tabelas de dados, mas o isolamento
não está enforçado para staff porque `default_tenant_id` nos `profiles` está NULL
para a maioria dos usuários de alto privilégio.

### Diagnóstico (dados reais em 2026-06-29)

| Tabela | Situação |
|--------|----------|
| `tenants` | 2 tenants: `pmpb` (ativo, 3 reserves) e `gmb` (inativo, sem reserves) |
| `reserves` | 3 reserves, todas no tenant PMPB |
| `profiles.default_tenant_id` | 276/318 populados; 30 staff (armeiro/admin_reserva/auditor/superadmin) com NULL |
| `tenant_memberships` | 6 entradas — cobertura mínima |
| `reserve_memberships` | 3 entradas — cobertura mínima |

### Causa raiz

Os usuários de staff foram criados antes da implementação do modelo multi-tenant
(ou via seed/admin sem setar o campo de tenant). A coluna `default_tenant_id` existia
mas nunca foi obrigatória na criação de perfil de staff.

### Impacto atual

- Staff com `default_tenant_id = NULL` → RLS com filtro de tenant sempre retorna vazio
- Staff sem `tenant_memberships` → `session.tenantId = null` no BFF → logs e queries sem contexto de tenant
- Impossível enforçar isolamento cross-tenant até popular os dados

---

## Solução

### Fase 1 — Backfill (esta migration)

1. Popular `default_tenant_id` em `profiles` para todo staff sem valor
2. Popular `tenant_memberships` com uma entrada por staff (PMPB = único tenant ativo)
3. Popular `reserve_memberships` para armeiros e admin_reserva com suas reserves
4. Ativar RLS com filtro de tenant nas políticas críticas

### Fase 2 — Enforçamento (próxima sprint)

1. Tornar `default_tenant_id` NOT NULL para roles de staff via check constraint
2. Validar no BFF durante login que `tenantId` nunca é null para staff
3. Adicionar alerta de monitoring para profiles de staff criados sem tenant

### Fase 3 — Multi-tenant real (futuro)

Quando houver mais de um tenant ativo com staff próprio, a lógica de
"assign PMPB como padrão" precisará ser substituída por seleção de tenant
durante o onboarding do usuário.

---

## Regras de negócio

- `superadmin` → acesso GLOBAL (todos os tenants) → NÃO atribuir tenant
- `admin_global` → acesso GLOBAL → NÃO atribuir tenant
- `admin_reserva`, `armeiro`, `auditor` → scoped ao seu tenant → ATRIBUIR tenant
- `usuario` → já tem `default_tenant_id` setado via fluxo de cadastro

### Inferência de tenant para staff existente

Como o sistema tem apenas 1 tenant ativo (PMPB com 3 reserves):
- Todo staff sem `default_tenant_id` → PMPB
- Todo staff → entrada em `tenant_memberships` com PMPB
- Armeiros e admin_reserva → entrada em `reserve_memberships` com a reserva default do PMPB

---

## Validação pós-migration

```sql
-- Todos os staff scoped devem ter tenant
SELECT role, COUNT(*) as total, COUNT(default_tenant_id) as with_tenant
FROM profiles
WHERE role IN ('admin_reserva','armeiro','auditor')
GROUP BY role;
-- Esperado: total = with_tenant para todos

-- tenant_memberships deve cobrir todo o staff scoped
SELECT COUNT(DISTINCT tm.user_id) as covered,
       COUNT(DISTINCT p.id) as total_staff
FROM profiles p
LEFT JOIN tenant_memberships tm ON tm.user_id = p.id
WHERE p.role IN ('admin_reserva','armeiro','auditor');
-- Esperado: covered = total_staff
```
