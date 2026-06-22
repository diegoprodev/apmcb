# Fase 7 — Dashboard de Comando

> **DoD Canônica:** IMPLEMENTADO NÃO É ENTREGUE — ver `../07-canonical-definition-of-done.md`  
> **Harness ID:** PH-7  
> **Premissa:** Fase 6 concluída — livro digital de serviço com HT01-HT04 passando

---

## Objetivo

Implementar dashboard de exceções e conformidade para admin_global com 14 cards baseados em dados reais, sem nenhuma nova tabela, apenas queries agregadas sobre os dados já existentes.

**Esta fase também cria o seed de demo completo** com 300+ militares e 90 dias de histórico. O seed deve existir nesta fase porque o dashboard só faz sentido com dados reais — um dashboard vazio não demonstra nada.

---

## Escopo

- Nova rota `/(dashboard)/admin/comando/page.tsx`
- Endpoint `GET /api/dashboard/command` com 14 métricas de exceção
- 14 cards de exceção: passagens em atraso, cautelas vencidas, etc.
- Filtro por unidade (admin_global vê todas; admin_reserva vê só a sua)
- Link do Sidebar para rota `/admin/comando`
- Suite E2E DASH01-DASH05
- **Seed de demo:** `supabase/seed-enterprise-demo.sql` — 300+ militares, 90 dias de histórico

---

## Fora do Escopo

- ❌ Relatórios exportáveis em PDF nesta fase (Fase 10)
- ❌ Alertas automáticos por e-mail (Fase 9)
- ❌ Dashboard de armeiro (já existe em `/reserva`)
- ❌ Gráficos de tendência histórica (Fase 10)
- ❌ Nova tabela (zero migrations nesta fase)

---

## Premissas

| # | Premissa | Como verificar |
|---|---|---|
| P1 | Fase 6 completa — HT01-HT04 passando | `pnpm test:e2e --project=handover-suite` |
| P2 | Dados reais de lendings, service_handovers, ocorrencias existentes | Seed de teste com dados |

---

## Arquivos Permitidos

**BFF:**
- `apps/bff/src/routes/dashboard.ts` — adicionar GET /api/dashboard/command

**Database (seed only — sem migration):**
- `supabase/seed-enterprise-demo.sql` — CRIAR seed de demo com 300+ militares e 90 dias de dados
  > Seed aplicado apenas em staging/demo. Nunca em produção.

**Frontend:**
- `apps/web/src/app/(dashboard)/admin/comando/page.tsx` — CRIAR
- `apps/web/src/components/admin/command-card.tsx` — CRIAR (card de exceção)
- `apps/web/src/components/layout/sidebar.tsx` — adicionar link para /admin/comando

**Testes:**
- `apps/web/e2e/command-dashboard.spec.ts` — nova suite
- `apps/web/playwright.config.ts` — adicionar `dashboard-suite`

## Arquivos Proibidos

| Arquivo | Motivo |
|---|---|
| `apps/web/src/components/ui/*.tsx` | Design system — não tocar |
| Qualquer rota existente de admin | Não tocar — criar apenas rota nova |
| Qualquer migration SQL | Zero migrations nesta fase |

---

## Tabelas Permitidas / Proibidas

**Nenhuma migration nesta fase.** O dashboard usa apenas queries SELECT sobre:
- `lendings` (cautelas ativas/vencidas)
- `service_handovers` (passagens pendentes/em atraso)
- `ocorrencias` (incidentes abertos)
- `audit_events` (movimentações críticas recentes)
- `material_requests` (SSA pendentes)
- `inventory_campaigns` (se existir — Fase 8)

---

## Endpoints

| Método | Path | Role | Ação |
|---|---|---|---|
| `GET` | `/api/dashboard/command` | admin_global, admin_reserva | 14 métricas de exceção |
| `GET` | `/api/dashboard/command?unidade_id=X` | admin_reserva | Filtrar por unidade |

**Response shape:**

```typescript
interface CommandDashboardResponse {
  passagens_em_atraso: number;
  passagens_pendentes_assinatura: number;
  // Cautela por tempo indeterminado (cautelamentos)
  cautelas_ativas: number;                   // cautelamentos WHERE status='ativa'
  cautelas_com_item_vencido: number;         // material_items.validade_item < now() WHERE status_operacional='cautelado'
  cautelas_sem_conferencia_90d: number;      // cautelamentos ativas sem data_ultima_conferencia nos últimos 90d
  // Saída diária (lendings)
  saidas_ativas: number;                     // material_items WHERE status_operacional='em_saida'
  saidas_com_atraso: number;                 // saídas ativas além do tempo esperado de turno
  // Estado do acervo (material_items — fonte única de verdade)
  itens_disponiveis: number;                 // material_items WHERE status_operacional='disponivel'
  itens_em_manutencao: number;               // material_items WHERE status_operacional='manutencao'
  itens_extraviados: number;                 // material_items WHERE status_operacional='extraviado'
  itens_sem_identificador: number;           // material_items WHERE identificador_principal IS NULL
  divergencias_abertas: number;
  solicitacoes_pendentes: number;           // SSA aguardando aprovação
  ocorrencias_abertas: number;
  usuarios_sem_totp: number;               // profiles sem TOTP configurado
  movimentacoes_24h: number;               // audit_events nas últimas 24h
  passagens_sem_entrante: number;           // handovers em aguardando_atribuicao > 2h
  generated_at: string;                    // ISO timestamp
  periodo: string;                         // "Atualizado há N minutos"
}
```

---

## 14 Cards de Exceção

| # | Card | Fonte | Alerta quando |
|---|---|---|---|
| 1 | Passagens em Atraso | service_handovers | status=vencido |
| 2 | Passagens Aguardando Assinatura | service_handovers | status=aguardando* |
| 3 | Cautelas Ativas (tempo indeterminado) | **cautelamentos** | status=ativa |
| 4 | Itens Cautelados com Validade Vencida | **material_items** | validade_item < now() AND status_operacional='cautelado' |
| 5 | Cautelas Sem Conferência (90d+) | **cautelamentos** | data_ultima_conferencia < now()-90d |
| 6 | Saídas de Turno Ativas | **material_items** | status_operacional='em_saida' |
| 7 | Saídas em Atraso | **lendings** + **material_items** | saída ativa além do tempo esperado |
| 8 | Itens Extraviados | **material_items** | status_operacional='extraviado' |
| 9 | Itens em Manutenção | **material_items** | status_operacional='manutencao' |
| 10 | Divergências em Aberto | ocorrencias / handovers | status=divergencia |
| 11 | Solicitações Pendentes | material_requests | status=pendente |
| 12 | Ocorrências Abertas | ocorrencias | status=aberta |
| 13 | Militares Sem TOTP | profiles | totp_configured = false |
| 14 | Passagens Sem Entrante (2h+) | service_handovers | aguardando_atribuicao > 2h |

> **Fonte de verdade:** Cards 4, 6, 8, 9 consultam `material_items.status_operacional` — a fonte única de estado operacional do acervo.  
> Cards 3, 5 consultam `cautelamentos` para dados de cautela por tempo indeterminado.  
> Cards 6-7 cruzam `material_items` + `lendings` para saída diária.

**Design dos cards:**

```tsx
// Card de exceção — bordas coloridas por severidade
// pattern: border-l-4 com cor baseada em severidade
<Card className="border-l-4 border-l-destructive">  {/* Alta */}
<Card className="border-l-4 border-l-yellow-500">   {/* Média */}
<Card className="border-l-4 border-l-blue-500">     {/* Informativa */}

// Contador grande em destaque
// Link para lista detalhada (quando existir)
```

---

## Componentes de UI

**`command-card.tsx`** — Card de exceção enterprise:

```tsx
interface CommandCardProps {
  title: string;
  count: number;
  severity: "critical" | "warning" | "info";
  icon: LucideIcon;
  href?: string;    // link para detalhe (se disponível)
  loading?: boolean;
}
```

Deve seguir o padrão do design system (ver `03-ui-design-system-guardrails.md`).

---

## Testes E2E

**Arquivo:** `apps/web/e2e/command-dashboard.spec.ts`  
**Projeto:** `dashboard-suite`

| ID | Teste | Critério |
|---|---|---|
| DASH01 | Página `/admin/comando` carrega para admin_global | 200, cards visíveis |
| DASH02 | Cards batem com dados reais | Criar lending → cautelas_ativas +1 |
| DASH03 | Filtro por unidade não vaza dados de outra unidade | 0 dados de outra unidade |
| DASH04 | admin_reserva vê apenas sua unidade | Filtrado automaticamente |
| DASH05 | Estado vazio (zero dados) tratado sem erro | Cards com 0, sem quebra |

---

## Testes de Segurança

| ID | Cenário | Resultado esperado |
|---|---|---|
| SEC-7-01 | `usuario` tenta GET /api/dashboard/command | 403 |
| SEC-7-02 | `armeiro` tenta GET /api/dashboard/command | 403 |
| SEC-7-03 | admin_global de tenant A vê dados de tenant B | 0 resultados |
| SEC-7-04 | `?unidade_id=unidade_de_outro_tenant` | 0 resultados (RLS) |

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
pnpm test:e2e --project=audit-suite
pnpm test:e2e --project=signature-suite
pnpm test:e2e --project=custody-suite
pnpm test:e2e --project=handover-suite
pnpm test:e2e --project=dashboard-suite    # NOVA
```

---

## Critérios de Aceite

| # | Critério | Bloqueio? |
|---|---|---|
| CA01 | DASH01: página carrega para admin_global | ✅ Sim |
| CA02 | DASH02: contagens batem com dados reais | ✅ BLOQUEIO |
| CA03 | DASH03: isolamento de tenant nos cards | ✅ BLOQUEIO |
| CA04 | DASH04: admin_reserva filtrado por unidade | ✅ Sim |
| CA05 | DASH05: zero dados sem quebra | ✅ Sim |
| CA06 | roleGuard em GET /api/dashboard/command | ✅ Sim |
| CA07 | Regressão completa verde | ✅ BLOQUEIO |

---

## Validação sob Estresse — Dashboard

1. Cards batem com dados reais: criar cautela → cautelas_ativas +1 no dashboard
2. Filtro por unidade: admin de unidade A não vê dados de unidade B
3. Estado vazio: tenant novo → todos os cards com 0, sem erro
4. Indicadores críticos: passagem vencida → card "Em Atraso" +1
5. admin_global de tenant A não vê dados de tenant B no dashboard

---

## Seed de Demo

**Arquivo:** `supabase/seed-enterprise-demo.sql`  
**Propósito:** Fornecer dados reais para que o dashboard de comando tenha conteúdo significativo desde a primeira demonstração.  
**Ambiente:** Aplicar apenas em staging/demo. Nunca em produção.

```sql
-- =============================================================================
-- supabase/seed-enterprise-demo.sql
-- 300+ militares, 3 unidades, 90 dias de histórico
-- =============================================================================

-- IMPORTANTE: Este seed assume que o DEFAULT tenant (APMCB) já foi criado
-- pela Fase 1 com id = '00000000-0000-0000-0000-000000000001'
-- Rodar apenas em staging/demo. Nunca em produção.

-- 3 Unidades de teste (além da Unidade Principal criada na Fase 1)
INSERT INTO unidades (id, tenant_id, nome, sigla, tipo) VALUES
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', '1ª Companhia de Policiamento', '1ª CIA', 'companhia'),
  ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', '2ª Companhia de Policiamento', '2ª CIA', 'companhia'),
  ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001', 'Companhia de Operações Especiais', 'COE', 'especial')
ON CONFLICT DO NOTHING;

-- 300 militares distribuídos nas 3 unidades
-- (usar loop ou script de geração — valores ilustrativos)
-- 1ª CIA: 150 militares
-- 2ª CIA: 100 militares
-- COE: 50 militares
-- (Inserção via script de geração de dados — ver seed-generator.ts)

-- 5 tipos de material principais
INSERT INTO material_types (id, tenant_id, nome, categoria, numero_serie, estoque_minimo) VALUES
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Pistola Taurus PT100', 'arma_curta', NULL, 10),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Pistola Glock G17', 'arma_curta', NULL, 5),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Colete Balístico III-A', 'equipamento_protecao', NULL, 20),
  ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'Rádio Motorola APX6000', 'comunicacao', NULL, 15),
  ('10000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', 'Algema', 'equipamento_geral', NULL, 30)
ON CONFLICT DO NOTHING;

-- =============================================================================
-- CAUTELAMENTOS (90 dias de histórico)
-- =============================================================================
-- 200 cautelamentos nos últimos 90 dias
-- • 140 devolvidos / substituídos (histórico)
-- • 60 ativos (30 com validade próxima do vencimento → cards 4 e 5)
-- • 5 com item vencido (validade_item < now()) → card 4
-- • 12 sem revisão há mais de 90 dias → card 5
-- (valores populados via seed-generator.ts)

-- EXEMPLO de 1 cautelamento ativo para referência de formato:
-- INSERT INTO cautelamentos (
--   tenant_id, unidade_id, militar_id, armeiro_id,
--   material_type_id, motivo_emissao, status, data_emissao,
--   validade_item, document_hash
-- ) VALUES (
--   '00000000-0000-0000-0000-000000000001',
--   '00000000-0000-0000-0000-000000000010',
--   '[militar_id]', '[armeiro_id]',
--   '10000000-0000-0000-0000-000000000003',
--   'Colete de proteção pessoal', 'ativa', now() - interval '95 days',
--   now() - interval '5 days',  -- VENCIDO → aparece no card 4
--   'hash_placeholder'
-- );

-- =============================================================================
-- LENDINGS / SAÍDAS (90 dias de histórico)
-- =============================================================================
-- 500 saídas de turno nos últimos 90 dias
-- • 460 devolvidas (histórico normal)
-- • 35 ativas (turno em andamento)
-- • 5 em divergência (itens não devolvidos corretamente) → card 8
-- (valores populados via seed-generator.ts)

-- =============================================================================
-- PASSAGENS DE SERVIÇO (90 dias)
-- =============================================================================
-- 270 passagens de serviço nos últimos 90 dias (3 por dia, 3 unidades)
-- • 250 concluídas (histórico normal)
-- • 8 em atraso (vencidas sem conclusão) → card 1
-- • 7 aguardando assinatura → card 2
-- • 3 sem entrante atribuído há > 2h → card 14
-- • 5 com divergência → card 8

-- =============================================================================
-- SOLICITAÇÕES SSA
-- =============================================================================
-- 45 solicitações nos últimos 90 dias
-- • 30 aprovadas
-- • 10 rejeitadas
-- • 5 pendentes → card 9

-- =============================================================================
-- OCORRÊNCIAS
-- =============================================================================
-- 30 ocorrências nos últimos 90 dias
-- • 20 resolvidas
-- • 10 abertas → card 10

-- =============================================================================
-- VALIDAÇÕES PÓS-SEED
-- =============================================================================
-- Verificar que os cards terão dados:
-- SELECT COUNT(*) FROM cautelamentos WHERE status='ativa';             -- deve ser ~60
-- SELECT COUNT(*) FROM cautelamentos WHERE validade_item < now();      -- deve ser ~5
-- SELECT COUNT(*) FROM lendings WHERE status='ativa';                  -- deve ser ~35
-- SELECT COUNT(*) FROM service_handovers WHERE status='vencido';       -- deve ser ~8
-- SELECT COUNT(*) FROM material_requests WHERE status='pendente';      -- deve ser ~5
-- SELECT COUNT(*) FROM ocorrencias WHERE status='aberta';              -- deve ser ~10
```

**Script auxiliar:** `supabase/scripts/seed-generator.ts`  
Gera os INSERTs reais com UUIDs, nomes de militares e datas distribuídas nos 90 dias.  
Rodar com `bun run supabase/scripts/seed-generator.ts > supabase/seed-enterprise-demo.sql`.

---

## Definition of Done da Fase 7

### 1. Critérios Funcionais
- [ ] DASH01-DASH05 passando
- [ ] 14 cards com dados reais
- [ ] Link no sidebar para /admin/comando

### 2. Critérios Técnicos
- [ ] Build passa
- [ ] Typecheck passa
- [ ] Zero migrations (nenhuma nova tabela)

### 3. Critérios de Segurança
- [ ] roleGuard: apenas admin_global e admin_reserva acessam
- [ ] Dados filtrados por tenant_id

### 4. Auditoria
- [ ] Acesso ao dashboard pode gerar audit_event (opcional nesta fase)

### 5. Multi-tenant
- [ ] DASH03: dados de outro tenant nunca aparecem ✅ BLOQUEIO

### 6. RBAC
- [ ] DASH01: usuario/armeiro não acessa → 403

### 7. UI
- [ ] Cards com bordas coloridas por severidade
- [ ] Mobile testado (grid responsivo)
- [ ] Estados vazios tratados (0, não erro)

### 8. Performance
- [ ] GET /api/dashboard/command responde em < 1s (10 queries agregadas)
- [ ] Dashboard carrega em < 2s (FCP)

### 9. Regressão
- [ ] `dashboard-suite`: 5/5 passando
- [ ] Fases anteriores: todos passando

### 10. Evidências
- [ ] Screenshot `dashboard-suite: 5/5 passed`
- [ ] Screenshot do dashboard com seed aplicado — todos os 14 cards com valores reais
- [ ] `SELECT COUNT(*) FROM cautelamentos WHERE status='ativa'` → 60+
- [ ] `SELECT COUNT(*) FROM lendings WHERE status='ativa'` → 35+
- [ ] `SELECT COUNT(*) FROM profiles WHERE tenant_id='...'` → 300+
- [ ] Relatório em `docs/enterprise/reports/phase-7-final-report.md`

---

*Fase 7 — Dashboard de Comando v1.1 — 2026-06-20*  
*Revisão: seed de demo movido para esta fase; cards 3-7 corrigidos para distinguir cautelamentos vs lendings*
