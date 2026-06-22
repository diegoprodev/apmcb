# Fase 8 — Inventário Periódico

> **DoD Canônica:** IMPLEMENTADO NÃO É ENTREGUE — ver `../07-canonical-definition-of-done.md`  
> **Harness ID:** PH-8  
> **Premissa:** Fase 7 concluída — dashboard de comando com DASH01-DASH05 passando

---

## Objetivo

Implementar sistema de inventário periódico com campanhas por tenant, conferência por unidade e item, assinatura do responsável pela unidade e relatório consolidado com verificação de conformidade.

---

## Escopo

- Novas tabelas: `inventory_campaigns`, `inventory_unit_checks`, `inventory_item_checks`
- Fluxo: planejamento → conferência por unidade → assinatura → consolidação → relatório
- PDF de relatório de inventário com assinatura e hash verificável
- Card de inventário no dashboard de comando (Fase 7)
- Suite E2E INV01-INV05

---

## Fora do Escopo

- ❌ Inventário rotativo / parcial (apenas campanha completa por escopo)
- ❌ Exportação de divergências para sistemas externos
- ❌ Integração com biometria para inventário (futuro)

---

## Arquivos Permitidos

**BFF:**
- `apps/bff/src/routes/inventory.ts` — CRIAR (endpoints de campanha)
- `apps/bff/src/lib/pdf/inventory-pdf.ts` — CRIAR (PDF de relatório)

**Frontend:**
- `apps/web/src/app/(dashboard)/admin/inventario/page.tsx` — CRIAR
- `apps/web/src/components/admin/inventory-card.tsx` — CRIAR

**Database:**
- `supabase/migrations/20260620000008_inventory.sql` — nova migration

**Testes:**
- `apps/web/e2e/inventory.spec.ts` — nova suite
- `apps/web/playwright.config.ts` — adicionar `inventory-suite`

---

## Migration

**Arquivo:** `supabase/migrations/20260620000008_inventory.sql`

```sql
CREATE TABLE IF NOT EXISTS inventory_campaigns (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id),
  nome                TEXT NOT NULL,
  escopo_categorias   TEXT[],                -- null = todas as categorias
  unidades_ids        UUID[],                -- null = todas as unidades
  prazo_inicio        TIMESTAMPTZ,
  prazo_fim           TIMESTAMPTZ NOT NULL,
  anexo_obrigatorio   BOOLEAN DEFAULT false,
  status              TEXT DEFAULT 'planejado'
    CHECK (status IN ('planejado','em_andamento','em_revisao','concluido','cancelado')),
  criado_por          UUID NOT NULL REFERENCES profiles(id),
  pdf_storage_path    TEXT,
  document_hash       TEXT,
  created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory_unit_checks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  campaign_id     UUID NOT NULL REFERENCES inventory_campaigns(id),
  unidade_id      UUID NOT NULL REFERENCES unidades(id),
  responsavel_id  UUID REFERENCES profiles(id),
  status          TEXT DEFAULT 'pendente'
    CHECK (status IN ('pendente','em_andamento','concluido','divergencia')),
  observacao      TEXT,
  signature_id    UUID REFERENCES document_signatures(id),
  concluido_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory_item_checks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  unit_check_id   UUID NOT NULL REFERENCES inventory_unit_checks(id),
  material_type_id UUID NOT NULL REFERENCES material_types(id),
  qtd_esperada    INT NOT NULL,
  qtd_contada     INT,
  status          TEXT DEFAULT 'pendente'
    CHECK (status IN ('pendente','conforme','divergencia')),
  divergencia_desc TEXT,
  conferido_por   UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_tenant ON inventory_campaigns(tenant_id);
CREATE INDEX IF NOT EXISTS idx_unit_checks_campaign ON inventory_unit_checks(campaign_id);
CREATE INDEX IF NOT EXISTS idx_item_checks_unit ON inventory_item_checks(unit_check_id);
```

---

## Endpoints

| Método | Path | Role | Ação |
|---|---|---|---|
| `POST` | `/api/inventory/campaigns` | admin_global | CRIAR campanha |
| `GET` | `/api/inventory/campaigns` | admin_global, admin_reserva, auditor | LISTAR |
| `GET` | `/api/inventory/campaigns/:id` | admin_global, admin_reserva, auditor | DETALHAR |
| `POST` | `/api/inventory/campaigns/:id/start` | admin_global | INICIAR campanha |
| `GET` | `/api/inventory/unit-checks/:id` | admin_reserva, armeiro | CONFERÊNCIA da unidade |
| `POST` | `/api/inventory/unit-checks/:id/items/:item_id/check` | armeiro, admin_reserva | CONFERIR item |
| `POST` | `/api/inventory/unit-checks/:id/sign` | admin_reserva | ASSINAR unidade |
| `POST` | `/api/inventory/campaigns/:id/close` | admin_global | FECHAR campanha + PDF |
| `GET` | `/api/inventory/campaigns/:id/pdf` | admin_global, auditor | BAIXAR PDF |

---

## Testes E2E

**Arquivo:** `apps/web/e2e/inventory.spec.ts`  
**Projeto:** `inventory-suite`

| ID | Teste | Critério |
|---|---|---|
| INV01 | Criar campanha → carga esperada calculada | inventory_item_checks criados por unidade |
| INV02 | Unidade B não vê carga de unidade A | 0 itens de outra unidade |
| INV03 | Divergência sem justificativa bloqueada | 422 |
| INV04 | Fechar campanha sem todas unidades assinadas | 422 |
| INV05 | PDF gerado após fechamento com hash verificável | PDF em Storage, hash verificável |

---

## Critérios de Aceite

| # | Critério | Bloqueio? |
|---|---|---|
| CA01 | INV01: carga esperada calculada automaticamente | ✅ Sim |
| CA02 | INV02: isolamento por unidade | ✅ BLOQUEIO |
| CA03 | INV03: divergência sem justificativa → 422 | ✅ Sim |
| CA04 | INV04: fechar sem todas assinadas → 422 | ✅ BLOQUEIO |
| CA05 | INV05: PDF gerado com hash verificável | ✅ Sim |
| CA06 | Regressão completa verde | ✅ BLOQUEIO |

---

## Definition of Done da Fase 8

### 1. Critérios Funcionais
- [ ] INV01-INV05 passando
- [ ] PDF de relatório gerado e verificável
- [ ] Dashboard de comando atualizado com card de inventário

### 2. Critérios Técnicos
- [ ] Build passa, typecheck passa, migration aplicada

### 3-6. Critérios de Segurança, Auditoria, Multi-tenant, RBAC
- [ ] Campanha filtrada por tenant_id
- [ ] Unidade filtrada por unidade_id
- [ ] roleGuard em todos os endpoints
- [ ] Criação e fechamento geram audit_events

### 7. UI
- [ ] Card de campanha no dashboard de comando
- [ ] Progresso de conferência por unidade visível
- [ ] Mobile testado

### 8-10. Performance, Regressão, Evidências
- [ ] `inventory-suite`: 5/5 passando
- [ ] Fases anteriores: todos passando
- [ ] Relatório em `docs/enterprise/reports/phase-8-final-report.md`

---

*Fase 8 — Inventário Periódico v1.0 — 2026-06-20*
