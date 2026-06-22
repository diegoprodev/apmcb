# Fase 10 — Hardening Enterprise

> **DoD Canônica:** IMPLEMENTADO NÃO É ENTREGUE — ver `../07-canonical-definition-of-done.md`  
> **Harness ID:** PH-10  
> **Premissa:** Fases 0-9 concluídas

---

## Objetivo

Consolidar o produto para apresentação institucional: correções de UX identificadas nas fases anteriores, logging estruturado no BFF e regressão completa de todas as 13+ suites.

> **Nota:** O seed de demo (300+ militares, 90 dias) foi criado na **Fase 7** para que o dashboard já tenha dados reais na primeira demonstração. Esta fase não cria seed novo — valida que o seed da Fase 7 está correto e completo.

---

## Escopo

- Verificação do seed de demo (criado na Fase 7): confirmar contagens e integridade
- Roteiro de demo para apresentação ao comando
- Correções de UX identificadas nas fases 0-9 (mapeadas no relatório da fase)
- Logging JSON estruturado no BFF (para Cloud Run futuro)
- Regressão completa: todas as 13+ suites E2E passando

---

## Fora do Escopo

- ❌ Nenhuma feature nova
- ❌ Nenhuma nova migration ou seed (seed foi criado na Fase 7)
- ❌ Cloud Run migration (Fase 11)

---

## Arquivos Permitidos

**BFF:**
- `apps/bff/src/index.ts` — adicionar logging JSON estruturado
- `apps/bff/src/lib/logger.ts` — CRIAR (wrapper de logging estruturado)
- Quaisquer correções de bugs identificados nas fases anteriores

**Frontend:**
- Correções de UX (identificar durante a fase)
- Nenhuma feature nova

**Database:**
- `supabase/seed-enterprise-demo.sql` — VERIFICAR (seed criado na Fase 7 — não recriar)

---

## Validação do Seed de Demo

O seed completo foi criado na **Fase 7**. Esta fase verifica que os dados estão corretos antes da apresentação:

```sql
-- 1. Contagens básicas
SELECT COUNT(*) FROM profiles WHERE role NOT IN ('superadmin');        -- >= 300
SELECT COUNT(*) FROM cautelamentos WHERE status = 'ativa';             -- >= 50
SELECT COUNT(*) FROM lendings WHERE status = 'ativa';                  -- >= 30
SELECT COUNT(*) FROM service_handovers WHERE status = 'vencido';       -- >= 5
SELECT COUNT(*) FROM material_requests WHERE status = 'pendente';      -- >= 3
SELECT COUNT(*) FROM ocorrencias WHERE status = 'aberta';              -- >= 5
SELECT COUNT(DISTINCT unidade_id) FROM profiles;                       -- >= 3
```

## Validação de Integridade de material_items

```sql
-- 2. Consistência de estado operacional (deve ser zero em todos)
-- Itens com posse dupla ativa (impossível se trigger estiver ativo)
SELECT COUNT(*) FROM material_items
  WHERE active_lending_id IS NOT NULL
    AND active_cautelamento_id IS NOT NULL;        -- DEVE SER 0

-- Itens em_saida sem lending ativa correspondente
SELECT COUNT(*) FROM material_items mi
  WHERE mi.status_operacional = 'em_saida'
    AND NOT EXISTS (
      SELECT 1 FROM lendings l
      WHERE l.item_id = mi.id
        AND l.status = 'ativa'
    );                                             -- DEVE SER 0

-- Itens cautelados sem cautelamento ativo correspondente
SELECT COUNT(*) FROM material_items mi
  WHERE mi.status_operacional = 'cautelado'
    AND NOT EXISTS (
      SELECT 1 FROM cautelamentos c
      WHERE c.item_id = mi.id
        AND c.status = 'ativa'
    );                                             -- DEVE SER 0

-- Itens com cache de posse mas status disponivel (cache não foi limpo)
SELECT COUNT(*) FROM material_items
  WHERE status_operacional = 'disponivel'
    AND (active_lending_id IS NOT NULL
      OR active_cautelamento_id IS NOT NULL);       -- DEVE SER 0

-- 3. Verificar trigger ativo (tentativa de posse dupla)
-- Deve falhar com ERRCODE P0001
DO $$
DECLARE
  item_id UUID;
BEGIN
  -- Pegar qualquer item em_saida
  SELECT id INTO item_id FROM material_items
    WHERE status_operacional = 'em_saida' LIMIT 1;
  IF item_id IS NOT NULL THEN
    BEGIN
      UPDATE material_items SET status_operacional = 'cautelado' WHERE id = item_id;
      RAISE EXCEPTION 'FALHA: trigger não bloqueou transição em_saida → cautelado';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
      RAISE NOTICE 'OK: trigger bloqueou corretamente';
    END;
    -- Desfazer para não alterar estado
    ROLLBACK;
  END IF;
END;
$$;
```

Se qualquer consulta de integridade retornar valor diferente de 0, a fase não fecha.

---

## Logging Estruturado

**Arquivo:** `apps/bff/src/lib/logger.ts`

```typescript
export const logger = {
  info: (msg: string, data?: Record<string, unknown>) => {
    console.log(JSON.stringify({ level: "info", msg, ...data, ts: new Date().toISOString() }));
  },
  error: (msg: string, data?: Record<string, unknown>) => {
    console.error(JSON.stringify({ level: "error", msg, ...data, ts: new Date().toISOString() }));
  },
  warn: (msg: string, data?: Record<string, unknown>) => {
    console.warn(JSON.stringify({ level: "warn", msg, ...data, ts: new Date().toISOString() }));
  },
};
```

**Regra:** Nunca logar com `logger.info(...)` dados como senha, TOTP, token, ou PII sensível.

---

## Critérios de Aceite

| # | Critério | Bloqueio? |
|---|---|---|
| CA01 | Seed da Fase 7 validado — contagens mínimas confirmadas | ✅ Sim |
| CA02 | Regressão: 13+ suites — 0 falhas | ✅ BLOQUEIO |
| CA03 | Roteiro de demo documentado | ✅ Sim |
| CA04 | Logging JSON estruturado no BFF | ✅ Sim |
| CA05 | `pnpm typecheck` sem erros | ✅ Sim |

---

## Definition of Done da Fase 10

### Regressão (crítica)
- [ ] Todas as 13+ suites passando: chromium, suite, ssa-suite, nexus-suite, rate-limit, multitenant-suite, rbac-suite, audit-suite, signature-suite, custody-suite, handover-suite, dashboard-suite, inventory-suite ✅ BLOQUEIO

### Evidências
- [ ] Output `pnpm test:e2e` com 13+ suites — 0 falhas
- [ ] Verificações SQL do seed da Fase 7 — todas as contagens mínimas passando
- [ ] Relatório em `docs/enterprise/reports/phase-10-final-report.md`

---

*Fase 10 — Hardening Enterprise v1.1 — 2026-06-20*  
*Revisão: seed movido para Fase 7; esta fase verifica (não cria) o seed*
