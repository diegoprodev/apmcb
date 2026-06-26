# Loop Prompt — Fase 5B: Nexus Enterprise

> **Uso:** `/loop` com este arquivo como instrução de turno  
> **Spec de referência:** `docs/enterprise/phases/phase-5b-nexus-enterprise.md`  
> **Objetivo:** Implementar o Nexus Enterprise completo step-by-step, validando cada bloco antes do próximo

---

## Instruções para o Loop Agent

Você é o implementador da Fase 5B do sistema APMCB. A cada iteração do loop, você deve:

1. **Verificar o estado atual** — ler o arquivo de progresso em `docs/enterprise/loop-state-nexus.md`
2. **Executar o próximo passo** da sequência abaixo
3. **Validar** o passo executado (typecheck, teste, ou verificação manual)
4. **Atualizar o arquivo de progresso** com o resultado
5. **Parar se houver falha** — nunca avançar com passo anterior quebrado

---

## Arquivo de Estado

O arquivo `docs/enterprise/loop-state-nexus.md` deve conter:
```
## Estado Atual
PASSO_ATUAL: X
PASSO_ANTERIOR: X-1
STATUS_ANTERIOR: passed | failed | blocked
NOTAS: [observações livres]
```

Se o arquivo não existir, criá-lo com `PASSO_ATUAL: 0`.

---

## Contexto do Projeto

- **BFF:** `apps/bff/src/` — Hono em Node.js, TypeScript strict
- **Frontend:** `apps/web/src/` — Next.js 16, Tailwind, shadcn/ui
- **DB:** Supabase PostgreSQL — migrations via psql no VPS Hetzner
- **SSH VPS:** `ssh -i ~/.ssh/apmcb_hetzner root@91.99.113.89`
- **Aplicar migration:** `PGPASSWORD='19041308Drs@#' psql -h db.jepitcrkicwmvzrmllpn.supabase.co -U postgres -d postgres -f <arquivo.sql>`
- **Deploy BFF:** `ssh -i ~/.ssh/apmcb_hetzner root@91.99.113.89 "cd /opt/apmcb/apps/bff && git pull && pnpm build && pm2 restart apmcb-bff"`
- **Test:** `cd apps/web && npx playwright test --project=nexus-enterprise-suite --workers=1`
- **Typecheck:** `pnpm typecheck` (na raiz do monorepo)
- **Tenant de teste:** `f0edc186-693f-4ab0-a0e8-6c18d65876fa` (PMPB / APMCB)

---

## Sequência de Passos

### PASSO 0 — Verificação de Premissas
**Ação:**
1. Verificar se `pnpm test:e2e --project=saida-suite` passa (regressão Fase 5)
2. Verificar se `pnpm test:e2e --project=cautelamento-suite` passa
3. Confirmar que a tabela `tenant_branding` NÃO existe ainda no banco
4. Confirmar que `tenants` NÃO tem coluna `custom_subdomain`

**Critério de sucesso:** F5 verde + schema sem branding + sem subdomain  
**Falha:** Abortar e corrigir regressão antes de avançar

---

### PASSO 1 — Migration: Nexus Enterprise Schema
**Arquivo:** `supabase/migrations/20260625000001_nexus_enterprise.sql`

**Ação:**
1. Criar o arquivo de migration com o SQL completo do harness (tabela `tenant_branding`, coluna `custom_subdomain` em `tenants`, index e trigger)
2. Aplicar via psql no VPS
3. Verificar que tabela existe: `SELECT * FROM tenant_branding LIMIT 1;`
4. Verificar coluna: `SELECT custom_subdomain FROM tenants LIMIT 1;`

**Critério de sucesso:** Ambas as queries retornam sem erro  
**Falha:** Rollback com `DROP TABLE IF EXISTS tenant_branding; ALTER TABLE tenants DROP COLUMN IF EXISTS custom_subdomain;` e investigar

---

### PASSO 2 — BFF: Rota Pública de Branding
**Arquivo:** `apps/bff/src/routes/nexus.ts` (ou novo `apps/bff/src/routes/public.ts`)

**Ação:**
1. Adicionar `GET /api/public/branding?tenant=slug` — sem auth, sem nexus session
2. Query: `supabase.from("tenant_branding").select("primary_hex, secondary_hex, tenant_logo_url").eq("tenant_id", tenant.id).single()`
3. Se não encontrar → retornar defaults `{ primary_hex: "#1B3A8C", secondary_hex: "#3b82f6", tenant_logo_url: null, name: tenant.name }`
4. Registrar a rota no index do BFF ANTES das rotas protegidas
5. Rodar typecheck: `cd apps/bff && npx tsc --noEmit`
6. Deploy BFF

**Critério de sucesso:** `curl "http://BFF_URL/api/public/branding?tenant=pmpb"` retorna 200 com `primary_hex`

---

### PASSO 3 — BFF: Endpoints de Branding por Tenant (Nexus)
**Arquivo:** `apps/bff/src/routes/nexus.ts`

**Ação:** Adicionar ao nexusRoutes (requer nexus session):

```typescript
// GET /api/nexus/tenants/:id/branding
nexusRoutes.get("/tenants/:id/branding", requireNexusSession, async (c) => {
  const tenantId = c.req.param("id");
  const { data, error } = await supabase
    .from("tenant_branding")
    .select("*")
    .eq("tenant_id", tenantId)
    .single();
  if (error && error.code !== "PGRST116") return c.json({ error: "Falha" }, 500);
  return c.json(data ?? { primary_hex: "#1B3A8C", secondary_hex: "#3b82f6", tenant_logo_url: null });
});

// PATCH /api/nexus/tenants/:id/branding
nexusRoutes.patch("/tenants/:id/branding", requireNexusSession,
  zValidator("json", z.object({
    primary_hex:   z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    secondary_hex: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  })),
  async (c) => {
    const tenantId = c.req.param("id");
    const body = c.req.valid("json");
    const { error } = await supabase.from("tenant_branding")
      .upsert({ tenant_id: tenantId, ...body }, { onConflict: "tenant_id" });
    if (error) return c.json({ error: "Falha ao salvar branding" }, 500);
    return c.json({ ok: true });
  }
);
```

**Após adicionar:** typecheck + deploy BFF  
**Critério de sucesso:** `curl -X PATCH /api/nexus/tenants/:id/branding` com cookie nexus retorna 200

---

### PASSO 4 — BFF: Upload de Logo de Tenant
**Arquivo:** `apps/bff/src/routes/nexus.ts`

**Ação:** Adicionar endpoint multipart/form-data:

```typescript
nexusRoutes.post("/tenants/:id/logo", requireNexusSession, async (c) => {
  const tenantId = c.req.param("id");
  const formData = await c.req.formData();
  const file = formData.get("logo") as File | null;
  if (!file) return c.json({ error: "Arquivo ausente" }, 400);
  
  // Validações
  const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
  if (!ALLOWED.includes(file.type)) return c.json({ error: "Tipo de arquivo inválido" }, 400);
  if (file.size > 2 * 1024 * 1024) return c.json({ error: "Arquivo deve ter no máximo 2MB" }, 400);
  
  const ext = file.type.split("/")[1].replace("svg+xml", "svg");
  const path = `${tenantId}/tenant-logo.${ext}`;
  const arrayBuffer = await file.arrayBuffer();
  
  const { error: uploadErr } = await supabase.storage
    .from("tenant-logos")
    .upload(path, arrayBuffer, { contentType: file.type, upsert: true });
  if (uploadErr) return c.json({ error: "Falha no upload" }, 500);
  
  const { data: { publicUrl } } = supabase.storage.from("tenant-logos").getPublicUrl(path);
  
  await supabase.from("tenant_branding")
    .upsert({ tenant_id: tenantId, tenant_logo_url: publicUrl }, { onConflict: "tenant_id" });
  
  return c.json({ ok: true, url: publicUrl });
});
```

**Premissa:** Criar bucket `tenant-logos` com acesso público no Supabase Dashboard > Storage  
**Critério de sucesso:** Upload de imagem retorna URL válida e acessível

---

### PASSO 5 — BFF: Status de Tenant + Membros
**Arquivo:** `apps/bff/src/routes/nexus.ts`

**Ação:** Adicionar:

```typescript
// PATCH /api/nexus/tenants/:id/status — ativar/inativar tenant
nexusRoutes.patch("/tenants/:id/status", requireNexusSession,
  zValidator("json", z.object({ active: z.boolean() })),
  async (c) => {
    const tenantId = c.req.param("id");
    const { active } = c.req.valid("json");
    const actorId = c.get("userId");
    const { error } = await supabase.from("tenants").update({ active }).eq("id", tenantId);
    if (error) return c.json({ error: "Falha ao atualizar status" }, 500);
    await supabase.from("audit_logs").insert({
      actor_id: actorId, action: active ? "nexus.tenant.activated" : "nexus.tenant.deactivated",
      resource_type: "tenant", resource_id: tenantId, metadata: { active },
    });
    return c.json({ ok: true });
  }
);

// GET /api/nexus/tenants/:id/members
nexusRoutes.get("/tenants/:id/members", requireNexusSession, async (c) => {
  const tenantId = c.req.param("id");
  const { data, error } = await supabase
    .from("profiles")
    .select("id, nome_completo, matricula, posto, role")
    .eq("tenant_id", tenantId)
    .order("nome_completo");
  if (error) return c.json({ error: "Falha" }, 500);
  return c.json({ members: data ?? [] });
});
```

**Critério de sucesso:** Typecheck OK + deploy OK

---

### PASSO 6 — BFF: Setup 2FA para Superadmin
**Arquivo:** `apps/bff/src/routes/nexus.ts`

**Ação:** Adicionar ANTES do `requireNexusSession` (rotas abertas dentro do nexus):

```typescript
import { authenticator } from "otplib"; // já instalado

// GET /api/nexus/setup-2fa — gera QR Code
nexusRoutes.get("/setup-2fa", async (c) => {
  // Verifica que tem session parcial (só password, sem totp)
  const session = await getIronSession(c.req.raw, c.res, sessionConfig);
  if (!session.userId) return c.json({ error: "Não autorizado" }, 401);

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, matricula, totp_configured")
    .eq("id", session.userId)
    .single();
  if (!profile) return c.json({ error: "Perfil não encontrado" }, 404);
  if (profile.totp_configured) return c.json({ error: "TOTP já configurado" }, 409);

  // Gerar secret temporário (não salvar ainda)
  const secret = authenticator.generateSecret();
  const otpauthUrl = authenticator.keyuri(profile.matricula, "APMCB-Nexus", secret);
  
  // Salvar secret temporário na session (não no DB — apenas para o setup)
  (session as Record<string, unknown>).totpSetupSecret = secret;
  await session.save();

  // Gerar QR Code URL via api pública de QR (ou usar qrcode lib)
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(otpauthUrl)}`;
  
  return c.json({ qrUrl, secret, otpauthUrl });
});

// POST /api/nexus/setup-2fa/confirm — confirma primeiro token e salva
nexusRoutes.post("/setup-2fa/confirm",
  zValidator("json", z.object({ token: z.string().length(6) })),
  async (c) => {
    const session = await getIronSession(c.req.raw, c.res, sessionConfig);
    if (!session.userId) return c.json({ error: "Não autorizado" }, 401);
    
    const secret = (session as Record<string, unknown>).totpSetupSecret as string | undefined;
    if (!secret) return c.json({ error: "Setup não iniciado" }, 400);
    
    const { token } = c.req.valid("json");
    const isValid = authenticator.verify({ token, secret });
    if (!isValid) return c.json({ error: "Token inválido" }, 400);
    
    // Salvar no banco
    await supabase.from("totp_secrets").upsert({
      user_id: session.userId, secret,
    }, { onConflict: "user_id" });
    
    await supabase.from("profiles").update({ totp_configured: true }).eq("id", session.userId);
    
    // Limpar secret temporário da session
    delete (session as Record<string, unknown>).totpSetupSecret;
    (session as Record<string, unknown>).nexusAuthorized = true;
    (session as Record<string, unknown>).nexusAuthorizedAt = Date.now();
    await session.save();
    
    return c.json({ ok: true });
  }
);
```

**Critério de sucesso:** Typecheck OK + endpoint acessível com session parcial

---

### PASSO 7 — Frontend: Sidebar Colapsável
**Arquivo:** `apps/web/src/app/nexus/_components/nexus-sidebar.tsx`

**Ação:** Refatorar para suportar colapso:

```tsx
"use client";
import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger
} from "@/components/ui/tooltip";

// ... (manter NAV array existente)

export function NexusSidebar() {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("nexus-sidebar-collapsed");
    if (saved === "true") setCollapsed(true);
  }, []);

  function toggle() {
    setCollapsed((c) => {
      localStorage.setItem("nexus-sidebar-collapsed", String(!c));
      return !c;
    });
  }

  return (
    <aside className={`
      flex flex-col h-screen bg-[#0A0A0F] border-r border-[#1E1E2E]
      transition-all duration-200 shrink-0
      ${collapsed ? "w-14" : "w-56"}
    `}>
      {/* Logo + toggle */}
      <div className="flex items-center justify-between px-3 py-4 border-b border-[#1E1E2E]">
        {!collapsed && (
          <span className="text-xs font-bold text-indigo-400 uppercase tracking-widest">Nexus</span>
        )}
        <button onClick={toggle} className="ml-auto p-1 rounded hover:bg-white/5 text-gray-500 hover:text-white transition-colors">
          {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 space-y-0.5 px-2">
        <TooltipProvider delayDuration={100}>
          {NAV.map((item) => (
            <Tooltip key={item.href} disableHoverableContent>
              <TooltipTrigger asChild>
                <NavItem item={item} collapsed={collapsed} />
              </TooltipTrigger>
              {collapsed && (
                <TooltipContent side="right" className="bg-[#1E1E2E] text-gray-200 border-[#2E2E3E] text-xs">
                  {item.label}
                </TooltipContent>
              )}
            </Tooltip>
          ))}
        </TooltipProvider>
      </nav>

      {/* Footer */}
      <div className={`px-3 py-4 border-t border-[#1E1E2E] ${collapsed ? "text-center" : ""}`}>
        {/* logout button — manter lógica existente */}
      </div>
    </aside>
  );
}
```

**Critério de sucesso:** Sidebar colapsa/expande, estado persiste no reload, sem erros de TS

---

### PASSO 8 — Frontend: Tenants com Accordion + Branding
**Arquivo:** `apps/web/src/app/nexus/tenants/page.tsx`

**Ação:** Reescrever com accordion (shadcn `Accordion`):
- Cada tenant = um `AccordionItem`
- Dentro: Tabs com "Estrutura" | "Membros" | "Branding"
- Aba Branding: dois inputs de cor hex + preview em tempo real + botão salvar
- Preview: mini-card com `background: primaryHex` + logo ao centro
- Botão "Inativar/Ativar" com Dialog de confirmação

**Componentes shadcn a usar:** `Accordion`, `Tabs`, `Dialog`, `Input`, `Button`, `Badge`

**Critério de sucesso:** Build OK + accordion funciona sem erros de runtime

---

### PASSO 9 — Frontend: Login Page com Branding
**Arquivo:** `apps/web/src/app/login/page.tsx`

**Ação:**
1. Detectar `?tenant=slug` nos searchParams (Server Component)
2. Se presente: `fetch(/api/public/branding?tenant=slug)` → obter cores + logo
3. Layout `grid grid-cols-1 md:grid-cols-2 min-h-dvh`
4. Col direita: `hidden md:flex flex-col items-center justify-center p-12`
   - `style={{ background: branding.primary_hex }}`
   - `<img src={branding.tenant_logo_url} />` (max 200px) ou ícone institucional
   - Nome do tenant em texto branco grande
5. Se sem tenant hint: col direita com layout institucional padrão

**Critério de sucesso:** `/login?tenant=pmpb` exibe painel direito com cor + logo do tenant

---

### PASSO 10 — Frontend: Setup 2FA Page
**Arquivo:** `apps/web/src/app/nexus/setup-2fa/page.tsx` (CRIAR)

**Ação:**
```tsx
"use client";
import { useEffect, useState } from "react";
// Fetch GET /api/nexus/setup-2fa → { qrUrl, secret }
// Exibir QR Code: <img src={qrUrl} className="size-48 rounded-lg" />
// Input para código de confirmação
// POST /api/nexus/setup-2fa/confirm → { ok: true }
// Se ok: redirect para /nexus
```

**Critério de sucesso:** Página carrega QR Code, código confirmado → redirect para /nexus

---

### PASSO 11 — E2E: nexus-enterprise.spec.ts
**Arquivo:** `apps/web/e2e/nexus-enterprise.spec.ts` (CRIAR)

**Ação:** Criar suite com NE01-NE16. Estrutura mínima:

```typescript
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

test.describe.configure({ mode: "serial" });

const BFF = process.env.PLAYWRIGHT_BFF_URL!;
const SA_EMAIL = "superadmin@apmcb.test";
const SA_PASS = "...";
let nexusCookies: string;
let createdTenantId: string;

test.beforeAll(async ({ request }) => {
  // Login no nexus → obter cookies
  // ...
});

// NE01 — Sidebar state persistence
test("NE01 — sidebar colapsa e persiste", async ({ page }) => { /* ... */ });

// NE02 — Criar tenant simples
test("NE02 — criar tenant simples", async ({ request }) => { /* ... */ });

// ... NE03-NE16
```

**Critério de sucesso:** `npx playwright test --project=nexus-enterprise-suite` → 16/16 green

---

### PASSO 12 — playwright.config.ts: Adicionar Suite
**Arquivo:** `apps/web/playwright.config.ts`

**Ação:** Adicionar:
```typescript
{
  name: "nexus-enterprise-suite",
  testMatch: /nexus-enterprise\.spec\.ts/,
  use: { ...devices["Desktop Chrome"] },
},
```

---

### PASSO 13 — Regressão Completa
**Ação:** Rodar todas as suites:
```bash
cd apps/web
npx playwright test --project=nexus-enterprise-suite --workers=1
npx playwright test --project=saida-suite --workers=1
npx playwright test --project=cautelamento-suite --workers=1
npx playwright test --project=item-integrity-suite --workers=1
npx playwright test --project=signature-suite --workers=1
npx playwright test --project=nexus-suite --workers=1
```

**Critério de sucesso:** ZERO falhas em todos os projetos

---

### PASSO 14 — Relatório Final
**Arquivo:** `docs/enterprise/reports/phase-5b-final-report.md`

**Ação:** Gerar relatório com:
- Resultados por teste NE01-NE16
- Screenshots das features principais
- Commit hash do deploy
- Checklist do Definition of Done (ver harness)
- Confirmar que Fase 5B está concluída → pronto para Fase 6

---

## Regras do Loop Agent

1. **Nunca pular passos** — cada passo tem pré-condições implícitas
2. **Nunca alterar migrations existentes** — apenas criar novas
3. **Nunca usar service role key no frontend** — toda query DB via BFF
4. **Nunca avançar com typecheck falhando** — `pnpm typecheck` deve passar em cada passo
5. **Parar e reportar na primeira falha** — não tentar "corrigir" sem entender a causa
6. **Ler o arquivo de estado primeiro** — não re-executar passos já concluídos
7. **Manter o design system** — sem criar classes CSS custom; usar tokens Tailwind existentes
8. **Sem comentários desnecessários no código** — apenas WHY quando não-óbvio

---

## Template de Atualização de Estado

Ao fim de cada iteração, escrever em `docs/enterprise/loop-state-nexus.md`:

```markdown
## Estado — Fase 5B Nexus Enterprise

PASSO_ATUAL: [número]
STATUS: passed | failed | blocked
DATA: [timestamp]

### Resultado do Passo Anterior
[descrição do que foi feito e o resultado]

### Próximo Passo
[o que precisa ser feito na próxima iteração]

### Bloqueios
[se houver — descrição detalhada do problema]
```
