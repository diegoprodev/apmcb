# Fase 7B — Onboarding Enterprise, Branding e Stress Operacional

> **DoD Canônica:** IMPLEMENTADO NÃO É ENTREGUE — ver `../07-canonical-definition-of-done.md`
> **Harness ID:** PH-7B
> **Posição no roadmap:** Após Fase 7 (Dashboard de Comando) — executada com dados reais pós-implementação
> **Premissa:** Fases 0-7 concluídas — sistema completo em produção com dados operacionais reais

---

## Objetivo

Transformar o sistema de uma fundação técnica em uma plataforma operacionalmente completa:
criar o fluxo de onboarding de novos tenants do zero (UI + API + storage), implementar branding
dinâmico por tenant/reserva (logo + cores), popular dados realistas de armamento, e executar
bateria de stress operacional de ponta a ponta simulando operações reais de cautela, SSA, auditoria
e exportação de PDF.

---

## Escopo

### Bloco 1 — Onboarding Enterprise UI (Nexus + Admin)
- E2E completo da criação de tenant em **modo simples** via Nexus:
  `POST /api/nexus/tenants` → UI `/nexus/tenants` → criação de reserve direta
- E2E completo da criação de tenant em **modo estruturado** via Nexus:
  `POST /api/nexus/tenants` → `POST /api/nexus/tenants/:id/org-units` → `POST /api/nexus/tenants/:id/reserves`
- Upload de logo por reserve via `/admin/estrutura` (Storage bucket `reserve-logos`)
- Validação de slug único, unicode, conflito de acronym entre tenants
- Inativação de tenant (cascata → reserves inativas → acesso bloqueado)

### Bloco 2 — Branding Dinâmico
- BFF: `GET /api/tenant/branding` → `{ tenant_logo_url, reserve_logo_url, primary_hex, secondary_hex }`
- Tabela `tenant_branding` com colunas `primary_hex`, `secondary_hex`, `tenant_logo_url`, `reserve_logo_url`
- Login page: logo do tenant carregada da sessão (fallback `/images/pm-logo.png`)
- Painel lateral: logo da reserva carregada do perfil do usuário
- CSS custom properties `--color-primary` e `--color-secondary` injetadas via `<style>` server-side
- Hover states em links, botões e badges usando `var(--color-primary)`
- Admin UI para editar cores e logos em `/admin/estrutura`

### Bloco 3 — Population Script
- Seed de dados operacionais realistas para PMPB/APMCB:
  - 20 militares com `registration_status=complete`, biometria simulada, fotos placeholder
  - 10 tipos de material (pistola, colete balístico, algema, lanterna, etc.) com calibre/categoria
  - 30 cautelas históricas fechadas (com `returned_at` e `master_id`)
  - 5 cautelas abertas (em andamento)
  - 10 SSA requests em diferentes status: `pending`, `approved`, `rejected`, `expired`
  - 3 ocorrências com prioridade variada
  - Notificações de sistema para cada usuário ativo
- Script idempotente em `supabase/scripts/seed-operational.mjs`
- Verificação pós-seed: contagens via API + asserções no test

### Bloco 4 — Stress Operacional de Ponta a Ponta
- 5 cautelas simultâneas para o mesmo armeiro (race condition no `status_legacy`)
- Ciclo completo de armamento/desarmamento: TOTP → lending → return → audit trail
- SSA request → TOTP approval → PDF export sob carga (3 requisições paralelas)
- Tentativa de cautela em material já emprestado → rejeição correta
- Admin lendo relatório PDF enquanto armeiro emite 3 cautelas simultâneas
- 10 logins paralelos de usuários diferentes (session isolation)
- Expiração de SSA request: criado há 6h+ → status `expired` automático
- Troca de reserva ativa pelo militar: preferência salva em `user_reserve_preferences`

---

## Fora do Escopo

- ❌ Assinatura digital de documentos PDF (Fase 4)
- ❌ Livro de serviço eletrônico (Fase 6)
- ❌ Dashboard de KPIs por comando (Fase 7)
- ❌ Multi-tenant billing ou licenciamento
- ❌ OAuth2 / SSO federado com AD/LDAP
- ❌ Push notifications mobile (Fase 6+)

---

## Premissas

| # | Premissa | Como verificar |
|---|---|---|
| P1 | Fase 2 completa — 6 roles e PT01-PT08 passando | `pnpm test:e2e --project=rbac-suite` |
| P2 | Nexus page `/nexus/tenants` renderiza sem erros | Acesso manual com superadmin |
| P3 | `/admin/estrutura` renderiza modo structured e simple | Acesso manual com admin_global |
| P4 | Storage bucket `reserve-logos` criado no Supabase | Verificar em Supabase Dashboard → Storage |
| P5 | BFF build e deploy sem erros TypeScript | `npx tsc --noEmit` em apps/bff |

---

## Arquivos Permitidos

**BFF:**
- `apps/bff/src/routes/nexus.ts` — completar endpoints de criação com full E2E
- `apps/bff/src/routes/admin.ts` — adicionar PATCH branding (cores + logos)
- `apps/bff/src/routes/dashboard.ts` — adicionar GET /api/tenant/branding
- `apps/bff/src/routes/arsenal.ts` — nenhuma alteração de lógica, só testes

**Frontend:**
- `apps/web/src/app/login/page.tsx` — carregar logo dinâmico do branding
- `apps/web/src/app/(dashboard)/layout.tsx` — injetar CSS custom properties de branding
- `apps/web/src/components/layout/sidebar.tsx` — logo da reserva dinâmico
- `apps/web/src/app/(dashboard)/admin/estrutura/page.tsx` — editor de branding
- `apps/web/src/app/nexus/tenants/page.tsx` — já existe, adicionar inativação de tenant

**Database:**
- `supabase/migrations/20260622000003_tenant_branding.sql` — nova tabela branding

**Scripts:**
- `supabase/scripts/seed-operational.mjs` — população de dados realistas
- `supabase/scripts/apply-rbac-migration.mjs` — mantido como referência

**Testes:**
- `apps/web/e2e/onboarding.spec.ts` — OB01-OB12
- `apps/web/e2e/branding.spec.ts` — BR01-BR06
- `apps/web/e2e/stress-operacional.spec.ts` — SO01-SO15
- `apps/web/playwright.config.ts` — adicionar `onboarding-suite`, `branding-suite`, `stress-operacional`

---

## Arquivos Proibidos

| Arquivo | Motivo |
|---|---|
| `apps/bff/src/routes/auth.ts` | Auth estável — não tocar |
| `supabase/migrations/2026061*.sql` | Nunca alterar migrations existentes |
| `apps/web/src/components/ui/*.tsx` | Design system — não tocar |
| `apps/bff/src/middleware/role-guard.ts` | RBAC já concluído |

---

## Tabelas Permitidas

| Tabela | Operação | Justificativa |
|---|---|---|
| `tenant_branding` | CREATE + INSERT + UPDATE | Nova tabela de branding |
| `tenants` | UPDATE (status) | Inativação de tenant |
| `reserves` | UPDATE (logo_url) | Upload de logo |
| `user_reserve_preferences` | INSERT + UPDATE | Preferência de reserva |
| `profiles` (seed) | INSERT | Militares de teste |
| `material_types` (seed) | INSERT | Materiais de teste |

---

## Tabelas Proibidas

Todas as demais — branding é camada visual e scripts de seed, não alteração de schema core.

---

## Migration

**Arquivo:** `supabase/migrations/20260622000003_tenant_branding.sql`

```sql
-- Fase 2B — Branding dinâmico por tenant
CREATE TABLE IF NOT EXISTS tenant_branding (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  primary_hex     CHAR(7) DEFAULT '#0f172a'   -- slate-900
    CHECK (primary_hex ~ '^#[0-9a-fA-F]{6}$'),
  secondary_hex   CHAR(7) DEFAULT '#3b82f6'  -- blue-500
    CHECK (secondary_hex ~ '^#[0-9a-fA-F]{6}$'),
  tenant_logo_url TEXT,
  reserve_logo_url TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id)
);

-- Seed branding padrão para PMPB
INSERT INTO tenant_branding (tenant_id, primary_hex, secondary_hex)
SELECT id, '#0f172a', '#3b82f6' FROM tenants WHERE slug = 'pmpb'
ON CONFLICT (tenant_id) DO NOTHING;

-- RLS
ALTER TABLE tenant_branding ENABLE ROW LEVEL SECURITY;
-- Leitura pública (qualquer usuário autenticado do tenant)
CREATE POLICY "tenant_member_read_branding" ON tenant_branding
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM tenant_memberships tm
      WHERE tm.tenant_id = tenant_branding.tenant_id
        AND tm.user_id = auth.uid()
    )
  );
-- Escrita apenas por admin_global e superadmin (via service_role no BFF)

-- Trigger updated_at
CREATE OR REPLACE FUNCTION set_tenant_branding_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
CREATE TRIGGER trg_tenant_branding_updated_at
  BEFORE UPDATE ON tenant_branding
  FOR EACH ROW EXECUTE FUNCTION set_tenant_branding_updated_at();

-- Index
CREATE INDEX IF NOT EXISTS idx_tenant_branding_tenant ON tenant_branding(tenant_id);
```

---

## BFF — Endpoint de Branding

**`GET /api/tenant/branding`** — retorna configuração visual do tenant atual

```typescript
// Response
{
  primary_hex:      "#0f172a",
  secondary_hex:    "#3b82f6",
  tenant_logo_url:  "https://...reserve-logos/pmpb/tenant.png",
  reserve_logo_url: "https://...reserve-logos/pmpb/apmcb/logo.png"
}
```

Cache de 5 minutos no BFF (evita round-trip a cada page load).

---

## Frontend — CSS Custom Properties

```tsx
// apps/web/src/app/(dashboard)/layout.tsx (server component)
const branding = await fetchBranding(session.tenantId);

return (
  <>
    <style>{`
      :root {
        --color-primary: ${branding.primary_hex};
        --color-secondary: ${branding.secondary_hex};
      }
    `}</style>
    {children}
  </>
);
```

```css
/* globals.css — adições */
.btn-primary { background: var(--color-primary); }
.btn-primary:hover { filter: brightness(1.15); }
a.nav-link:hover { color: var(--color-secondary); }
```

---

## Testes E2E

### Suite: `onboarding-suite` — OB01-OB12

| ID | Cenário | Critério | Bloqueio |
|---|---|---|---|
| OB01 | Superadmin cria tenant simples via Nexus UI | Tenant aparece na lista com `structure_mode=simple` | ✅ |
| OB02 | Superadmin cria tenant estruturado via Nexus UI | Tenant criado com `structure_mode=structured` | ✅ |
| OB03 | Admin global cria org_unit dentro de tenant estruturado | `org_units` count +1, parent_id correto | ✅ |
| OB04 | Admin global cria reserva vinculada à org_unit | `reserves.org_unit_id` setado corretamente | ✅ |
| OB05 | Admin global cria reserva direta em tenant simples | `reserves.org_unit_id IS NULL` | ✅ |
| OB06 | Slug duplicado é rejeitado com mensagem clara | HTTP 409 + mensagem no UI | ✅ BLOQUEIO |
| OB07 | Acronym de reserva duplicado entre tenants é rejeitado | HTTP 409 + mensagem no UI | ✅ BLOQUEIO |
| OB08 | Logo upload para reserva — imagem salva no Storage | URL retornada + imagem acessível | ✅ |
| OB09 | Inativação de tenant bloqueia login de membros | Membro recebe 403 ao tentar logar | ✅ BLOQUEIO |
| OB10 | Seed operacional executado → contagens corretas | 20 militares, 10 materiais, 35 cautelas | ✅ |
| OB11 | Militar sem `reserve_membership` vê lista de reservas ativas | GET /api/nexus/tenants/:id/reserves → APMCB visível | ✅ |
| OB12 | Troca de reserva ativa salva preferência do usuário | `user_reserve_preferences` atualizado | ✅ |

### Suite: `branding-suite` — BR01-BR06

| ID | Cenário | Critério | Bloqueio |
|---|---|---|---|
| BR01 | GET /api/tenant/branding retorna cores e URLs corretos | `primary_hex`, `secondary_hex` presentes | ✅ |
| BR02 | Login page carrega logo do tenant do DB (não hardcoded) | Screenshot sem logo estático fallback quando tenant tem logo | ✅ |
| BR03 | Sidebar exibe logo da reserva quando configurado | Screenshot com reserve_logo_url da sessão | ✅ |
| BR04 | CSS custom properties aplicados no layout | `--color-primary` presente no `<style>` do HTML | ✅ |
| BR05 | Admin edita cores via `/admin/estrutura` → salvo no DB | PATCH branding → GET branding retorna novos valores | ✅ |
| BR06 | Branding de tenant A não vaza para sessão de tenant B | Admin de tenant B vê suas próprias cores | ✅ BLOQUEIO |

### Suite: `stress-operacional` — SO01-SO15

| ID | Cenário | Critério Real | Bloqueio |
|---|---|---|---|
| SO01 | 5 cautelas simultâneas para o mesmo armeiro | Todos os 5 INSERTs persistem, nenhum perdido | ✅ BLOQUEIO |
| SO02 | Cautela em material já emprestado (race condition) | 2ª tentativa recebe 409/400 — não duplica empréstimo | ✅ BLOQUEIO |
| SO03 | Ciclo completo: armamento TOTP → lending → return | Status `returned_at` setado corretamente, audit log gerado | ✅ |
| SO04 | SSA request → TOTP approval → PDF export | PDF gerado com assinatura de tempo real | ✅ |
| SO05 | 3 PDFs exportados em paralelo | Todos os 3 retornam 200 com `Content-Type: application/pdf` | ✅ |
| SO06 | SSA expirado (criado há 6h+) não pode ser aprovado | Status `expired` automático, approval retorna 409 | ✅ BLOQUEIO |
| SO07 | 10 logins simultâneos — sessions isoladas | Cada usuário acessa APENAS seus dados (RLS ativo) | ✅ BLOQUEIO |
| SO08 | Admin_global lê relatório enquanto 3 cautelas emitidas | Relatório retorna dados consistentes (no phantom reads) | ✅ |
| SO09 | Armeiro tenta emitir cautela com TOTP expirado | TOTP expired → 403, cautela não criada | ✅ BLOQUEIO |
| SO10 | 20 material_requests simultâneos de usuários distintos | Todos os 20 persistem, IDs únicos | ✅ |
| SO11 | Troca de reserva ativa: militar muda para reserva 2 | `user_reserve_preferences.is_favorite` atualizado | ✅ |
| SO12 | Devolução de cautela por armeiro diferente do que emitiu | Aceita se mesmo tenant_id e reserva | ✅ |
| SO13 | Filtro de relatório com 1000+ registros | Paginação correta, sem timeout em 5s | ✅ |
| SO14 | Multi-tenant isolation: admin de PMPB não vê dados de GM | RLS bloqueia, 0 resultados em qualquer query | ✅ BLOQUEIO |
| SO15 | Rate limit de 120/min em exchange sob carga de 10 workers | Workers acima do limite recebem 429, não 500 | ✅ |

---

## Critérios de Aceite

| # | Critério | Bloqueio? |
|---|---|---|
| CA01 | OB01-OB12 passando (onboarding full E2E) | ✅ BLOQUEIO |
| CA02 | BR01-BR06 passando (branding dinâmico funcionando) | ✅ Sim |
| CA03 | SO01-SO15 passando (0 race conditions, 0 vazamentos) | ✅ BLOQUEIO |
| CA04 | Modo simples e estruturado validados end-to-end via UI | ✅ BLOQUEIO |
| CA05 | Regressão completa verde após todos os blocos | ✅ BLOQUEIO |
| CA06 | Logo de tenant e reserva carregadas dinamicamente | Sim |
| CA07 | Isolation: zero cross-tenant data leak nos stress tests | ✅ BLOQUEIO |

---

## Sequência de Execução

```
1. Migration: 20260622000003_tenant_branding.sql
2. BFF: GET /api/tenant/branding + PATCH /api/admin/branding
3. BFF: completar endpoints nexus (inativação de tenant)
4. Frontend: login page branding dinâmico
5. Frontend: layout.tsx CSS custom properties
6. Frontend: sidebar reserve logo
7. Frontend: /admin/estrutura editor de cores
8. Script: seed-operational.mjs (20 militares, materiais, cautelas)
9. Testes: onboarding.spec.ts (OB01-OB12)
10. Testes: branding.spec.ts (BR01-BR06)
11. Testes: stress-operacional.spec.ts (SO01-SO15)
12. Regressão completa
13. Relatório: reports/phase-2b-report.md
```

---

## Riscos e Mitigações

| Risco | Probabilidade | Mitigação |
|---|---|---|
| Race condition em cautelas simultâneas (SO01-SO02) | Alta | Adicionar `SELECT FOR UPDATE` na query de verificação de disponibilidade |
| Storage URL pública exposta sem autenticação | Alta | Usar Supabase Storage com signed URLs (TTL 1h) |
| CSS custom properties quebrando em SSR | Média | Injetar via `<style>` tag server-side, não via JS |
| Seed script não idempotente quebrando CI | Média | Usar `ON CONFLICT DO NOTHING` em todos os INSERTs |
| branding.reserve_logo_url null quebrando sidebar | Baixa | Fallback para ícone default quando null |
| Timeout no stress SO13 (1000+ registros) | Média | Garantir índices em `tenant_id + created_at`, usar cursor pagination |

---

## Testes de Regressão Obrigatórios

```bash
cd apps/web
pnpm test:e2e --project=chromium         # core smoke
pnpm test:e2e --project=suite            # CRUD + regressão
pnpm test:e2e --project=ssa-suite        # SSA flows
pnpm test:e2e --project=rbac-suite       # RBAC (Fase 2)
pnpm test:e2e --project=multitenant-suite # Multi-tenant (Fase 1)
pnpm test:e2e --project=onboarding-suite  # NOVA — Fase 2B
pnpm test:e2e --project=branding-suite    # NOVA — Fase 2B
pnpm test:e2e --project=stress-operacional # NOVA — Fase 2B
```

**ZERO falhas permitidas.**

---

## Relatório Final

Gerar `docs/enterprise/reports/phase-2b-report.md` com:
- OB01-OB12: resultado por teste (passed/failed/skipped)
- BR01-BR06: resultado
- SO01-SO15: resultado + latência observada nos stress tests
- Screenshot do branding dinâmico funcionando no login
- Screenshot das cores customizadas no layout
- Evidência de isolation multi-tenant (SO07, SO14)
- Commit hash do deploy final
