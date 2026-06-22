# Template de Harness de Fase

> **Versão:** 1.1  
> **Data:** 2026-06-20  
> **Propósito:** Template base que todo arquivo `phases/phase-N-*.md` deve seguir  
> **Uso:** Copiar e preencher para cada nova fase antes de iniciar implementação  
> **DoD Canônica:** Ver `07-canonical-definition-of-done.md`

---

## Regra Canônica de Entrega

```
IMPLEMENTADO NÃO É ENTREGUE.

ENTREGUE = implementado + testado + validado + auditado +
           regressão aprovada + critérios de aceite comprovados +
           evidência final documentada.
```

---

## Como Usar Este Template

1. Copiar este arquivo para `docs/enterprise/phases/phase-N-nome.md`
2. Preencher TODOS os 30 campos abaixo
3. Revisar contra `00-global-prd.md` e `01-global-technical-spec.md`
4. Obter aprovação antes de começar qualquer alteração de código
5. Usar como referência durante toda a execução da fase
6. Gerar relatório final ao encerrar

---

## Harness da Fase N — [Nome da Fase]

### Campo 1 — Nome da Fase
`phase-N-nome-da-fase`

**Nome legível:** Nome Completo da Fase  
**Código de identificação:** `PH-N`

---

### Campo 2 — Objetivo

Uma frase clara descrevendo o resultado esperado ao final desta fase.

> Exemplo: "Adicionar isolamento multi-tenant real com `tenant_id` em todas as tabelas sensíveis, RLS policies correspondentes e suporte no BFF para propagação do tenant na sessão."

---

### Campo 3 — Escopo

Lista explícita do que ESTÁ dentro desta fase:

- Item de escopo 1
- Item de escopo 2
- Item de escopo 3

---

### Campo 4 — Fora do Escopo

Lista explícita do que NÃO está nesta fase (evita scope creep):

- ❌ Feature X — reservada para Fase N+1
- ❌ Refatoração Y — não é necessária para o objetivo
- ❌ Integração Z — depende de fase posterior

---

### Campo 5 — Premissas

O que deve ser verdadeiro antes de iniciar esta fase:

| # | Premissa | Como verificar |
|---|---|---|
| P1 | Fase N-1 está completa com todos os critérios de aceite passando | Rodar regressão completa |
| P2 | Suites E2E existentes passando sem falha | `pnpm test:e2e --project=suite` |
| P3 | Descrição específica da premissa | Comando/verificação |

---

### Campo 6 — Arquivos Permitidos para Alteração

Lista de arquivos que PODEM ser alterados nesta fase:

**BFF:**
- `apps/bff/src/routes/[arquivo].ts` — descrição do motivo
- `apps/bff/src/lib/[arquivo].ts` — descrição do motivo
- `apps/bff/src/middleware/[arquivo].ts` — descrição do motivo

**Frontend:**
- `apps/web/src/app/(dashboard)/[rota]/page.tsx` — descrição
- `apps/web/src/components/[componente].tsx` — descrição

**Database:**
- `supabase/migrations/YYYYMMDDNNNNNN_descricao.sql` — migration nova

**Testes:**
- `apps/web/e2e/[suite].spec.ts` — nova suite da fase

---

### Campo 7 — Arquivos Proibidos para Alteração

Arquivos que NÃO devem ser tocados nesta fase (exceto aprovação documentada):

| Arquivo | Motivo da proibição |
|---|---|
| `apps/bff/src/routes/auth.ts` | Autenticação — mudança aqui pode quebrar login |
| `apps/bff/src/routes/nexus.ts` | Nexus — isolado e já testado |
| `supabase/migrations/20260611*.sql` | Migration inicial — nunca alterar migrations existentes |
| `apps/web/src/components/ui/*.tsx` | Design system — só alterar via processo de design |

**Regra geral de migrations:** NUNCA editar migration já commitada. Criar nova migration.

---

### Campo 8 — Tabelas Permitidas

Tabelas do banco de dados que PODEM ser alteradas ou criadas:

| Tabela | Operação | Justificativa |
|---|---|---|
| `nova_tabela` | CREATE | Nova funcionalidade |
| `tabela_existente` | ALTER ADD COLUMN | Adicionar campo necessário |

---

### Campo 9 — Tabelas Proibidas

Tabelas que NÃO devem ser alteradas nesta fase:

| Tabela | Motivo |
|---|---|
| `auth.users` | Gerenciada pelo Supabase — nunca alterar diretamente |
| `totp_secrets` | Crítica de segurança — requer fase específica |
| `audit_logs` | Imutável — só INSERT via service_role |

---

### Campo 10 — Endpoints Envolvidos

Endpoints BFF que serão criados ou modificados:

| Método | Path | Role | Ação |
|---|---|---|---|
| `POST` | `/api/[recurso]` | admin, master | CRIAR — descrição |
| `GET` | `/api/[recurso]/:id` | admin | LER — descrição |
| `PATCH` | `/api/[recurso]/:id` | admin | ATUALIZAR — descrição |

---

### Campo 11 — Componentes de UI Envolvidos

Componentes React que serão criados ou modificados:

| Componente | Caminho | Ação |
|---|---|---|
| `NovoComponente` | `apps/web/src/components/[modulo]/novo.tsx` | CRIAR |
| `ComponenteExistente` | `apps/web/src/components/[modulo]/existente.tsx` | MODIFICAR |

---

### Campo 12 — Feature Flags

Se a fase usa feature flags para rollout seguro:

| Flag | Valor padrão | Quando ativar |
|---|---|---|
| `FEATURE_X_ENABLED` | `false` | Após testes de integração |

> Se não há feature flags nesta fase: `N/A — esta fase não usa feature flags.`

---

### Campo 13 — Migrações Necessárias

Lista de migrations SQL a criar:

| Arquivo | Propósito |
|---|---|
| `YYYYMMDDNNNNNN_descricao.sql` | Descrever o que a migration faz |

**Ordem de execução:**
1. Migration A (dependência de B)
2. Migration B

**Checklist de migration:**
- [ ] Migration tem rollback (DROP TABLE / DROP COLUMN) documentado
- [ ] Migration é idempotente (CREATE IF NOT EXISTS quando possível)
- [ ] RLS policies incluídas na migration
- [ ] Migration testada em branch Supabase antes de aplicar em produção

---

### Campo 14 — Plano de Dados / Seed

Dados de teste necessários para esta fase:

```sql
-- Seed para testes da Fase N
-- Arquivo: supabase/seeds/phase-N-test-data.sql

-- Inserir dados de exemplo necessários para os testes
```

**O que o seed deve conter:**
- Usuários de teste com roles específicos da fase
- Dados necessários para exercitar os endpoints
- Dados de fronteira (ex: tenant com zero registros, tenant com 1000 registros)

---

### Campo 15 — Testes Unitários

Testes unitários a criar (se aplicável):

| Arquivo de teste | O que testa |
|---|---|
| `apps/bff/src/lib/__tests__/[modulo].test.ts` | Funções puras críticas (hash, cálculos) |

> Se não há lógica pura testável unitariamente: `N/A — lógica desta fase é coberta pelos E2E.`

---

### Campo 16 — Testes de Integração

Testes de integração BFF a criar:

| Endpoint | Cenário | Resultado esperado |
|---|---|---|
| `POST /api/[recurso]` | Payload válido com role correto | 201 Created + registro no banco |
| `POST /api/[recurso]` | Sem sessão | 401 Unauthorized |
| `POST /api/[recurso]` | Role insuficiente | 403 Forbidden |

---

### Campo 17 — Testes E2E

Suite Playwright a criar para esta fase:

**Arquivo:** `apps/web/e2e/phase-N-[modulo].spec.ts`  
**Suite no `playwright.config.ts`:** `phase-N-suite`

| ID | Teste | Critério |
|---|---|---|
| PN01 | Descrição do teste 1 | Critério de aceite |
| PN02 | Descrição do teste 2 | Critério de aceite |

**Configuração da suite:**
```typescript
{
  name: "phase-N-suite",
  use: { ...devices["Desktop Chrome"] },
  testMatch: ["e2e/phase-N-*.spec.ts"],
  workers: 1,
  retries: 1,
  timeout: 60_000,
}
```

---

### Campo 18 — Testes de Segurança

Testes de segurança específicos desta fase:

| ID | Cenário | Resultado esperado |
|---|---|---|
| SEC-N-01 | Acesso sem autenticação ao endpoint | 401 |
| SEC-N-02 | Acesso com role incorreto | 403 |
| SEC-N-03 | Dados de outro tenant acessíveis? | 0 resultados (RLS bloqueia) |
| SEC-N-04 | CSRF bypass tentado | 403 |

---

### Campo 19 — Testes de Regressão

Suites existentes que devem passar antes de considerar a fase concluída:

```bash
# Regressão obrigatória antes de encerrar Fase N
pnpm test:e2e --project=chromium          # smoke tests
pnpm test:e2e --project=suite             # suite principal
pnpm test:e2e --project=ssa-suite         # SSA
pnpm test:e2e --project=nexus-suite       # Nexus
pnpm test:e2e --project=rate-limit        # rate limit
# + suites de fases anteriores (Fase 1+: multitenant-suite, etc.)
```

**Zero falhas permitidas.** Se qualquer teste de regressão falhar, a fase não está concluída.

---

### Campo 20 — Critérios de Aceite

Os critérios que devem ser verdadeiros para a fase ser declarada concluída:

| # | Critério | Como verificar |
|---|---|---|
| CA01 | Descrição do critério | Evidência/comando |
| CA02 | Critério de negócio | Verificação manual ou automatizada |
| CA03 | Zero regressão nas suites existentes | `pnpm test:e2e` all green |

**Critério de BLOQUEIO:** descrever a condição que, se falhar, impede absolutamente o encerramento da fase.

---

### Campo 21 — Checklist de UI

- [ ] Seguiu guardrails de design system (`03-ui-design-system-guardrails.md`)
- [ ] Nenhum componente novo duplica existente em `ui/`
- [ ] Usa AppShell como wrapper
- [ ] Mobile testado em 375px
- [ ] Loading states em todas as ações async
- [ ] Estados vazios com ícone + texto + CTA
- [ ] Erros exibem toast ou Alert adequado
- [ ] Linguagem institucional (sem emojis, sem gírias)
- [ ] Datas formatadas em `dd/MM/yyyy HH:mm`

---

### Campo 22 — Checklist de Segurança

- [ ] Nenhuma secret/credencial exposta em código ou log
- [ ] Endpoint protegido por `authMiddleware` + `roleGuard`
- [ ] CSRF validado em mutations
- [ ] Rate limit aplicado onde necessário
- [ ] `tenant_id` propagado e validado em todas as queries (a partir Fase 1)
- [ ] RLS policy adicionada para novas tabelas
- [ ] `service_role` key usada apenas no BFF, nunca no frontend
- [ ] Input do usuário validado com Zod no BFF

---

### Campo 23 — Checklist de Auditoria

- [ ] Toda ação sensível gera registro em `audit_events` (a partir Fase 3)
- [ ] Evento tem `before_snapshot` e `after_snapshot` quando aplicável
- [ ] Evento registra `actor_id`, `tenant_id`, `ip`, `user_agent`
- [ ] Documento assinado não é alterado — nova versão/retificação se necessário
- [ ] Exportações geram registro de auditoria
- [ ] Logs não contêm dados sensíveis (senha, TOTP, tokens)

---

### Campo 24 — Checklist de LGPD

- [ ] Novos dados pessoais têm base legal documentada
- [ ] Dados biométricos com criptografia em repouso (AES-256)
- [ ] `tenant_id` em todas as tabelas com dados pessoais
- [ ] Retenção de dados documentada (ex: audit logs: 5 anos)
- [ ] Nenhum dado pessoal em variável de ambiente ou log

---

### Campo 25 — Plano de Rollback

Como desfazer esta fase se algo der errado em produção:

**Nível 1 (sem downtime):** Revert do commit + redeploy
```bash
git revert [commit-hash]
git push origin main
# CF Pages deploya automaticamente
# BFF: docker compose restart (Hetzner)
```

**Nível 2 (com downtime breve):** Rollback de migration
```sql
-- Migration de rollback (criar antes de aplicar a migration)
-- Reverter: DROP TABLE / DROP COLUMN / DROP POLICY
```

**Nível 3 (falha grave):** Restaurar backup do Supabase
```
1. Supabase Dashboard → Database → Backups
2. Restaurar para o ponto anterior à migration
3. Revert do deploy
```

**Tempo máximo de rollback:** < 30 minutos para Nível 1, < 2 horas para Nível 2.

---

### Campo 26 — Evidências Esperadas ao Final

Screenshots, outputs de terminal ou logs que provam que a fase foi bem-sucedida:

| Evidência | Formato | Como capturar |
|---|---|---|
| Suite E2E da fase passando | Screenshot ou output de terminal | `pnpm test:e2e --project=phase-N-suite` |
| Regressão completa passando | Output de terminal | `pnpm test:e2e` all green |
| Funcionalidade X demonstrada | Screenshot do browser | Teste manual + Playwright MCP |
| Migration aplicada com sucesso | Output do Supabase MCP | `list_migrations` ou `execute_sql` |

---

### Campo 27 — Comandos Seguros

Comandos que podem ser executados sem aprovação adicional:

```bash
# Leitura
git log --oneline -10
git diff HEAD~1
pnpm --filter web build  # checar erros de TypeScript

# Testes
pnpm test:e2e --project=chromium
pnpm test:e2e --project=suite
pnpm test:e2e --project=phase-N-suite

# Verificação de banco (readonly)
# Via Supabase MCP: list_tables, execute_sql SELECT apenas
```

---

### Campo 28 — Comandos Proibidos

Comandos que NÃO devem ser executados sem aprovação explícita:

```bash
# Nunca sem aprovação
git push --force
git reset --hard
git checkout -- .

# Banco: nunca em produção sem aprovação
supabase db push  # em produção
# Execute SQL com DROP, TRUNCATE, UPDATE sem WHERE

# Deploy
# Não fazer push sem teste E2E passando
```

---

### Campo 29 — Resultado Esperado no Terminal

Output de terminal que indica sucesso da fase:

```
# pnpm test:e2e --project=phase-N-suite
Running X tests using Y workers

  PN01  [Descrição do teste 1] (Xs)
  PN02  [Descrição do teste 2] (Xs)
  ...

  X passed (Xs)

# pnpm test:e2e (regressão completa)
  X passed (Xs)
  0 failed
```

---

### Campo 30 — Relatório Final da Fase

Ao encerrar a fase, criar relatório em `docs/enterprise/reports/phase-N-report.md`:

```markdown
# Relatório Final — Fase N: [Nome]

**Data de início:** YYYY-MM-DD  
**Data de encerramento:** YYYY-MM-DD  
**Status:** ✅ Concluída

## O que foi implementado
- Item 1
- Item 2

## Arquivos modificados
- `path/to/file.ts` — o que foi alterado

## Migrations aplicadas
- `YYYYMMDDNNNNNN_descricao.sql` — o que criou/alterou

## Testes
- Suite da fase: X/X passando
- Regressão: Y/Y passando

## Desvios do plano original
- Desvio 1: o que mudou e por quê

## Riscos residuais
- Risco identificado que persiste para fases futuras

## Prompt para próxima fase
[Prompt para iniciar a Fase N+1]
```

---

## Definition of Done da Fase

> Copiar e preencher ao encerrar a fase. Todos os itens devem ser ✅ para a fase ser APROVADA.

### 1. Critérios Funcionais
- [ ] UC-XX: [caso de uso] funciona end-to-end
- [ ] [Descrever critério funcional adicional]

### 2. Critérios Técnicos
- [ ] Build passa: `pnpm --filter web build`
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
- [ ] TT01 passando

### 6. Critérios RBAC (a partir Fase 2)
- [ ] roleGuard aplicado em todos os endpoints da fase
- [ ] PT01 passando
- [ ] Nenhuma escalada de privilégio detectada

### 7. Critérios de UI
- [ ] Checklist de UI (doc 03-ui-design-system-guardrails.md) completo
- [ ] Mobile testado em 375px
- [ ] Estados vazios e de erro implementados
- [ ] Nenhum componente duplicado

### 8. Critérios de Performance Mínima
- [ ] Endpoint principal responde em < 800ms (p95)
- [ ] Página carrega em < 2s (FCP) em conexão 4G simulada

### 9. Critérios de Regressão
- [ ] Suite da fase: X/X passando
- [ ] Chromium smoke: ✅
- [ ] Suite principal: ✅
- [ ] SSA suite: ✅
- [ ] Nexus suite: ✅
- [ ] Rate limit: ✅
- [ ] Suites de fases anteriores: ✅

### 10. Evidências Obrigatórias
- [ ] Screenshot ou output de terminal da suite passando
- [ ] Output de `pnpm typecheck` sem erros
- [ ] Output de `pnpm --filter web build` bem-sucedido
- [ ] Relatório final em `docs/enterprise/reports/phase-N-final-report.md`

---

## Checklist de Início de Fase (20 Etapas)

Antes de começar qualquer código, confirmar:

```
PLANEJAMENTO:
[ ] 1. Li o PRD global (docs/enterprise/00-global-prd.md)
[ ] 2. Li a spec técnica global (docs/enterprise/01-global-technical-spec.md)
[ ] 3. Li os guardrails de UI (docs/enterprise/03-ui-design-system-guardrails.md)
[ ] 4. Li o harness desta fase (docs/enterprise/phases/phase-N-*.md)
[ ] 5. Declarei plano de execução (aprovado antes de alterar código)

IMPLEMENTAÇÃO:
[ ] 6. Implementar apenas escopo autorizado
[ ] 7. Build + typecheck + lint passando

TESTES:
[ ] 8. Testes unitários (se aplicável)
[ ] 9. Testes de integração (se aplicável)
[ ] 10. Testes E2E da fase passando
[ ] 11. Testes de segurança
[ ] 12. Testes de isolamento multi-tenant (Fase 1+)
[ ] 13. Testes de RBAC (Fase 2+)
[ ] 14. Testes de RLS (Fase 1+)

VALIDAÇÃO:
[ ] 15. Regressão obrigatória passando (ZERO falhas)
[ ] 16. UI validada contra design system
[ ] 17. Auditoria validada (ações sensíveis geram eventos)
[ ] 18. Logs sem dados sensíveis
[ ] 19. Rollback documentado e testável

ENCERRAMENTO:
[ ] 20. Relatório final gerado em docs/enterprise/reports/phase-N-final-report.md
```

---

*Template v1.0 — 2026-06-20*  
*Copiar este arquivo para cada nova fase. Nunca alterar o template diretamente.*
