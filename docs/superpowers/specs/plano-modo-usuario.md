# Plano — Role Mode Switcher: Modo Usuário

**Data:** 2026-06-29  
**Autor:** Diego Rodrigues  
**Status:** AGUARDANDO APROVAÇÃO  
**DoD canônica:** `docs/enterprise/07-canonical-definition-of-done.md`

---

## 1. Problema e Motivação

Todo armeiro, admin, admin_reserva e auditor **é também um militar** que precisa se armar em alguma reserva. Exigir uma segunda conta separada para acesso como usuário é fricção desnecessária e anti-empresarial.

Sistemas enterprise (AWS, Salesforce, GitHub Enterprise, Jira) resolvem isso com **troca de contexto de papel** dentro da mesma sessão: o usuário mantém uma conta única e alterna entre seu papel de staff e seu papel de usuário final com um clique.

---

## 2. Solução: Role Mode Switcher

### Padrão Enterprise Adotado

Inspirado em **AWS IAM Role Switch** e **Salesforce "Login As"**:

- Entrada no dropdown do avatar no navbar
- Banner persistente âmbar quando em modo usuário (confirmação visual do contexto ativo)
- Retorno ao modo staff com um clique
- Segurança: em modo usuário, todos os endpoints de staff retornam 403 (o BFF efetivamente trata o usuário como `usuario`)

### UX Final

```
┌──────────────────────────────────────────────────────────┐
│ [Logo]   Olá, Cap Rodrigues           🔔  [🌙]  [Avatar▼] │
├──────────────────────────────────────────────────────────┤ ← Banner só aparece em modo usuário
│  ⚠ Modo Usuário Ativo — Voltar ao modo Armeiro            │
└──────────────────────────────────────────────────────────┘
│ Sidebar: Minhas Cautelas, Histórico, Solicitações         │
│ (nav de cadete — sem itens de staff)                      │
```

**Avatar dropdown (modo staff — para armeiro/admin/auditor):**
```
┌──────────────────┐
│  Perfil          │
│  Modo Usuário    │  ← NOVO — visível apenas para staff
│  Reportar        │
│  ─────────────── │
│  Sair            │
└──────────────────┘
```

**Avatar dropdown (modo usuário ativo):**
```
┌──────────────────────────────┐
│  Perfil                      │
│  ← Voltar ao modo Armeiro    │  ← substitui "Modo Usuário"
│  Reportar                    │
│  ──────────────────────────  │
│  Sair                        │
└──────────────────────────────┘
```

---

## 3. Arquitetura Técnica

### 3.1 Camada de Sessão (Iron-Session)

Adicionar 2 campos opcionais ao `SessionData`:

```typescript
interface SessionData {
  // existentes
  userId: string;
  role: "superadmin" | "admin_global" | "admin_reserva" | "armeiro" | "auditor" | "usuario";
  tenantId: string | null;
  reserveId: string | null;
  supabaseAccessToken: string;
  issuedAt?: number;
  nexusAuthorized?: boolean;
  nexusAuthorizedAt?: number;
  pendingTotpSecret?: string;
  pendingTotpExpiresAt?: number;
  // NOVOS
  activeMode?: "usuario";       // undefined = modo staff padrão
  originalRole?: string;        // role real preservada durante modo usuário
}
```

**Invariantes:**
- `activeMode` só pode ser `"usuario"` (não há outros modos por enquanto)
- `originalRole` só é definido quando `activeMode === "usuario"`
- Ao trocar de volta para staff, ambos os campos são deletados da sessão

### 3.2 BFF — Auth Middleware

`apps/bff/src/middleware/auth.ts` — adicionar após carregar a sessão:

```typescript
// Role efetivo: activeMode substitui role quando em modo usuário
const effectiveRole = session.activeMode === "usuario" ? "usuario" : session.role;
c.set("role", effectiveRole as Role);
```

**Efeito:** Em modo usuário, qualquer endpoint com `roleGuard("armeiro")` retorna 403. O usuário só acessa endpoints que permitem `"usuario"`.

### 3.3 BFF — Novo Arquivo de Rotas

`apps/bff/src/routes/session.ts` (NOVO):

```
POST /api/session/mode        — troca o modo ativo (staff ↔ usuario)
GET  /api/session/info        — retorna role original + activeMode (para o layout ler)
```

**POST /api/session/mode:**
- Body: `{ mode: "usuario" | "staff" }`
- Guard: apenas roles staff podem chamar (admin_global, superadmin, armeiro, admin_reserva, auditor)
  - Obs: em modo usuário, o effective role é "usuario" — o guard usa o role REAL da sessão (originalRole ou role), não o efetivo, para validar permissão de troca
- Ao trocar para "usuario": `session.originalRole = session.role; session.activeMode = "usuario"; await session.save()`
- Ao trocar para "staff": `delete session.activeMode; delete session.originalRole; await session.save()`

**GET /api/session/info:**
- Retorna: `{ role: string; activeMode?: "usuario"; originalRole?: string }`
- Usado pelo layout server component para saber o estado atual

### 3.4 Registro de Rota

`apps/bff/src/index.ts`:

```typescript
import { sessionRoutes } from "./routes/session";
app.use("/api/session/*", authMiddleware);
app.route("/api/session", sessionRoutes);
```

⚠️ Registrar **antes** das rotas de `/api/auth` mas **após** os middlewares globais.

### 3.5 Frontend — Layout Server Component

`apps/web/src/app/(dashboard)/layout.tsx`:

1. Após `supabase.auth.getUser()`, busca `GET /api/session/info` usando o access token como Bearer
2. Se `sessionInfo.activeMode === "usuario"`, sobrescreve `uiRole = "usuario"`
3. Passa `activeMode` e `originalRole` para `AppShell`

```typescript
// Buscar estado do modo ativo na sessão BFF
const sessionInfoRes = await fetch(`${BFF_URL}/api/session/info`, {
  headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
  cache: "no-store",
});
const sessionInfo = sessionInfoRes.ok ? await sessionInfoRes.json() : {};
const activeMode = sessionInfo.activeMode as "usuario" | undefined;
const originalRole = sessionInfo.originalRole as string | undefined;

// Sobrescrever uiRole se em modo usuário
const uiRole: Role = activeMode === "usuario"
  ? "usuario"
  : (profile.role === "admin_global" || profile.role === "superadmin" || profile.role === "auditor"
      ? "admin"
      : profile.role === "armeiro" || profile.role === "admin_reserva"
      ? "master"
      : "usuario");
```

### 3.6 Frontend — AppShell

`apps/web/src/components/layout/app-shell.tsx`:

- Recebe `activeMode?: "usuario"` e `originalRole?: string`
- Repassa para `Header`
- Renderiza banner âmbar quando `activeMode === "usuario"`:

```tsx
{activeMode === "usuario" && (
  <div className="flex items-center gap-2 px-4 py-1.5 bg-amber-500/10 border-b border-amber-500/20 text-amber-700 text-xs">
    <ShieldAlert className="size-3.5 shrink-0" />
    <span>Modo Usuário Ativo</span>
    <ModeToggleButton originalRole={originalRole} />  {/* client component */}
  </div>
)}
```

### 3.7 Frontend — Header

`apps/web/src/components/layout/header.tsx`:

- Recebe `dbRole?: string` (role original do DB) e `activeMode?: "usuario"`
- No dropdown, adiciona item entre "Perfil" e "Reportar":

```tsx
{/* Switcher de modo — apenas para staff */}
{dbRole && dbRole !== "usuario" && (
  <>
    <DropdownMenuSeparator />
    <DropdownMenuItem onClick={handleModeToggle} className="gap-2">
      {activeMode === "usuario" ? (
        <>
          <ArrowLeftRight className="size-4 text-amber-600" />
          <span>Voltar ao modo {ROLE_LABELS[dbRole] ?? "Staff"}</span>
        </>
      ) : (
        <>
          <User className="size-4" />
          <span>Modo Usuário</span>
        </>
      )}
    </DropdownMenuItem>
  </>
)}
```

**`handleModeToggle`:**
```typescript
async function handleModeToggle() {
  const targetMode = activeMode === "usuario" ? "staff" : "usuario";
  const token = await getToken();  // supabase access token
  await fetch(`${BFF_URL}/api/session/mode`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    credentials: "include",
    body: JSON.stringify({ mode: targetMode }),
  });
  // Redirecionar para o dashboard correto
  if (targetMode === "usuario") {
    router.push("/cadete");
  } else {
    router.push(ROLE_DASHBOARD[dbRole ?? ""] ?? "/");
  }
  router.refresh();
}
```

---

## 4. Segurança

| Vetor | Mitigação |
|---|---|
| Staff acessa endpoints de staff em modo usuário | BFF authMiddleware sobrescreve role efetivo → roleGuard retorna 403 |
| Usuario tenta ativar modo usuário (já é usuário) | `POST /api/session/mode` valida que role original é staff |
| Usuário forja `originalRole` | Campo está na sessão iron-session (encriptada, httpOnly) — não acessível pelo cliente |
| Loop de redirecionamento | Redirect vai para `/cadete` (sempre existe) — não depende de role |
| Expiração de sessão em modo usuário | Iron-session expira normalmente; ao re-login o `activeMode` não existe mais |

---

## 5. Arquivos Afetados

| Arquivo | Tipo | Mudança |
|---|---|---|
| `apps/bff/src/lib/session.ts` | MODIFICADO | Adiciona `activeMode`, `originalRole` ao `SessionData` |
| `apps/bff/src/middleware/auth.ts` | MODIFICADO | Aplica role efetivo com base em `activeMode` |
| `apps/bff/src/routes/session.ts` | CRIADO | Endpoints `POST /mode` e `GET /info` |
| `apps/bff/src/index.ts` | MODIFICADO | Registra `sessionRoutes` |
| `apps/web/src/app/(dashboard)/layout.tsx` | MODIFICADO | Busca `GET /api/session/info`, passa activeMode |
| `apps/web/src/components/layout/app-shell.tsx` | MODIFICADO | Recebe activeMode, renderiza banner |
| `apps/web/src/components/layout/header.tsx` | MODIFICADO | Recebe dbRole + activeMode, item de troca no dropdown |

**Sem migrations de DB** — a feature é 100% sessão.

---

## 6. Testes E2E

Arquivo: `apps/web/e2e/user-mode.spec.ts`

| ID | Cenário | Resultado esperado |
|---|---|---|
| UM01 | Armeiro faz login → dropdown do avatar mostra "Modo Usuário" | Item visível |
| UM02 | Admin faz login → dropdown mostra "Modo Usuário" | Item visível |
| UM03 | Usuário (cadete) faz login → dropdown NÃO mostra "Modo Usuário" | Item ausente |
| UM04 | Armeiro clica "Modo Usuário" → redireciona para /cadete | URL = /cadete |
| UM05 | Em modo usuário → banner âmbar visível | Banner presente |
| UM06 | Em modo usuário → dropdown mostra "Voltar ao modo Armeiro" | Item correto |
| UM07 | Em modo usuário → acesso a /reserva/arsenal retorna/redireciona (403 ou redirect) | Bloqueado |
| UM08 | Em modo usuário → clica "Voltar ao modo Armeiro" → redireciona para /reserva | URL = /reserva |
| UM09 | Após voltar → banner âmbar sumiu | Banner ausente |
| UM10 | Após voltar → dropdown mostra "Modo Usuário" novamente | Modo staff restaurado |

---

## 7. Definition of Done da Feature

### Critérios Funcionais
- [ ] UM01–UM10: todos passando no E2E
- [ ] Banner visível e funcional em modo usuário
- [ ] Dropdown correto em ambos os modos
- [ ] Endpoints de staff inacessíveis em modo usuário (BFF retorna 403)
- [ ] Retorno ao modo staff restaura role e dashboard corretos

### Critérios Técnicos
- [ ] `pnpm --filter web build` sem erros
- [ ] `pnpm typecheck` sem erros
- [ ] `pnpm lint` sem erros
- [ ] 0 erros TypeScript em arquivos novos/modificados

### Critérios de Segurança
- [ ] `activeMode` armazenado apenas em iron-session (httpOnly, encriptado)
- [ ] `POST /api/session/mode` bloqueado para role `"usuario"` real
- [ ] Em modo usuário, role efetivo no BFF é sempre `"usuario"` (verificável via logs)

### Critérios de Regressão
- [ ] `pnpm test:e2e --project=chromium` (smoke) → 0 falhas
- [ ] `pnpm test:e2e --project=ssa-suite` → 0 falhas
- [ ] `pnpm test:e2e --project=suite` → 0 falhas
- [ ] Nenhuma regressão em login/logout/TOTP

---

## 8. Itens Fora do Escopo (YAGNI)

- ~~Modo admin dentro de modo usuário~~ — não necessário
- ~~Histórico de troca de modo~~ — não requerido
- ~~Modo usuário para superadmin com impersonation de outro usuário~~ — diferente, separado
- ~~Sessões simultâneas com modos diferentes~~ — iron-session é por cookie, não há conflito
- ~~Notificações diferentes por modo~~ — usuário vê as próprias notificações sempre

---

## 9. Rollback

Se algo der errado após o deploy:

1. A feature é 100% código — sem migration
2. Reverter commit: `git revert HEAD~N`
3. Re-deploy BFF + frontend
4. Usuários em modo usuário terão o cookie `activeMode` na sessão, mas o middleware sem o código novo apenas ignorará o campo (não há referência ao campo sem o código) → sessão volta ao normal

---

## 10. Estimativa de Esforço

| Tarefa | Esforço |
|---|---|
| BFF: session.ts (lib) + routes/session.ts | 30 min |
| BFF: auth.ts + index.ts | 15 min |
| Frontend: layout.tsx | 20 min |
| Frontend: app-shell.tsx (banner) | 20 min |
| Frontend: header.tsx (dropdown) | 30 min |
| E2E: user-mode.spec.ts | 45 min |
| Testes + ajustes | 30 min |
| **Total** | **~3h** |

---

*Plano criado em 2026-06-29. Aguardando aprovação de Diego antes da implementação.*
