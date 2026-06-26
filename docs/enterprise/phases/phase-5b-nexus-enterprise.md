# Fase 5B — Nexus Enterprise: Super Admin Panel Completo

> **DoD Canônica:** IMPLEMENTADO NÃO É ENTREGUE — ver `../07-canonical-definition-of-done.md`  
> **Harness ID:** PH-5B  
> **Posição no roadmap:** Após Fase 5 (Cautela Enterprise) — antes da Fase 6 (Livro Digital)  
> **Premissa:** Fases 0-5 concluídas e todas as suites E2E verdes

---

## Objetivo

Transformar o painel Nexus de uma ferramenta técnica em um **control center enterprise completo** para o superadmin: criação e gestão de tenants com branding visual por tenant/reserva, sidebar colapsável com navegação inteligente, gestão de usuários contextual (dentro do tenant), cores e logo configuráveis por tenant, logo dinâmica na tela de login, suporte a subdomínios, e autenticação do superadmin com Google Authenticator (TOTP RFC 6238 via fluxo de setup dedicado no Nexus).

---

## 5 Leis de UX Aplicadas

| Lei | Aplicação concreta nesta fase |
|---|---|
| **Hick's Law** — menos opções = decisão mais rápida | Sidebar com apenas 5 itens principais; criação de usuários DENTRO do tenant (não no menu global), eliminando duplicidade de contexto |
| **Fitts's Law** — alvos maiores são mais fáceis de clicar | Botões de ação primária com `h-10 min-w-32`; áreas de clique de tenants com padding generoso; color picker com swatches grandes |
| **Jakob's Law** — usuários esperam padrões conhecidos | Sidebar colapsável seguindo padrão de admin dashboards (Vercel, Linear, Supabase); breadcrumbs em drill-down de tenant |
| **Miller's Law** — mente humana processa ~7 itens | Sidebar: 5 itens; criação de tenant: máximo 6 campos no formulário; branding: 2 cores + 2 logos |
| **Peak-End Rule** — primeiro e último momento definem a experiência | Loading state claro ao entrar no Nexus; estado de sucesso explícito ao criar tenant (toast + confetti sutil + destaque na lista) |

---

## Escopo

### Bloco 1 — Sidebar Colapsável (shadcn NavigationMenu)
- Sidebar desktop colapsável (expandida: 224px, recolhida: 64px)
- Animação de colapso suave com `transition-all duration-200`
- Em modo recolhido: apenas ícones com tooltip ao hover
- Botão de toggle no header da sidebar
- Estado de colapso salvo em `localStorage` (persiste entre navegações)
- Mobile: sidebar vira drawer (shadcn Sheet)
- Sem novo componente — usar `Sheet` do shadcn existente

### Bloco 2 — Gestão de Tenants com Usuários Embutidos
- Tenant list page: cada tenant tem um painel expansível (accordion)
- Dentro do painel expandido:
  - Info do tenant (nome, slug, tipo, status)
  - Lista de org_units (modo estruturado) ou reservas diretas (modo simples)
  - Lista de membros (usuários com role no tenant)
  - Botão "+ Adicionar membro" → dialog inline
  - Botão "+ Nova reserva" → dialog inline
  - Botão "Inativar tenant" → confirmação destrutiva
- Criação de usuário no contexto do tenant (não no menu global de Usuários)
- Pesquisa por matrícula/nome para vincular usuário existente ao tenant

### Bloco 3 — Branding Dinâmico por Tenant
- Migration: tabela `tenant_branding` (ver schema abaixo)
- BFF: `GET /api/nexus/tenants/:id/branding` → retorna configuração visual
- BFF: `PATCH /api/nexus/tenants/:id/branding` → atualiza cores e logos
- UI no Nexus: seção "Branding" dentro do painel do tenant
  - Color picker para cor primária (hex input + 8 swatches institucionais)
  - Color picker para cor secundária
  - Upload de logo do tenant (max 2MB, png/jpg/webp/svg)
  - Preview em tempo real: card simulando a tela de login com as cores/logos
  - Botão "Salvar" + indicador de mudanças não salvas
- Storage: bucket `tenant-logos` (separado do `reserve-logos`)

### Bloco 4 — Tela de Login com Branding por Tenant
- Login page (`/login`) detecta tenant pelo:
  1. Parâmetro `?tenant=slug` na URL (ex: `/login?tenant=pmpb`)
  2. Subdomínio: `pmpb.apmcb.pmpb.online` → detecta `pmpb`
  3. Fallback: logo institucional padrão
- Layout da tela de login reformulado:
  - **Lado esquerdo**: formulário de login (email/senha → TOTP)
  - **Lado direito** (desktop ≥ 768px): painel visual com logo do tenant grande centralizada + nome do órgão + cor primária como background
  - Mobile: apenas o formulário (sem painel direito)
- Logo do tenant carregada via `GET /api/public/branding?tenant=slug` (rota pública, sem auth)

### Bloco 5 — Suporte a Subdomínio por Tenant
- Campo `custom_subdomain` em `tenants` table (opcional, único)
- BFF: `GET /api/public/branding?tenant=slug` — sem auth — retorna logo + cores para a tela de login
- Next.js middleware: detecta subdomínio e injeta `tenant_hint` nos headers
- Login page: lê `tenant_hint` do header para carregar branding sem parâmetro de URL
- Nexus: campo "Subdomínio" no formulário de criação/edição de tenant
- Validação: slug do subdomínio `^[a-z0-9-]{2,30}$`, unicidade garantida por `UNIQUE` constraint

### Bloco 6 — Setup TOTP no Nexus para Superadmin
- Rota dedicada `/nexus/setup-2fa` (acessível ANTES do step TOTP no login)
- Flow:
  1. Superadmin faz login com credenciais (step 1)
  2. Se TOTP não configurado → redirect para `/nexus/setup-2fa`
  3. `/nexus/setup-2fa` exibe QR Code para Google Authenticator
  4. Campo para confirmar o primeiro código (anti-mistake)
  5. Após confirmação → marca TOTP como configurado → redirect para `/nexus`
- BFF: `GET /api/nexus/setup-2fa` → gera secret + QR Code URL (via `otpauth://`)
- BFF: `POST /api/nexus/setup-2fa/confirm` → valida primeiro token, salva secret em `totp_secrets`
- Garante que superadmin nunca fica "preso" sem poder configurar TOTP

---

## Fora do Escopo

- ❌ Google OAuth2 / Sign-in with Google (risco de dependência externa; TOTP RFC 6238 é suficiente)
- ❌ TOTP obrigatório para roles diferentes de superadmin/admin_global no Nexus
- ❌ Billing / subscription management de tenants
- ❌ SSO SAML/LDAP enterprise (Fase 12+)
- ❌ Múltiplos subdomínios por tenant (1:1 nesta fase)
- ❌ Editor visual de layout de login (apenas logo + cores)
- ❌ Push notification para admin quando tenant é criado

---

## Migration

### `20260625000001_nexus_enterprise.sql`

```sql
-- Branding por tenant
CREATE TABLE IF NOT EXISTS tenant_branding (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  primary_hex      CHAR(7) NOT NULL DEFAULT '#1B3A8C'
    CHECK (primary_hex ~ '^#[0-9a-fA-F]{6}$'),
  secondary_hex    CHAR(7) NOT NULL DEFAULT '#3b82f6'
    CHECK (secondary_hex ~ '^#[0-9a-fA-F]{6}$'),
  tenant_logo_url  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)
);

ALTER TABLE tenant_branding ENABLE ROW LEVEL SECURITY;

CREATE POLICY "superadmin_branding_full" ON tenant_branding
  FOR ALL USING (true);  -- service_role no BFF, anon nunca acessa

-- Trigger updated_at
CREATE OR REPLACE FUNCTION fn_tenant_branding_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
CREATE TRIGGER trg_tenant_branding_updated_at
  BEFORE UPDATE ON tenant_branding
  FOR EACH ROW EXECUTE FUNCTION fn_tenant_branding_updated_at();

-- Subdomínio por tenant
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS custom_subdomain TEXT
  UNIQUE
  CHECK (custom_subdomain ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$');

-- Seed branding para tenant existente
INSERT INTO tenant_branding (tenant_id, primary_hex, secondary_hex)
SELECT id, '#1B3A8C', '#3b82f6' FROM tenants
ON CONFLICT (tenant_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_tenant_branding_tenant ON tenant_branding(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenants_subdomain ON tenants(custom_subdomain)
  WHERE custom_subdomain IS NOT NULL;
```

---

## BFF — Endpoints

### Públicos (sem auth — para login page)

| Método | Path | Descrição |
|---|---|---|
| GET | `/api/public/branding` | `?tenant=slug` → `{ primary_hex, secondary_hex, tenant_logo_url, name }` |

### Protegidos por Nexus Session

| Método | Path | Descrição |
|---|---|---|
| GET | `/api/nexus/tenants/:id/branding` | Retorna branding do tenant |
| PATCH | `/api/nexus/tenants/:id/branding` | Atualiza cores (hex) |
| POST | `/api/nexus/tenants/:id/logo` | Upload logo → Storage `tenant-logos` |
| PATCH | `/api/nexus/tenants/:id/status` | Ativa/inativa tenant |
| GET | `/api/nexus/tenants/:id/members` | Lista membros do tenant (cross-reserve) |
| POST | `/api/nexus/tenants/:id/members` | Adiciona membro ao tenant |
| GET | `/api/nexus/setup-2fa` | Gera QR Code TOTP para superadmin não configurado |
| POST | `/api/nexus/setup-2fa/confirm` | Confirma primeiro token, salva secret |

---

## Frontend — Componentes

### Sidebar Colapsável
```
apps/web/src/app/nexus/_components/nexus-sidebar.tsx   ← MODIFICAR
```
- Estado: `const [collapsed, setCollapsed] = useState(false)` + localStorage
- Largura: `w-56` → `w-14` ao colapsar (com `transition-all duration-200`)
- Labels e descrições: visíveis apenas quando expandido (`collapsed ? "hidden" : "block"`)
- Ícones: sempre visíveis (tamanho `size-5` quando colapsado)
- Toggle button: `ChevronLeft/Right` no footer da sidebar
- Mobile: `Sheet` do shadcn — overlay full

### Nexus Tenants com Accordion
```
apps/web/src/app/nexus/tenants/page.tsx              ← REESCREVER
```
- Lista de tenants como cards colapsáveis (shadcn `Accordion`)
- Cada tenant expandido mostra:
  - Header: nome, slug, tipo, status badge
  - Tabs: "Estrutura" | "Membros" | "Branding"
  - **Aba Estrutura**: lista de org_units → reserves (modo estruturado) ou reserves diretamente (modo simples)
  - **Aba Membros**: lista de usuários vinculados ao tenant + botão "+ Adicionar"
  - **Aba Branding**: color pickers + upload de logo + preview

### Tela de Login Reformulada
```
apps/web/src/app/login/page.tsx                       ← MODIFICAR
```
- Layout `grid grid-cols-1 md:grid-cols-2 min-h-dvh`
- Col esquerda: formulário atual (sem mudança de lógica)
- Col direita (`hidden md:flex`): painel de branding
  - Background: `primary_hex` do tenant
  - Logo centralizada (máx 200px)
  - Nome do órgão em texto grande
  - Tagline institucional
  - Se sem tenant hint: painel com logo institucional padrão

### Setup 2FA no Nexus
```
apps/web/src/app/nexus/setup-2fa/page.tsx             ← CRIAR
```
- Acessível antes do TOTP step (sem nexus session)
- QR Code exibido via `<img src={qrCodeUrl} />` (otplib gera URL)
- Input de confirmação do primeiro código
- Instrução clara: "Abra o Google Authenticator → Scan QR → Digite o código"
- Redirect automático para login TOTP step após confirmação

---

## Swatches Institucionais para Color Picker

```
Cores sugeridas para picker (paleta institucional):
#1B3A8C  — Azul PM (padrão)
#0D1B4B  — Azul marinho
#0f172a  — Slate 900
#1e3a5f  — Azul corporativo
#166534  — Verde militar
#7c2d12  — Vermelho bombeiro
#1c1917  — Preto institucional
#374151  — Cinza operacional
```

---

## Testes E2E

### Suite: `nexus-enterprise-suite` — NE01-NE16

| ID | Cenário | Resultado esperado | Bloqueio |
|---|---|---|---|
| NE01 | Sidebar colapsa/expande e estado persiste no reload | localStorage salvo, largura muda, labels somem/aparecem | |
| NE02 | Criar tenant simples via accordion form | Tenant aparece na lista, `structure_mode=simple` | ✅ |
| NE03 | Criar tenant estruturado com org_unit + reserva | Hierarquia correta no banco | ✅ |
| NE04 | Adicionar membro a tenant pelo painel embutido | `tenant_memberships +1`, usuário aparece na aba Membros | ✅ |
| NE05 | Upload logo de tenant → aparece na aba Branding | URL salva em `tenant_branding.tenant_logo_url` | ✅ |
| NE06 | Editar cor primária + salvar → GET branding retorna nova cor | `primary_hex` atualizado no DB | ✅ |
| NE07 | Login page com `?tenant=pmpb` carrega logo e cor do tenant | Logo visível no painel direito, cor como background | ✅ BLOQUEIO |
| NE08 | Slug duplicado em tenant → 409 + mensagem clara na UI | Formulário não fecha, toast de erro | ✅ BLOQUEIO |
| NE09 | Inativar tenant → membros não conseguem logar | POST /api/auth/login retorna 403 para membro do tenant inativo | ✅ BLOQUEIO |
| NE10 | Superadmin sem TOTP → `/nexus/login` redireciona para `/nexus/setup-2fa` | Redirect correto, QR Code exibido | ✅ BLOQUEIO |
| NE11 | Setup 2FA: QR Code gerado → código confirmado → TOTP ativo | `totp_configured=true`, `totp_secrets+1` | ✅ BLOQUEIO |
| NE12 | Rota pública `/api/public/branding?tenant=pmpb` retorna branding sem auth | Status 200, `primary_hex` correto | ✅ |
| NE13 | Subdomínio único por tenant — duplicata → 409 | Constraint violada, mensagem clara | ✅ BLOQUEIO |
| NE14 | Preview de branding reflete cores em tempo real (antes de salvar) | Card de preview atualiza ao mudar hex no input | |
| NE15 | Mobile: sidebar abre como drawer Sheet ao clicar no hamburguer | Overlay visível, nav links clicáveis | |
| NE16 | Branding de tenant A não vaza em login de tenant B | Logo e cores corretos por tenant | ✅ BLOQUEIO |

---

## Arquivos Permitidos

**BFF:**
- `apps/bff/src/routes/nexus.ts` — adicionar endpoints de branding, logo, status, members, setup-2fa
- `apps/bff/src/routes/index.ts` / `apps/bff/src/index.ts` — adicionar rota pública de branding

**Frontend:**
- `apps/web/src/app/nexus/_components/nexus-sidebar.tsx` — sidebar colapsável
- `apps/web/src/app/nexus/tenants/page.tsx` — reescrever com accordion
- `apps/web/src/app/nexus/setup-2fa/page.tsx` — CRIAR (setup TOTP)
- `apps/web/src/app/nexus/login/page.tsx` — redirect para setup-2fa se TOTP ausente
- `apps/web/src/app/login/page.tsx` — painel de branding à direita
- `apps/web/src/middleware.ts` — detectar subdomínio e injetar tenant_hint

**Database:**
- `supabase/migrations/20260625000001_nexus_enterprise.sql`

**Testes:**
- `apps/web/e2e/nexus-enterprise.spec.ts` — NE01-NE16
- `apps/web/playwright.config.ts` — adicionar `nexus-enterprise-suite`

---

## Arquivos Proibidos

| Arquivo | Motivo |
|---|---|
| `apps/bff/src/routes/auth.ts` | Auth estável |
| `supabase/migrations/2026060*.sql` | Nunca alterar migrations existentes |
| `apps/web/src/components/ui/*.tsx` | Design system — não tocar |
| `apps/bff/src/middleware/role-guard.ts` | RBAC concluído |
| `apps/web/e2e/saidas.spec.ts` | Fase 5 concluída — não regredir |
| `apps/web/e2e/cautelamentos.spec.ts` | Fase 5 concluída — não regredir |
| `apps/web/e2e/item-integrity.spec.ts` | Fase 5 concluída — não regredir |

---

## Sequência de Execução

```
1.  Migration: 20260625000001_nexus_enterprise.sql (via psql VPS)
2.  BFF: GET /api/public/branding (rota pública)
3.  BFF: GET + PATCH /api/nexus/tenants/:id/branding
4.  BFF: POST /api/nexus/tenants/:id/logo (Storage upload)
5.  BFF: PATCH /api/nexus/tenants/:id/status (ativar/inativar)
6.  BFF: GET + POST /api/nexus/tenants/:id/members
7.  BFF: GET + POST /api/nexus/setup-2fa (QR Code + confirm)
8.  Frontend: nexus-sidebar.tsx colapsável
9.  Frontend: nexus/tenants/page.tsx com accordion + tabs
10. Frontend: nexus/setup-2fa/page.tsx (nova)
11. Frontend: nexus/login/page.tsx (redirect para setup-2fa se sem TOTP)
12. Frontend: login/page.tsx reformulada (painel direito de branding)
13. Frontend: middleware.ts (detecção de subdomínio)
14. Testes: nexus-enterprise.spec.ts (NE01-NE16)
15. Regressão completa de todas as suites
16. Relatório: reports/phase-5b-final-report.md
```

---

## Riscos e Mitigações

| Risco | Probabilidade | Mitigação |
|---|---|---|
| Storage public URL exposta sem TTL | Alta | Usar signed URLs com TTL 1h para logos privadas; tenant_logo_url para login page pode ser pública (branding intencional) |
| Middleware de subdomínio quebrando localhost | Alta | Detectar `localhost` e ignorar lógica de subdomínio; usar `?tenant=slug` em dev |
| Color picker sem validação de contraste WCAG | Média | Validar luminosidade mínima: cor primária deve ter contraste ≥ 4.5:1 contra branco |
| Accordion de tenants lento com 50+ tenants | Média | Virtualizar lista se > 20 tenants; paginação server-side |
| Setup 2FA secret exposto em log | Alta | NUNCA logar o secret; apenas logar o user_id |
| Sidebar colapsada quebrando tooltips em mobile | Baixa | Tooltips apenas em desktop (`@media(hover:hover)`) |
| Subdomínio em CF Pages requer wildcard DNS | Alta | Documentar configuração de `*.apmcb.pmpb.online` no CF; não bloquear a feature |

---

## Critérios de Aceite

| # | Critério | Bloqueio? |
|---|---|---|
| CA01 | NE01-NE16 passando (0 failed, 0 skipped) | ✅ BLOQUEIO |
| CA02 | Sidebar colapsa em desktop e vira drawer em mobile | ✅ |
| CA03 | Criação de tenant (simples + estruturado) funciona end-to-end | ✅ BLOQUEIO |
| CA04 | Branding dinâmico no login com logo + cor por tenant | ✅ BLOQUEIO |
| CA05 | Setup 2FA funcional para superadmin sem TOTP | ✅ BLOQUEIO |
| CA06 | NE09 — inativação de tenant bloqueia login de membros | ✅ BLOQUEIO |
| CA07 | NE16 — sem vazamento de branding entre tenants | ✅ BLOQUEIO |
| CA08 | Regressão completa verde (todas as suites F0-F5) | ✅ BLOQUEIO |
| CA09 | Build e typecheck sem erros | ✅ BLOQUEIO |
| CA10 | Relatório final gerado | ✅ |

---

## Regressão Obrigatória

```bash
cd apps/web
npx playwright test --project=nexus-enterprise-suite --workers=1
npx playwright test --project=nexus-suite --workers=1
npx playwright test --project=saida-suite --workers=1
npx playwright test --project=cautelamento-suite --workers=1
npx playwright test --project=item-integrity-suite --workers=1
npx playwright test --project=signature-suite --workers=1
npx playwright test --project=rbac-suite --workers=1
npx playwright test --project=multitenant-suite --workers=1
npx playwright test --project=audit-suite --workers=1
```

**ZERO falhas permitidas antes de avançar para Fase 6.**

---

## Definition of Done da Fase 5B

### 1. Critérios Funcionais
- [ ] Sidebar colapsável funciona em desktop (ícones) e mobile (drawer)
- [ ] Tenant criado (simples + estruturado) com org_unit e reserva do painel Nexus
- [ ] Membros adicionados ao tenant dentro do accordion (não no menu global)
- [ ] Branding (logo + cores) configurado por tenant via Nexus
- [ ] Login page exibe logo + cor primária do tenant no painel direito
- [ ] `GET /api/public/branding?tenant=slug` retorna dados sem auth
- [ ] Superadmin sem TOTP é redirecionado para `/nexus/setup-2fa`
- [ ] Setup 2FA gera QR Code, confirma token, salva secret

### 2. Critérios Técnicos
- [ ] Migration `20260625000001_nexus_enterprise.sql` aplicada
- [ ] Build passa: `pnpm --filter web build`
- [ ] Typecheck: `pnpm typecheck` sem erros
- [ ] Sem hardcode de hex colors no componente (usar variáveis CSS)

### 3. Critérios de Segurança
- [ ] Secret TOTP nunca em log
- [ ] Rota `/api/public/branding` nunca retorna dados de auth/usuários
- [ ] Upload de logo valida MIME type e tamanho (max 2MB)
- [ ] Inativação de tenant bloqueia acesso de membros imediatamente

### 4. Critérios de UX (5 Leis)
- [ ] Hick's: sidebar com no máximo 5 itens top-level
- [ ] Fitts's: botões primários com `h-10 px-4` mínimo
- [ ] Jakob's: sidebar segue convenção de painel admin conhecido
- [ ] Miller's: formulário de criação de tenant com no máximo 6 campos
- [ ] Peak-End: toast de sucesso + highlight do tenant recém-criado na lista

### 5. Critérios de Regressão
- [ ] nexus-enterprise-suite: 16/16 passando
- [ ] saida-suite: 6/6 ✅
- [ ] cautelamento-suite: 8/8 ✅
- [ ] item-integrity-suite: 9/9 ✅
- [ ] signature-suite: 6/6 ✅

### 6. Evidências Obrigatórias
- [ ] Screenshot: sidebar expandida vs. recolhida
- [ ] Screenshot: login page com branding de dois tenants diferentes
- [ ] Screenshot: tenant accordion com aba Membros + aba Branding
- [ ] Screenshot: tela setup-2fa com QR Code
- [ ] Output de `pnpm typecheck` sem erros
- [ ] Relatório em `docs/enterprise/reports/phase-5b-final-report.md`
