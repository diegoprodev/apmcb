# Fase 0 — Baseline e Governança

> **DoD Canônica:** IMPLEMENTADO NÃO É ENTREGUE — ver `../07-canonical-definition-of-done.md`  
> **Harness ID:** PH-0

---

## Objetivo

Mapear o estado atual do sistema sem alterar nenhuma linha de código, garantir que toda a documentação enterprise está criada e coerente, e confirmar que a infraestrutura de testes existente está 100% verde. Esta fase cria a linha base inviolável de qualidade para todas as fases seguintes.

---

## Escopo

- Criação da estrutura `docs/enterprise/` com todos os documentos base
- Criação do seed de dados de teste enterprise (`supabase/seed-enterprise.sql`)
- Verificação e documentação do estado atual de todas as suites E2E
- Confirmação de que build, typecheck e lint passam sem erros
- Identificação e documentação de débitos técnicos existentes (sem corrigir)

---

## Fora do Escopo

- ❌ Nenhuma alteração de código fonte (`.ts`, `.tsx`, `.js`)
- ❌ Nenhuma alteração de migrations existentes
- ❌ Nenhuma nova migration
- ❌ Nenhuma feature nova
- ❌ Nenhuma correção de bug (documentar apenas)

---

## Premissas

| # | Premissa | Como verificar |
|---|---|---|
| P1 | Repositório em branch `main` sem conflitos | `git status` limpo |
| P2 | Supabase project ativo (`jepitcrkicwmvzrmllpn`) | Dashboard Supabase acessível |
| P3 | Hetzner BFF rodando | `GET /health` responde 200 |
| P4 | CF Pages frontend acessível | URL do projeto carrega |

---

## Arquivos Permitidos para Alteração

- `docs/enterprise/*.md` — documentação (não é código)
- `docs/enterprise/phases/*.md` — specs de fase
- `supabase/seed-enterprise.sql` — seed de dados (arquivo novo)

## Arquivos Proibidos

| Arquivo | Motivo |
|---|---|
| `apps/bff/src/**/*.ts` | Zero mudanças funcionais nesta fase |
| `apps/web/src/**/*.tsx` | Zero mudanças funcionais nesta fase |
| `supabase/migrations/*.sql` | Zero migrations novas |
| `apps/web/e2e/**/*.spec.ts` | Zero mudanças em testes |

---

## Tabelas Permitidas

Nenhuma — zero alterações de banco de dados.

## Tabelas Proibidas

Todas — nenhuma migration nesta fase.

---

## Endpoints

Nenhum novo endpoint. Nenhuma alteração de endpoint existente.

---

## Componentes de UI

Nenhum novo componente. Nenhuma alteração de componente existente.

---

## Feature Flags

N/A — esta fase não usa feature flags.

---

## Migrações

Nenhuma migration nesta fase.

---

## Plano de Dados / Seed

Criar `supabase/seed-enterprise.sql` com dados de teste para as fases seguintes:

```sql
-- Seed enterprise — dados de teste para Fases 1+
-- Usar apenas em ambiente de desenvolvimento/staging, nunca em produção

-- Usuários de teste (referem-se a auth.users existentes)
-- Admin: matricula 001, role=admin
-- Armeiro: matricula 002, role=master
-- Militar 1: matricula 003, role=usuario
-- Militar 2: matricula 004, role=usuario

-- Lendings de teste: 2 ativos, 1 devolvido
-- Material requests: 1 pendente, 1 aprovado
-- Ocorrências: 1 aberta
-- Audit logs: histórico dos 7 dias anteriores
```

---

## Testes Unitários

N/A — sem lógica nova.

## Testes de Integração

N/A — sem endpoints novos.

---

## Testes E2E (Verificação de Linha Base)

Rodar toda a suíte existente e documentar resultados:

```bash
cd apps/web

# Smoke
pnpm test:e2e --project=chromium

# Suite principal
pnpm test:e2e --project=suite

# SSA
pnpm test:e2e --project=ssa-suite

# Nexus
pnpm test:e2e --project=nexus-suite

# Rate limit
pnpm test:e2e --project=rate-limit

# Status/Detail
pnpm test:e2e --project=status-suite

# Invite
pnpm test:e2e --project=invite-suite

# Stress
pnpm test:e2e --project=stress

# Completo
pnpm test:e2e
```

**Resultado esperado:** 0 falhas em todas as suites.

Se qualquer suite falhar → documentar no relatório, investigar, e corrigir antes de avançar para Fase 1.

---

## Testes de Segurança

N/A — verificar apenas que os testes existentes de segurança (rate-limit, nexus-suite) passam.

---

## Testes de Regressão

**Esta fase establece a linha base de regressão.** Todas as suites existentes devem passar com 0 falhas. Se qualquer suite falhar, a Fase 0 está REPROVADA.

---

## Critérios de Aceite

| # | Critério | Verificação | Bloqueio? |
|---|---|---|---|
| CA01 | Todos os documentos `docs/enterprise/` criados | `ls docs/enterprise/` | ✅ Sim |
| CA02 | `pnpm test:e2e` all green — 0 falhas | Output de terminal | ✅ Sim |
| CA03 | `pnpm --filter web build` limpo | Output de terminal | ✅ Sim |
| CA04 | `pnpm typecheck` zero erros | Output de terminal | ✅ Sim |
| CA05 | Seed de dados criado e documentado | `ls supabase/seed-enterprise.sql` | ✅ Sim |
| CA06 | Débitos técnicos documentados | Seção no relatório final | Não |

---

## Checklist de UI

N/A — sem alterações de UI.

## Checklist de Segurança

- [ ] Seed não contém senhas reais ou tokens
- [ ] Seed usa apenas dados fictícios ou anônimos

## Checklist de Auditoria

N/A — sem ações auditadas nesta fase.

## Checklist de LGPD

- [ ] Seed usa dados fictícios (não dados reais de militares)

---

## Plano de Rollback

Não aplicável — esta fase não altera nenhum código ou banco de dados.

Se algo der errado com a documentação: corrigir os arquivos Markdown diretamente.

---

## Evidências Esperadas

| Evidência | Como capturar |
|---|---|
| Output de `pnpm test:e2e` com 0 falhas | Terminal screenshot |
| Output de `pnpm --filter web build` ok | Terminal screenshot |
| `ls docs/enterprise/` mostrando todos os arquivos | Terminal screenshot |

---

## Comandos Seguros

```bash
pnpm test:e2e                           # Rodar todos os testes
pnpm --filter web build                 # Checar build
pnpm typecheck                          # Checar tipos
pnpm lint                               # Checar lint
git status                              # Verificar mudanças
git log --oneline -20                   # Histórico
```

## Comandos Proibidos

```bash
git push --force
supabase db push   # em produção sem aprovação
# qualquer comando que altere código fonte
```

---

## Definition of Done da Fase 0

### 1. Critérios Funcionais
- [ ] Todos os documentos enterprise criados e coerentes
- [ ] Seed de dados criado

### 2. Critérios Técnicos
- [ ] Build passa: `pnpm --filter web build`
- [ ] Typecheck passa: `pnpm typecheck`
- [ ] Lint passa: `pnpm lint`

### 3. Critérios de Segurança
- [ ] Seed usa apenas dados fictícios

### 4. Auditoria
- [ ] Débitos técnicos documentados no relatório final

### 5. Multi-tenant
- N/A nesta fase

### 6. RBAC
- N/A nesta fase

### 7. UI
- N/A nesta fase

### 8. Performance
- N/A nesta fase

### 9. Regressão
- [ ] `pnpm test:e2e` all green — 0 falhas em todas as suites

### 10. Evidências
- [ ] Output de terminal das suites passando
- [ ] Output de `pnpm typecheck` sem erros
- [ ] Output de `pnpm --filter web build` bem-sucedido
- [ ] Relatório final em `docs/enterprise/reports/phase-0-final-report.md`

---

## Resultado Esperado no Terminal

```
Running X tests using Y workers

[chromium] ✓ login page carrega (1s)
[chromium] ✓ login com credenciais válidas (2s)
... (todos os testes existentes)

X passed (Ys)
0 failed
```

---

## Relatório Final

Criar em: `docs/enterprise/reports/phase-0-final-report.md`

Incluir:
- Status: APROVADA | REPROVADA
- Suites testadas e resultados (X/X passando)
- Débitos técnicos identificados
- Seed de dados criado
- Próxima fase: Fase 1 — Multi-tenant Foundation

---

*Fase 0 — Baseline v1.0 — 2026-06-20*
