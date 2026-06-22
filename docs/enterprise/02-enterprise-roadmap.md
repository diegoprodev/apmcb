# Roadmap Enterprise — Plataforma de Governança de Bens Sensíveis

> **Versão:** 1.0  
> **Data:** 2026-06-20  
> **Foco dos próximos 30 dias:** Fases 0-7  
> **DoD Canônica:** IMPLEMENTADO NÃO É ENTREGUE — ver `07-canonical-definition-of-done.md`

---

## Visão Geral do Roadmap

| Fase | Nome | Prioridade | Status |
|---|---|---|---|
| **0** | Baseline e Governança | 🔴 P0 | ✅ Concluído (2026-06-18) |
| **1** | Multi-tenant Foundation | 🔴 P0 | ✅ Concluído — Slice 1A (2026-06-22) |
| **2** | RBAC Enterprise | 🔴 P0 | ✅ Concluído (2026-06-22) |
| **3** | Audit Events com Hash | 🔴 P0 | Pendente |
| **4** | Assinatura Eletrônica | 🔴 P0 | Pendente |
| **5** | Cautela Eletrônica | 🔴 P0 | Pendente |
| **6** | Livro Digital de Serviço | 🔴 P0 | Pendente |
| **7** | Dashboard de Comando | 🔴 P0 | Pendente |
| **8** | Inventário Periódico | 🟡 P1 | Pós-piloto |
| **9** | E-mail Transacional (Resend) | 🟡 P1 | Pós-piloto |
| **10** | Hardening Enterprise | 🟡 P1 | Pós-piloto |
| **11** | Migração Infra Brasil | 🟢 P2 | Pós-venda |
| **12** | API Segura + Webhooks | 🟢 P2 | Pós-venda |

---

## Fase 0 — Baseline e Governança

**Objetivo:** Mapear estado atual do sistema, garantir documentação completa, confirmar que toda infraestrutura de testes existe e que zero regressão está presente.

**Entregáveis:**
- Estrutura `docs/enterprise/` criada e populada
- Seed de dados de teste em `supabase/seed-enterprise.sql` (2 usuários admin, 1 master/armeiro, 2 usuários, dados de lendings/SSA)
- Verificação que todas as suites E2E existentes passam
- Documentação de arquitetura atual completa (feita via spec técnica)

**Fora do Escopo:**
- Nenhuma alteração de banco de dados
- Nenhuma alteração de código fonte
- Nenhuma feature nova

**Arquivos da Fase:**
- `docs/enterprise/` (documentos — não é código)
- `supabase/seed-enterprise.sql` (seed de teste)

**Tabelas:** Nenhuma alteração

**Endpoints:** Nenhum novo endpoint

**Componentes:** Nenhum novo componente

**Riscos:**
- Suite existente pode ter testes frágeis — identificar e documentar antes de avançar

**Testes Obrigatórios:**
```bash
cd apps/web && pnpm test:e2e          # ALL suites — ZERO falhas
pnpm --filter web build               # Build limpo
pnpm typecheck                        # Zero erros de tipo
```

**Testes de Regressão:** Todas as suites existentes são a linha base

**Critérios de Aceite:**
- CA01: Toda documentação em `docs/enterprise/` criada e coerente
- CA02: `pnpm test:e2e` all green (0 failed)
- CA03: `pnpm --filter web build` bem-sucedido
- CA04: Seed de dados populado e verificado

**Rollback:** N/A — sem mudanças funcionais

**Evidência Esperada:** Output de `pnpm test:e2e` com 0 falhas + listagem dos arquivos criados

**Prompt para Implementação:**
```
Fase 0 — Baseline. Não altere nenhum código funcional. Verifique que todas as
suites E2E passam rodando `pnpm test:e2e` em apps/web. Crie o seed de dados em
supabase/seed-enterprise.sql com 2 admins, 1 armeiro e 2 militares (usando os
usuários de teste existentes ou expandindo). Documente o estado atual. Relate
quaisquer suites falhando antes de avançar para Fase 1.
```

---

## Fase 1 — Multi-tenant Foundation

**Objetivo:** Adicionar isolamento multi-tenant real com `tenant_id` em todas as tabelas sensíveis, RLS policies correspondentes e suporte no BFF para propagação do tenant na sessão.

**Entregáveis:**
- Tabelas: `tenants`, `unidades` (novas)
- Colunas `tenant_id` e `unidade_id` adicionadas em: `profiles`, `material_types`, `lendings`, `material_requests`, `material_request_items`, `totp_secrets`, `biometric_templates`, `ocorrencias`, `notifications`, `audit_logs`
- `SessionData` expandido com `tenantId`, `unidadeId`
- RLS policies de isolamento por tenant em todas as tabelas
- Nexus: endpoints para provisionar tenants e unidades
- 1 tenant de demo criado (APMCB/PM-PB)

**Fora do Escopo:**
- ❌ RBAC enterprise (Fase 2)
- ❌ audit_events (Fase 3)
- ❌ Múltiplos logins por tenant (ainda sem multi-admin)
- ❌ UI de gestão de tenants para admin_global (Fase 2)

**Arquivos da Fase:**
- `apps/bff/src/lib/session.ts` — expandir SessionData
- `apps/bff/src/middleware/auth.ts` — propagar tenantId na sessão
- `apps/bff/src/routes/nexus.ts` — adicionar endpoints de tenant CRUD
- `apps/bff/src/routes/*.ts` — adicionar filtro tenant_id em queries
- `supabase/migrations/20260620000001_multitenant_foundation.sql`
- `apps/web/e2e/multitenant.spec.ts` — nova suite TT01-TT08

**Tabelas Permitidas:** tenants (CREATE), unidades (CREATE), todas as tabelas existentes (ALTER ADD COLUMN)

**Tabelas Proibidas:** auth.users (Supabase gerencia), document_signatures (ainda não existe)

**Endpoints:**
| Método | Path | Role |
|---|---|---|
| POST | `/api/nexus/tenants` | superadmin (nexus) |
| GET | `/api/nexus/tenants` | superadmin (nexus) |
| POST | `/api/nexus/tenants/:id/unidades` | superadmin (nexus) |

**Riscos:**
- RT01: Migration com DEFAULT + valor de tenant padrão é a abordagem mais segura
- RT02: Código existente sem filtro de tenant precisa ser atualizado

**Testes Obrigatórios:** TT01-TT08 em `e2e/multitenant.spec.ts`

**Testes de Regressão:** Todas as suites da Fase 0 + `multitenant-suite`

**Critérios de Aceite:**
- CA01: TT01 passando — usuário de tenant A não vê dados de tenant B (BLOQUEIO)
- CA02: TT02-TT08 passando
- CA03: Regressão completa verde
- CA04: `pnpm typecheck` sem erros de tipo

**Rollback:**
- Nível 1: `git revert` + redeploy
- Nível 2: `DROP COLUMN tenant_id` (via migration de rollback)
- Nível 3: Restaurar backup Supabase

**Evidência Esperada:** Output `multitenant-suite: 8/8 passed`

**Prompt para Implementação:**
```
Fase 1 — Multi-tenant Foundation. Leia o harness em phases/phase-1-multitenant.md
antes de qualquer alteração. Crie as tabelas tenants e unidades via nova migration.
Adicione tenant_id (com DEFAULT = tenant_padrão) em todas as tabelas sensíveis.
Expanda SessionData para incluir tenantId e unidadeId. Atualize todas as queries
do BFF para filtrar por tenant_id explicitamente. Crie as RLS policies de isolamento.
Crie a suite e2e/multitenant.spec.ts com TT01-TT08. BLOQUEIO: TT01 deve passar
(usuário de tenant A não vê dados de tenant B) antes de declarar a fase concluída.
```

---

## Fase 2 — RBAC Enterprise

**Objetivo:** Expandir de 3 roles (admin/master/usuario) para 6 roles institucionais (superadmin/admin_global/admin_reserva/armeiro/usuario/auditor), com roleGuard atualizado e UI adaptada.

**Entregáveis:**
- Role enum expandido: 6 roles
- `HonoVariables` com tipo `Role` expandido
- `roleGuard()` atualizado para todos os endpoints
- `SessionData.role` tipado com novos roles
- Migration de atualização de perfis existentes
- Suite E2E de RBAC com PT01-PT08

**Fora do Escopo:**
- ❌ Permissões granulares por feature (apenas role-level)
- ❌ UI de gestão de usuários completa (Fase 7+)
- ❌ Onboarding de novos militares via convite (já existe via Fase existente)

**Arquivos da Fase:**
- `apps/bff/src/types/hono.ts` — tipo Role expandido
- `apps/bff/src/middleware/role-guard.ts` — actualizado
- `apps/bff/src/lib/session.ts` — SessionData.role tipado
- `apps/bff/src/routes/*.ts` — roleGuard aplicado em todos
- `supabase/migrations/20260620000002_rbac_roles.sql`
- `apps/web/e2e/rbac.spec.ts` — PT01-PT08

**Endpoints:** Nenhum novo — apenas guards em endpoints existentes

**Critérios de Aceite:**
- CA01: PT01 passando — role insuficiente retorna 403 (BLOQUEIO)
- CA02: PT02-PT08 passando
- CA03: Regressão completa verde

**Prompt para Implementação:**
```
Fase 2 — RBAC Enterprise. Leia o harness em phases/phase-2-rbac.md. Expanda o
tipo Role para 6 valores: superadmin, admin_global, admin_reserva, armeiro,
usuario, auditor. Atualize roleGuard e todos os endpoints do BFF. Crie migration
para atualizar perfis existentes (admin→admin_global, master→armeiro, usuario→usuario).
Crie e2e/rbac.spec.ts com PT01-PT08. BLOQUEIO: escalada de privilégio detectada
= fase não fecha.
```

---

## Fase 3 — Audit Events com Hash Encadeado

**Objetivo:** Substituir audit_logs por audit_events com hash SHA-256 encadeado, before/after snapshots, e informações de tenant/unidade/ip/user_agent para trilha de auditoria imutável e verificável.

**Entregáveis:**
- Tabela `audit_events` com campos completos
- `apps/bff/src/lib/audit-hash.ts` — `computeEventHash()`
- `apps/bff/src/middleware/audit.ts` — atualizado para audit_events
- RULE SQL de imutabilidade em audit_events
- Middleware audit injetado em todos os endpoints sensíveis
- Suite E2E AT01-AT05

**Fora do Escopo:**
- ❌ Exportação de relatório de auditoria (Fase 7+)
- ❌ UI de visualização de audit log (Fase 7+)
- ❌ Remoção de audit_logs (manter para compatibilidade)

**Testes Obrigatórios:** AT01-AT05 em `e2e/audit-events.spec.ts`

**Critérios de Aceite:**
- CA01: AT01 passando — hash calculado corretamente (BLOQUEIO)
- CA02: AT03/AT04 — UPDATE e DELETE bloqueados por RULE SQL (BLOQUEIO)
- CA03: Cadeia de hash não quebra (AT05) (BLOQUEIO)

**Prompt para Implementação:**
```
Fase 3 — Audit Events. Leia o harness em phases/phase-3-audit-events.md. Crie a
tabela audit_events com seq, hash encadeado, before/after snapshots, tenant_id,
ip, user_agent. Crie apps/bff/src/lib/audit-hash.ts com computeEventHash() usando
SHA-256. Atualize o middleware de auditoria. Adicione RULE SQL de imutabilidade.
BLOQUEIO: AT03 (DELETE bloqueado) e AT01 (hash correto) devem passar.
```

---

## Fase 4 — Assinatura Eletrônica

**Objetivo:** Implementar assinatura eletrônica Nível 1 (TOTP + hash documental) para fluxos críticos, com tabela `document_signatures` imutável e rota pública de verificação.

**Entregáveis:**
- Tabela `document_signatures` com RULE imutável
- `apps/bff/src/lib/document-hash.ts` — `hashDocument()`
- `apps/bff/src/lib/signature-proof.ts` — `computeSignatureProof()`
- Integração com TOTP em fluxos de assinatura
- Rota pública `/v/[document_id]` no frontend
- Suite E2E SIG01-SIG06

**Fora do Escopo:**
- ❌ WebAuthn/Passkey (Fase 10+)
- ❌ Gov.br OAuth2 (Fase 12+)
- ❌ ICP-Brasil A1/A3

**Critérios de Aceite:**
- CA01: SIG01 — assinar com TOTP válido cria document_signatures
- CA02: SIG03 — UPDATE em document_signatures bloqueado por RULE (BLOQUEIO)
- CA03: SIG05 — verificação pública retorna status correto

---

## Fase 5 — Cautela Eletrônica

**Objetivo:** Transformar lendings em fluxo enterprise com status machine completo, assinatura dupla (armeiro + militar), PDF com QR Code verificável e bucket de armazenamento.

**Entregáveis:**
- ALTER TABLE lendings: status_v2, prazo_devolucao, military_signature_id, armeiro_signature_id, document_hash, pdf_storage_path, tenant_id, unidade_id
- Status machine: emitida → aguardando_recebimento → ativa → devolvida/divergencia
- Endpoints: /confirm, /sign, /pdf
- Geração de PDF no BFF
- Bucket `custody-docs` no Supabase Storage
- Suite E2E CT01-CT06

**Critérios de Aceite:**
- CA01: CT02 — item já cautelado → 409 (BLOQUEIO)
- CA02: CT03 — hash do documento verificável
- CA03: CT04 — assinatura criada em document_signatures

---

## Fase 6 — Livro Digital de Serviço

**Objetivo:** Implementar passagem de serviço digital com snapshot automático do turno, assinatura dupla e PDF verificável.

**Entregáveis:**
- Tabelas: `service_handovers`, `handover_attachments`
- 8 endpoints de handover
- Snapshot JSONB automático do turno
- Notificações push para armeiro entrante
- Card de handover no dashboard do armeiro
- Suite E2E HT01-HT04

**Critérios de Aceite:**
- CA01: HT01 — snapshot contém dados reais do turno
- CA02: HT03 — PDF com dupla assinatura gerado e verificável
- CA03: Prazo vencido → status correto no dashboard

---

## Fase 7 — Dashboard de Comando

**Objetivo:** Adicionar dashboard de comando para admin_global com 14 cards de exceção e conformidade, baseado em dados reais.

**Entregáveis:**
- Nova rota `/(dashboard)/admin/comando/page.tsx`
- Endpoint `GET /api/dashboard/command` com 14 métricas
- 14 cards de exceção: passagens em atraso, cautelas vencidas, itens sem auditoria, ocorrências abertas, inventários pendentes, etc.
- Filtro por unidade
- Suite E2E DASH01-DASH05

**Fora do Escopo:**
- ❌ Nova tabela (usa dados de lendings, service_handovers, ocorrencias, audit_events)
- ❌ Relatórios exportáveis em PDF (Fase 10)

**Critérios de Aceite:**
- CA01: DASH02 — cards batem com dados reais (criar registro → contador aumenta)
- CA02: DASH03 — filtro por unidade não quebra isolamento
- CA03: DASH04 — tenant A não vê dados de tenant B no dashboard

---

## Fase 8 — Inventário Periódico

**Objetivo:** Implementar sistema de inventário periódico com campanhas por unidade, conferência por item e relatório com assinatura.

**Entregáveis:**
- Tabelas: `inventory_campaigns`, `inventory_unit_checks`, `inventory_item_checks`
- Fluxo: campanha → conferência por unidade → assinatura → consolidação
- PDF de relatório com assinatura
- Suite E2E INV01-INV05

**Critérios de Aceite:**
- CA01: INV02 — unidade B não vê carga de unidade A
- CA02: INV03 — divergência sem justificativa → 422
- CA03: INV05 — PDF gerado após fechamento de campanha

---

## Fase 9 — E-mail Transacional (Resend)

**Objetivo:** Integrar Resend SDK no BFF para e-mails transacionais (convite, TOTP setup, passagem pendente, cautela emitida, inventário).

**Entregáveis:**
- Resend SDK em `apps/bff/src/services/email.ts`
- Templates: invite, totp-setup, handover-pending, cautela-emitted, inventory-due
- Logs de envio em audit_events
- Variáveis: `RESEND_API_KEY=***`, `FROM_EMAIL=***`, `FROM_NAME=***`

**Fora do Escopo:**
- ❌ Migrar e-mails de autenticação do Supabase para Resend
- ❌ SPF/DKIM/DMARC (aguarda domínio definitivo)

---

## Fase 10 — Hardening Enterprise

**Objetivo:** Seed de demo realista com 300+ militares e 90 dias de histórico, roteiro de apresentação, correções de UX identificadas nas fases anteriores, regressão completa.

**Entregáveis:**
- `supabase/seed-enterprise-demo.sql` com 300+ registros realistas
- Roteiro de demo para apresentação ao comando
- Correções de UX identificadas nas fases 0-8
- Regressão completa: 13+ suites passando
- Logging JSON estruturado no BFF

---

## Fase 11 — Migração Infra Brasil

**Objetivo:** Documentar e planejar migração do BFF de Hetzner (Alemanha) para Google Cloud Run southamerica-east1 (Brasil) para conformidade com LGPD.

> ⚠️ **Esta fase é APENAS documentação e checklist — sem executar migração.**

**Entregáveis:**
- Checklist de migração Cloud Run sa-east-1
- Atualização de Dockerfile se necessário
- Plano de cutover de DNS
- Plano de migração de secrets para Google Secret Manager
- Estimativa de custo

---

## Fase 12 — API Segura + Webhooks

**Objetivo:** Especificar (não implementar) API pública v1 com autenticação por API key e webhooks HMAC-SHA256 para integrações externas.

> ⚠️ **Esta fase é APENAS especificação — sem implementar.**

**Entregáveis:**
- Spec da API v1 (`/v1/`) com escopos
- Spec de webhooks HMAC-SHA256
- OpenAPI 3.0 rascunho
- Tabela `api_keys` definida (apenas spec)

---

## Dependências entre Fases

```
0 ──► 1 ──► 2 ──► 3 ──► 4 ──► 5 ──► 6 ──► 7
                              │
                              └──► 8 (paralela após Fase 5)
                                   9 (paralela após Fase 4)

7 ──► 10 (hardening)
10 ──► 11 (migração)
10 ──► 12 (API)
```

**Dependências críticas:**
- Fase 1 (multi-tenant) deve preceder toda nova feature com dados sensíveis
- Fase 2 (RBAC) deve preceder toda feature com diferença de permissão
- Fase 3 (audit) deve preceder assinatura (Fase 4)
- Fase 4 (assinatura) deve preceder cautela (Fase 5) e livro (Fase 6)

---

## Critérios de MVP Institucional

A plataforma está pronta para MVP quando as Fases 0-7 estiverem concluídas:

| Critério | Fase |
|---|---|
| Autenticação TOTP com anti-replay | ✅ Existente |
| SSA com aprovação e status | ✅ Existente |
| Cautela eletrônica com assinatura | Fase 5 |
| Livro digital de serviço | Fase 6 |
| Dashboard de exceções do comando | Fase 7 |

---

## Métricas de Progresso

Após cada fase, verificar:

```bash
# Contar suites passando
cd apps/web && pnpm test:e2e | tail -5

# Contar arquivos de documentação
Get-ChildItem "docs/enterprise/" -Recurse -Filter "*.md" | Measure-Object

# Contar relatórios finais gerados
Get-ChildItem "docs/enterprise/reports/" -Filter "*.md" | Measure-Object
```

---

*Roadmap enterprise v1.0 — 2026-06-20*  
*Sujeito a revisão após validação do MVP com usuário piloto.*
