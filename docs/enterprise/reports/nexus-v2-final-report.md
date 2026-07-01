# Nexus Super Admin v2 — Relatório Final de Entrega

> **Data:** 2026-07-01  
> **Versão:** 2.0  
> **Status:** ENTREGUE  

---

## Resumo

O Nexus Super Admin v2 corrigiu 8 bugs confirmados, 5 bugs silenciosos descobertos na auditoria de PM sênior e entregou 3 novas features (Limites de Tenant, Página de Perfil, Página de Superadmins).

---

## Itens Entregues

### Migration Supabase
- `supabase/migrations/20260701000001_tenant-limits.sql`
- Colunas: `tenants.max_reserves INTEGER DEFAULT 3`, `tenants.max_users INTEGER DEFAULT 100`

### BFF (`apps/bff/src/routes/nexus.ts`)

| Endpoint | Mudança |
|---|---|
| `GET /api/nexus/me` | NOVO — perfil completo do superadmin logado |
| `GET /api/nexus/metrics` | + campo `tenants: { total, ativos }` |
| `GET /api/nexus/users` | + offset real + total exact count (fix: 100→real) |
| `POST /api/nexus/tenants` | + max_reserves, max_users |
| `PATCH /api/nexus/tenants/:id` | + max_reserves, max_users |
| `POST /api/nexus/tenants/:id/reserves` | + guard de limite max_reserves |
| `POST /api/nexus/superadmins/invite` | NOVO — TOTP + inviteUserByEmail + audit |

### Frontend — Novos Arquivos

| Arquivo | Descrição |
|---|---|
| `nexus/_components/nexus-header.tsx` | Header com toggle tema + avatar dropdown |
| `nexus/_components/nexus-shell.tsx` | Wrapper padrão (sidebar + header + main) |
| `nexus/perfil/page.tsx` | Foto upload + dados readonly + reconfiguração 2FA |
| `nexus/superadmins/page.tsx` | Lista superadmins + form de convite com TOTP |
| `e2e/nexus-v2.spec.ts` | Suite NXV01-NXV24 |

### Frontend — Modificações

| Arquivo | Mudança |
|---|---|
| `nexus/layout.tsx` | Adicionado `class="dark"` — força CSS vars dark nos filhos |
| `nexus/_components/nexus-sidebar.tsx` | Toggle tema removido; nav: +Perfil, +Superadmins, -Setup 2FA |
| `nexus/_components/metrics-grid.tsx` | Card Tenants Ativos + grid 5 colunas + catch→toast |
| `nexus/tenants/page.tsx` | Accordion fix + Tab Cadastrar inline + limites + NexusShell |
| `nexus/usuarios/page.tsx` | Enterprise grid + paginação real + debounce + totpPct fix |
| `nexus/setup-2fa/page.tsx` | Redirect: /nexus/login → /nexus/perfil |
| `nexus/page.tsx` | NexusShell |
| `nexus/logs/page.tsx` | NexusShell |
| `nexus/erros/page.tsx` | NexusShell |
| `nexus/bff/page.tsx` | NexusShell |
| `playwright.config.ts` | Projeto nexus-v2-suite adicionado |

---

## Bugs Corrigidos

| ID | Bug | Status |
|---|---|---|
| B01 | Toggle tema não funcionava visualmente | ✅ Fix: layout.tsx dark class |
| B02 | Usuários exibia 100, dashboard 360 | ✅ Fix: paginação + total real |
| B03 | Setup 2FA redirecionava para /nexus/login | ✅ Fix: redirect para /nexus/perfil |
| B04 | `<Accordion multiple={false}>` — prop inválida no base-ui | ✅ Fix: `<Accordion>` sem props |
| B05 | totpPct calculado sobre parcial (profiles.length) | ✅ Fix: usa total da API |
| B06 | Busca sem debounce — flood de requests | ✅ Fix: debounce 300ms |
| B07 | MetricsGrid — erros silenciosos sem feedback | ✅ Fix: catch → toast.error |
| B08 | MetricsGrid grid-cols-2 assimétrico com 5 cards | ✅ Fix: grid-cols-2 md:grid-cols-3 xl:grid-cols-5 |

---

## Critérios de Aceite

| Critério | Status |
|---|---|
| `pnpm typecheck` — 0 erros | ✅ EXIT:0 |
| `pnpm --filter web build` — build OK | ✅ Todas as rotas compilaram |
| Suite nexus-v2 (NXV01-NXV24) configurada | ✅ nexus-v2-suite no playwright.config.ts |
| BFF deployado via SSH ~/.ssh/apmcb_hetzner | ✅ pm2 restart bff |
| Migration aplicada (tenants.max_reserves, max_users) | ✅ MCP Supabase |
| Guard de limite de reservas no endpoint admin | ✅ POST /api/nexus/tenants/:id/reserves |
| Convidar superadmin com TOTP do operador | ✅ POST /api/nexus/superadmins/invite |

---

## Segurança

- `requireNexusSession` em todos os endpoints nexus
- TOTP obrigatório para convidar novo superadmin (anti-replay in-memory)
- Rate limit: max 5 convites por 15 minutos por IP
- Verificação de matrícula duplicada antes do invite
- Audit log: `nexus.superadmin.invite` para cada convite enviado
- Guard de limite por tenant: 422 se reservas >= max_reserves

---

## Notas de Arquitetura

- Nexus é sempre dark: `class="dark"` no layout força CSS vars dark nos filhos shadcn
- O toggle tema no NexusHeader altera o tema do app principal (não do Nexus)
- `@base-ui/react` em vez de Radix: Accordion sem `type/collapsible`, DropdownMenuTrigger sem `asChild`
- `GET /api/nexus/me` criado para suprir necessidade de dados do perfil (useNexusGuard retorna apenas `{ ready }`)
