# APMCB — Inventário de Segurança

> Última atualização: 2026-06-17. Atualizar a cada mudança de arquitetura de segurança.

---

## 1. Content Security Policy (CSP)

**Arquivo:** `apps/web/src/middleware.ts`

Toda resposta HTTP do Next.js (CF Pages) inclui o header `Content-Security-Policy`:

| Diretiva | Valor | Motivo |
|----------|-------|--------|
| `default-src` | `'self'` | Bloqueia qualquer origem não listada |
| `script-src` | `'self' 'unsafe-inline' https://static.cloudflareinsights.com https://challenges.cloudflare.com` | CF Pages beacon + Turnstile api.js |
| `style-src` | `'self' 'unsafe-inline'` | Tailwind CSS inline (necessário) |
| `img-src` | `'self' blob: data: https://<supabase> https://challenges.cloudflare.com` | Avatares do Supabase Storage + assets do widget Turnstile |
| `connect-src` | `'self' https://<supabase> wss://<supabase> <BFF_URL> https://cloudflareinsights.com https://challenges.cloudflare.com https://turnstile-siteverify-apmcb.arckosia.workers.dev` | Supabase REST/Realtime + BFF + Turnstile challenge XHR + Worker siteverify |
| `frame-src` | `https://challenges.cloudflare.com` | iframe do widget Turnstile |
| `font-src` | `'self'` | Apenas fontes locais |
| `frame-ancestors` | `'none'` | Bloqueia clickjacking |
| `form-action` | `'self'` | Bloqueia submissões para domínios externos |
| `base-uri` | `'self'` | Impede injeção de `<base>` tag |

**Nota sobre `unsafe-inline`:** Next.js App Router injeta scripts de hidratação inline que não podem receber nonce sem integração profunda do framework. `strict-dynamic` os bloquearia. A defesa primária de XSS está em `default-src 'self'` + `connect-src` whitelist + `frame-ancestors 'none'`.

**Headers adicionais em todas as respostas:**

| Header | Valor | Protege contra |
|--------|-------|----------------|
| `X-Frame-Options` | `DENY` | Clickjacking |
| `X-Content-Type-Options` | `nosniff` | MIME type confusion |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Vazamento de URL em referrer |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | APIs do browser não usadas pelo app |

---

## 2. Anti-Bot — Cloudflare Turnstile

**Widget:** sitekey `0x4AAAAAADmwPEpkY8mUdcK9` (modo invisible — sem interação do usuário)
**Worker siteverify:** `https://turnstile-siteverify-apmcb.arckosia.workers.dev`

### Fluxo de proteção no login

1. `api.js` do Turnstile carrega via `<Script strategy="afterInteractive">`
2. Widget renderiza de forma **invisível** (fingerprinting, PAT challenge, análise comportamental em background)
3. Se o desafio passa → `callback(token)` preenche `turnstileToken.current`
4. Se token expirar → `expired-callback` limpa o ref; widget auto-renova
5. Ao submeter o formulário: se token existe, verifica via Worker (`POST /verify { token }`)
6. Worker chama `https://challenges.cloudflare.com/turnstile/v0/siteverify` com **secret key** (nunca exposto ao cliente)
7. Se Worker retorna `{ success: true }` → login prossegue
8. Se widget falhar (PAT loop, Playwright headless, etc.) → login **não é bloqueado** (soft gate) — o Supabase rate limiting e bcrypt protegem contra brute-force nesse cenário
9. Cleanup: `useEffect` chama `turnstile.remove()` no unmount, evitando interval orphan no console

### Por que o captcha do Supabase Auth está desabilitado

O Supabase Auth tem opção de verificar o captchaToken no `signInWithPassword`. Foi desabilitado porque o secret key configurado lá era incompatível com o sitekey Turnstile, causando `400 Bad Request` em todo login. A proteção bot já ocorre no nosso Worker antes de chamar o Supabase — a dupla verificação era redundante e quebrada.

### Secrets do Turnstile

| Segredo | Onde | Exposto? |
|---------|------|----------|
| `TURNSTILE_SECRET_KEY` | Cloudflare Worker env var (via `wrangler secret put` stdin — nunca em disco) | **Não** |
| `NEXT_PUBLIC_TURNSTILE_SITEKEY` | CF Pages env var | **Sim, intencional** — chave pública por design |
| `NEXT_PUBLIC_TURNSTILE_WORKER_URL` | CF Pages env var | **Sim, intencional** — URL pública |

---

## 3. Sessão — Iron-Session (BFF)

**Arquivo:** `apps/bff/src/lib/session.ts`

Iron-session é usado pelo BFF (Hono no Hetzner) para sessões com estado criptografado em cookie.

### Interface `SessionData`

```typescript
{
  userId: string;                          // UUID Supabase
  role: "admin" | "master" | "usuario";
  supabaseAccessToken: string;             // JWT para operações Supabase via BFF
}
```

### Configuração do cookie

| Parâmetro | Valor | Propósito |
|-----------|-------|-----------|
| `password` | `SESSION_SECRET` (mínimo 32 chars) | Chave de encriptação AES-256-CBC |
| `cookieName` | `apmcb_session` | Nome do cookie |
| `httpOnly` | `true` | Inacessível por `document.cookie` em JS |
| `secure` | `true` em produção | HTTPS obrigatório |
| `sameSite` | `"strict"` | Cookie não é enviado em requisições cross-site |
| `path` | `/` | Escopo raiz |
| `maxAge` | `28800s` (8 horas) | Duração da sessão |

### Fluxo de login (BFF)

```
POST /api/auth/login
1. Recebe: { email? | matricula?, password }
2. Se matricula: RPC get_email_by_matricula() → resolve email
3. Autentica: supabase.auth.signInWithPassword(email, password)
4. Busca role: SELECT role, registration_status FROM profiles WHERE id = user.id
5. Cria iron-session: { userId, role, supabaseAccessToken }
6. Emite CSRF token em cookie legível (não httpOnly, sameSite=Lax):
   setCookie("csrf-token", crypto.randomUUID(), { maxAge: 86400 })
7. Retorna: { user: { id, email, role, registration_status } }

Falha: audit_logs.insert({ action: "auth.login_failed", metadata: { email, ip, reason } })
```

```
POST /api/auth/logout
- session.destroy() — destrói o cookie criptografado
```

---

## 4. Autenticação — Middleware do BFF

**Arquivo:** `apps/bff/src/middleware/auth.ts`

### Dual-layer auth (Iron-session + Bearer)

```
Para cada request autenticado:
  Prioridade 1: Valida apmcb_session via getIronSession()
  Prioridade 2: Fallback para Bearer token (Authorization: Bearer <jwt>)
  Em ambos os casos: supabase.auth.getUser(token) — validação server-side
  Sem token: 401
  Sem profile: 403
```

**Protege contra:** tokens forjados, tokens expirados, usuários sem perfil criado.

---

## 5. Autorização por Role — roleGuard

**Arquivo:** `apps/bff/src/middleware/role-guard.ts`

```typescript
roleGuard("admin", "master")  // Apenas admin e master passam
```

| Endpoint | Roles permitidas |
|----------|-----------------|
| `/api/biometric/*` | `admin`, `master` |
| `/api/totp/validate` | `admin`, `master` |
| `/api/ssa/*/approve` | `admin`, `master` |
| `/api/ssa/*/reject` | `admin`, `master` |
| `/api/ssa/*/deliver` | `admin`, `master` |
| `/api/arsenal/requests/*/approve` | `admin` (somente) |
| `/api/ssa/requests` (criar) | `usuario` |
| `/api/totp/setup` | `usuario` |

Falha: `403 "Insufficient permissions"`.

---

## 6. CSRF Protection

**Arquivo:** `apps/bff/src/middleware/csrf.ts`

**Padrão:** Double-submit cookie — o token está num cookie legível por JS (`csrf-token`) e deve ser enviado como header (`x-csrf-token`). O servidor compara os dois valores.

```
Métodos seguros (GET, HEAD, OPTIONS): isento
Rotas exemptadas: /api/auth/login, /api/push/broadcast
Requests com Bearer token: isentos (autenticação stateless, não sessão de browser)
Requests sem apmcb_session: isentos (sem sessão de browser)

Demais mutations (POST, PUT, PATCH, DELETE):
  cookieToken !== headerToken → 403 "CSRF token inválido"
```

**Protege contra:** CSRF em todas as operações que modificam estado, usando sessão de browser.

---

## 7. Rate Limiting

**Arquivo:** `apps/bff/src/middleware/rate-limit.ts`

**Algoritmo:** Sliding window in-memory, por IP isolado. Evita o "burst duplo" do fixed window (2× a cota na virada de janela).

**Extração de IP:** `CF-Connecting-IP` (header Cloudflare, não forjável) → fallback `X-Forwarded-For`.

| Rota | Limite | Janela | Caso de uso |
|------|--------|--------|-------------|
| `/api/auth/*` | 5 req | 15 min | Anti brute-force de credenciais |
| `/api/totp/*`, `/api/ssa/*`, `/api/biometric/*` | 20 req | 1 min | Operações sensíveis |
| Demais `/api/*` | 120 req | 1 min | API geral |

**Headers em toda resposta `/api/*`:**
- `X-RateLimit-Limit` — cota máxima
- `X-RateLimit-Remaining` — requisições restantes
- `X-RateLimit-Reset` — timestamp Unix de reset

**Headers em `429`:**
- `Retry-After` — segundos até liberar
- Body: `{ "error": "Too many requests", "retry_after_seconds": N }`

**Limpeza:** A cada 5 min, IPs sem timestamps são removidos da store in-memory.

---

## 8. TOTP — RFC 6238 (Código de Verificação Temporal)

**Arquivo:** `apps/bff/src/routes/totp.ts`
**Biblioteca:** `otplib` v13

### Geração e armazenamento

- Secret: 20 bytes Base32 (160 bits) gerado por `generateSecret({ length: 20 })`
- Armazenado **exclusivamente** em `totp_secrets` (Supabase), com RLS `FOR ALL TO service_role` — zero acesso por clients
- Secret **nunca aparece** em responses, logs ou no cliente

### Geração de código (`GET /api/totp/code`)

```
epochSec = Math.floor(Date.now() / 1000)
secondsRemaining = 30 - (epochSec % 30)
code = generateSync({ secret })   // 6 dígitos, período 30s
Retorna: { code, seconds_remaining, period: 30 }
```

### Validação (`POST /api/totp/validate`)

```
1. Rate limit: failure_count >= 5 AND elapsed < 15min → 429 (bloqueio)
2. verifySync({ secret, token, afterTimeStep: 1 })
   (tolerância ±1 step = ±30s para desincronização de relógio)
3. Anti-replay: token === last_used_token → rejeitar
4. Se válido:
   - failure_count = 0, last_used_token = token, last_validated_at = now()
   - audit_logs: "totp.validado"
5. Se inválido:
   - failure_count++, last_failure_at = now()
   - audit_logs: "totp.falhou"
```

**Protege contra:** brute-force (lockout), replay de código (last_used_token), desincronização de relógio (afterTimeStep).

---

## 9. Row Level Security (RLS) — Supabase

Todas as tabelas críticas têm RLS habilitado. Políticas aplicadas no banco — nenhuma regra de acesso depende exclusivamente do código da aplicação.

### Função helper

```sql
CREATE FUNCTION auth_role() RETURNS role_enum AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;
```

### Políticas por tabela

| Tabela | Operação | Condição |
|--------|----------|----------|
| `profiles` | SELECT | `auth.uid() = id OR auth_role() IN ('admin','master')` |
| `profiles` | INSERT | `auth_role() = 'admin'` |
| `profiles` | UPDATE | Admin irrestrito; usuário só edita o próprio — **não pode alterar `role` nem `registration_status`** (WITH CHECK explícito) |
| `biometric_templates` | ALL | `auth_role() IN ('admin','master')` |
| `material_types` | SELECT | Qualquer autenticado |
| `material_types` | INSERT/UPDATE/DELETE | `auth_role() IN ('admin','master')` |
| `lendings` | SELECT | `military_id = auth.uid() OR auth_role() IN ('admin','master')` |
| `lendings` | INSERT/UPDATE | `auth_role() IN ('admin','master')` |
| `material_requests` | SELECT (militar) | `military_id = auth.uid()` |
| `material_requests` | INSERT (militar) | `auth_role() = 'military' AND NOT EXISTS (pendente/aprovado)` |
| `material_requests` | UPDATE (staff) | `auth_role() IN ('admin','master')` |
| `material_request_items` | SELECT | Via request pai do próprio usuário ou staff |
| `totp_secrets` | ALL | `TO service_role` (exclusivo BFF — zero acesso a usuários) |
| `notifications` | SELECT/UPDATE | `user_id = auth.uid()` |
| `audit_logs` | SELECT | `auth_role() = 'admin'` |
| `push_subscriptions` | SELECT/INSERT/DELETE | `user_id = auth.uid()` (mais `TO service_role` para envio) |

### Imutabilidade do audit_log

```sql
CREATE RULE no_update_audit_logs AS ON UPDATE TO audit_logs DO INSTEAD NOTHING;
CREATE RULE no_delete_audit_logs AS ON DELETE TO audit_logs DO INSTEAD NOTHING;
```

Registros de auditoria **não podem ser alterados ou deletados** nem pelo `service_role`.

### View com security_invoker

```sql
CREATE VIEW material_availability WITH (security_invoker = on) AS ...
```

A view respeita as RLS policies do usuário que a consulta, não do criador — impede bypass de RLS via view.

---

## 10. Auditoria

**Tabela:** `public.audit_logs`
**Arquivo:** `apps/bff/src/middleware/audit.ts` + triggers em migrations

### O que é registrado

| Ação | Trigger | Campos |
|------|---------|--------|
| Login bem-sucedido | BFF auth.ts | `actor_id`, `action: auth.login`, `ip`, `user_agent` |
| Falha de login | BFF auth.ts | `actor_id: null`, `action: auth.login_failed`, `email`, `ip`, `reason` |
| TOTP validado | BFF totp.ts | `actor_id`, `action: totp.validado`, `military_id` |
| TOTP falhou | BFF totp.ts | `actor_id`, `action: totp.falhou`, `attempt_count` |
| SSA solicitado/aprovado/rejeitado/retirado/expirado | Trigger PostgreSQL | Status anterior e novo, IDs envolvidos |
| Arsenal: ajuste/adição aprovado/rejeitado | Trigger PostgreSQL | Tipo, payload, admin_note |
| Biometria identificada/registrada | BFF biometric.ts | `user_id`, `finger_index`, `quality` |
| Push subscribed/unsubscribed | Trigger PostgreSQL | `endpoint_hash: md5(endpoint)` (endpoint real não armazenado) |

### Garantias de imutabilidade

Todas as escritas em `audit_logs` ocorrem via `SECURITY DEFINER` (triggers) ou `service_role` (BFF). As RULE `no_update` e `no_delete` impedem qualquer alteração posterior, mesmo por administradores.

---

## 11. Autenticação no Frontend (Next.js)

**Arquivo:** `apps/web/src/lib/supabase/`

### Cliente browser (`createBrowserClient`)

- Usa `NEXT_PUBLIC_SUPABASE_ANON_KEY` (chave pública, permissões limitadas por RLS)
- Sessão gerenciada via cookies HttpOnly pelo Supabase SSR — não armazenada em `localStorage`
- `AuthListener` em `providers.tsx`: escuta evento `SIGNED_OUT` (disparado quando o refresh token retorna 400) e redireciona para `/login` imediatamente

### Cliente server (`createServerClient`)

- Mesmo `ANON_KEY` (nunca expõe `SERVICE_ROLE_KEY` ao edge)
- Cookie jar gerenciado pelo Next.js (`getAll` / `setAll`)
- Usado em Server Components e Route Handlers para verificação SSR

### Fluxo de callback PKCE (`/auth/callback/route.ts`)

```
GET /auth/callback?code=xxx&next=/xyz
1. exchangeCodeForSession(code) — troca authorization code por tokens
2. Busca role: SELECT role, registration_status FROM profiles
3. Redireciona por role:
   admin   → /admin
   master  → /reserva
   usuario → /cadete
4. Fallback: /auth/error
```

### Fluxo de magic link implicit (`/auth/exchange/page.tsx`)

Usado **exclusivamente** pelo harness de testes E2E (admin.generateLink → implicit flow com hash tokens). Não exposto para usuários reais.

```
1. Lê hash da URL: window.location.hash → { access_token, refresh_token }
2. supabase.auth.setSession({ access_token, refresh_token })
3. Busca role → redireciona por role
```

---

## 12. CORS — BFF

**Arquivo:** `apps/bff/src/index.ts`

**Whitelist de origens permitidas:**

```
process.env.WEB_URL ?? "http://localhost:3000"
"https://apmcb.pages.dev"
"https://apmcb.pmpb.online"
+ process.env.CORS_ORIGINS (CSV de origens extras)
```

**Configuração:** `credentials: true` (permite envio de cookies entre origens listadas).

Origens não listadas → browser bloqueia a response automaticamente.

---

## 13. Headers de Segurança do BFF

**Arquivo:** `apps/bff/src/index.ts`

`secureHeaders()` (middleware Hono) adiciona automaticamente:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Strict-Transport-Security` (produção)

**Body limit:** `bodyLimit({ maxSize: 2 * 1024 * 1024 })` = 2 MB em todas as rotas `/api/*`.

**Push broadcast interno (`GET /api/push/broadcast`):**

```
Verifica header: "x-internal-secret" === process.env.INTERNAL_API_SECRET
Sem header: 403 Forbidden
```

---

## 14. SSA — Proteções Específicas

**Arquivo:** `apps/bff/src/routes/ssa.ts`

| Vetor | Proteção |
|-------|----------|
| Múltiplas solicitações simultâneas | `NOT EXISTS (pendente OR aprovado)` verificado antes de INSERT |
| TOTP forjado na solicitação | `verifySync` + anti-replay (`last_used_token`) |
| Race condition approve | Re-check de disponibilidade no momento da aprovação (TOCTOU) |
| Entrega após expiração | `expires_at < now()` verificado em `/deliver` → 409 |
| Tampering de nome do material | Snapshot imutável `material_nome_snapshot` + `material_categoria_snapshot` criados no momento da solicitação |
| Exposição de estoque total | `GET /api/ssa/available-materials` retorna apenas `{ id, nome, categoria, disponivel: true }` — sem quantidades |

---

## 15. Dependências de Segurança

**Arquivo:** `apps/bff/package.json`

| Pacote | Versão | Propósito |
|--------|--------|-----------|
| `iron-session` | ^8.0.4 | Sessão criptografada (AES-256-CBC) em cookie |
| `zod` | ^3.24.0 | Validação e sanitização de schemas de entrada |
| `@hono/zod-validator` | ^0.4.0 | Integração Zod automática nos handlers |
| `otplib` | ^13.4.1 | TOTP RFC 6238 (geração + validação) |
| `web-push` | ^3.6.7 | Web Push VAPID (RFC 8292) |
| `@supabase/supabase-js` | ^2.49.0 | Client com RLS enforcement no banco |

---

## 16. Infraestrutura

| Componente | Detalhe |
|-----------|---------|
| **CF Pages (frontend)** | Edge network Cloudflare — sem servidor próprio para atacar |
| **Hetzner VPS (BFF)** | Container Docker, processo não-root (uid=1001), porta 3001 bind em `127.0.0.1` apenas |
| **Nginx** | TLS termination + reverse proxy; porta 3001 nunca exposta diretamente |
| **Supabase** | Instância gerenciada — auth, DB, storage, Realtime |
| **SSH** | Chave `apmcb_hetzner` ED25519, sem autenticação por senha |
| **Secrets** | Nunca em disco ou repositório: `SESSION_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `TURNSTILE_SECRET_KEY`, `VAPID_PRIVATE_KEY`, `INTERNAL_API_SECRET` |

---

## 17. Exposição de API Keys

| Chave | Onde | Exposta no client? |
|-------|------|--------------------|
| `SUPABASE_SERVICE_ROLE_KEY` | BFF `.env` e CF Pages server-only | **Não** |
| `SUPABASE_ANON_KEY` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Sim, intencional** — chave pública, protegida por RLS |
| `SUPABASE_URL` | `NEXT_PUBLIC_SUPABASE_URL` | **Sim, intencional** — URL pública |
| `SESSION_SECRET` | BFF `.env` apenas | **Não** |
| `INTERNAL_API_SECRET` | BFF `.env` apenas | **Não** |
| `TURNSTILE_SECRET_KEY` | Cloudflare Worker env var (stdin, nunca em disco) | **Não** |
| `TURNSTILE_SITEKEY` | `NEXT_PUBLIC_TURNSTILE_SITEKEY` | **Sim, intencional** — chave pública por design |
| `VAPID_PRIVATE_KEY` | BFF `.env` apenas | **Não** |
| `VAPID_PUBLIC_KEY` | `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | **Sim, intencional** — enviado ao browser para subscription |

**ReactQueryDevtools:** Desabilitado em produção — renderizado apenas quando `NODE_ENV === "development"`.

---

## 18. Mapeamento de Vetores de Ataque

| Vetor | Mitigação | Onde |
|-------|-----------|------|
| Brute-force de login | Rate limit 5/15min por IP + bcrypt Supabase | `rateLimitAuth` |
| Session hijacking | `httpOnly=true`, `secure=true`, `sameSite=strict` | iron-session options |
| CSRF | Double-submit token (cookie + header) | `csrfMiddleware` |
| XSS | CSP `default-src 'self'` + `connect-src` whitelist | Next.js `middleware.ts` |
| Clickjacking | `frame-ancestors 'none'` + `X-Frame-Options: DENY` | Next.js + BFF headers |
| TOTP replay | `last_used_token` armazenado e verificado | `totp.ts` |
| TOTP brute-force | Lockout após 5 falhas / 15 min | `totp.ts` |
| TOTP clock skew | `afterTimeStep: 1` (tolerância ±30s) | `totp.ts` |
| Escalação de role | RLS `WITH CHECK` em `profiles.update` | `security_hardening.sql` |
| Enumeração de usuários | Resposta genérica "Credenciais inválidas" | `auth.ts` |
| Acesso não autorizado | `roleGuard` + RLS dupla camada | `role-guard.ts` + Supabase |
| Material double-request | Verificação `NOT EXISTS (pendente/aprovado)` | `ssa.ts` |
| TOCTOU em aprovação | Re-check de disponibilidade no approve | `ssa.ts` |
| Material tampering | Snapshot imutável de nome/categoria | `ssa.ts` |
| Exposição de estoque | Response sem quantidades para militares | `ssa.ts` |
| Secret TOTP exposure | RLS `service_role only` + nunca em response | `totp_secrets` + `totp.ts` |
| Audit bypass | Triggers imutáveis + RULE no PostgreSQL | migrations |
| Cross-origin data theft | CORS whitelist + `credentials: true` | `index.ts` |
| Upload de payload gigante | `bodyLimit(2MB)` | `index.ts` |
| Bot no login | Cloudflare Turnstile invisible + Worker | `login/page.tsx` + Worker |
| Push não autorizado | `x-internal-secret` header obrigatório | `index.ts` |
| Dead push subscriptions | Cleanup automático de endpoints `410 Gone` | push handler |
| View bypass de RLS | `security_invoker = on` na view | `view_security.sql` |
| Container privilege escalation | Processo non-root uid=1001 | Docker config |
| Porta BFF exposta | Bind em `127.0.0.1` + nginx reverse proxy | Infra |

---

## 19. Localização dos Dados — Supabase São Paulo

**Região:** `sa-east-1` — AWS São Paulo, Brasil

Todos os dados de usuários armazenados no Supabase (banco de dados PostgreSQL, Storage e Auth) residem **exclusivamente em data centers da AWS na região sa-east-1 (São Paulo, SP, Brasil)**. Isso inclui:

| Dado | Onde fica | Região |
|------|-----------|--------|
| Perfis de militares (`profiles`) | Supabase PostgreSQL | sa-east-1 (São Paulo) |
| Tokens de autenticação (Supabase Auth) | Supabase Auth service | sa-east-1 (São Paulo) |
| Fotos e documentos (Storage) | Supabase Storage / S3 | sa-east-1 (São Paulo) |
| Biometria (`biometric_templates`) | Supabase PostgreSQL | sa-east-1 (São Paulo) |
| Secrets TOTP (`totp_secrets`) | Supabase PostgreSQL | sa-east-1 (São Paulo) |
| Logs de auditoria (`audit_logs`) | Supabase PostgreSQL | sa-east-1 (São Paulo) |
| Notificações (`notifications`) | Supabase PostgreSQL | sa-east-1 (São Paulo) |

**Conformidade:** Dados em território nacional atende à Lei Geral de Proteção de Dados (LGPD — Lei 13.709/2018) sem necessidade de cláusulas de transferência internacional.

**Exceções (não armazenam dados de usuários):**
- Cloudflare Pages (CDN/edge): serve apenas assets estáticos — HTML, JS, CSS
- Hetzner VPS (BFF): processa dados em trânsito, sem persistência local
- Cloudflare Workers (Turnstile siteverify): recebe apenas tokens temporários de challenge

---

## 20. Checklist de Segurança

- [x] CSP em todas as respostas HTTP (inclui `challenges.cloudflare.com` para Turnstile)
- [x] Cloudflare Turnstile invisible no login (anti-bot, verificado via Worker)
- [x] Turnstile secret key apenas no Cloudflare Worker (nunca em disco ou repo)
- [x] Iron-session com AES-256-CBC, 8h, httpOnly + secure + sameSite=strict
- [x] CSRF protection em todas as mutations com sessão de browser
- [x] Rate limiting sliding window por rota e por IP
- [x] roleGuard middleware em todos os endpoints privilegiados
- [x] RLS em todas as tabelas críticas (dupla camada com código)
- [x] `totp_secrets` acessível exclusivamente via `service_role`
- [x] Anti-replay TOTP (`last_used_token`)
- [x] Lockout TOTP após 5 falhas / 15 min
- [x] Audit logs imutáveis (RULE no PostgreSQL — sem UPDATE/DELETE)
- [x] Trigger de auditoria para transitions de SSA, arsenal, push
- [x] `security_invoker = on` na view de disponibilidade de material
- [x] Snapshot imutável de nome/categoria em material_request_items
- [x] CORS whitelist no BFF
- [x] Body limit 2MB no BFF
- [x] Service role key nunca no cliente
- [x] VAPID private key nunca no cliente
- [x] Tokens em cookies HttpOnly (não localStorage)
- [x] AuthListener: redireciona para login ao expirar sessão
- [x] Nginx TLS + reverse proxy (porta 3001 não exposta)
- [x] Container non-root (uid=1001)
- [x] ReactQueryDevtools desabilitado em produção
- [x] SSH por chave ED25519 (sem senha)
