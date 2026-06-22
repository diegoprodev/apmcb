# Fase 3 — Audit Events com Hash Encadeado

> **DoD Canônica:** IMPLEMENTADO NÃO É ENTREGUE — ver `../07-canonical-definition-of-done.md`  
> **Harness ID:** PH-3  
> **Premissa:** Fase 2 concluída — RBAC com 6 roles funcionando e PT01-PT08 passando

---

## Objetivo

Implementar trilha de auditoria enterprise com tabela `audit_events` imutável, hash SHA-256 encadeado entre eventos, snapshots before/after, e middleware de auditoria injetado em todos os endpoints sensíveis.

---

## Escopo

- Nova tabela `audit_events` com campos completos (seq, hash encadeado, before/after, tenant, ip, user_agent)
- `apps/bff/src/lib/audit-hash.ts` — `computeEventHash()`
- `apps/bff/src/middleware/audit.ts` — reescrito para usar audit_events
- RULE SQL de imutabilidade em audit_events (UPDATE e DELETE bloqueados)
- Realtime CDC em audit_events para o Nexus
- Suite E2E AT01-AT05

---

## Fora do Escopo

- ❌ UI de visualização de audit log para admin (Fase 7+)
- ❌ Exportação de relatório de auditoria (Fase 7+)
- ❌ Remoção de audit_logs (manter como backup)
- ❌ Verificação de integridade da cadeia em UI (CLI apenas nesta fase)

---

## Premissas

| # | Premissa | Como verificar |
|---|---|---|
| P1 | Fase 2 completa — PT01-PT08 passando | `pnpm test:e2e --project=rbac-suite` |
| P2 | tenant_id em todas as tabelas (Fase 1) | Schema Supabase verificado |

---

## Arquivos Permitidos

**BFF:**
- `apps/bff/src/lib/audit-hash.ts` — CRIAR (função computeEventHash)
- `apps/bff/src/middleware/audit.ts` — REESCREVER para audit_events
- `apps/bff/src/routes/*.ts` — injetar audit middleware em ações sensíveis
- `apps/bff/src/routes/nexus.ts` — adicionar Realtime subscription a audit_events

**Database:**
- `supabase/migrations/20260620000003_audit_events.sql` — nova migration

**Testes:**
- `apps/web/e2e/audit-events.spec.ts` — nova suite
- `apps/web/playwright.config.ts` — adicionar `audit-suite`

## Arquivos Proibidos

| Arquivo | Motivo |
|---|---|
| `supabase/migrations/20260611*.sql` | Nunca alterar migrations existentes |
| `apps/web/src/components/ui/*.tsx` | Design system — não tocar |
| `apps/bff/src/routes/auth.ts` | Auth separada — não tocar |

---

## Tabelas Permitidas

| Tabela | Operação | Justificativa |
|---|---|---|
| `audit_events` | CREATE | Nova tabela de auditoria enterprise |

## Tabelas Proibidas

| Tabela | Motivo |
|---|---|
| `audit_logs` | Manter para compatibilidade — não alterar |
| `document_signatures` | Fase 4 |

---

## Migration

**Arquivo:** `supabase/migrations/20260620000003_audit_events.sql`

```sql
-- 1. Criar tabela audit_events
CREATE TABLE IF NOT EXISTS audit_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seq             BIGSERIAL NOT NULL,
  tenant_id       UUID REFERENCES tenants(id),
  unidade_id      UUID REFERENCES unidades(id),
  actor_id        UUID REFERENCES profiles(id),
  actor_role      TEXT NOT NULL,
  action          TEXT NOT NULL,         -- namespace.verb: "lending.created"
  resource_type   TEXT NOT NULL,
  resource_id     UUID,
  before_snapshot JSONB,
  after_snapshot  JSONB,
  metadata        JSONB DEFAULT '{}',
  ip              INET,
  user_agent      TEXT,
  device_id       TEXT,
  event_hash      TEXT NOT NULL,         -- SHA-256 calculado no BFF
  previous_hash   TEXT,                  -- hash do evento anterior (cadeia)
  created_at      TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- 2. RULE de imutabilidade (mais forte que RLS — aplica mesmo para service_role)
CREATE RULE no_update_audit_events AS ON UPDATE TO audit_events DO INSTEAD NOTHING;
CREATE RULE no_delete_audit_events AS ON DELETE TO audit_events DO INSTEAD NOTHING;

-- 3. Realtime CDC para Nexus
ALTER TABLE audit_events REPLICA IDENTITY FULL;

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_audit_events_tenant ON audit_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_actor ON audit_events(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_action ON audit_events(action);
CREATE INDEX IF NOT EXISTS idx_audit_events_seq ON audit_events(seq);
CREATE INDEX IF NOT EXISTS idx_audit_events_resource ON audit_events(resource_type, resource_id);

-- 5. RLS — apenas service_role pode INSERT; auditor e admin podem SELECT
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_insert_audit" ON audit_events
  FOR INSERT WITH CHECK (TRUE);  -- apenas service_role chega aqui

CREATE POLICY "auditor_select_audit" ON audit_events
  FOR SELECT USING (
    tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid
    AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin_global','admin_reserva','auditor','superadmin')
  );
```

---

## Lógica de Hash

**Arquivo:** `apps/bff/src/lib/audit-hash.ts`

```typescript
import { createHash } from "crypto";

interface HashParams {
  seq: number;
  actor_id: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  before_snapshot: unknown;
  after_snapshot: unknown;
  created_at: string;         // ISO string
  previous_hash: string | null;
}

export function computeEventHash(params: HashParams): string {
  const sorted = Object.fromEntries(
    Object.entries(params).sort(([a], [b]) => a.localeCompare(b))
  );
  const payload = JSON.stringify(sorted);
  return createHash("sha256").update(payload, "utf8").digest("hex");
}
```

**Regras de hash:**
- Campos fixos: seq, actor_id, action, resource_type, resource_id, before_snapshot, after_snapshot, created_at, previous_hash
- Ordem dos campos: canônica (sort alfabético de keys)
- Encoding: UTF-8
- Algoritmo: SHA-256
- `previous_hash` do primeiro evento: `null`

---

## Middleware de Auditoria

**Arquivo:** `apps/bff/src/middleware/audit.ts`

Padrão de uso:

```typescript
// Nas rotas do BFF
app.post("/api/lendings", authMiddleware, roleGuard("armeiro", "admin_reserva"), async (c) => {
  const session = c.get("session");
  const body = await c.req.json();

  // 1. Executar ação
  const { data: lending, error } = await supabase.from("lendings").insert(body).select().single();
  if (error) return c.json({ error: error.message }, 500);

  // 2. Audit — fire-and-forget
  auditLog(c, {
    action: "lending.created",
    resource_type: "lending",
    resource_id: lending.id,
    before_snapshot: null,
    after_snapshot: lending,
    metadata: { material_type_id: body.material_type_id }
  });

  return c.json(lending, 201);
});
```

**Ações que DEVEM gerar audit_event:**

| Ação | action namespace |
|---|---|
| Login bem-sucedido | `auth.login` |
| Logout | `auth.logout` |
| Login Nexus | `nexus.login` |
| Login falhou | `auth.login_failed` |
| Criar lending | `lending.created` |
| Devolver lending | `lending.returned` |
| Aprovar SSA | `ssa.approved` |
| Rejeitar SSA | `ssa.rejected` |
| Alterar role de usuário | `user.role_changed` |
| Criar tenant | `tenant.created` |
| Criar unidade | `unit.created` |
| Exportar dados | `export.data` |
| Assinatura eletrônica | `signature.created` |

---

## Testes E2E

**Arquivo:** `apps/web/e2e/audit-events.spec.ts`  
**Projeto:** `audit-suite`

| ID | Teste | Critério |
|---|---|---|
| AT01 | Criar lending gera audit_event com action="lending.created" | SELECT audit_events WHERE action='lending.created' → 1 resultado |
| AT02 | Evento contém actor_id, tenant_id, ip, user_agent, timestamp | Campos presentes e não nulos |
| AT03 | DELETE em audit_events bloqueado por RULE SQL | 0 rows affected (silencioso) |
| AT04 | UPDATE em audit_events bloqueado por RULE SQL | 0 rows affected (silencioso) |
| AT05 | Hash do evento N+1 usa previous_hash = hash do evento N | Cadeia verificável manualmente |

---

## Testes de Segurança

| ID | Cenário | Resultado esperado |
|---|---|---|
| SEC-3-01 | Usuario sem role adequado tenta SELECT audit_events via anon key | 0 resultados (RLS) |
| SEC-3-02 | Tentativa de INSERT manual em audit_events via frontend | Rejeitado (apenas service_role) |
| SEC-3-03 | Audit_event não contém dados sensíveis (senha, TOTP) | Verificar conteúdo dos snapshots |

---

## Testes de Regressão

```bash
cd apps/web
pnpm test:e2e --project=chromium
pnpm test:e2e --project=suite
pnpm test:e2e --project=ssa-suite
pnpm test:e2e --project=nexus-suite
pnpm test:e2e --project=rate-limit
pnpm test:e2e --project=multitenant-suite
pnpm test:e2e --project=rbac-suite
pnpm test:e2e --project=audit-suite         # NOVA
```

---

## Critérios de Aceite

| # | Critério | Bloqueio? |
|---|---|---|
| CA01 | AT01: criar lending → audit_event criado | ✅ BLOQUEIO |
| CA02 | AT03: DELETE bloqueado por RULE | ✅ BLOQUEIO |
| CA03 | AT04: UPDATE bloqueado por RULE | ✅ BLOQUEIO |
| CA04 | AT05: cadeia de hash verificável | ✅ BLOQUEIO |
| CA05 | AT02: evento com todos os campos obrigatórios | ✅ Sim |
| CA06 | Regressão completa verde | ✅ BLOQUEIO |
| CA07 | Logs sem dados sensíveis | ✅ Sim |

---

## Validação sob Estresse — Auditoria

1. Ação crítica (criar cautela) → audit_event com action="lending.created"
2. Evento tem actor_id, tenant_id, ip, user_agent, timestamp, after_snapshot
3. Hash do evento é calculado com computeEventHash()
4. previous_hash do evento N+1 = hash do evento N
5. UPDATE direto em audit_events → 0 rows affected (RULE bloqueia)
6. DELETE direto em audit_events → 0 rows affected (RULE bloqueia)
7. Exportação de dados → audit_event com action="export.data"
8. Acesso negado (403) → considerar logar (opcional nesta fase)

---

## Definition of Done da Fase 3

### 1. Critérios Funcionais
- [ ] Toda ação sensível gera audit_event
- [ ] Nexus: audit_events streaming via Realtime

### 2. Critérios Técnicos
- [ ] Build passa
- [ ] Typecheck passa
- [ ] Lint passa
- [ ] computeEventHash() testa com vetor de teste manual

### 3. Critérios de Segurança
- [ ] RULE SQL bloqueia UPDATE e DELETE em audit_events
- [ ] Logs sem dados sensíveis

### 4. Auditoria
- [ ] AT01-AT05 passando ✅ BLOQUEIO
- [ ] Cadeia de hash não quebra

### 5. Multi-tenant
- [ ] audit_events filtrado por tenant_id nas queries de leitura

### 6. RBAC
- [ ] roleGuard continua funcionando em todos os endpoints

### 7. UI
- [ ] N/A nesta fase (sem UI nova)

### 8. Performance
- [ ] audit middleware fire-and-forget (não bloqueia resposta da API)
- [ ] Endpoint crítico responde em < 800ms mesmo com audit

### 9. Regressão
- [ ] `audit-suite`: 5/5 passando
- [ ] Fases anteriores: todos passando

### 10. Evidências
- [ ] Screenshot `audit-suite: 5/5 passed`
- [ ] Verificação manual da cadeia de hash (vetor de teste)
- [ ] Output de `pnpm typecheck` sem erros
- [ ] Relatório em `docs/enterprise/reports/phase-3-final-report.md`

---

*Fase 3 — Audit Events v1.0 — 2026-06-20*
