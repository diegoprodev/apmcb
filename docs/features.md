# APMCB — Inventário Completo de Features

> **Documento vivo de features implementadas, parciais e planejadas**  
> **Última atualização:** 2026-06-30  
> **Versão:** 1.1  
> **Status:** Baseado em Phases 0-7B + roadmap Phases 8-12

---

## Índice

1. [Módulos por Área Funcional](#1-módulos-por-área-funcional)
2. [Segurança em Camadas](#2-segurança-em-camadas)
3. [RBAC — Hierarquia com Privilege Ceiling](#3-rbac--hierarquia-com-privilege-ceiling)
4. [Diferenciais Competitivos](#4-diferenciais-competitivos)
5. [Integrações Externas](#5-integrações-externas)
6. [Roadmap Futuro](#6-roadmap-futuro-phases-8-12)

---

## 1. Módulos por Área Funcional

### 1.1 — Autenticação e Gestão de Sessão

#### 1.1.1 Login com Credenciais
- **Status:** ✅ Implementado
- Login por email/matrícula + senha com Supabase Auth
- Resolução de matrícula → email via RPC `get_email_by_matricula()`
- CAPTCHA Cloudflare Turnstile (invisível, background check)
- Iron-session httpOnly cookie (`apmcb_session`, 8h TTL)
- CSRF duplo token (cookie + header)
- Rate limiting 3 níveis: 5/15min (TOTP), 100/min, 120/min
- Fallback Bearer token para server-to-server (Next.js proxy → BFF)

#### 1.1.2 Convite e Ativação de Conta
- **Status:** ✅ Implementado
- Link de convite com PKCE + `next` parameter
- Tela `/auth/confirmar-conta` com medidor de força de senha
- Marca `account_activated_at` no perfil após ativação
- Redirecionamento pós-ativação por role

#### 1.1.3 TOTP (2FA)
- **Status:** ✅ Implementado
- Autenticação com senhas de tempo único RFC 6238
- Setup inicial com QR code (Google Authenticator compatible)
- Anti-replay via `last_used_token` + janela ± 30s
- Rate limit 5/15min por usuário
- Validação em operações sensíveis (assinatura, passagem de serviço)
- Segredo armazenado apenas em `totp_secrets` — jamais em auth.users

#### 1.1.4 Gestão de Sessão e Invalidação em Tempo Real
- **Status:** ✅ Implementado (Fase 7B)
- `sessions_invalidated_at` em profiles (logout forçado por admin)
- Hook `useRoleGuard` — polling 5min + `window.focus` listener
- `/api/auth/me` valida role DB vs sessão; force re-login se divergir
- Logout em cascata quando admin desativa usuário

#### 1.1.5 OAuth (Google)
- **Status:** ✅ Implementado
- Login social via Google OAuth com PKCE flow
- Criação automática de perfil no first sign-in

#### 1.1.6 Modo Usuário (Staff em modo civil)
- **Status:** ✅ Implementado
- Armeiros e admins podem alternar para "modo usuário" (visualização como efetivo)
- Cookie `apmcb_mode` com `domain: .pmpb.online` — propagado ao BFF
- BFF aplica `activeMode` em `authMiddleware` (iron-session + cookie fallback)

---

### 1.2 — Biometria

#### 1.2.1 Identificação Biométrica 1:N ZKTeco
- **Status:** ✅ Implementado
- Identificação sem ID digitado — leitura + matching contra templates do tenant
- Integração com SDK ZKTeco via BFF
- Resultado: nome, matrícula, foto, posto — exibido em card

#### 1.2.2 Cadastro de Biometria
- **Status:** ✅ Implementado
- Captura biométrica de novos militares (armeiro)
- Templates armazenados em `biometric_templates` com isolamento por tenant
- Fluxo de re-matrícula suportado

---

### 1.3 — Solicitação Remota de Armamento (SSA)

#### 1.3.1 Requisição pelo Militar (SSA Request)
- **Status:** ✅ Implementado
- Military fora da reserva solicita material remotamente
- Seleção de reserva destino + itens + quantidades
- Validação TOTP no momento da requisição
- Notas opcionais

#### 1.3.2 Controle de Acesso Remoto por Reserva
- **Status:** ✅ Implementado (2026-06-30)
- Toggle `allow_remote_requests` por reserva (admin_reserva / admin_global)
- Quando desabilitado: apenas membros da própria reserva podem requisitar remotamente
- Defense-in-depth: verificado no `GET /available-materials` E no `POST /requests`
- UI: componente `ReserveRemoteAccessToggle` em `/reserva`

#### 1.3.3 Aprovação/Rejeição pelo Armeiro
- **Status:** ✅ Implementado
- Armeiro revisa pendências remotas com itens, quantidades e solicitante
- Aprovação gera `expires_at` para retirada (janela de tempo configurável)
- Rejeição notifica solicitante

#### 1.3.4 Disponibilidade de Materiais
- **Status:** ✅ Implementado
- View `material_availability` — `quantidade_disponivel = quantidade_total - armada - em_cautela - em_uso`
- Corrigido fan-out N×M (2026-06-30): subqueries independentes para lendings e request_items
- Filtro obrigatório por `tenant_id` no BFF (security fix M5)

---

### 1.4 — Saídas Diárias (Lendings)

#### 1.4.1 Emissão de Saída
- **Status:** ✅ Implementado
- Registro de saída de material: militar + item + data/hora
- Identificação por biometria ou matrícula
- Múltiplos itens por saída

#### 1.4.2 Devolução
- **Status:** ✅ Implementado
- Registro de devolução com confirmação do armeiro
- Status tracking: `ativo` → `devolvido`
- Histórico completo por militar

#### 1.4.3 Devoluções Pendentes com Alerta
- **Status:** ✅ Implementado
- Card com contagem em tempo real de saídas ativas
- Badge de perigo para saídas em atraso

---

### 1.5 — Cautela Eletrônica

#### 1.5.1 Emissão de Termo de Cautela
- **Status:** ✅ Implementado
- Emissão com assinatura dupla (armeiro + militar via TOTP)
- Geração de PDF com prova criptográfica
- QR code verificável publicamente em `/verificar/:hash`

#### 1.5.2 Devolução de Cautela
- **Status:** ✅ Implementado
- Devolução com assinatura dupla confirmando retorno
- Atualização de status e histórico

---

### 1.6 — Passagem de Serviço Digital

#### 1.6.1 Iniciação de Passagem
- **Status:** ✅ Implementado
- Armeiro sainte cria passagem com snapshot do estado do almoxarifado
- Estado inclui: saídas ativas, cautelas, ocorrências abertas, materiais por categoria

#### 1.6.2 Aceite e Assinatura Dupla
- **Status:** ✅ Implementado
- Armeiro entrante revisa snapshot + assina com TOTP
- Hash SHA-256 encadeado ao log de auditoria
- Registro imutável no `audit_log`

#### 1.6.3 Verificação Pública
- **Status:** ✅ Implementado
- Rota pública `/verificar/:hash` — valida autenticidade da passagem sem login
- QR code na passagem impressa

---

### 1.7 — Arsenal e Almoxarifado

#### 1.7.1 Cadastro de Material
- **Status:** ✅ Implementado
- Tipos de material com categoria, foto, número de série
- Rastreabilidade de item individual (cada unidade tem ID único)

#### 1.7.2 Categorias e Organização
- **Status:** ✅ Implementado
- Categorias hierárquicas (ex: Armamento > Fuzil, Coturno > Curto/Cano)
- Filtros por categoria no almoxarifado

#### 1.7.3 Notificações de Validade
- **Status:** ✅ Implementado
- Alertas configuráveis para materiais com validade próxima
- Notificações push + in-app

#### 1.7.4 Solicitações de Alteração de Estoque
- **Status:** ✅ Implementado
- Armeiro solicita ajuste de quantidade com justificativa
- Aprovação exclusiva do admin_global (roleGuard)
- Audit log obrigatório: aprovador, data, nota, delta

---

### 1.8 — Perfil e Gestão de Usuário

#### 1.8.1 Perfil do Usuário
- **Status:** ✅ Implementado
- Edição de nome de guerra, telefone, foto
- Upload de foto com validação (JPG/PNG, max 5MB)
- Exibição de posto, matrícula, unidade

#### 1.8.2 Histórico do Militar
- **Status:** ✅ Implementado
- Cadete visualiza seu próprio histórico (saídas, cautelas, SSA)
- Armeiro em modo usuário visualiza o mesmo histórico

---

### 1.9 — Relatório de Movimentação
- **Status:** ✅ Implementado
- Filtros: período, tipo (saídas/cautelas/passagens/SSA), reserva
- Export para PDF ou tabela na tela

---

### 1.10 — Auditoria com Hash Encadeado
- **Status:** ✅ Implementado (Fase 3)
- Toda operação sensível gera `audit_log` com: ator, ação, recurso, IP, método auth
- Hash SHA-256 encadeado (cada entrada referencia o hash da anterior)
- Imutabilidade garantida por RULE PostgreSQL (bloqueia UPDATE/DELETE)
- `admin_global` e `superadmin` consultam via `/admin/auditoria`

---

### 1.11 — Assinatura Eletrônica Nível 1
- **Status:** ✅ Implementado (Fase 4)
- Assinatura com prova criptográfica vinculada à identidade do signatário
- TOTP como segundo fator obrigatório
- QR verificável em `/verificar/:hash`
- Conformidade com Lei 14.063/2020 (assinatura eletrônica simples)

---

### 1.12 — Ocorrências e Incidentes
- **Status:** ✅ Implementado
- Militar reporta problema com material (danificado, extraviado, etc.)
- Status: aberta → em_análise → resolvida
- Notificação ao armeiro na criação
- Contagem em tempo real no dashboard do armeiro

---

### 1.13 — Notificações

#### 1.13.1 Push Notifications
- **Status:** ✅ Implementado
- Web Push via VAPID (service worker)
- Opt-in por usuário com permissão explícita
- Eventos: SSA pendente, cautela aprovada, devolução atrasada

#### 1.13.2 In-App Notifications
- **Status:** ✅ Implementado
- Sino de notificações com badge de contagem
- Leitura individual e marcar todas como lidas

---

### 1.14 — Gestão de Usuários (admin_global)
- **Status:** ✅ Implementado
- CRUD completo de militares: criar, buscar, alterar status, atualizar dados
- Status: `pending`, `complete`, `inactive`, `impedimento_administrativo`
- Impedimento bloqueia autenticação no middleware
- Militares sem login: flag `account_activated_at IS NULL`

---

### 1.15 — Estrutura Organizacional (admin_global)
- **Status:** ✅ Implementado
- Árvore: Tenant → OrgUnits → Reserves
- Criar/deletar org_units com validação (409 se houver reserves vinculadas)
- Criar reserves com acronym e logo_url
- Validação em cascata: delete bloqueia se filho existir

---

### 1.16 — Dashboards

#### 1.16.1 Dashboard Armeiro / Admin Reserva
- **Status:** ✅ Implementado
- Cards de atalho com contagens em tempo real
- Identificar militar, nova saída, devoluções pendentes, SSA, retiradas, ocorrências

#### 1.16.2 Painel de Comando (admin_global)
- **Status:** ✅ Implementado
- 14 métricas de exceção em tempo real
- Cautelas ativas, saídas com atraso, estoque baixo, divergências, ocorrências

#### 1.16.3 Dashboard Cadete (usuario)
- **Status:** ✅ Implementado
- Cards navegáveis: histórico, perfil, SSA, TOTP
- Tooltips e feedback visual sem texto redundante

#### 1.16.4 Nexus (superadmin)
- **Status:** ✅ Implementado
- Painel de criação e gerenciamento de tenants
- Metrics cross-tenant (apenas para operador SaaS)

---

### 1.17 — Desprovisionamento
- **Status:** ✅ Implementado (Fase 7)
- Desativação de usuário com invalidação de sessão em cascata
- Biometria não é deletada (auditoria histórica)
- Role downgrade possível sem deleção

---

## 2. Segurança em Camadas

O sistema implementa **defense-in-depth** com 7 camadas:

| Camada | Implementação | Status |
|---|---|---|
| **1. Rede** | HTTPS everywhere; HSTS no Nginx; Cloudflare WAF | ✅ |
| **2. Autenticação** | Iron-session httpOnly; CSRF duplo; Turnstile anti-bot | ✅ |
| **3. Autorização** | RBAC Privilege Ceiling (H-RBAC); roleGuard no BFF | ✅ |
| **4. Banco de Dados** | RLS por tenant_id em todas as tabelas; RULE de imutabilidade no audit_log | ✅ |
| **5. Aplicação** | Validação Zod em todo input; TypeScript strict; Fail Fast | ✅ |
| **6. Operação** | TOTP anti-replay; rate limiting sliding window; session invalidation | ✅ |
| **7. Auditoria** | Hash encadeado SHA-256; registro de IP, método auth, ator, recurso | ✅ |

### 2.1 — Isolamento Multi-Tenant

- Todas as queries BFF (service_role) filtram por `tenant_id` da sessão
- RLS nas tabelas Supabase como segunda linha de defesa (belt-and-suspenders)
- Isolamento absoluto: nenhuma role de um tenant vê dados de outro
- `superadmin` acessa dados cross-tenant APENAS via `/api/nexus/*` (endpoints dedicados)

### 2.2 — Segurança do SSA

- `GET /available-materials` — filtro obrigatório por `tenant_id` + `allow_remote_requests`
- `POST /requests` — verifica `allow_remote_requests` + membership (defense-in-depth)
- TOTP obrigatório na requisição pelo militar
- Aprovação exclusiva do armeiro da reserva destino

### 2.3 — Proteção de Segredos

- Service role key: apenas no BFF (variável de ambiente no Hetzner VPS)
- TOTP secrets: apenas em `totp_secrets` — não em `auth.users`, não em client code
- Secrets GitHub: zero — todos os segredos em CF Pages env vars ou BFF `.env`
- SSH: chave `~/.ssh/apmcb_hetzner` para deploy — nunca por senha

---

## 3. RBAC — Hierarquia com Privilege Ceiling

O APMCB implementa **Hierarchical RBAC com Privilege Ceiling (H-RBAC)**, também conhecido como **Bounded Delegation** na literatura SaaS enterprise.

### Princípio

> Cada role só pode exercer poder até o **teto** da sua camada. Nenhuma role pode delegar ou executar permissões maiores que as suas. Não há escalada vertical nem horizontal.

### Hierarquia

```
superadmin    → SaaS operator (Nexus) — provisiona tenants, SEM controle estrutural
    │
admin_global  → Governa estrutura em cascata: org_units → reserves → usuários
    │
admin_reserva → Governa apenas a sua reserva (toggle SSA, membros, armeiros)
    │
armeiro       → Operações do dia a dia dentro da reserva
    │
usuario       → Auto-serviço (SSA, perfil, histórico)
```

### Roles e Tetos

| Role | Teto | Contexto | Pode gerenciar |
|---|---|---|---|
| `superadmin` | Cross-tenant (SaaS) | Nexus | Tenants, org global — sem estrutura interna |
| `admin_global` | Tenant inteiro | `/admin` | Org units, reserves, usuários, arsenal |
| `admin_reserva` | Própria reserva | `/reserva` | Membros, armeiros, toggle SSA da reserva |
| `armeiro` | Operação da reserva | `/reserva` | Saídas, cautelas, passagem, SSA approval |
| `usuario` | Próprio perfil | `/cadete` | SSA requests, histórico, perfil |
| `auditor` | Read-only tenant | `/admin/auditoria` | Apenas leitura de logs |

### Implementação Técnica

- **BFF:** `roleGuard(...roles)` em cada endpoint — retorna 403 imediatamente se role não consta
- **Frontend:** `profile?.role === "..."` controls UI visibility (guard visual)
- **Banco:** RLS policies com `auth_role() IN (...)` — terceira camada de defesa
- **Regra:** `superadmin` NUNCA aparece em `roleGuard` de endpoints de gestão estrutural/reserva

### Garantias do Privilege Ceiling

1. `admin_reserva` não pode alterar outra reserva (membership guard no BFF)
2. `admin_global` não pode acessar `/api/nexus/*` (superadmin exclusivo)
3. `superadmin` não pode gerenciar reservas, usuários ou estrutura interna (sem roleGuard)
4. Nenhuma role pode criar role de nível superior à sua
5. Tenant isolation: role de um tenant não tem visibilidade em outro

---

## 4. Diferenciais Competitivos

| Diferencial | Detalhe |
|---|---|
| **Multi-tenant real** | Isolamento absoluto por `tenant_id` — dados nunca vazam entre organizações |
| **Biometria para assinatura** | ZKTeco 1:N integrado — identifica militar sem digitação; prova presença física |
| **Assinatura eletrônica com QR verificável** | Cautela/passagem têm QR code verificável publicamente sem login |
| **Passagem de serviço com snapshot criptográfico** | Hash encadeado do estado do almoxarifado no momento da passagem |
| **RBAC com Privilege Ceiling** | H-RBAC: nenhuma role pode exceder seu próprio teto — sem escalada de privilégio |
| **Dashboard de exceções em tempo real** | 14 métricas de alerta — painel de comando sem polling manual |
| **Defense-in-depth SSA** | Acesso remoto verificado em 3 camadas: BFF GET + BFF POST + RLS |
| **PWA com push notifications** | Armeiro recebe push quando SSA pendente — sem precisar abrir o sistema |
| **Rastreabilidade de item individual** | Cada unidade de material tem ID único — histórico completo por item |
| **Modo usuário (staff-as-efetivo)** | Armeiro/admin testa a visão do cadete sem logout — contexto preservado |
| **API BFF com Hono** | BFF dedicado com iron-session — sem exposição de service_role ao frontend |

---

## 5. Integrações Externas

| Integração | Status | Função |
|---|---|---|
| Supabase PostgreSQL | ✅ Ativo | Banco principal com RLS |
| Supabase Auth | ✅ Ativo | JWT, OAuth, magic link |
| Supabase Realtime | ✅ Ativo | Notificações em tempo real |
| Supabase Storage | ✅ Ativo | Fotos de militares e materiais |
| Cloudflare Pages | ✅ Ativo | CDN edge — frontend Next.js |
| Cloudflare Turnstile | ✅ Ativo | Anti-bot invisível no login |
| Hetzner VPS | ✅ Ativo | BFF Hono em Docker |
| ZKTeco SDK | ✅ Ativo | Biometria 1:N |
| Supabase Management API | ✅ Ativo | Nexus provisiona tenants |
| Resend (Email) | 📋 Fase 9 | E-mail transacional |

---

## 6. Roadmap Futuro (Phases 8-12)

| Phase | Feature Principal | Status |
|---|---|---|
| **Phase 7B** | Onboarding flow, branding por tenant, stress test | 🔧 Em andamento |
| **Phase 8** | Inventário periódico com conformidade | 📋 Planejado |
| **Phase 9** | E-mail transacional (Resend) | 📋 Planejado |
| **Phase 10** | Hardening enterprise: TOTP encryption, Redis rate limit, E2E staging | 📋 Planejado |
| **Phase 11** | Migração BFF Brasil (LGPD data residency) | 📋 Planejado |
| **Phase 12** | API Pública v1 + Webhooks para integrações | 📋 Planejado |
| **Post-piloto** | Importação CSV/XLSX de efetivo | 📋 Backlog |
| **Post-piloto** | App Mobile Nativo | 📋 Backlog |

---

## Métricas

| | Quantidade |
|---|---|
| **Features implementadas** | 38 |
| **Features parciais** | 4 |
| **Features planejadas** | 8 |
| **Total** | **50** |
| **Roles RBAC** | 6 |
| **Camadas de segurança** | 7 |
| **Endpoints BFF** | ~45 |
