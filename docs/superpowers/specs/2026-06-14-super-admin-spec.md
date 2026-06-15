# Super Admin — Central de Controle do Sistema
**Classificação:** CONFIDENCIAL — acesso exclusivo role `admin`  
**Data:** 2026-06-14  
**Rota:** `/admin/sistema`

---

## 1. Contexto

O admin já possui `/admin` (dashboard KPIs), `/admin/usuarios`, `/admin/arsenal`, `/admin/auditoria` e `/admin/relatorios`. O que falta é uma **Central de Controle de Sistema** que permita gerenciar:
- Saúde dos serviços (BFF, Supabase)
- Eventos de segurança consolidados
- Gerenciamento de TOTP por usuário
- Gestão de sessões/roles
- Configuração operacional

---

## 2. Referências de Design (awesome-design-md)

| Padrão | Aplicação |
|--------|-----------|
| **Linear** | Tabelas ultra-densas, sidebar spacing, ações inline discretas |
| **Supabase Dashboard** | Seções com bordas sutis, estado de saúde verde/vermelho/amarelo |
| **Vercel** | Tipografia precisa, badges monocromáticos, status pill |
| **Stripe** | Separação clara de seções, hierarquia sem excesso de cor |

**Tokens existentes a usar:** `--shadow-card`, `--shadow-modal`, `bg-card`, `text-muted-foreground`, `badge-success/warning/danger/neutral`, cores `primary: #1B3A8C`, `destructive: #C8102E`.

---

## 3. Layout da Página

```
/admin/sistema
├── Header: "Central de Controle" + ícone Shield
├── Grid 2 colunas (lg) / 1 coluna (mobile)
│   ├── [COLUNA ESQUERDA]
│   │   ├── Card: Saúde dos Serviços (BFF + Supabase)
│   │   ├── Card: Estatísticas de Segurança (últimas 24h)
│   │   └── Card: Sessões Ativas (count por role)
│   └── [COLUNA DIREITA]
│       ├── Card: Eventos de Segurança (últimos 20)
│       └── Card: Gerenciamento TOTP
└── Card full-width: Gestão de Roles (tabela inline editável)
```

---

## 4. Seções em Detalhe

### 4.1 Saúde dos Serviços

Fonte: client-side fetch (não SSR — evita timeout em edge)

```
┌────────────────────────────────────────────┐
│  Saúde dos Serviços                        │
├──────────────┬─────────────────────────────┤
│ BFF (Hono)   │ ● Online   91.99.113.89    │
│ Supabase DB  │ ● Online   jepitcr...      │
│ CF Pages     │ ● Online   apmcb.pmpb.online│
└──────────────┴─────────────────────────────┘
```

- Ping a `/api/bff-health` (edge route que faz fetch ao BFF `/health`)
- Ping Supabase via `supabase.from('profiles').select('id').limit(1)`
- Status: verde (< 500ms), amarelo (500-2000ms), vermelho (erro/timeout)
- Auto-refresh a cada 30s via `useEffect`

### 4.2 Estatísticas de Segurança (últimas 24h)

Fonte: `audit_logs` filtrado por `created_at > now() - interval '24h'`

```
┌──────────────────────────────────────────┐
│ Segurança — últimas 24h                  │
├─────────────────┬────────────────────────┤
│ Logins com sucesso   │  12              │
│ Logins falhados      │   3  ⚠️          │
│ TOTP validados       │   8              │
│ TOTP bloqueados      │   1  ⚠️          │
│ SSA solicitados      │   5              │
│ SSA entregues        │   4              │
└─────────────────┴────────────────────────┘
```

### 4.3 Eventos de Segurança

Tabela dos últimos 20 eventos de `audit_logs` com `action` filtrado para:
- `auth.login_failed`
- `totp.falhou`
- `totp.bloqueado`
- `ssa.*`
- `biometric.*`

Colunas: `Evento | Ator | IP | Data`  
Linhas com `login_failed` ou `totp.bloqueado` → fundo `bg-destructive/5`

### 4.4 Gerenciamento TOTP

Lista de usuários com TOTP configurado. Ações por linha:
- **Reset TOTP** → DELETE em `totp_secrets` via API `DELETE /api/admin/totp/:userId`
- **Desbloquear** (quando `failure_count >= 5`) → PATCH `failure_count = 0`

```
┌────────────────────────────────────────────────────┐
│ Nome          │ Matrícula │ Status TOTP │ Ações     │
├───────────────┼───────────┼─────────────┼───────────┤
│ Cdto Silva    │ 000003    │ ✅ Ativo    │ Reset     │
│ Cdto Souza    │ 000004    │ ⛔ Bloq. 5 │ Desbloquear│
│ Sgto Lima     │ 000005    │ ❌ Sem TOTP │ —         │
└───────────────┴───────────┴─────────────┴───────────┘
```

### 4.5 Gestão de Roles

Tabela full-width com todos os usuários (`role` + `registration_status`).  
Ação inline: alterar role via dropdown → `PATCH /api/admin/users/:id/role`.  
Restrito: admin não pode remover o próprio role de admin.

---

## 5. Novos Endpoints

### BFF
| Método | Rota | Descrição |
|--------|------|-----------|
| DELETE | `/api/admin/totp/:userId` | Reset TOTP de usuário |
| PATCH  | `/api/admin/totp/:userId/unblock` | Zera failure_count |

### Next.js API (edge)
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/admin/security-events` | Últimos 50 eventos de segurança |
| PATCH | `/api/admin/users/:id/role` | Alterar role |
| GET | `/api/bff-health` | Proxy health check ao BFF |

---

## 6. Segurança

- Rota protegida por `role === "admin"` (redirect se não for)
- Todos os endpoints novos verificam role no server
- Reset de TOTP gera entrada em `audit_logs`: `action: "totp.reset_admin"`, `actor_id: admin.id`
- Alteração de role gera `action: "admin.role_changed"` em `audit_logs`
- Admin não pode escalar para além de `admin` (não existe super-admin role no enum)

---

## 7. Arquivos a Criar

```
apps/web/src/app/(dashboard)/admin/sistema/page.tsx          (SSR shell + client sections)
apps/web/src/app/(dashboard)/admin/sistema/_health-card.tsx  (client component, fetch BFF)
apps/web/src/app/(dashboard)/admin/sistema/_security-stats.tsx
apps/web/src/app/(dashboard)/admin/sistema/_totp-management.tsx
apps/web/src/app/(dashboard)/admin/sistema/_role-management.tsx
apps/web/src/app/api/admin/security-events/route.ts
apps/web/src/app/api/admin/totp/[userId]/route.ts
apps/web/src/app/api/admin/users/[id]/role/route.ts
apps/web/src/app/api/bff-health/route.ts
apps/bff/src/routes/admin.ts                                 (+totp reset/unblock endpoints)
```

## 8. Arquivos a Modificar

```
apps/web/src/components/layout/sidebar.tsx    (adicionar link /admin/sistema)
apps/bff/src/index.ts                         (+adminRoutes)
```

---

## 9. Fases

| Fase | O que | Resultado |
|------|-------|-----------|
| 1 | Endpoints API (Next.js + BFF) | Backend pronto |
| 2 | Página shell + Health Card + Security Stats | Monitoramento funcional |
| 3 | TOTP Management + Role Management | Controle operacional |
| 4 | Sidebar link + polish | Integração completa |

---

*Implementar após aprovação da spec.*
