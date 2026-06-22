# Estratégia de Testes de Regressão Enterprise

> **Versão:** 1.0  
> **Data:** 2026-06-20  
> **Princípio canônico:** `IMPLEMENTADO NÃO É ENTREGUE` — ver `07-canonical-definition-of-done.md`

---

## Comandos de Teste (Repositório Atual)

### Comandos existentes

```bash
# Localização: apps/web/
cd apps/web

# Todos os projetos do playwright.config.ts
pnpm test:e2e

# Por projeto específico
pnpm test:e2e --project=chromium        # smoke (apmcb.spec.ts)
pnpm test:e2e --project=mobile-safari   # mobile viewport
pnpm test:e2e --project=suite           # suite completa (12 arquivos)
pnpm test:e2e --project=stress          # stress (workers=1)
pnpm test:e2e --project=ssa-suite       # SSA (workers=1)
pnpm test:e2e --project=ssa-stress      # SSA stress
pnpm test:e2e --project=status-suite    # Status + Detail
pnpm test:e2e --project=invite-suite    # Invite + Activation
pnpm test:e2e --project=rate-limit      # Rate limiting
pnpm test:e2e --project=nexus-suite     # Nexus super admin

# Build e type check
pnpm --filter web build                 # Next.js build
pnpm typecheck                          # tsc --noEmit (todos os workspaces)
pnpm lint                               # ESLint (todos os workspaces)

# BFF testes unitários
cd apps/bff && pnpm test               # bun test (se existirem *.test.ts)

# Relatório de testes
cd apps/web && pnpm test:e2e:report    # Abrir relatório HTML
```

### Comandos AUSENTES (recomendar criação futura)

| Comando | Status | Criar em |
|---|---|---|
| Teste de integração BFF | ❌ Ausente | Fase 3 — `apps/bff/src/__tests__/` |
| Teste unitário de audit-hash.ts | ❌ Ausente | Fase 3 |
| Teste unitário de document-hash.ts | ❌ Ausente | Fase 4 |
| Teste unitário de signature-proof.ts | ❌ Ausente | Fase 4 |
| Verificação de RLS policies | ❌ Ausente | Fase 1 via Supabase MCP |
| Verificação de migrations | ❌ Ausente | `supabase db diff` |
| Coverage de E2E | ❌ Ausente | Fase 10 hardening |

---

## Suites Existentes (Inventário)

| Suite | Projeto Playwright | Arquivo | Fases que cobrem |
|---|---|---|---|
| Smoke | `chromium` | `e2e/apmcb.spec.ts` | 0+ (sempre) |
| Mobile | `mobile-safari` | `e2e/apmcb.spec.ts` | 0+ (sempre) |
| Suite principal | `suite` | 12 arquivos e2e/ | 0+ (sempre) |
| Stress | `stress` | `e2e/stress.spec.ts` | 0+ |
| SSA | `ssa-suite` | `e2e/ssa-*.spec.ts` | 0+ (sempre) |
| SSA Stress | `ssa-stress` | `e2e/ssa-stress.spec.ts` | 0+ |
| Status/Detail | `status-suite` | `e2e/status-detail.spec.ts` | 0+ |
| Invite | `invite-suite` | `e2e/invite-activate.spec.ts` | 0+ |
| Rate Limit | `rate-limit` | `e2e/rate-limit.spec.ts` | 0+ (sempre) |
| Nexus | `nexus-suite` | `e2e/nexus.spec.ts` | 0+ (sempre) |

---

## Suites a Criar por Fase

| Suite | Projeto | Arquivo a criar | Fase |
|---|---|---|---|
| Multi-tenant | `multitenant-suite` | `e2e/multitenant.spec.ts` | 1 |
| RBAC | `rbac-suite` | `e2e/rbac.spec.ts` | 2 |
| Audit Events | `audit-suite` | `e2e/audit-events.spec.ts` | 3 |
| Signatures | `signature-suite` | `e2e/signatures.spec.ts` | 4 |
| Custody | `custody-suite` | `e2e/custody.spec.ts` | 5 |
| Handovers | `handover-suite` | `e2e/handovers.spec.ts` | 6 |
| Command Dashboard | `dashboard-suite` | `e2e/command-dashboard.spec.ts` | 7 |
| Inventory | `inventory-suite` | `e2e/inventory.spec.ts` | 8 |

---

## 30 Categorias de Teste

### CAT-01 — Login e Autenticação

| ID | Teste | Suite | Critério |
|---|---|---|---|
| T-AUTH-01 | Login com email válido + senha correta | `chromium` | Redirect por role correto |
| T-AUTH-02 | Login com matrícula válida | `chromium` | RPC get_email_by_matricula funciona |
| T-AUTH-03 | Login com credenciais inválidas | `chromium` | Mensagem de erro exibida |
| T-AUTH-04 | Login com Turnstile inválido | `rate-limit` | Bloqueado (se habilitado) |
| T-AUTH-05 | Rate limit: 5 falhas em 15min | `rate-limit` | 429 com Retry-After |
| T-AUTH-06 | TOTP inválido no step 2 | `nexus-suite` | Erro exibido, não avança |

### CAT-02 — Logout e Sessão

| ID | Teste | Suite | Critério |
|---|---|---|---|
| T-SESS-01 | Logout limpa cookie e redireciona para /login | `suite` | Redirect funciona |
| T-SESS-02 | Sessão expirada (8h TTL) — re-login exigido | Manual | 401 em qualquer endpoint |
| T-SESS-03 | Cookie forjado — rejeitado | `rate-limit` | 401 |
| T-SESS-04 | Sessão Nexus expirada (2h TTL) | `nexus-suite` | 401 em /api/nexus/* |

### CAT-03 — Proteção de Rotas (Frontend)

| ID | Teste | Suite | Critério |
|---|---|---|---|
| T-ROUTE-01 | /admin sem sessão → redirect /login | `chromium` | Redirect funciona |
| T-ROUTE-02 | /reserva sem sessão → redirect /login | `chromium` | Redirect funciona |
| T-ROUTE-03 | /cadete sem sessão → redirect /login | `chromium` | Redirect funciona |
| T-ROUTE-04 | /nexus sem sessão nexus → redirect /nexus/login | `nexus-suite` | Redirect funciona |
| T-ROUTE-05 | /admin com role=usuario → redirect adequado | `suite` | Role guard no layout |

### CAT-04 — Multi-tenant (Fase 1+)

| ID | Teste | Suite | Critério |
|---|---|---|---|
| TT01 | Usuário de Tenant A não vê dados de Tenant B | `multitenant-suite` | 0 resultados |
| TT02 | Admin_global de Tenant A não vê usuários de Tenant B | `multitenant-suite` | 0 resultados |
| TT03 | Admin_reserva só aprova saídas da sua unidade | `multitenant-suite` | 403 para unidade errada |
| TT04 | JWT com tenant_id adulterado é rejeitado | `multitenant-suite` | RLS bloqueia |
| TT05 | Nexus: GET /api/nexus/events sem filtro retorna todos | `nexus-suite` | service_role sem filtro |
| TT06 | Criação de recurso sem tenant_id bloqueada | `multitenant-suite` | NOT NULL constraint |
| TT07 | SQL injection cross-tenant via parâmetros | `multitenant-suite` | RLS ignora |
| TT08 | Superadmin vê todos os tenants via Nexus | `nexus-suite` | N tenants retornados |

### CAT-05 — Separação por Unidade (Fase 1+)

| ID | Teste | Suite | Critério |
|---|---|---|---|
| TU01 | admin_reserva de unidade A não vê dados de unidade B | `multitenant-suite` | 0 resultados |
| TU02 | armeiro de unidade A não opera na unidade B | `multitenant-suite` | 403 |

### CAT-06 — RBAC: Superadmin (Fase 2+)

| ID | Teste | Suite | Critério |
|---|---|---|---|
| PT-SA-01 | Superadmin acessa /nexus | `nexus-suite` | 200 |
| PT-SA-02 | Superadmin cria tenant | `nexus-suite` | 201 |
| PT-SA-03 | Outros roles não acessam /nexus | `nexus-suite` | 403 |

### CAT-07 — RBAC: Admin Global (Fase 2+)

| ID | Teste | Suite | Critério |
|---|---|---|---|
| PT-AG-01 | admin_global vê todos os usuários do tenant | `rbac-suite` | N resultados |
| PT-AG-02 | admin_global cria unidade | `rbac-suite` | 201 |
| PT-AG-03 | admin_global não acessa /nexus | `nexus-suite` | 403 |

### CAT-08 — RBAC: Admin de Unidade (Fase 2+)

| ID | Teste | Suite | Critério |
|---|---|---|---|
| PT-AR-01 | admin_reserva vê usuários da sua unidade | `rbac-suite` | N resultados (filtrado) |
| PT-AR-02 | admin_reserva não vê usuários de outra unidade | `rbac-suite` | 0 resultados |
| PT-AR-03 | admin_reserva aprova saída da sua unidade | `rbac-suite` | 200 |

### CAT-09 — RBAC: Armeiro (Fase 2+)

| ID | Teste | Suite | Critério |
|---|---|---|---|
| PT-ARM-01 | armeiro emite cautela | `custody-suite` | 201 |
| PT-ARM-02 | armeiro não cria unidade | `rbac-suite` | 403 |
| PT-ARM-03 | armeiro inicia passagem de serviço | `handover-suite` | 201 |

### CAT-10 — RBAC: Militar (Fase 2+)

| ID | Teste | Suite | Critério |
|---|---|---|---|
| PT-MIL-01 | usuario solicita SSA | `ssa-suite` | 201 |
| PT-MIL-02 | usuario não emite cautela | `rbac-suite` | 403 |
| PT-MIL-03 | usuario confirma recebimento de cautela própria | `custody-suite` | 200 |
| PT-MIL-04 | usuario não confirma cautela de outro militar | `custody-suite` | 403 |

### CAT-11 — RBAC: Auditor (Fase 2+)

| ID | Teste | Suite | Critério |
|---|---|---|---|
| PT-AUD-01 | auditor lê audit_events | `rbac-suite` | 200 |
| PT-AUD-02 | auditor exporta relatório | `rbac-suite` | 200 |
| PT-AUD-03 | auditor não cria cautela | `rbac-suite` | 403 |
| PT-AUD-04 | auditor não altera dados | `rbac-suite` | 403 |

### CAT-12 — Super Admin / Nexus (Existente)

| ID | Teste | Suite | Critério |
|---|---|---|---|
| NX01 | /nexus/login carrega sem crash | `nexus-suite` | UI visível |
| NX02 | /nexus sem sessão nexus → /nexus/login | `nexus-suite` | Redirect |
| NX03 | Credenciais inválidas no step 1 | `nexus-suite` | Erro exibido |
| NX04 | TOTP inválido no step 2 | `nexus-suite` | Não avança |
| NX05 | GET /api/nexus/health sem sessão | `nexus-suite` | 401-403 |
| NX06 | GET /api/nexus/events sem sessão | `nexus-suite` | 401-403 |
| NX07 | GET /api/nexus/errors sem sessão | `nexus-suite` | 401-403 |
| NX08 | POST /api/nexus/clear-rate-limit sem sessão | `nexus-suite` | 401-403 |

### CAT-13 — Cautela Eletrônica (Fase 5+)

| ID | Teste | Suite | Critério |
|---|---|---|---|
| CT01 | Emitir cautela com material disponível | `custody-suite` | 201 |
| CT02 | Emitir cautela de item já cautelado | `custody-suite` | 409 |
| CT03 | Hash do documento verificável | `custody-suite` | Hash match |
| CT04 | Assinatura do armeiro criada | `custody-suite` | document_signatures +1 |
| CT05 | Confirmação do militar | `custody-suite` | status = aguardando_recebimento → ativa |
| CT06 | Divergência gera ocorrência | `custody-suite` | ocorrencias +1 |

### CAT-14 — Devolução

| ID | Teste | Suite | Critério |
|---|---|---|---|
| T-DEV-01 | Devolução com quantidade correta | `custody-suite` | status = devolvida |
| T-DEV-02 | Devolução com quantidade diferente | `custody-suite` | status = divergencia |
| T-DEV-03 | Devolução de cautela inexistente | `custody-suite` | 404 |

### CAT-15 — Livro Digital de Serviço (Fase 6+)

| ID | Teste | Suite | Critério |
|---|---|---|---|
| HT01 | Passagem criada com snapshot correto | `handover-suite` | JSON contém cautelas_ativas |
| HT02 | Prazo vencido → status = vencido | `handover-suite` | Após mock de tempo |
| HT03 | PDF com dupla assinatura | `handover-suite` | PDF contém ambos os signatários |
| HT04 | Divergência gera alerta | `handover-suite` | Notificação criada |

### CAT-16 — Assinatura Eletrônica (Fase 4+)

| ID | Teste | Suite | Critério |
|---|---|---|---|
| SIG01 | Assinar com TOTP válido | `signature-suite` | document_signatures +1 |
| SIG02 | Assinar com TOTP inválido | `signature-suite` | 400 |
| SIG03 | UPDATE em document_signatures bloqueado | `signature-suite` | RULE SQL |
| SIG04 | Retificação preserva histórico | `signature-suite` | Original com revoked_at |
| SIG05 | Verificação pública retorna status correto | `signature-suite` | 200 com validade |
| SIG06 | Hash adulterado na verificação | `signature-suite` | Retorna inválido |

### CAT-17 — Auditoria (Fase 3+)

| ID | Teste | Suite | Critério |
|---|---|---|---|
| AT01 | Hash calculado corretamente | `audit-suite` | Hash match manual |
| AT02 | Alteração de log invalida hash | `audit-suite` | Varredura detecta |
| AT03 | DELETE em audit_events bloqueado | `audit-suite` | RULE SQL |
| AT04 | UPDATE em audit_events bloqueado | `audit-suite` | RULE SQL |
| AT05 | Cadeia de hash verificável | `audit-suite` | Todos os previous_hash corretos |

### CAT-18 — Documentos e PDF

| ID | Teste | Suite | Critério |
|---|---|---|---|
| T-PDF-01 | PDF de cautela gerado | `custody-suite` | Arquivo em Storage |
| T-PDF-02 | PDF de passagem gerado | `handover-suite` | Arquivo em Storage |
| T-PDF-03 | QR Code de verificação funcional | `signature-suite` | URL resolve corretamente |

### CAT-19 — Anexos / Upload

| ID | Teste | Suite | Critério |
|---|---|---|---|
| T-UP-01 | Upload de foto na passagem | `handover-suite` | Arquivo salvo em Storage |
| T-UP-02 | Upload de tipo inválido | `handover-suite` | 422 — MIME inválido |
| T-UP-03 | Upload > limite de tamanho | `handover-suite` | 413 |

### CAT-20 — Dashboard de Comando (Fase 7+)

| ID | Teste | Suite | Critério |
|---|---|---|---|
| DASH01 | Cards carregam sem erro | `dashboard-suite` | 200 em todos os endpoints |
| DASH02 | Contagens refletem dados reais | `dashboard-suite` | N+1 após criar registro |
| DASH03 | Filtro por unidade funciona | `dashboard-suite` | 0 resultados de outra unidade |
| DASH04 | Estado vazio tratado | `dashboard-suite` | Sem erro em tenant novo |
| DASH05 | Indicadores de atraso corretos | `dashboard-suite` | Card atualiza após vencimento |

### CAT-21 — Inventário (Fase 8+)

| ID | Teste | Suite | Critério |
|---|---|---|---|
| INV01 | Campanha criada com carga esperada | `inventory-suite` | inventory_item_checks criados |
| INV02 | Unidade B não vê carga de unidade A | `inventory-suite` | Isolamento correto |
| INV03 | Divergência sem justificativa bloqueada | `inventory-suite` | 422 |
| INV04 | Fechar sem todas as unidades assinadas | `inventory-suite` | 422 |
| INV05 | Relatório PDF após fechamento | `inventory-suite` | PDF verificável |

### CAT-22 — RLS (Row Level Security)

| ID | Teste | Suite | Critério |
|---|---|---|---|
| T-RLS-01 | anon key não retorna profiles de outros | `chromium` | 0 resultados |
| T-RLS-02 | audit_logs não acessíveis via anon | `audit-suite` | 403 ou 0 |
| T-RLS-03 | totp_secrets não acessíveis via anon | `ssa-suite` | 403 |
| T-RLS-04 | tenant_id isolation via RLS | `multitenant-suite` | Dados isolados |

### CAT-23 — Rate Limiting

| ID | Teste | Suite | Critério |
|---|---|---|---|
| T-RL-01 | 5 falhas de login em 15min → 429 | `rate-limit` | 429 com Retry-After |
| T-RL-02 | Clear rate limit via Nexus | `nexus-suite` | Desbloqueado após clear |
| T-RL-03 | Rate limit geral (120/min) | `rate-limit` | 429 após limite |
| T-RL-04 | Rate limit sensível (100/min) | `rate-limit` | 429 após limite |

### CAT-24 — TOTP

| ID | Teste | Suite | Critério |
|---|---|---|---|
| T-TOTP-01 | Configurar TOTP | `suite` | totp_configured = true |
| T-TOTP-02 | Validar TOTP com código correto | `ssa-suite` | 200 |
| T-TOTP-03 | Rejeitar TOTP repetido (anti-replay) | `ssa-suite` | 400/429 |
| T-TOTP-04 | Rejeitar TOTP inválido | `ssa-suite` | 400 |

### CAT-25 — CORS

| ID | Teste | Suite | Critério |
|---|---|---|---|
| T-CORS-01 | Origin não permitida bloqueada | `rate-limit` | CORS error |
| T-CORS-02 | Preflight OPTIONS retorna headers corretos | Manual | Access-Control-Allow-Origin |

### CAT-26 — Turnstile / CAPTCHA

| ID | Teste | Suite | Critério |
|---|---|---|---|
| T-TURN-01 | Login sem Turnstile (modo teste) | `chromium` | Token bypass funciona em E2E |
| T-TURN-02 | Login com Turnstile inválido | Manual (prod) | 400 |

### CAT-27 — SSA (Sistema de Solicitação)

| ID | Teste | Suite | Critério |
|---|---|---|---|
| ST01 | Militar solicita material | `ssa-suite` | 201 |
| ST02 | Armeiro aprova com nota | `ssa-suite` | status = aprovado |
| ST03 | Armeiro rejeita | `ssa-suite` | status = rejeitado |
| ST04 | Expiração automática em 6h | `ssa-suite` | status = expirado |
| ST05 | TOTP required em validação sensível | `ssa-suite` | 401 sem TOTP |
| ST06 | Stress: 10 solicitações simultâneas | `ssa-stress` | Sem race condition |

### CAT-28 — Exportação de Dados

| ID | Teste | Suite | Critério |
|---|---|---|---|
| T-EXP-01 | Exportar relatório gera audit_event | `audit-suite` | action="export.data" |
| T-EXP-02 | Exportação filtrada por tenant | `multitenant-suite` | Dados do tenant correto |
| T-EXP-03 | Exportação sem role adequado | `rbac-suite` | 403 |

### CAT-29 — Estados Vazios e Erros

| ID | Teste | Suite | Critério |
|---|---|---|---|
| T-EMPTY-01 | Lista de cautelas vazia | `chromium` | Empty state visível |
| T-EMPTY-02 | Dashboard sem dados | `dashboard-suite` | Cards com 0, sem erro |
| T-EMPTY-03 | Erro de API exibe toast | `suite` | Toast de erro visível |
| T-EMPTY-04 | Rota 404 | `chromium` | Página de erro adequada |

### CAT-30 — Biometria

| ID | Teste | Suite | Critério |
|---|---|---|---|
| T-BIO-01 | Identificação biométrica 1:N | Manual (ZKTeco físico) | Identifica corretamente |
| T-BIO-02 | Enroll biométrico | Manual | Template salvo |
| T-BIO-03 | Biometria não acessível via anon | `suite` | RLS bloqueia |

---

## Matriz de Regressão por Fase

Define quais suites devem passar para encerrar cada fase:

| Suite | F0 | F1 | F2 | F3 | F4 | F5 | F6 | F7 | F8 |
|---|---|---|---|---|---|---|---|---|---|
| `chromium` (smoke) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `suite` (principal) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `ssa-suite` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `nexus-suite` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `rate-limit` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `multitenant-suite` | — | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `rbac-suite` | — | — | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `audit-suite` | — | — | — | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `signature-suite` | — | — | — | — | ✅ | ✅ | ✅ | ✅ | ✅ |
| `custody-suite` | — | — | — | — | — | ✅ | ✅ | ✅ | ✅ |
| `handover-suite` | — | — | — | — | — | — | ✅ | ✅ | ✅ |
| `dashboard-suite` | — | — | — | — | — | — | — | ✅ | ✅ |
| `inventory-suite` | — | — | — | — | — | — | — | — | ✅ |

**Zero falhas permitidas** em qualquer suite marcada ✅.

---

## Definição de Fase Concluída

Uma fase está **CONCLUÍDA** quando:

```
✅ Suite da fase atual: X/X passando (0 falhas)
✅ Todas as suites anteriores da matriz acima: passando
✅ pnpm --filter web build: ✅
✅ pnpm typecheck: ✅
✅ pnpm lint: ✅
✅ Relatório final gerado em docs/enterprise/reports/phase-N-final-report.md
✅ 17 critérios do DoD Global confirmados (07-canonical-definition-of-done.md)
```

Se qualquer item for ❌ → fase está **REPROVADA** → ver condições de reprovação automática.

---

## Configuração de Nova Suite no playwright.config.ts

Template para adicionar nova suite:

```typescript
// Em apps/web/playwright.config.ts, na array 'projects':
{
  name: "phase-N-suite",
  use: { ...devices["Desktop Chrome"] },
  testMatch: ["e2e/phase-N-*.spec.ts"],
  workers: 1,        // 1 para testes com estado compartilhado
  retries: 1,        // 1 retry para CI
  timeout: 60_000,   // 60s por teste
},
```

---

## Harness de Teste de Segurança por Fase

### Fase 1 (Multi-tenant)
```typescript
// e2e/multitenant.spec.ts — IDs de teste: TT01-TT08
test("TT01 — tenant A não vê dados de tenant B", async ({ page }) => {
  // 1. Login como admin do Tenant A
  // 2. GET /api/lendings → verificar que TODOS os registros são do Tenant A
  // 3. Tentar GET /api/lendings?tenant_id=[tenant_B_id] → 0 resultados
});
```

### Fase 2 (RBAC)
```typescript
// e2e/rbac.spec.ts — IDs de teste: PT01-PT08+
test("PT01 — armeiro NÃO pode criar tenant", async ({ request }) => {
  // Login como armeiro, tentar POST /api/nexus/tenants → 403
});
```

### Fase 3 (Auditoria)
```typescript
// e2e/audit-events.spec.ts — IDs de teste: AT01-AT05
test("AT03 — DELETE em audit_events falha", async ({ request }) => {
  // service_role: DELETE FROM audit_events WHERE id = '...' → 0 rows affected
});
```

---

*Estratégia de regressão v1.0 — 2026-06-20*  
*Toda fase deve seguir esta estratégia. IMPLEMENTADO NÃO É ENTREGUE.*
