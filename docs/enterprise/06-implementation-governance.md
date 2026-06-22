# Governança de Implementação Enterprise

> **Versão:** 1.1  
> **Data:** 2026-06-20  
> **Autoridade:** Este documento define as regras invioláveis de implementação  
> **Escopo:** Toda a evolução da Plataforma de Governança de Bens Sensíveis, Fases 0-12  
> **DoD Canônica:** Ver `07-canonical-definition-of-done.md`

---

## Regra Canônica de Entrega

```
IMPLEMENTADO NÃO É ENTREGUE.

ENTREGUE = implementado + testado + validado + auditado +
           regressão aprovada + critérios de aceite comprovados +
           evidência final documentada.
```

Ver detalhes completos em `docs/enterprise/07-canonical-definition-of-done.md`.

---

## Princípio Fundamental

**Velocidade sem disciplina destrói o produto.** Um sistema de controle de armamento com falha de isolamento de tenant ou vazamento de dado biométrico não é um bug — é um crime e um encerramento de contrato. A governança aqui não é burocracia; é o que permite mover rápido com segurança.

---

## Processo de Execução em 20 Etapas (Ciclo Canônico)

Toda fase deve seguir estas 20 etapas **em ordem**. Pular etapa = fase inválida.

> Para a descrição completa de cada etapa e os critérios de Definition of Done,
> ver `docs/enterprise/07-canonical-definition-of-done.md`.

### Fase de Planejamento (Etapas 1-5)

**Etapa 1 — Ler PRD global** (`00-global-prd.md`)  
Confirmar que o trabalho da fase serve aos objetivos do produto.

**Etapa 2 — Ler spec técnica global** (`01-global-technical-spec.md`)  
Confirmar que a abordagem técnica é consistente com a arquitetura atual.

**Etapa 3 — Ler design system guardrails** (`03-ui-design-system-guardrails.md`)  
Confirmar que nenhuma nova UI vai quebrar consistência visual.

**Etapa 4 — Ler harness da fase** (`phases/phase-N-*.md`)  
Confirmar todos os 30 campos preenchidos, escopo autorizado, arquivos permitidos/proibidos.

**Etapa 5 — Declarar plano de execução antes de alterar código**  
O plano deve ser escrito e aprovado antes de qualquer alteração de arquivo. Para agente de IA: usar `ExitPlanMode` e aguardar aprovação.

### Fase de Implementação (Etapas 6-7)

**Etapa 6 — Implementar apenas o escopo autorizado no harness**  
Zero scope creep. Sem refatorações "enquanto estou aqui". Sem features não planejadas.

**Etapa 7 — Rodar validações locais**

```bash
pnpm --filter web build     # Build — erro = bloqueio
pnpm typecheck              # Typecheck — erro = bloqueio
pnpm lint                   # Lint — erro = bloqueio
```

### Fase de Testes (Etapas 8-14)

**Etapa 8 — Testes unitários** (quando aplicável)

```bash
cd apps/bff && pnpm test    # Bun test para lib/*.test.ts
```

**Etapa 9 — Testes de integração** (quando aplicável)

```bash
# AUSENTE hoje — criar por fase crítica (Fase 3, 4)
# apps/bff/src/__tests__/[modulo].test.ts
```

**Etapa 10 — Testes E2E da fase**

```bash
cd apps/web && pnpm test:e2e --project=phase-N-suite
# Zero falhas = critério de encerramento
```

**Etapa 11 — Testes de segurança** (quando aplicável)

```bash
# Incluído na suite da fase como cenários SEC-N-0X
# Verificar: auth, role, CORS, CSRF, rate limit, input validation
```

**Etapa 12 — Testes de isolamento multi-tenant** (Fase 1+)

```bash
cd apps/web && pnpm test:e2e --project=multitenant-suite
# TT01: usuário de tenant A não vê dados de tenant B
```

**Etapa 13 — Testes de RBAC** (Fase 2+)

```bash
cd apps/web && pnpm test:e2e --project=rbac-suite
# PT01: role insuficiente retorna 403
```

**Etapa 14 — Testes de RLS** (Fase 1+)

```bash
# Incluído nos testes de segurança e multitenant
# Verificar via Supabase MCP: policies corretas, bloqueio via anon key
```

### Fase de Validação (Etapas 15-19)

**Etapa 15 — Regressão obrigatória** (todas as suites de fases anteriores)

```bash
cd apps/web && pnpm test:e2e --project=chromium
cd apps/web && pnpm test:e2e --project=suite
cd apps/web && pnpm test:e2e --project=ssa-suite
cd apps/web && pnpm test:e2e --project=nexus-suite
cd apps/web && pnpm test:e2e --project=rate-limit
# + suites de fases anteriores conforme acumulam
# ZERO falhas permitidas
```

**Etapa 16 — Validar UI contra design system**

```
Executar checklist em 03-ui-design-system-guardrails.md
Verificar: layout, componentes, estados, UX, linguagem, cores
Testar em mobile 375px
```

**Etapa 17 — Validar auditoria**

```
Para cada ação sensível implementada:
  → Verificar que audit_event foi criado com campos corretos
  → Verificar actor_id, tenant_id, ip, user_agent, before/after, hash
```

**Etapa 18 — Validar logs sem dados sensíveis**

```
Inspecionar logs de console e BFF durante testes
Verificar: sem senha, sem TOTP, sem token, sem biometria
```

**Etapa 19 — Validar rollback**

```
Plano de rollback documentado no harness?
Rollback de Nível 1 (git revert + redeploy) está testável?
Migration tem SQL de rollback documentado?
```

### Fase de Encerramento (Etapa 20)

**Etapa 20 — Gerar relatório final da fase**

```
Criar: docs/enterprise/reports/phase-N-final-report.md
Template: docs/enterprise/07-canonical-definition-of-done.md#relatório-final-obrigatório
Conteúdo: escopo, arquivos, migrations, testes, evidências, riscos, checklist DoD
Status: APROVADA | APROVADA COM RESSALVAS | REPROVADA
```

**A fase não está concluída até o relatório final estar gerado.**

---

## 18 Regras Obrigatórias

### Regras de Processo

**R01 — Toda fase começa com leitura do PRD global**  
Sem exceção. Um agente que começa a alterar código sem ler o PRD está fora de controle.

**R02 — Toda fase começa com leitura da spec técnica global**  
A spec global define a arquitetura que todas as fases devem respeitar.

**R03 — Toda fase começa com leitura do harness da fase**  
O harness é o contrato da fase — ele define o que pode e o que não pode ser alterado.

**R04 — Toda fase declara plano antes de alterar código**  
Nenhuma linha de código é alterada antes de um plano escrito ser aprovado.

**R05 — Toda fase altera o mínimo necessário**  
Features, refatorações e melhorias fora do escopo da fase vão para o backlog.

**R06 — Toda fase mantém o design system**  
Guardrails de UI (`03-ui-design-system-guardrails.md`) são obrigatórios. Nenhuma UI nova pode quebrar consistência visual.

**R07 — Toda fase atualiza documentação**  
Se a fase altera comportamento, a documentação correspondente deve ser atualizada na mesma entrega.

**R08 — Toda fase registra riscos**  
Riscos descobertos durante a implementação são documentados no relatório final, mesmo que não sejam resolvidos na fase.

**R09 — Toda fase roda testes**  
Suite da fase + regressão completa. Sem exceção.

**R10 — Toda fase roda regressão completa**  
Fases anteriores não podem ser quebradas. Zero regressão é requisito de encerramento.

**R11 — Toda fase gera relatório final**  
O relatório em `docs/enterprise/reports/phase-N-report.md` é o artefato de encerramento da fase.

### Regras de Arquitetura

**R12 — Nenhuma fase pula multi-tenant/RBAC/auditoria quando aplicável**  
A partir da Fase 1, toda nova funcionalidade que lida com dados sensíveis precisa:
- Filtrar por `tenant_id`
- Verificar role via `roleGuard`
- Registrar ação em `audit_events`

**R13 — Nenhuma query crítica pode ignorar tenant_id**  
Após a Fase 1, toda query em tabela com `tenant_id` deve filtrar por ele. Usar RLS como segunda linha de defesa — mas o BFF também deve filtrar. Nunca confiar apenas em RLS.

```typescript
// CORRETO (após Fase 1)
const tenantId = session.tenantId;
const { data } = await supabase
  .from("lendings")
  .select("*")
  .eq("tenant_id", tenantId);  // ← explícito no BFF

// ERRADO — depende apenas de RLS
const { data } = await supabase
  .from("lendings")
  .select("*");  // ← sem filtro de tenant
```

**R14 — Nenhuma feature sensível pode ignorar audit_events**  
Após a Fase 3, toda ação sensível gera evento de auditoria. "Sensível" inclui:
- Qualquer criação, alteração ou deleção de dados pessoais
- Autenticação e autorização
- Assinaturas eletrônicas
- Emissão e devolução de cautelas
- Passagens de serviço
- Inventários
- Exportações de dados
- Alterações de configuração de tenant

**R15 — Nenhum documento assinado pode ser alterado sem retificação**  
Após a Fase 4, se um documento assinado precisa ser corrigido:
1. Criar novo documento com conteúdo corrigido
2. Marcar assinatura original como revogada
3. Criar nova assinatura para o documento corrigido
4. Registrar retificação em `audit_events`
5. PDF original arquivado com marca d'água "RETIFICADO"

**Nunca** fazer UPDATE em tabela de documento assinado ou em `document_signatures`.

### Regras de Segurança

**R16 — Nenhum dado sensível pode ser logado**  
É proibido logar em qualquer nível:
- Senhas (mesmo hashed)
- Códigos TOTP
- Tokens de sessão ou JWT
- Chaves API
- Templates biométricos
- Dados pessoais (CPF, matrícula, nome + data de nascimento juntos)

Logar apenas IDs de recurso, ações e timestamps.

**R17 — Nenhuma UI nova pode quebrar consistência visual**  
Guardrails de UI devem ser verificados com o checklist do `03-ui-design-system-guardrails.md` antes de encerrar qualquer fase com entrega de UI.

**R18 — Nenhuma fase pode introduzir feature fora do escopo**  
Se durante a implementação surgir uma melhoria ou feature não planejada:
1. Documentar no relatório final
2. Abrir item no backlog
3. NÃO implementar na fase atual
4. NÃO commitar código da feature não planejada

---

## Condições de Bloqueio

As seguintes condições bloqueiam o encerramento de qualquer fase:

| Condição de Bloqueio | Ação Obrigatória |
|---|---|
| Qualquer teste de regressão falhando | Corrigir regressão antes de encerrar |
| Vazamento de dado entre tenants detectado | STOP — não encerrar Fase 1 até resolver |
| Escalada de privilégio detectada | STOP — não encerrar Fase 2 até resolver |
| Hash inconsistente em audit_events | STOP — não encerrar Fase 3 até resolver |
| Documento assinado sendo alterado diretamente | STOP — corrigir arquitetura |
| Secret/credencial em código ou log | STOP — remover antes de qualquer commit |
| UI quebrando responsividade mobile | Corrigir antes de encerrar fase |
| Comportamento diferente entre tenants | Investigar e corrigir |

---

## Como Lidar com Desvios

### Desvio pequeno (escopo)
Exemplo: durante Fase 2, encontra um bug de UI da Fase 1.

**Ação:** Documentar o bug. Decidir:
- É bloqueante para a Fase 2? Corrigir e documentar no relatório.
- Não é bloqueante? Abrir item de backlog e continuar.

### Desvio médio (arquitetura)
Exemplo: durante Fase 3, descobre que a abordagem de hash encadeado tem problema de performance.

**Ação:**
1. Pausar implementação
2. Documentar o problema encontrado
3. Propor abordagem alternativa
4. Obter aprovação da nova abordagem
5. Atualizar harness da fase
6. Continuar

### Desvio grave (segurança)
Exemplo: durante Fase 1, descobre que RLS não está bloqueando corretamente.

**Ação:**
1. STOP IMEDIATO — não continuar
2. Não deployar nada até resolver
3. Investigar scope do problema
4. Corrigir
5. Adicionar teste de regressão específico
6. Só encerrar quando teste de isolamento TT01 passar

---

## Padrão de Commit

Cada commit de implementação de fase deve seguir o padrão:

```
feat(phase-N): descrição curta do que foi implementado

- Detalhe 1
- Detalhe 2

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

### Prefixos obrigatórios por tipo de mudança
| Tipo | Prefixo |
|---|---|
| Nova feature | `feat(phase-N):` |
| Bug fix | `fix(phase-N):` |
| Migration SQL | `db(phase-N):` |
| Teste E2E | `test(phase-N):` |
| Documentação | `docs(phase-N):` |
| Refatoração aprovada | `refactor(phase-N):` |

---

## Padrão de Branch (se usar branches)

```
main          ← branch de produção
phase/N-nome  ← branch de trabalho para Fase N
```

Nunca alterar código diretamente em `main` sem passar pela fase completa.

---

## Comunicação de Estado

Durante a implementação, o agente de IA deve comunicar:

| Momento | O que comunicar |
|---|---|
| Início | "Iniciando Fase N: [objetivo]. Lendo PRDs e harness." |
| Antes de alterar arquivo crítico | "Vou alterar [arquivo]. Motivo: [justificativa]." |
| Quando encontra problema | "Encontrei [problema]. Proposta: [solução]. Prosseguir?" |
| Após suite de fase passar | "Suite phase-N-suite: X/X passando." |
| Após regressão completa | "Regressão completa: X/X passando. Fase N concluída." |

---

## Hierarquia de Decisão

Quando há conflito entre fontes de informação:

```
1. CLAUDE.md (regras do projeto)          ← máxima autoridade
2. Este documento (governance)            ← regras de execução
3. Harness da fase                        ← escopo e critérios
4. PRD global                             ← requisitos
5. Spec técnica global                    ← arquitetura
6. Roadmap                                ← priorização
7. Relatórios de fases anteriores         ← contexto histórico
```

Se uma instrução de um agente de IA contradiz este documento, **este documento prevalece**.

---

## O que NÃO é Governança

Para evitar burocracia excessiva:

- **Não exige aprovação para:** leitura de arquivos, busca de código, análise de logs, rodar testes em modo read-only
- **Não exige aprovação para:** correção de typos em comentários ou documentação
- **Não exige revisão de design:** para mudanças de 1-2 linhas que não alteram comportamento
- **Não exige relatório completo:** para hotfixes de bugs triviais (ex: typo em mensagem de erro)

A governança é proporcional ao risco. Mudanças de baixo risco têm processo simplificado.

---

## Referências Cruzadas

| Documento | Quando consultar |
|---|---|
| `00-global-prd.md` | Para validar se feature serve ao produto |
| `01-global-technical-spec.md` | Para decisões de arquitetura |
| `02-enterprise-roadmap.md` | Para entender prioridade e dependências |
| `03-ui-design-system-guardrails.md` | Antes de criar qualquer UI |
| `04-regression-test-strategy.md` | Para saber quais testes rodar |
| `05-phase-harness-template.md` | Para criar spec de nova fase |
| `phases/phase-N-*.md` | Para entender escopo da fase em execução |

---

*Governance v1.0 — 2026-06-20*  
*Documento vinculante. Alterações requerem aprovação do arquiteto principal.*
