# APMCB — Inventário Completo de Features

> **Documento vivo de features implementadas, parciais e planejadas**  
> **Última atualização:** 2026-06-30  
> **Versão:** 1.0  
> **Status:** Baseado em Phases 0-7B + roadmap Phases 8-12

---

## Índice

1. [Módulos por Área Funcional](#1-módulos-por-área-funcional)
2. [Segurança e Compliance](#2-segurança-e-compliance)
3. [Diferenciais Competitivos](#3-diferenciais-competitivos)
4. [Integrações Externas](#4-integrações-externas)
5. [Roadmap Futuro](#5-roadmap-futuro-phases-8-12)

---

## 1. Módulos por Área Funcional

### 1.1 — Autenticação e Gestão de Sessão

#### 1.1.1 Login com Credenciais
- **Status:** ✅ Implementado
- **Descrição:** Fluxo de login por email/matrícula + senha com Supabase Auth
- **Features:**
  - Resolução de matrícula → email via RPC `get_email_by_matricula()`
  - CAPTCHA Cloudflare Turnstile (invisível, background check)
  - Iron-session httpOnly cookie (`apmcb_session`, 8h TTL)
  - CSRF duplo token (cookie + header)
  - Rate limiting 3 níveis: 5/15min (TOTP), 100/min, 120/min
  - Fallback para Bearer token (Bearer JWT)
  - Server-side validation via `supabase.auth.getUser(token)`
- **Endpoints BFF:**
  - `POST /api/auth/login` — valida credenciais e cria sessão
  - `GET /api/auth/me` — retorna perfil atual + role
  - `POST /api/auth/logout` — destroi sessão
- **Rotas Frontend:**
  - `/login` — formulário público
  - `/auth/callback` — OAuth callback com validação de `next` parameter
  - `/auth/exchange` — troca JWT por iron-session

#### 1.1.2 Convite e Ativação de Conta
- **Status:** ✅ Implementado
- **Descrição:** Fluxo de convite por e-mail com ativação de primeira senha
- **Features:**
  - Geração de link de convite com PKCE + `next` parameter
  - Tela `/auth/confirmar-conta` com medidor de força de senha
  - Validação de requisitos (maiúscula, número, comprimento)
  - Marca `account_activated_at` no perfil
  - Redirecionamento pós-ativação por role
- **Endpoints BFF:**
  - `POST /api/auth/invite` — gera link de convite (admin apenas)
  - `POST /api/auth/activate-account` — marca conta como ativa

#### 1.1.3 TOTP (2FA)
- **Status:** ✅ Implementado
- **Descrição:** Autenticação com senhas de tempo único RFC 6238
- **Features:**
  - Setup inicial com QR code (google-authenticator compatible)
  - Anti-replay via `last_used_token` + janela de ± 30s
  - Rate limit 5/15min por usuário
  - Validação em operações sensíveis (assinatura, TOTP setup, passagem de serviço)
  - Self-validate (armeiro/admin prova conhecimento do TOTP antes de assinar)
- **Endpoints BFF:**
  - `GET /api/totp/status` — status atual
  - `POST /api/totp/setup` — gera novo segredo + QR
  - `POST /api/totp/validate` — valida token (operações sensíveis)
  - `POST /api/totp/self-validate` — armeiro prova conhecimento
- **Armazenamento:** Tabela `totp_secrets` (jamais sincronizada com auth.users)

#### 1.1.4 Gestão de Sessão e Revalidação
- **Status:** ✅ Implementado (Fase 7B)
- **Descrição:** Invalidação de sessão por logout admin + revalidação periódica
- **Features:**
  - `sessions_invalidated_at` em profiles (timestamp de logout forçado)
  - `issuedAt` em SessionData para invalidação por timestamp
  - Hook `useRoleGuard` — polling 5min + `window.focus` listener
  - Logout em cascata quando admin desativa usuário
  - `/api/auth/me` valida role DB vs sessão; force re-login se divergir
- **RoleWatcher:** Integrado ao dashboard layout

#### 1.1.5 OAuth (Google)
- **Status:** ✅ Implementado
- **Descrição:** Login social via Google OAuth
- **Features:**
  - Callback via `/auth/callback`
  - Criação automática de perfil no first sign-in
  - PKCE flow
  - CSRF protection

