# Definition of Done Canônica — Plataforma de Governança de Bens Sensíveis

> **Versão:** 1.0  
> **Data:** 2026-06-20  
> **Autoridade:** MÁXIMA — prevalece sobre qualquer outra definição de "concluído"  
> **Escopo:** Toda fase, feature, endpoint, migration, componente e alteração de permissão

---

## Regra Canônica

```
╔═══════════════════════════════════════════════════════════════════════╗
║                                                                       ║
║           IMPLEMENTADO NÃO É ENTREGUE.                               ║
║                                                                       ║
║  ENTREGUE = implementado + testado + validado + auditado +           ║
║             regressão aprovada + critérios de aceite comprovados +   ║
║             evidência final documentada.                              ║
║                                                                       ║
╚═══════════════════════════════════════════════════════════════════════╝
```

Esta regra se aplica a:
- Toda fase do roadmap enterprise (Fases 0-12)
- Toda feature individual
- Todo endpoint novo ou modificado
- Toda migration de banco de dados
- Toda alteração de permissão (role, RLS, policy)
- Todo componente de UI
- Todo fluxo sensível (autenticação, assinatura, auditoria, multi-tenant)

---

## Ciclo Obrigatório de Entrega (20 Etapas)

Toda fase deve executar estas 20 etapas **em ordem**. Nenhuma pode ser pulada.

```
┌──────────────────────────────────────────────────────────────────┐
│  FASE DE PLANEJAMENTO                                            │
├──────────────────────────────────────────────────────────────────┤
│  1.  Ler PRD global (00-global-prd.md)                           │
│  2.  Ler spec técnica global (01-global-technical-spec.md)       │
│  3.  Ler design system guardrails (03-ui-design-system-*)        │
│  4.  Ler harness da fase (phases/phase-N-*.md)                   │
│  5.  Declarar plano de execução (escrito, aprovado)              │
├──────────────────────────────────────────────────────────────────┤
│  FASE DE IMPLEMENTAÇÃO                                           │
├──────────────────────────────────────────────────────────────────┤
│  6.  Implementar apenas o escopo autorizado no harness           │
│  7.  Rodar validações locais (build + typecheck + lint)          │
├──────────────────────────────────────────────────────────────────┤
│  FASE DE TESTES                                                  │
├──────────────────────────────────────────────────────────────────┤
│  8.  Testes unitários (quando aplicável)                         │
│  9.  Testes de integração (quando aplicável)                     │
│  10. Testes E2E da fase atual                                    │
│  11. Testes de segurança (quando aplicável)                      │
│  12. Testes de isolamento multi-tenant (quando aplicável)        │
│  13. Testes de RBAC (quando aplicável)                           │
│  14. Testes de RLS (quando aplicável)                            │
├──────────────────────────────────────────────────────────────────┤
│  FASE DE VALIDAÇÃO                                               │
├──────────────────────────────────────────────────────────────────┤
│  15. Regressão obrigatória (todas as suites anteriores)          │
│  16. Validar UI contra design system (checklist 03-*)            │
│  17. Validar auditoria (ações críticas geraram eventos?)         │
│  18. Validar logs (dados sensíveis presentes?)                   │
│  19. Validar rollback (plano documentado e testável?)            │
├──────────────────────────────────────────────────────────────────┤
│  FASE DE ENCERRAMENTO                                            │
├──────────────────────────────────────────────────────────────────┤
│  20. Gerar relatório final (docs/enterprise/reports/phase-N-*)   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Definition of Done Global

Uma entrega só pode ser marcada como **CONCLUÍDA** se TODOS os 17 critérios abaixo forem verdadeiros:

| # | Critério | Verificação |
|---|---|---|
| G01 | O escopo implementado corresponde exatamente ao harness da fase | Comparar harness vs. commits |
| G02 | Nenhuma feature fora do escopo foi adicionada | Review de diff |
| G03 | Nenhum componente visual quebrou a identidade atual da UI | Checklist `03-ui-design-system-guardrails.md` |
| G04 | Nenhuma query crítica ignora `tenant_id` (a partir Fase 1) | Code review + TT01 passando |
| G05 | Nenhum acesso sensível ignora RBAC | Code review + PT01 passando |
| G06 | Nenhuma ação crítica ignora auditoria (a partir Fase 3) | Code review + AT01 passando |
| G07 | Nenhum documento assinado pode ser alterado sem retificação (a partir Fase 4) | Code review + SIG03 passando |
| G08 | Nenhum dado sensível aparece em logs | Inspecionar logs de teste |
| G09 | Nenhum endpoint novo fica sem validação de entrada (Zod) | Code review |
| G10 | Nenhum fluxo sensível fica sem teste mínimo | Suite da fase passando |
| G11 | Build passa | `pnpm --filter web build` ✅ |
| G12 | Typecheck passa | `pnpm typecheck` ✅ |
| G13 | Lint passa (se existir) | `pnpm lint` ✅ |
| G14 | Testes aplicáveis passam | Suite da fase ✅ |
| G15 | Regressão obrigatória passa | `pnpm test:e2e` ✅ |
| G16 | Smoke test passa | `pnpm test:e2e --project=chromium` ✅ |
| G17 | Relatório final da fase foi gerado | Arquivo em `reports/phase-N-*` ✅ |

**Se qualquer critério for falso → a fase está REPROVADA → não é entregue.**

---

## Condições de Reprovação Automática

A fase é marcada automaticamente como **REPROVADA** se qualquer uma das condições abaixo ocorrer:

| # | Condição | Descrição |
|---|---|---|
| REP01 | Build falhou | `next build` ou `tsc` com erros |
| REP02 | Typecheck falhou | `pnpm typecheck` com erros de tipo |
| REP03 | Teste crítico falhou | Qualquer teste da suite da fase falhando |
| REP04 | Regressão falhou | Qualquer teste de fase anterior falhando |
| REP05 | Vazamento entre tenants detectado | TT01 ou qualquer teste de isolamento falhando |
| REP06 | Escalada de privilégio detectada | PT01 ou qualquer teste de RBAC falhando |
| REP07 | Ação crítica ficou sem audit_event | Ação sensível sem registro em `audit_events` |
| REP08 | Documento assinado pôde ser alterado | UPDATE em document_signatures possível |
| REP09 | UI quebrou padrão visual sem justificativa | Checklist de UI com item falho não justificado |
| REP10 | Dado sensível apareceu em log | Senha, token, TOTP, template biométrico em log |
| REP11 | Endpoint sensível ficou sem validação | Endpoint aceita input sem Zod schema |
| REP12 | Foi implementado escopo não autorizado | Commit com feature não descrita no harness |
| REP13 | Não há evidência suficiente da validação | Relatório final ausente ou incompleto |

---

## Comandos de Validação (Repositório Atual)

### Comandos existentes e verificados

```bash
# ═══════════════════════════════════════
# BUILD
# ═══════════════════════════════════════
pnpm --filter web build             # Build do frontend (Next.js)
# Saída esperada: "✓ Compiled successfully"
# Falha: qualquer erro de compilação → REP01

# ═══════════════════════════════════════
# TYPECHECK
# ═══════════════════════════════════════
pnpm typecheck                      # Turbo: web + bff typecheck em paralelo
pnpm --filter web typecheck         # Typecheck apenas do frontend
pnpm --filter bff typecheck         # Typecheck apenas do BFF
# Saída esperada: zero erros de tipo
# Falha: qualquer erro TypeScript → REP02

# ═══════════════════════════════════════
# LINT
# ═══════════════════════════════════════
pnpm lint                           # Turbo: lint em todos os workspaces
pnpm --filter web lint              # ESLint no frontend
# Saída esperada: zero warnings/errors
# Falha: qualquer erro de lint → REP02 (tratado como typecheck)

# ═══════════════════════════════════════
# TESTES E2E (Playwright)
# ═══════════════════════════════════════
cd apps/web && pnpm test:e2e                         # Todos os projetos
cd apps/web && pnpm test:e2e --project=chromium      # Smoke tests
cd apps/web && pnpm test:e2e --project=suite         # Suite principal
cd apps/web && pnpm test:e2e --project=ssa-suite     # SSA
cd apps/web && pnpm test:e2e --project=nexus-suite   # Nexus
cd apps/web && pnpm test:e2e --project=rate-limit    # Rate limit
cd apps/web && pnpm test:e2e --project=stress        # Stress
cd apps/web && pnpm test:e2e --project=status-suite  # Status + Detail

# Suites a criar por fase:
# Fase 1:  --project=multitenant-suite    → e2e/multitenant.spec.ts
# Fase 2:  --project=rbac-suite           → e2e/rbac.spec.ts
# Fase 3:  --project=audit-suite          → e2e/audit-events.spec.ts
# Fase 4:  --project=signature-suite      → e2e/signatures.spec.ts
# Fase 5:  --project=custody-suite        → e2e/custody.spec.ts
# Fase 6:  --project=handover-suite       → e2e/handovers.spec.ts
# Fase 7:  --project=dashboard-suite      → e2e/command-dashboard.spec.ts
# Fase 8:  --project=inventory-suite      → e2e/inventory.spec.ts

# Saída esperada: "X passed (Xs)" com 0 failed
# Falha: qualquer "failed" → REP03/REP04

# ═══════════════════════════════════════
# TESTES UNITÁRIOS (BFF)
# ═══════════════════════════════════════
cd apps/bff && pnpm test            # Bun test (se arquivos *.test.ts existirem)
# Saída esperada: "X tests passed"
# AUSENTE: não há testes unitários hoje → criar por fase

# ═══════════════════════════════════════
# FORMATAÇÃO
# ═══════════════════════════════════════
pnpm format                         # Prettier em todo o repositório
# AUSENTE como validação de CI — apenas formatação local
```

### Comandos AUSENTES (recomendar criação)

| Comando | Status | Recomendação |
|---|---|---|
| Testes de integração BFF | ❌ Ausente | Criar `apps/bff/src/__tests__/` com Bun test para endpoints críticos |
| Testes unitários de lib | ❌ Ausente | Criar `apps/bff/src/lib/__tests__/` para `audit-hash.ts`, `document-hash.ts` |
| Verificação de RLS | ❌ Ausente | Criar script SQL de verificação de policies via Supabase MCP |
| Verificação de migrations | ❌ Ausente | `supabase db diff` para checar schema drift |
| Smoke test de BFF | ❌ Ausente | `GET /health` retorna 200 |
| Coverage de testes | ❌ Ausente | Considerar para fases críticas (Fase 3, 4) |

---

## Definition of Done por Fase

Cada arquivo em `docs/enterprise/phases/` deve conter uma seção `## Definition of Done da Fase` com os 10 critérios abaixo:

### Template obrigatório para seção DoD em cada fase

```markdown
## Definition of Done da Fase N

### 1. Critérios Funcionais
- [ ] UC-XX: [Caso de uso] funciona end-to-end
- [ ] UC-XX: ...

### 2. Critérios Técnicos
- [ ] Build passa sem warnings: `pnpm --filter web build`
- [ ] Typecheck passa: `pnpm typecheck`
- [ ] Lint passa: `pnpm lint`
- [ ] Migrations aplicadas e verificadas

### 3. Critérios de Segurança
- [ ] Nenhum secret em código ou log
- [ ] Endpoints protegidos por authMiddleware + roleGuard
- [ ] CSRF validado em mutations
- [ ] Rate limit aplicado
- [ ] Input validado com Zod em todos os endpoints

### 4. Critérios de Auditoria (a partir Fase 3)
- [ ] Toda ação sensível gera audit_event
- [ ] Evento contém: actor, tenant, unidade, resource, before, after, ip, timestamp
- [ ] Hash do evento calculado e verificável
- [ ] Logs sem dados sensíveis

### 5. Critérios Multi-tenant (a partir Fase 1)
- [ ] tenant_id em todas as novas tabelas
- [ ] Queries filtradas por tenant_id no BFF
- [ ] RLS policy de tenant isolation criada
- [ ] TT01 passando: usuário de tenant A não vê dados de tenant B

### 6. Critérios RBAC (a partir Fase 2)
- [ ] roleGuard aplicado em todos os endpoints da fase
- [ ] PT01 passando: role insuficiente retorna 403
- [ ] Nenhuma escalada de privilégio detectada

### 7. Critérios de UI
- [ ] Checklist de UI do doc 03-ui-design-system-guardrails.md completo
- [ ] Mobile testado em 375px
- [ ] Estados vazios e de erro implementados
- [ ] Nenhum componente duplicado

### 8. Critérios de Performance Mínima
- [ ] Endpoint principal responde em < 800ms (p95)
- [ ] Página carrega em < 2s (FCP) em conexão 4G simulada
- [ ] Sem memory leaks óbvios em listagens grandes

### 9. Critérios de Regressão
- [ ] Suite da fase atual: X/X passando
- [ ] Chromium smoke: ✅
- [ ] Suite principal: ✅
- [ ] SSA suite: ✅
- [ ] Nexus suite: ✅
- [ ] Rate limit: ✅
- [ ] Suites de fases anteriores: ✅

### 10. Evidências Obrigatórias
- [ ] Screenshot ou output de terminal da suite da fase passando
- [ ] Output de `pnpm typecheck` sem erros
- [ ] Output de `pnpm --filter web build` bem-sucedido
- [ ] Relatório final em docs/enterprise/reports/phase-N-final-report.md
```

---

## Validação sob Estresse Operacional

Quando uma fase envolve fluxo crítico, ela só pode ser considerada concluída após validação dos seguintes cenários de estresse:

### 🏢 Multi-tenant (Fase 1+)

| # | Cenário | Resultado esperado |
|---|---|---|
| MT-S01 | Dois tenants com dados semelhantes (mesmo nome de material) | Query retorna apenas dados do tenant correto |
| MT-S02 | Usuário de Tenant A com token válido tenta GET de recurso de Tenant B via ID direto | 403 ou 0 resultados (RLS bloqueia) |
| MT-S03 | Admin de unidade A tenta ver/editar recurso de unidade B do mesmo tenant | 403 ou 0 resultados |
| MT-S04 | Parâmetro `tenant_id` forjado no body da requisição | BFF ignora — usa tenantId da sessão |
| MT-S05 | `?tenant_id=outro-uuid` na querystring | BFF ignora — usa tenantId da sessão |
| MT-S06 | RLS: anon key com tenant_id forjado no JWT | Supabase rejeita (assinatura inválida) |
| MT-S07 | service_role query sem filtro de tenant | Retorna TODOS os tenants (correto para Nexus) |
| MT-S08 | Criação de recurso sem tenant_id | NOT NULL constraint bloqueia |

### 🔐 RBAC (Fase 2+)

| # | Cenário | Resultado esperado |
|---|---|---|
| RBAC-S01 | `usuario` tenta POST /api/lendings | 403 |
| RBAC-S02 | `armeiro` tenta GET /api/nexus/health | 403 |
| RBAC-S03 | `admin_reserva` tenta criar tenant via Nexus | 403 |
| RBAC-S04 | `auditor` tenta PATCH em qualquer recurso | 403 |
| RBAC-S05 | `admin_global` de tenant A acessa dados de tenant B | 0 resultados (RLS) |
| RBAC-S06 | Usuário sem role em profiles tenta login | 401 ou role padrão aplicado |
| RBAC-S07 | Role no body forjado | BFF ignora — usa role da sessão |
| RBAC-S08 | `armeiro` de unidade A aprova saída de unidade B | 403 (se unidade_id validada) |

### 📋 Auditoria (Fase 3+)

| # | Cenário | Resultado esperado |
|---|---|---|
| AUD-S01 | Emitir cautela | audit_event com action="lending.created" criado |
| AUD-S02 | Evento criado | Contém actor_id, tenant_id, ip, user_agent, timestamp |
| AUD-S03 | Evento N+1 | previous_hash = hash do evento N |
| AUD-S04 | Alterar evento diretamente | RULE SQL bloqueia silenciosamente |
| AUD-S05 | Deletar evento | RULE SQL bloqueia silenciosamente |
| AUD-S06 | Varredura de integridade | Todos os hashes verificam corretamente |
| AUD-S07 | Exportação de dados | audit_event com action="export.data" criado |
| AUD-S08 | Acesso negado (403) | Considerar logar em audit_events para análise |

### ✍️ Assinatura Eletrônica (Fase 4+)

| # | Cenário | Resultado esperado |
|---|---|---|
| SIG-S01 | Assinar documento | document_hash gerado, signature_proof calculado |
| SIG-S02 | Tentar assinar mesmo documento duas vezes | Rejeitar duplicata ou retornar assinatura existente |
| SIG-S03 | Tentar UPDATE em document_signatures | RULE SQL bloqueia |
| SIG-S04 | Retificação de documento assinado | Novo documento + assinatura revogada + audit_event |
| SIG-S05 | TOTP inválido na assinatura | 400 — não cria assinatura |
| SIG-S06 | TOTP expirado (anti-replay) | 400 — não cria assinatura |
| SIG-S07 | Verificação pública via `/v/[id]?hash=[hash]` | Retorna status correto sem dados sensíveis |
| SIG-S08 | Hash adulterado na URL de verificação | Retorna "documento inválido" |

### 📦 Cautela Eletrônica (Fase 5+)

| # | Cenário | Resultado esperado |
|---|---|---|
| CAU-S01 | Emitir cautela de item já cautelado | 409 Conflict |
| CAU-S02 | Militar com cautela ativa tenta abrir segunda do mesmo tipo | 409 Conflict |
| CAU-S03 | Devolução de cautela inexistente | 404 |
| CAU-S04 | Devolução com quantidade maior que emitida | 422 |
| CAU-S05 | Status machine: transição inválida (ex: devolvida → ativa) | 422 |
| CAU-S06 | PDF gerado com hash verificável | Hash no documento = hash no banco |
| CAU-S07 | Histórico do material atualizado após saída/devolução | material_types.quantidade atualizada |
| CAU-S08 | Divergência na devolução cria ocorrência automaticamente | ocorrencias +1 |

### 📖 Livro Digital de Serviço (Fase 6+)

| # | Cenário | Resultado esperado |
|---|---|---|
| LDS-S01 | Armeiro inicia passagem | Snapshot automático reflete estado real |
| LDS-S02 | Snapshot com cautelas ativas | cautelas_ativas no JSON = COUNT(lendings ativas) |
| LDS-S03 | Prazo de assumção vencido | status → 'vencido', alerta para admin |
| LDS-S04 | Assunção com divergência | status → 'divergencia', justificativa obrigatória |
| LDS-S05 | Finalizar sem assinatura do entrante | 422 — documento não finaliza |
| LDS-S06 | Mesmo armeiro tentando assinar como saindo e entrando | 422 |
| LDS-S07 | Upload de anexo com tipo inválido | 422 — validação de MIME |
| LDS-S08 | Admin vê status correto no dashboard | Cards do dashboard refletem estado real |

### 📊 Dashboard de Comando (Fase 7+)

| # | Cenário | Resultado esperado |
|---|---|---|
| DASH-S01 | Cards mostram contagens reais | Criar registro → contador aumenta na UI |
| DASH-S02 | Filtro por unidade | Cards mostram apenas dados da unidade selecionada |
| DASH-S03 | Estado vazio | Cards mostram 0 sem quebrar |
| DASH-S04 | Dados de outro tenant não aparecem | admin_global de tenant A não vê dados de tenant B |
| DASH-S05 | Indicador de atraso | Passagem vencida aparece no card "Em Atraso" |

### 📦 Inventário Periódico (Fase 8+)

| # | Cenário | Resultado esperado |
|---|---|---|
| INV-S01 | Campanha criada | Carga esperada calculada automaticamente |
| INV-S02 | Unidade B não vê carga de unidade A | Isolamento por unidade_id |
| INV-S03 | Divergência sem justificativa | 422 — justificativa obrigatória |
| INV-S04 | Fechar campanha sem todas as unidades assinadas | 422 |
| INV-S05 | Relatório PDF gerado após fechamento | PDF com hash verificável |
| INV-S06 | Itens não conferidos | Aparecem como 'pendente' no relatório |

---

## Relatório Final Obrigatório por Fase

Cada fase deve gerar um relatório em `docs/enterprise/reports/phase-N-final-report.md`.

### Template do relatório final

```markdown
# Relatório Final — Fase N: [Nome da Fase]

**Fase:** N  
**Data de início:** YYYY-MM-DD  
**Data de encerramento:** YYYY-MM-DD  
**Executor:** [Nome ou identificação]  
**Status final:** ✅ APROVADA | ⚠️ APROVADA COM RESSALVAS | ❌ REPROVADA

---

## 1. Escopo Planejado
(copiar do harness)

## 2. Escopo Entregue
- Item implementado 1
- Item implementado 2

## 3. Arquivos Alterados
| Arquivo | Tipo de alteração | Motivo |
|---|---|---|
| `path/file.ts` | MODIFICADO | Descrição |
| `path/new.ts` | CRIADO | Descrição |

## 4. Migrations Criadas
| Arquivo | O que criou/alterou |
|---|---|
| `YYYYMMDDNNNNNN_desc.sql` | Descrição |

## 5. Endpoints Criados ou Alterados
| Método | Path | Ação | Status |
|---|---|---|---|
| POST | `/api/recurso` | CRIADO | ✅ |

## 6. Componentes Criados ou Alterados
| Componente | Caminho | Ação |
|---|---|---|
| `NomeComponente` | `path/to.tsx` | CRIADO |

## 7. Testes Executados
| Suite | Comando | Total | Passou | Falhou |
|---|---|---|---|---|
| Suite da fase | `pnpm test:e2e --project=phase-N-suite` | X | X | 0 |
| Smoke | `--project=chromium` | X | X | 0 |
| SSA | `--project=ssa-suite` | X | X | 0 |
| Nexus | `--project=nexus-suite` | X | X | 0 |
| Regressão completa | `pnpm test:e2e` | X | X | 0 |

## 8. Build e Typecheck
```
pnpm --filter web build     → ✅ OK
pnpm typecheck              → ✅ OK
pnpm lint                   → ✅ OK
```

## 9. Evidências
- Screenshot: [descrição]
- Output: [trecho de terminal]

## 10. Riscos Remanescentes
- Risco 1: descrição + fase que resolve

## 11. Bugs Conhecidos
- Bug 1: descrição + severidade + fase que resolve

## 12. Itens Fora do Escopo (não implementados nesta fase)
- Item X → mover para Fase N+1

## 13. Rollback Disponível
- Como reverter esta fase em < 30 minutos

## 14. Checklist de Definition of Done

| Critério | Status |
|---|---|
| G01: Escopo correto | ✅ |
| G02: Sem feature extra | ✅ |
| G03: UI consistente | ✅ |
| G04: tenant_id nas queries | ✅ |
| G05: RBAC aplicado | ✅ |
| G06: Auditoria completa | ✅ |
| G07: Documentos protegidos | ✅ |
| G08: Sem dado sensível em log | ✅ |
| G09: Input validado | ✅ |
| G10: Fluxos testados | ✅ |
| G11: Build ✅ | ✅ |
| G12: Typecheck ✅ | ✅ |
| G13: Lint ✅ | ✅ |
| G14: Testes passando | ✅ |
| G15: Regressão passando | ✅ |
| G16: Smoke test ✅ | ✅ |
| G17: Relatório gerado | ✅ |

## 15. Conclusão

**Status:** APROVADA

Descrição do que foi entregue e do estado do sistema após esta fase.

**Próxima fase:** Phase N+1 — [Nome]  
**Prompt para próxima fase:** [Prompt sugerido para iniciar Fase N+1]
```

---

## Regra de UI Consistency Canônica

```
╔═══════════════════════════════════════════════════════════════════╗
║                                                                   ║
║  Nenhuma fase pode criar novo padrão visual próprio.             ║
║                                                                   ║
║  Toda nova tela, card, tabela, modal, badge, filtro, toast,      ║
║  formulário, empty state e loading state deve seguir o design    ║
║  atual documentado em 03-ui-design-system-guardrails.md.         ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
```

Se for necessário criar componente novo:

1. Justificar: por que componente existente não atende
2. Demonstrar: como o novo componente preserva identidade visual
3. Documentar: adicionar ao inventário em `03-ui-design-system-guardrails.md`
4. Localizar: criar em `apps/web/src/components/ui/` se genérico, ou em `components/[modulo]/` se específico

---

## Hierarquia de Autoridade Quando Há Conflito

```
1. CLAUDE.md (regras do projeto)                    ← máxima autoridade
2. 07-canonical-definition-of-done.md (este doc)    ← autoridade de entrega
3. 06-implementation-governance.md                  ← regras de execução
4. Harness da fase (phases/phase-N-*.md)            ← escopo e critérios
5. 00-global-prd.md                                 ← requisitos
6. 01-global-technical-spec.md                      ← arquitetura
7. 02-enterprise-roadmap.md                         ← priorização
```

---

## Resumo Executivo

| O que é entrega | O que NÃO é entrega |
|---|---|
| Implementado + testado + validado + evidenciado | Código commitado |
| Todas as 17 condições do DoD verdadeiras | Build passando isoladamente |
| Regressão completa verde | "Testei manualmente e funcionou" |
| Relatório final gerado | Tarefa marcada como concluída |
| Zero condições de reprovação automática | Pull request mergeado |

---

*Definition of Done Canônica v1.0 — 2026-06-20*  
*Este documento prevalece sobre qualquer outra definição de "concluído" no projeto.*
