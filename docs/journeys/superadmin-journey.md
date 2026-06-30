# Jornada do Superadmin (Nexus)

**Role:** `superadmin`  
**Contexto:** Administrador de plataforma multi-tenant. Equivalente à Secretaria de Segurança — gerencia múltiplos órgãos (PM, Bombeiros, Guarda Municipal) de forma centralizada. Acessa exclusivamente via API REST `/api/nexus/*`.  
**Interface frontend:** Nenhuma. Acesso apenas via requisições diretas ao BFF.

---

## ICP (Ideal Customer Profile)

- Gestor de TI da Secretaria de Segurança Pública
- Responsável por onboarding de novas organizações na plataforma
- Tem acesso privilegiado irrestrito a todos os tenants
- Opera com autenticação de dois fatores obrigatória (TOTP + sessão 2h)

---

## Páginas Acessíveis

| Rota | Acesso |
|---|---|
| Nenhuma página frontend | — |
| Todos os endpoints `/api/nexus/*` | ✅ com nexusSession válida |

---

## Jornada Passo a Passo

### Cenário 1: Onboarding de nova PM Estadual

#### 1. Autenticação + Setup TOTP

```http
POST /api/auth/login
{ email, password }
→ iron-session criada, totp_configured=false
```

```http
GET /api/nexus/setup-2fa
→ { qr_code_url, secret }  # válido por 10 min
```

1. Superadmin lê QR Code com Google Authenticator / Authy
2. Insere token de 6 dígitos:

```http
POST /api/nexus/setup-2fa/confirm
{ token: "123456" }
→ { ok: true }
# session.nexusAuthorized = true, TTL 2h
# secret armazenado em totp_secrets
```

#### 2. Criar Tenant (nova PM)

```http
POST /api/nexus/tenants
{
  nome: "Polícia Militar PB",
  slug: "pm-pb",
  tipo_orgao: "pm",
  estado: "PB"
}
→ { tenant_id, created_at }
```

#### 3. Configurar Branding

```http
POST /api/nexus/tenants/{tenant_id}/logo
Content-Type: multipart/form-data
→ { logo_url }

PATCH /api/nexus/tenants/{tenant_id}/branding
{ cor_primaria: "#1e3a5f", cor_secundaria: "#c9a227" }
→ { ok: true }
```

#### 4. Criar Estrutura Organizacional

```http
POST /api/nexus/tenants/{tenant_id}/org-units
{ nome: "Departamento de Ensino e Cultura", acronym: "DEC" }
→ { org_unit_id }

POST /api/nexus/tenants/{tenant_id}/reserves
{
  nome: "APMCB — Reserva Principal",
  acronym: "APMCB",
  org_unit_id: "{org_unit_id}"
}
→ { reserve_id }
```

#### 5. Convidar Admin Global para o Tenant

```http
POST /api/nexus/tenants/{tenant_id}/invite
{
  email: "coronel.almeida@pm.pb.gov.br",
  nome_completo: "Cel. Almeida"  // opcional
}
→ 201 { ok: true, invite_sent: true }
# Role fixo: admin_global (Privilege Ceiling do superadmin)
# Magic link enviado via Supabase
```

**Via UI Nexus:** botão "Convidar Admin" na aba de membros do tenant. Role exibida como label fixo "Admin Global" — não editável.

#### 5b. Configurar Modo de Estrutura

```http
PATCH /api/nexus/tenants/{tenant_id}
{ structure_mode: "structured" }
→ { ok: true }
# "simple" = lista plana de reservas (padrão)
# "structured" = hierarquia org_unit → reserves com ícones
```

**Via UI Nexus:** badge clicável "simples"/"estruturado" no card do tenant → dialog de confirmação antes de alterar.

#### 6. Monitorar Saúde do Sistema

```http
GET /api/nexus/health
→ {
  bff: "ok",
  supabase: "ok",
  latency_ms: 12
}

GET /api/nexus/metrics
→ {
  total_tenants: 3,
  total_users: 187,
  totp_configured_pct: 94,
  admins: 12,
  armeiros: 28,
  errors_24h: 0
}
```

#### 7. Ver Auditoria de Ações

```http
GET /api/nexus/events?action=handover.signed&from=2026-01-01&to=2026-12-31
→ { events: [...], total: 847 }
```

#### 8. Operações de Emergência

```http
# Resetar TOTP de usuário bloqueado
POST /api/nexus/users/{user_id}/reset-totp
→ { ok: true, message: "TOTP resetado com sucesso" }

# Limpar rate limit de IP (flood acidental)
POST /api/nexus/clear-rate-limit
{ ip: "203.0.113.45" }
→ { ok: true }

# Desativar tenant em caso de suspeita
PATCH /api/nexus/tenants/{tenant_id}/status
{ status: "inactive" }
→ { ok: true }
```

#### 9. Expiração da Sessão Nexus

Após 2 horas, `nexusAuthorized` expira. Próxima chamada retorna `401 Unauthorized`.  
Requer novo fluxo de login + confirmação TOTP.

---

## RBAC — O Que o Superadmin NÃO Pode Fazer

| Ação Bloqueada | Motivo |
|---|---|
| Criar militares (`POST /api/admin/militares`) | Responsabilidade do `admin_global` |
| Assinar cautelas / saídas | Operação de `armeiro` / `admin_reserva` |
| Aprovar solicitações SSA | Responsabilidade do `admin_global` |
| Capturar biometria de militares | Responsabilidade do `armeiro` |
| Acessar dados de militares individuais | Privacidade — acessa apenas audit logs e métricas agregadas |

---

## Controles de Segurança

| Controle | Implementação |
|---|---|
| 2FA obrigatório | `session.nexusAuthorized` necessário em todos os endpoints `/api/nexus/*` |
| TTL de sessão | 2 horas; renovação requer novo TOTP |
| Replay protection | `last_used_token` no DB — mesmo código não aceito duas vezes |
| Audit log | Toda ação logada em `audit_logs` com IP, user_agent, timestamp |
| Tenant isolation | Superadmin pode ver todos tenants, mas cada operação é scoped por `tenant_id` |

---

## Notas de Implementação

- Não há interface frontend — o superadmin usa Postman, CLI, ou script
- Sessão via `iron-session` (cookie HTTP-only) — não Bearer token
- Setup 2FA armazena secret temporariamente em Map em memória (10 min TTL) antes de confirmar
