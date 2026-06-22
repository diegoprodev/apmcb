# Fase 6 — Livro Digital de Serviço

> **DoD Canônica:** IMPLEMENTADO NÃO É ENTREGUE — ver `../07-canonical-definition-of-done.md`  
> **Harness ID:** PH-6  
> **Premissa:** Fase 5 concluída — cautela eletrônica com status machine e CT01-CT06 passando

---

## Objetivo

Implementar passagem de serviço digital com snapshot automático do turno, assinatura dupla (armeiro que sai + armeiro que entra), alerta de prazo, suporte a divergências, PDF verificável e card de status no dashboard.

---

## Escopo

- Novas tabelas: `service_handovers`, `handover_attachments`
- 8 endpoints de handover
- Snapshot automático JSONB do turno no momento da abertura
- Notificações push para armeiro entrante
- Card de handover no dashboard do armeiro (`/reserva`)
- PDF de Livro Digital de Serviço com assinatura dupla
- Bucket `handover-docs` e `handover-attachments` no Supabase Storage
- Suite E2E HT01-HT04

---

## Fora do Escopo

- ❌ Aprovação do comando sobre a passagem (Fase 7 dashboard)
- ❌ Histórico completo de passagens em UI dedicada (Fase 7)
- ❌ Passagem entre turnos automatizadas por escala (futuro)
- ❌ Múltiplos armeiros por turno (MVP: 1 saindo, 1 entrando)

---

## Premissas

| # | Premissa | Como verificar |
|---|---|---|
| P1 | Fase 5 completa — CT01-CT06 passando | `pnpm test:e2e --project=custody-suite` |
| P2 | PDF de cautela funcionando (Fase 5) | Bucket custody-docs com PDF |
| P3 | Notificações push existentes (`push.ts`) | GET /api/notifications retorna dados |

---

## Arquivos Permitidos

**BFF:**
- `apps/bff/src/routes/handovers.ts` — CRIAR (8 endpoints)
- `apps/bff/src/lib/pdf/handover-pdf.ts` — CRIAR (PDF de passagem)
- `apps/bff/src/lib/snapshot.ts` — CRIAR (gerar snapshot do turno)

**Frontend:**
- `apps/web/src/app/(dashboard)/reserva/passagens/page.tsx` — CRIAR
- `apps/web/src/components/reserva/handover-card.tsx` — CRIAR
- `apps/web/src/components/reserva/handover-form.tsx` — CRIAR
- `apps/web/src/app/(dashboard)/reserva/page.tsx` — adicionar card de passagem pendente

**Database:**
- `supabase/migrations/20260620000006_service_handovers.sql` — nova migration

**Testes:**
- `apps/web/e2e/handovers.spec.ts` — nova suite
- `apps/web/playwright.config.ts` — adicionar `handover-suite`

## Arquivos Proibidos

| Arquivo | Motivo |
|---|---|
| `apps/bff/src/routes/lendings.ts` | Cautela separada — não tocar |
| `apps/bff/src/routes/push.ts` | Push existente — usar sem alterar |
| `apps/web/src/components/ui/*.tsx` | Design system |
| `supabase/migrations/20260620000005*.sql` | Cautela migration — não alterar |

---

## Tabelas Permitidas

| Tabela | Operação | Justificativa |
|---|---|---|
| `service_handovers` | CREATE | Nova tabela de passagem de serviço |
| `handover_attachments` | CREATE | Anexos (fotos de divergência) |

---

## Endpoints

| Método | Path | Role | Ação |
|---|---|---|---|
| `POST` | `/api/handovers` | armeiro | CRIAR passagem + snapshot |
| `GET` | `/api/handovers` | armeiro, admin_reserva | LISTAR passagens |
| `GET` | `/api/handovers/:id` | armeiro, admin_reserva, auditor | DETALHAR passagem |
| `POST` | `/api/handovers/:id/sign-exit` | armeiro (saindo) | ASSINAR saída (TOTP) |
| `POST` | `/api/handovers/:id/assign-entry` | admin_reserva | ATRIBUIR armeiro entrante |
| `POST` | `/api/handovers/:id/sign-entry` | armeiro (entrando) | ASSINAR entrada (TOTP) |
| `POST` | `/api/handovers/:id/report-divergence` | armeiro (entrando) | REGISTRAR divergência |
| `GET` | `/api/handovers/:id/pdf` | armeiro, admin_reserva | BAIXAR PDF |

---

## Migration

**Arquivo:** `supabase/migrations/20260620000006_service_handovers.sql`

```sql
-- 1. Tabela service_handovers
CREATE TABLE IF NOT EXISTS service_handovers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id),
  unidade_id            UUID NOT NULL REFERENCES unidades(id),
  saindo_id             UUID NOT NULL REFERENCES profiles(id),
  entrando_id           UUID REFERENCES profiles(id),
  status                TEXT DEFAULT 'rascunho'
    CHECK (status IN ('rascunho','aguardando_assinatura_saida','aguardando_atribuicao',
                      'aguardando_assinatura_entrada','concluido','divergencia','vencido','cancelado')),
  report_snapshot       JSONB NOT NULL,        -- snapshot automático do turno
  observacao_saindo     TEXT,
  observacao_entrada    TEXT,
  divergencia_descricao TEXT,
  prazo_assumcao        TIMESTAMPTZ,           -- prazo para o entrante assinar
  saindo_signature_id   UUID REFERENCES document_signatures(id),
  entrada_signature_id  UUID REFERENCES document_signatures(id),
  document_hash         TEXT,
  pdf_storage_path      TEXT,
  created_at            TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at            TIMESTAMPTZ DEFAULT now()
);

-- 2. Tabela handover_attachments
CREATE TABLE IF NOT EXISTS handover_attachments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  handover_id     UUID NOT NULL REFERENCES service_handovers(id),
  tipo            TEXT NOT NULL CHECK (tipo IN ('foto_divergencia', 'documento')),
  storage_path    TEXT NOT NULL,
  descricao       TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_handovers_tenant ON service_handovers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_handovers_unidade ON service_handovers(unidade_id);
CREATE INDEX IF NOT EXISTS idx_handovers_status ON service_handovers(status);
CREATE INDEX IF NOT EXISTS idx_handovers_saindo ON service_handovers(saindo_id);
CREATE INDEX IF NOT EXISTS idx_handovers_entrando ON service_handovers(entrando_id);

-- 4. RLS
ALTER TABLE service_handovers ENABLE ROW LEVEL SECURITY;
ALTER TABLE handover_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_handovers" ON service_handovers
  USING (tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid);

CREATE POLICY "tenant_isolation_attachments" ON handover_attachments
  USING (tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid);
```

---

## Snapshot do Turno

O snapshot é gerado automaticamente quando `POST /api/handovers` é chamado:

```typescript
// apps/bff/src/lib/snapshot.ts
interface TurnSnapshot {
  data_referencia: string;           // ISO timestamp da abertura da passagem
  unidade: string;                   // nome da unidade
  carga_total: {
    por_tipo: Record<string, number>;  // { "Pistola": 5, "Colete": 10 }
    total: number;
  };
  cautelas_ativas: Array<{
    id: string;
    material_descricao: string;
    militar_nome: string;
    data_emissao: string;
    prazo: string | null;
  }>;
  devolucoes_turno: Array<{...}>;    // devoluções no turno atual
  saidas_turno: Array<{...}>;        // emissões no turno atual
  solicitacoes_pendentes: number;    // SSA pendentes
  ocorrencias_abertas: number;       // incidentes abertos
}
```

---

## Status Machine

```
[rascunho]
    │ POST /api/handovers (criação)
    ▼
[aguardando_assinatura_saida]
    │ POST /sign-exit (armeiro que sai, TOTP)
    ▼
[aguardando_atribuicao]
    │ POST /assign-entry (admin_reserva atribui armeiro entrante)
    ▼
[aguardando_assinatura_entrada]
    │ prazo_assumcao vencido → [vencido] (via job ou trigger)
    │ POST /sign-entry (armeiro entrante, TOTP)
    ▼
[concluido]
    
[aguardando_assinatura_entrada]
    │ POST /report-divergence
    ▼
[divergencia]  → admin resolve → [concluido]
```

---

## Testes E2E

**Arquivo:** `apps/web/e2e/handovers.spec.ts`  
**Projeto:** `handover-suite`

| ID | Teste | Critério |
|---|---|---|
| HT01 | Criar passagem → snapshot com dados corretos | report_snapshot.cautelas_ativas = COUNT(lendings ativas) |
| HT02 | Prazo vencido → status = vencido | Após mock de tempo |
| HT03 | PDF com dupla assinatura gerado | PDF com saindo_signature + entrada_signature |
| HT04 | Divergência gera notificação para admin | notifications +1 |

---

## Testes de Segurança

| ID | Cenário | Resultado esperado |
|---|---|---|
| SEC-6-01 | Militar (usuario) tenta criar passagem | 403 |
| SEC-6-02 | Armeiro tenta assinar passagem de outra unidade | 403 ou 404 |
| SEC-6-03 | Mesmo armeiro assina como saindo e entrando | 422 |
| SEC-6-04 | Finalizar sem assinatura do entrante | 422 |
| SEC-6-05 | Upload de arquivo com MIME inválido | 422 |

---

## Critérios de Aceite

| # | Critério | Bloqueio? |
|---|---|---|
| CA01 | HT01: snapshot contém dados reais do turno | ✅ BLOQUEIO |
| CA02 | HT03: PDF com dupla assinatura gerado | ✅ Sim |
| CA03 | Status machine completo | ✅ Sim |
| CA04 | Notificação para armeiro entrante enviada | ✅ Sim |
| CA05 | Mesmo armeiro não pode assinar os dois lados | ✅ BLOQUEIO |
| CA06 | audit_event para cada ação | ✅ Sim |
| CA07 | Regressão completa verde | ✅ BLOQUEIO |

---

## Validação sob Estresse — Livro Digital de Serviço

1. Armeiro inicia passagem → snapshot automatico reflete estado real
2. snapshot.cautelas_ativas = COUNT(lendings WHERE status_v2='ativa' AND unidade_id=X)
3. Prazo de assumção vencido → status → 'vencido', alerta para admin no dashboard
4. Assunção com divergência → status → 'divergencia', justificativa obrigatória
5. Finalizar sem assinatura do entrante → 422
6. Mesmo armeiro tentando assinar como saindo e entrando → 422
7. Upload de foto com tipo inválido (não .jpg/.png) → 422
8. Admin_reserva vê status correto no dashboard

---

## Definition of Done da Fase 6

### 1. Critérios Funcionais
- [ ] HT01-HT04 passando
- [ ] PDF de passagem com dupla assinatura verificável
- [ ] Notificação push para armeiro entrante

### 2. Critérios Técnicos
- [ ] Build passa
- [ ] Typecheck passa
- [ ] Migration aplicada
- [ ] Buckets handover-docs e handover-attachments criados

### 3. Critérios de Segurança
- [ ] Mesmo armeiro não pode assinar dos dois lados ✅ BLOQUEIO
- [ ] Finalizar sem assinatura do entrante → 422 ✅ BLOQUEIO
- [ ] Passagem de outra unidade inacessível

### 4. Auditoria
- [ ] Criação gera audit_event action="handover.created"
- [ ] Assinatura gera audit_event action="handover.signed"
- [ ] Divergência gera audit_event action="handover.divergence"

### 5. Multi-tenant
- [ ] service_handovers filtrado por tenant_id

### 6. RBAC
- [ ] roleGuard: armeiro pode criar, admin_reserva pode atribuir

### 7. UI
- [ ] Card de passagem pendente no dashboard do armeiro
- [ ] Status da passagem visível
- [ ] Mobile testado

### 8. Performance
- [ ] Snapshot gerado em < 2s
- [ ] PDF gerado em < 5s

### 9. Regressão
- [ ] `handover-suite`: 4/4 passando
- [ ] Fases anteriores: todos passando

### 10. Evidências
- [ ] Screenshot `handover-suite: 4/4 passed`
- [ ] Screenshot do PDF de passagem
- [ ] Screenshot do card de passagem no dashboard
- [ ] Relatório em `docs/enterprise/reports/phase-6-final-report.md`

---

*Fase 6 — Livro Digital de Serviço v1.0 — 2026-06-20*
