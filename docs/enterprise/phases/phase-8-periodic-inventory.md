# Fase 8 — Inventário Periódico

> **DoD Canônica:** IMPLEMENTADO NÃO É ENTREGUE — ver `../07-canonical-definition-of-done.md`  
> **Harness ID:** PH-8  
> **Premissa:** Fase 7 concluída — dashboard de comando com DASH01-DASH05 passando

---

## Objetivo

Implementar sistema de inventário periódico com campanhas por tenant, conferência por reserva e item, assinatura do admin_reserva responsável e relatório consolidado com hash verificável.

---

## Lógica de Negócio (RBAC)

```
admin_global ──cria campanha──► reserve(s) do tenant
admin_reserva ──cria campanha──► apenas a sua própria reserve

Fluxo de execução:
  1. admin_global OU admin_reserva CRIA campanha (POST /api/inventory/campaigns)
  2. Ao INICIAR (POST /campaigns/:id/start):
       → cria inventory_reserve_checks para cada reserve alvo
       → cria inventory_item_checks com qtd_esperada = material_type.quantidade
  3. admin_reserva ATRIBUI armeiro (PATCH /reserve-checks/:id/assign)
  4. armeiro CONFERE item a item (POST /reserve-checks/:id/items/:item_id/check)
       → divergência sem justificativa → 422
  5. admin_reserva ASSINA (POST /reserve-checks/:id/sign) via TOTP
  6. admin_global FECHA campanha (POST /campaigns/:id/close)
       → todas as reserve_checks devem estar assinadas → 422 se não
       → gera PDF + hash verificável
```

---

## Escopo

- Novas tabelas: `inventory_campaigns`, `inventory_reserve_checks`, `inventory_item_checks`
- Fluxo: criação → início → atribuição → conferência → assinatura → fechamento → PDF
- PDF de relatório com hash SHA-256 verificável
- Card de inventário no dashboard de comando
- Suite E2E INV01-INV10

---

## Fora do Escopo

- ❌ Inventário rotativo / parcial (apenas campanha completa)
- ❌ Exportação para sistemas externos
- ❌ Integração biométrica

---

## Arquivos Permitidos

**BFF:**
- `apps/bff/src/routes/inventory.ts` — CRIAR
- `apps/bff/src/lib/pdf/inventory-pdf.ts` — CRIAR
- `apps/bff/src/index.ts` — montar inventoryRoutes

**Frontend:**
- `apps/web/src/app/(dashboard)/admin/inventario/page.tsx` — CRIAR
- `apps/web/src/components/admin/inventory-card.tsx` — CRIAR
- `apps/web/src/app/(dashboard)/admin/inventario/[id]/page.tsx` — CRIAR (detalhe campanha)

**Database:**
- `supabase/migrations/20260628000001_inventory.sql` — nova migration

**Testes:**
- `apps/web/e2e/inventory.spec.ts` — nova suite (INV01-INV10)
- `apps/web/playwright.config.ts` — adicionar `inventory-suite`

---

## Migration

**Arquivo:** `supabase/migrations/20260628000001_inventory.sql`

```sql
-- inventory_campaigns: campanha por tenant
CREATE TABLE IF NOT EXISTS inventory_campaigns (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  nome              TEXT NOT NULL,
  descricao         TEXT,
  reserve_ids       UUID[],           -- null = todas as reserves do tenant
  prazo_inicio      TIMESTAMPTZ,
  prazo_fim         TIMESTAMPTZ NOT NULL,
  status            TEXT DEFAULT 'planejado'
    CHECK (status IN ('planejado','em_andamento','em_revisao','concluido','cancelado')),
  criado_por        UUID NOT NULL REFERENCES profiles(id),
  pdf_storage_path  TEXT,
  document_hash     TEXT,
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- inventory_reserve_checks: conferência por reserve
CREATE TABLE IF NOT EXISTS inventory_reserve_checks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  campaign_id     UUID NOT NULL REFERENCES inventory_campaigns(id) ON DELETE CASCADE,
  reserve_id      UUID NOT NULL REFERENCES reserves(id),
  responsavel_id  UUID REFERENCES profiles(id),   -- admin_reserva responsável
  armeiro_id      UUID REFERENCES profiles(id),   -- armeiro designado
  status          TEXT DEFAULT 'pendente'
    CHECK (status IN ('pendente','em_andamento','concluido','divergencia')),
  observacao      TEXT,
  signature_id    UUID REFERENCES document_signatures(id),
  concluido_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- inventory_item_checks: conferência item a item
CREATE TABLE IF NOT EXISTS inventory_item_checks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  reserve_check_id UUID NOT NULL REFERENCES inventory_reserve_checks(id) ON DELETE CASCADE,
  material_type_id UUID NOT NULL REFERENCES material_types(id),
  qtd_esperada     INT NOT NULL,
  qtd_contada      INT,
  status           TEXT DEFAULT 'pendente'
    CHECK (status IN ('pendente','conforme','divergencia')),
  divergencia_desc TEXT,
  conferido_por    UUID REFERENCES profiles(id),
  conferido_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_inv_campaigns_tenant ON inventory_campaigns(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inv_reserve_checks_campaign ON inventory_reserve_checks(campaign_id);
CREATE INDEX IF NOT EXISTS idx_inv_reserve_checks_reserve ON inventory_reserve_checks(reserve_id);
CREATE INDEX IF NOT EXISTS idx_inv_item_checks_reserve_check ON inventory_item_checks(reserve_check_id);

-- RLS
ALTER TABLE inventory_campaigns     ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_reserve_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_item_checks   ENABLE ROW LEVEL SECURITY;

-- Policies via service_role (BFF usa service_role — bypass RLS)
CREATE POLICY "service_role_all_campaigns"
  ON inventory_campaigns FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_reserve_checks"
  ON inventory_reserve_checks FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_item_checks"
  ON inventory_item_checks FOR ALL TO service_role USING (true) WITH CHECK (true);
```

---

## Endpoints

| Método | Path | Role(s) | Ação |
|--------|------|---------|------|
| `POST`  | `/api/inventory/campaigns`                            | admin_global, admin_reserva | Criar campanha |
| `GET`   | `/api/inventory/campaigns`                            | admin_global, admin_reserva, auditor | Listar |
| `GET`   | `/api/inventory/campaigns/:id`                        | admin_global, admin_reserva, auditor | Detalhar |
| `POST`  | `/api/inventory/campaigns/:id/start`                  | admin_global, admin_reserva | Iniciar (cria checks) |
| `POST`  | `/api/inventory/campaigns/:id/close`                  | admin_global | Fechar + PDF |
| `GET`   | `/api/inventory/campaigns/:id/pdf`                    | admin_global, admin_reserva, auditor | Download PDF |
| `PATCH` | `/api/inventory/reserve-checks/:id/assign`            | admin_reserva | Atribuir armeiro |
| `GET`   | `/api/inventory/reserve-checks/:id`                   | admin_global, admin_reserva, armeiro | Ver conferência |
| `POST`  | `/api/inventory/reserve-checks/:id/items/:iid/check`  | armeiro, admin_reserva | Conferir item |
| `POST`  | `/api/inventory/reserve-checks/:id/sign`              | admin_reserva | Assinar (TOTP) |

---

## Testes E2E

**Arquivo:** `apps/web/e2e/inventory.spec.ts`

| ID | Cenário | Critério |
|----|---------|----------|
| INV01 | Criar campanha → carga esperada calculada ao iniciar | `inventory_item_checks` criados com `qtd_esperada` > 0 |
| INV02 | admin_reserva cria campanha apenas para sua reserve | `reserve_ids` = [sua reserve], 403 se tentar outra |
| INV03 | Divergência sem justificativa → 422 | `divergencia_desc` obrigatório quando qtd_contada ≠ qtd_esperada |
| INV04 | Fechar campanha com reserve_check não assinado → 422 | Todas devem ter `signature_id` |
| INV05 | PDF gerado após fechamento com hash verificável | `pdf_storage_path` preenchido, `document_hash` não-nulo |
| INV06 | armeiro sem atribuição não pode conferir item | 403 |
| INV07 | admin_global lista campanhas de todas as reserves | Retorna campanhas de reserves que não são suas |
| INV08 | admin_reserva lista apenas campanhas da sua reserve | Não vê campanhas de reserves de outro admin_reserva |
| INV09 | PATCH assign armeiro — apenas admin_reserva da reserve | 403 para outros roles |
| INV10 | Cancelar campanha em andamento → 422 se itens já conferidos | Proteção de integridade |

---

## Definition of Done da Fase 8

### 1. Critérios Funcionais
- [ ] INV01-INV10 passando (ou API tests equivalentes)
- [ ] PDF gerado e hash verificável
- [ ] Card de inventário no dashboard de comando

### 2. Critérios Técnicos
- [ ] Build passa: `pnpm --filter web build`
- [ ] Typecheck passa: `pnpm typecheck`
- [ ] Lint passa: `pnpm lint`
- [ ] Migration aplicada em produção

### 3. Critérios de Segurança
- [ ] roleGuard em todos os endpoints
- [ ] admin_reserva só vê/edita sua própria reserve
- [ ] armeiro só confere itens da sua reserve_check atribuída
- [ ] Input validado com Zod em todos os endpoints
- [ ] CSRF em todas as mutations

### 4. Critérios de Auditoria
- [ ] `campaign.created` → audit_event
- [ ] `campaign.started` → audit_event
- [ ] `campaign.closed` → audit_event
- [ ] `reserve_check.signed` → audit_event

### 5. Multi-tenant
- [ ] `tenant_id` em todas as novas tabelas
- [ ] Queries BFF filtradas por `tenantId` da sessão
- [ ] RLS policies aplicadas

### 6. RBAC
- [ ] admin_global → campanhas de qualquer reserve do tenant
- [ ] admin_reserva → campanhas apenas da sua reserve
- [ ] armeiro → conferência apenas se atribuído
- [ ] auditor → apenas leitura

### 7-10. UI, Performance, Regressão, Evidências
- [ ] Página `/admin/inventario` funcional
- [ ] Card de inventário no dashboard
- [ ] Todas as suites anteriores passando
- [ ] Relatório em `docs/enterprise/reports/phase-8-final-report.md`

---

*Fase 8 — Inventário Periódico v2.0 — 2026-06-28 (atualizado com lógica reserve-first)*
