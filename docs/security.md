# APMCB — Inventário de Segurança

> Documento gerado em 2026-06-17. Atualizar a cada mudança de arquitetura de segurança.

---

## 1. Content Security Policy (CSP)

**Arquivo:** `apps/web/src/middleware.ts`

Toda resposta HTTP do Next.js (CF Pages) inclui o header `Content-Security-Policy`:

| Diretiva | Valor | Motivo |
|----------|-------|--------|
| `default-src` | `'self'` | Bloqueia qualquer origem não listada |
| `script-src` | `'self' 'unsafe-inline' https://static.cloudflareinsights.com` | CF Pages injeta beacon de analytics automaticamente |
| `style-src` | `'self' 'unsafe-inline'` | Tailwind CSS inline (necessário) |
| `img-src` | `'self' blob: data: https://<supabase>` | Avatares vindos do Supabase Storage |
| `connect-src` | `'self' https://<supabase> wss://<supabase> <BFF_URL> https://cloudflareinsights.com` | Permite Supabase REST/Realtime + BFF |
| `frame-ancestors` | `'none'` | Bloqueia clickjacking |
| `form-action` | `'self'` | Bloqueia submissões para domínios externos |
| `base-uri` | `'self'` | Impede injeção de `<base>` tag |

**Nota:** `unsafe-inline` sem `strict-dynamic` — necessário porque Next.js App Router injeta scripts de hidratação inline sem nonce. Principal defesa XSS está em `default-src 'self'` + `connect-src` whitelist.

Headers adicionais em todas as respostas:
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`

---

## 2. Autenticação

### Front-end (CF Pages → Supabase)

**Biblioteca:** `@supabase/ssr` com `createBrowserClient`

- Tokens de sessão armazenados em **cookies HttpOnly** (não localStorage) — indetectáveis por `document.cookie` em JS malicioso
- Refresh automático via Supabase Auth
- `AuthListener` (`apps/web/src/components/providers.tsx`) escuta `SIGNED_OUT` e redireciona para `/login` imediatamente quando o token expira ou é revogado (400 no refresh → `SIGNED_OUT` event)

### Back-end (BFF → Supabase)

**Arquivo:** `apps/bff/src/middleware/auth.ts`

- Valida o JWT Supabase do header `Authorization: Bearer <token>` em cada request autenticado
- Usa `supabase.auth.getUser(token)` — validação server-side, não apenas decodificação local
- Retorna `401` se token ausente, expirado ou inválido

---

## 3. Rate Limiting

**Arquivo:** `apps/bff/src/middleware/rate-limit.ts`

**Algoritmo:** Sliding window (janela deslizante) — previne o "burst duplo" do fixed window (2× a cota na virada de janela).

| Rota | Limite | Janela | Caso de uso |
|------|--------|--------|-------------|
| `/api/auth/*` | 5 req | 15 min | Anti brute-force de credenciais |
| `/api/totp/*`, `/api/ssa/*`, `/api/biometric/*` | 20 req | 1 min | Operações sensíveis (TOTP, SSA, biometria) |
| Demais `/api/*` | 120 req | 1 min | API geral (dashboard, arsenal, notificações) |

**Headers em toda resposta `/api/*`:**
- `X-RateLimit-Limit` — cota máxima da rota
- `X-RateLimit-Remaining` — requisições restantes na janela
- `X-RateLimit-Reset` — timestamp Unix de reset da janela

**Headers em resposta `429`:**
- `Retry-After` — segundos até a janela liberar
- Body: `{ "error": "Too many requests", "retry_after_seconds": N }`

**IP Detection:** `CF-Connecting-IP` (header Cloudflare, não forjável) com fallback para `X-Forwarded-For`.

**Validação E2E (Playwright):** `apps/web/e2e/rate-limit.spec.ts` — 9 testes, 100% passando contra BFF em produção.

---

## 4. CSRF Protection

**Arquivo:** `apps/bff/src/middleware/csrf.ts`

- Header `X-CSRF-Token` obrigatório em todos os requests mutáveis (`POST`, `PUT`, `PATCH`, `DELETE`) para `/api/*`
- Requests com `Authorization: Bearer` (token Supabase) são isentos — já autenticados de forma segura
- Sem token CSRF: `401 Unauthorized`

---

## 5. Row Level Security (RLS) — Supabase

Todas as tabelas críticas têm RLS habilitado. Políticas por tabela:

| Tabela | Políticas |
|--------|-----------|
| `profiles` | Usuário lê e edita apenas o próprio perfil; admin/master lê todos |
| `lendings` | Usuário vê apenas próprios empréstimos; staff (admin/master) vê todos |
| `material_requests` | Usuário vê apenas os próprios pedidos; staff vê todos |
| `material_request_items` | Idem ao request pai |
| `totp_secrets` | **Zero acesso a usuários** — somente `service_role` (BFF) via política `FOR ALL TO service_role` |
| `audit_logs` | Insert-only para autenticados; DELETE bloqueado por RULE (imutabilidade) |

**Função helper:** `auth_role()` retorna o papel do usuário autenticado — usada em políticas `WITH CHECK` para evitar escalação de privilégio.

---

## 6. TOTP (RFC 6238)

**Biblioteca:** `otplib` (BFF — Hetzner VPS)

- Secret TOTP armazenado **somente no Supabase** (tabela `totp_secrets`, RLS service_role only)
- Secret **nunca exposto** a: CF Pages, JS do cliente, logs, responses de API
- Código gerado server-side no BFF, retornado sem o secret: `{ code, seconds_remaining, period }`
- Validação com janela ±1 step (60s) — evita falha por drift de relógio
- Anti-replay: `otplib` rejeita step anterior; `last_used_token` no DB impede reutilização do mesmo código
- Bloqueio por falhas: 5 falhas consecutivas → `failure_count >= 5` → BFF retorna 429 (além do rate limiter de rede)

---

## 7. Auditoria (Audit Logs)

**Tabela:** `public.audit_logs`

- Trigger `SECURITY DEFINER` registra toda transição de status de `material_requests`
- Registros **imutáveis**: RULE do PostgreSQL bloqueia `DELETE` e `UPDATE` na tabela
- Campos: `actor_id`, `action`, `resource_type`, `resource_id`, `metadata` (JSONB), `created_at`
- Ações rastreadas: login, logout, TOTP validado/falhou, SSA solicitado/aprovado/rejeitado/retirado/expirado, lendings criados/devolvidos

---

## 8. Exposição de API Keys

**Verificação realizada em 2026-06-17:**

| Chave | Onde está | Exposta no client? |
|-------|-----------|-------------------|
| `SUPABASE_SERVICE_ROLE_KEY` | CF Pages env var (server-only) + BFF `.env` | **Não** — acessada via `getRequestContext().env` em CF Workers; nunca bundled no JS |
| `SUPABASE_ANON_KEY` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` (CF Pages) | **Sim, intencional** — chave pública por design do Supabase; protegida por RLS |
| `SUPABASE_URL` | `NEXT_PUBLIC_SUPABASE_URL` | **Sim, intencional** — URL pública |
| `INTERNAL_API_SECRET` | BFF `.env` apenas | **Não** — usado só em `/api/push/broadcast` internamente |
| `BFF_URL` | `NEXT_PUBLIC_BFF_URL` | **Sim, intencional** — URL pública da API |

**ReactQueryDevtools:** Desabilitado em produção — só renderizado quando `process.env.NODE_ENV === "development"` (`apps/web/src/components/providers.tsx`).

---

## 9. Infraestrutura

- **CF Pages (front-end):** Edge network Cloudflare — sem servidor para atacar diretamente
- **Hetzner VPS (BFF):** Container Docker, processo não-root (uid=1001), porta 3001 bind em `127.0.0.1` apenas — exposta só via nginx reverso com TLS
- **Supabase:** Instância gerenciada — autenticação, banco, storage, Realtime
- **Nginx:** TLS termination, proxy reverso para BFF; sem porta 3001 exposta diretamente
- **SSH:** Acesso ao VPS via chave `apmcb_hetzner` (ED25519), sem senha

---

## 10. Checklist de Segurança

- [x] CSP em todas as respostas HTTP
- [x] Tokens em cookies HttpOnly (não localStorage)
- [x] Rate limiting sliding window por rota
- [x] CSRF protection em mutations
- [x] RLS em todas as tabelas críticas
- [x] Service role key nunca no cliente
- [x] TOTP secret nunca exposto em respostas
- [x] Audit logs imutáveis (RULE no PostgreSQL)
- [x] ReactQueryDevtools desabilitado em produção
- [x] AuthListener: expiração de sessão redireciona para login
- [x] Nginx TLS + reverse proxy (sem porta direta exposta)
- [x] Container non-root (uid=1001)
- [x] `X-Frame-Options: DENY` + `X-Content-Type-Options: nosniff`
