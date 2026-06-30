# Fase 7D — Ícones de Unidade + Atribuição de Admin por Reserva

> **DoD Canônica:** IMPLEMENTADO NÃO É ENTREGUE — ver `../07-canonical-definition-of-done.md`
> **Harness ID:** PH-7D
> **Posição no roadmap:** Após Fase 7C (Security + Invite Ceiling)
> **Data de planejamento:** 2026-06-30
> **Prazo estimado:** 1 dia

---

## Contexto

A página `/admin/estrutura` **já existe** e já funciona:
- Modo simples (`structure_mode=simple`): lista plana de reservas
- Modo estruturado (`structure_mode=structured`): hierarquia org_unit → reservas vinculadas
- Toggle de structure_mode criado na Fase 7C (via Nexus)
- `org_units` e `reserves` existem no banco com RLS multi-tenant

**O que falta:**
1. `org_units` não tem `icon_name` — todas mostram o mesmo ícone genérico `Building2`
2. `reserves` não tem admin_reserva atribuído (sem UI de assignment)
3. Modo simples: não deve mostrar o menu "Nova Unidade" (já correto no código, mas confirmar)

---

## Escopo

### Bloco 1 — Ícones para Unidades Organizacionais

**DB:** Adicionar coluna `icon_name text DEFAULT 'building2'` em `org_units`

**Ícones disponíveis (picker curado):**

| Tipo sugerido | Ícone | Nome Lucide |
|---|---|---|
| Batalhão | 🛡️ | `shield` |
| Companhia | 🏢 | `building2` |
| Pelotão | 👥 | `users` |
| Seção | 📋 | `clipboard` |
| Diretoria | ⭐ | `star` |
| Guarda | 🔒 | `lock` |
| Secretaria | 📁 | `folder` |
| Centro | 🎯 | `target` |
| Depósito | 📦 | `archive` |
| Outro | 📌 | `map-pin` |

O picker é um grid de 10 ícones. Ao selecionar, o ícone substitui o `Building2` genérico no header de cada unidade.

**API:** Atualizar `POST /api/nexus/tenants/:id/org-units` para aceitar `icon_name`
**API:** Atualizar `GET /api/admin/estrutura` para retornar `icon_name`
**Frontend:** Adicionar icon picker no dialog "Nova Unidade Organizacional"
**Frontend:** Substituir `<Building2>` genérico pelo ícone salvo no header do card

### Bloco 2 — Atribuição de Admin Reserva por Reserva

Cada reserva pode ter um admin_reserva responsável. O admin_global:
1. Vê quem é o admin atual da reserva (se houver) no `ReserveRow`
2. Pode convidar novo admin_reserva via `POST /api/admin/users/invite` com `reserve_id`
3. Pode ver o botão "Convidar Admin" inline no `ReserveRow`

**API:** `GET /api/admin/estrutura` deve retornar, para cada reserva, o perfil do admin_reserva atual (join em `reserve_memberships` onde `role = 'admin_reserva'`)
**Frontend:** `ReserveRow` exibe nome do admin atual (ou "Sem admin") + botão de convite

### Bloco 3 — Feature Gate por structure_mode

- `isStructured = tenant.structure_mode === "structured"` já existe no código
- Modo simples: botão "Nova Unidade" já está oculto (ok); confirmar que o menu lateral também não mostra opções de unidade
- Modo estruturado: mostrar hierarquia completa com ícones
- **Nenhuma alteração necessária** neste bloco — já funciona corretamente

---

## Arquivos a Modificar

| Arquivo | Ação |
|---|---|
| `supabase/migrations/20260701000001_org_units_icon_name.sql` | CRIAR — ADD COLUMN icon_name |
| `apps/bff/src/routes/nexus.ts` | MODIFICAR — aceitar icon_name no POST org-units |
| `apps/bff/src/routes/admin.ts` | MODIFICAR — retornar icon_name + admin_reserva em GET estrutura |
| `apps/web/src/app/(dashboard)/admin/estrutura/page.tsx` | MODIFICAR — icon picker + admin assignment |
| `apps/web/e2e/estrutura-icon.spec.ts` | CRIAR — DEP-01..DEP-06 |

---

## Migration

```sql
-- 20260701000001_org_units_icon_name.sql
ALTER TABLE org_units ADD COLUMN IF NOT EXISTS icon_name text NOT NULL DEFAULT 'building2'
  CHECK (icon_name IN (
    'shield','building2','users','clipboard','star','lock',
    'folder','target','archive','map-pin','flag','layers',
    'award','briefcase','wrench','radio','key','badge-check'
  ));
```

---

## Critérios de Aceite

| # | ID | Critério | Verificação |
|---|---|---|---|
| 1 | DEP-01 | Criar org_unit com icon_name="shield" → retorna icon_name na listagem | E2E |
| 2 | DEP-02 | Ícone correto exibido no header do card da unidade (não Building2 genérico) | Manual |
| 3 | DEP-03 | Icon picker exibe 10+ ícones, seleção persiste | Manual |
| 4 | DEP-04 | GET /api/admin/estrutura retorna `admin_reserva` por reserva (ou null) | E2E |
| 5 | DEP-05 | ReserveRow exibe nome do admin atual ou "Sem admin" | Manual |
| 6 | DEP-06 | Botão "Convidar Admin" no ReserveRow abre dialog com reserve_id pré-preenchido | Manual |
| 7 | DEP-07 | Modo simples: "Nova Unidade" oculto, hierarquia não exibida | Manual |
| 8 | DEP-08 | Cross-tenant: admin_global de tenant B não vê org_units de tenant A | E2E |

---

## Fora do Escopo

| Item | Justificativa |
|---|---|
| Editar ícone de unidade existente | YAGNI — delete + recreate suficiente no MVP |
| Drag-and-drop de reordenação | YAGNI — não há requisito de ordem nas unidades |
| Sub-unidades além do nível existente (parent_org_unit_id) | Já existe na tabela, UI não precisa de hierarquia profunda agora |
| Remoção/arquivamento de unidade | YAGNI — não há fluxo destruttivo validado com piloto |

---

## Definition of Done da Fase 7D

- [x] Migration aplicada: `icon_name` em `org_units` — `20260701000001_org_units_icon_name.sql`
- [x] `pnpm typecheck` — 0 erros
- [x] `pnpm --filter web build` — OK
- [x] DEP-02: ícone dinâmico via `OrgIcon` component (ICON_MAP com 18 entradas)
- [x] DEP-03: icon picker grid 9-col no dialog "Nova Unidade"
- [x] DEP-05: ReserveRow exibe nome do admin_reserva ou link "Convidar admin"
- [x] DEP-06: dialog "Convidar Admin Reserva" com reserve_id pré-preenchido
- [x] DEP-07: "Nova Unidade" condicional em `isStructured`
- [x] BFF: GET estrutura retorna icon_name + admin_reserva por reserva
- [x] BFF: POST/PATCH org-units aceitam icon_name com validação Zod
- [x] Correção bug: criação de org_unit usa `/api/admin/org-units` (era endpoint Nexus)
- [ ] DEP-01: E2E criar org_unit com icon_name → ⏳ aguardando suite `estrutura-icon.spec.ts`
- [ ] DEP-04: E2E GET estrutura retorna admin_reserva → ⏳ aguardando suite
- [ ] DEP-08: E2E cross-tenant isolation → ⏳ aguardando suite
- [ ] Report em `docs/enterprise/reports/phase-7d-final-report.md` → ⏳

> **Status: ⏳ IMPLEMENTADO — aguardando E2E suite estrutura-icon.spec.ts**

---

*Phase 7D v2.0 — 2026-06-30*
*Atualizada após leitura do código existente: `/admin/estrutura` já existe com org_units e reservas.*
*Escopo reduzido a: icon_name + admin assignment. Sem criar do zero.*
