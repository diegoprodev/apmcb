# Spec: Security Audit Phase 2 — Achados Pendentes

> **Para agentes:** implementar task-by-task seguindo os checkboxes abaixo.
> Cada grupo é independente e pode ser paralelizado por sessão.
> DoD canônica: `docs/enterprise/07-canonical-definition-of-done.md`
> Princípios: SRP · DRY · SSOT · KISS · YAGNI · SoC · Fail Fast · Least Surprise

**Status:** 🔴 Pendente  
**Origem:** Auditoria global `2026-06-29` — achados não corrigidos na Fase 1

---

## Priorização

| ID | Achado | Prioridade | Esforço estimado |
|----|--------|-----------|-----------------|
| C3 | TOTP secrets em TEXT puro | CRÍTICO | ~3h |
| A1 | CSRF cookie `httpOnly: false` | ALTO | ~2h |
| M8 | `sessions_invalidated_at` não verificado no BFF | ALTO | ~1h |
| M6 | Domínios/email hardcoded no BFF | MÉDIO | ~30min |
| M4 | Triggers duplicados em `material_items` | MÉDIO | ~1h |
| M1 | Rate limit in-memory (não distribuído) | MÉDIO | ~2h |
| M2 | E2E contra produção | MÉDIO | ~1h |
| M3 | CI/CD sem rollback | MÉDIO | ~1h |
| B3 | Sem endpoints GDPR | BAIXO | Sprint longa |
| B4 | Sem política de re-enrollment biométrico | BAIXO | Sprint longa |

---

## Grupo 1 — CRÍTICO: C3 · TOTP Secrets em TEXT

### Contexto

`totp_secrets.secret` armazena o seed TOTP em TEXT puro. Se o banco vazar (backup,
dump, SQL injection via service_role), todo o 2FA do sistema está comprometido
instantaneamente — sem segunda camada de proteção.

### Estratégia

Usar `pgcrypto` + chave de aplicação (env var no BFF) para encriptar o secret antes
de gravar e decriptar antes de usar. A chave **nunca** vai ao banco — só ao BFF.

### Tarefas

- [ ] **1.1** — Verificar se `pgcrypto` já está habilitada no projeto Supabase
  ```sql
  SELECT * FROM pg_extension WHERE extname = 'pgcrypto';
  ```

- [ ] **1.2** — Criar migration `YYYYMMDD_totp_secrets_encrypt.sql`
  ```sql
  -- Habilitar pgcrypto se ausente
  CREATE EXTENSION IF NOT EXISTS pgcrypto;

  -- Adicionar coluna encriptada ao lado da coluna TEXT
  ALTER TABLE totp_secrets ADD COLUMN IF NOT EXISTS secret_enc BYTEA;

  -- Encriptar secrets existentes (chave fornecida via parâmetro de sessão)
  -- NOTA: executar com SET app.encryption_key = '<chave>' na mesma sessão
  UPDATE totp_secrets
  SET secret_enc = pgp_sym_encrypt(secret, current_setting('app.encryption_key'))
  WHERE secret IS NOT NULL AND secret_enc IS NULL;

  -- Após validar, tornar secret_enc NOT NULL e remover secret plaintext
  -- (em migration separada após confirmar dados migrados)
  ```

- [ ] **1.3** — Adicionar `TOTP_ENCRYPTION_KEY` ao `.env` do BFF e ao CF Pages secrets
  - Gerar: `openssl rand -base64 32`
  - Jamais commitar — apenas env var em runtime

- [ ] **1.4** — Atualizar `apps/bff/src/routes/totp.ts`:
  - **Gravar secret:** antes de INSERT, chamar `pgp_sym_encrypt(secret, key)` via RPC ou query raw
  - **Ler secret:** antes de verificar OTP, chamar `pgp_sym_decrypt(secret_enc, key)` e usar o resultado
  - Remover referência à coluna `secret` (TEXT) das queries

- [ ] **1.5** — Migration de remoção da coluna plaintext
  ```sql
  ALTER TABLE totp_secrets DROP COLUMN IF EXISTS secret;
  ALTER TABLE totp_secrets RENAME COLUMN secret_enc TO secret;
  ALTER TABLE totp_secrets ALTER COLUMN secret SET NOT NULL;
  ```

- [ ] **1.6** — Testes: `pnpm test apps/bff/src/__tests__/totp-guard.test.ts` deve passar

- [ ] **1.7** — Validação manual: fluxo de login com TOTP (nexus) funciona end-to-end

---

## Grupo 2 — ALTO: A1 · CSRF Cookie `httpOnly: false`

### Contexto

`apps/bff/src/routes/auth.ts` define o cookie CSRF com `httpOnly: false` para que o
frontend leia via `document.cookie` e envie em headers. Isso expõe o token a XSS.

### Estratégia

**Double Submit Cookie** com `SameSite=Strict` — o token CSRF continua sendo um cookie,
mas o frontend lê uma cópia dele devolvida no **body** do login/exchange (não pelo cookie),
armazena em memória (não em localStorage), e envia como header `X-CSRF-Token`.
O BFF compara o header com o cookie. Se XSS roubar o cookie não-httpOnly, o ataque
só funcionaria de dentro do mesmo site (SameSite=Strict já bloqueia cross-site).

**Solução melhorada:** Tornar o CSRF cookie `httpOnly: true` e retornar o token no **body**
da resposta de login/exchange. O frontend usa o token do body (em memória), nunca mais
lê `document.cookie`.

### Tarefas

- [ ] **2.1** — `apps/bff/src/routes/auth.ts` — alterar `setCookie` do csrf-token:
  ```typescript
  // ANTES
  setCookie(c, "csrf-token", csrfToken, {
    httpOnly: false,  // ← vulnerável
    ...
  });

  // DEPOIS: httpOnly true + retornar token no body
  setCookie(c, "csrf-token", csrfToken, {
    httpOnly: true,   // ← browser não expõe via document.cookie
    sameSite: "Strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24,
    domain: process.env.COOKIE_DOMAIN ?? undefined,
  });
  ```

- [ ] **2.2** — `apps/bff/src/routes/auth.ts` — incluir `csrfToken` no body das respostas:
  - `POST /api/auth/login` → adicionar `csrfToken` ao JSON retornado
  - `POST /api/auth/exchange` → adicionar `csrfToken` ao JSON retornado

- [ ] **2.3** — `apps/web/src/app/login/page.tsx` — capturar `csrfToken` do body de `/api/auth/exchange`:
  ```typescript
  const exchangeData = await exchangeRes.json() as AuthExchangeResponse;
  // Armazenar em memória (não localStorage)
  if (exchangeData.csrfToken) {
    sessionStorage.setItem("csrf-token", exchangeData.csrfToken);
  }
  router.replace(exchangeData.landAt ?? "/");
  ```

- [ ] **2.4** — Criar/atualizar hook `useCsrf` em `apps/web/src/hooks/use-csrf.ts`:
  ```typescript
  export function getCsrfToken(): string {
    return sessionStorage.getItem("csrf-token") ?? "";
  }
  ```

- [ ] **2.5** — Atualizar todos os fetch ao BFF que usam `document.cookie` para ler csrf-token,
  substituindo por `getCsrfToken()`.
  - Buscar: `grep -r "csrf" apps/web/src`

- [ ] **2.6** — `apps/bff/src/middleware/csrf.ts` — o middleware já lê do header `X-CSRF-Token`,
  não precisa mudar. Verificar que o cookie `csrf-token` httpOnly=true ainda é comparado corretamente.

- [ ] **2.7** — Testar login → ação autenticada → validar que `X-CSRF-Token` chega no BFF

---

## Grupo 3 — ALTO: M8 · `sessions_invalidated_at` Não Verificado

### Contexto

`profiles.sessions_invalidated_at` existe no banco mas o middleware BFF nunca verifica.
Um admin que revogar o acesso de outro usuário não tem efeito imediato — a sessão
continua válida até expirar (8h).

### Status

⚠️ **Parcialmente implementado** — `/api/auth/me` já verifica. O middleware principal
`apps/bff/src/middleware/auth.ts` NÃO verifica.

### Tarefas

- [ ] **3.1** — `apps/bff/src/middleware/auth.ts` — adicionar verificação pós-carga de sessão:
  ```typescript
  // Após ler a sessão e confirmar session.userId:
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, sessions_invalidated_at")
    .eq("id", session.userId)
    .single();

  if (profile) {
    // Role mudou → forçar re-login
    if (profile.role !== session.role) {
      session.destroy();
      return c.json({ error: "Sessão revogada — role alterada" }, 401);
    }

    // Sessão explicitamente invalidada por admin
    const invalidatedAt = profile.sessions_invalidated_at
      ? new Date(profile.sessions_invalidated_at).getTime()
      : null;
    if (invalidatedAt && session.issuedAt && session.issuedAt < invalidatedAt) {
      session.destroy();
      return c.json({ error: "Sessão revogada" }, 401);
    }
  }
  ```

- [ ] **3.2** — Adicionar cache TTL de 60s para evitar query no Supabase em TODA request:
  ```typescript
  // Em memória por instância — válido para single-container
  // Para multi-réplica, use Redis (ver M1)
  const sessionCache = new Map<string, { role: string; invalidatedAt: number | null; checkedAt: number }>();
  const CACHE_TTL_MS = 60_000;

  function getCachedProfile(userId: string) { ... }
  function setCachedProfile(userId: string, data: { role, invalidatedAt }) { ... }
  ```

- [ ] **3.3** — Teste: invalidar sessão via SQL → request subsequente deve retornar 401 em até 60s

---

## Grupo 4 — MÉDIO: M6 · Domínios/Email Hardcoded

### Contexto

`apps/bff/src/index.ts` tem `"https://apmcb.pages.dev"` e `"https://apmcb.pmpb.online"`
hardcoded no array de CORS. `apps/bff/src/routes/push.ts` tem email de admin hardcoded
no VAPID subject.

### Tarefas

- [ ] **4.1** — `apps/bff/src/index.ts` — CORS já lê `CORS_ORIGINS` env var mas o fallback
  ainda tem hardcoded. Mover para env var obrigatória com fallback apenas em dev:
  ```typescript
  const defaultOrigins = process.env.NODE_ENV === "production"
    ? []  // produção DEVE ter CORS_ORIGINS setado
    : ["http://localhost:3000"];

  if (process.env.NODE_ENV === "production" && !process.env.CORS_ORIGINS) {
    throw new Error("CORS_ORIGINS obrigatório em produção");
  }
  ```

- [ ] **4.2** — `apps/bff/src/routes/push.ts` — substituir email hardcoded:
  ```typescript
  // ANTES
  subject: process.env.VAPID_SUBJECT ?? "mailto:admin@apmcb.pmpb.online"

  // DEPOIS
  subject: process.env.VAPID_SUBJECT  // obrigatório — sem fallback em produção
  ```
  Adicionar guard no startup: `if (!process.env.VAPID_SUBJECT) throw new Error(...)`

- [ ] **4.3** — Atualizar `.env.example` com os novos env vars obrigatórios

- [ ] **4.4** — Adicionar ao `CORS_ORIGINS` no BFF `.env` do Hetzner os dois domínios

---

## Grupo 5 — MÉDIO: M4 · Triggers Duplicados

### Contexto

`fn_validate_item_transition()` em `20260620000001b_material_items.sql` e
`_validate_item_possession()` em `20260620000005b_cautelamentos.sql` têm
lógica quase idêntica em triggers separados na mesma tabela `material_items`.
Viola DRY; risco de drift entre as validações.

### Tarefas

- [ ] **5.1** — Comparar as duas funções lado a lado:
  ```sql
  SELECT routine_name, routine_definition
  FROM information_schema.routines
  WHERE routine_name IN ('fn_validate_item_transition', '_validate_item_possession');
  ```

- [ ] **5.2** — Criar migration `YYYYMMDD_consolidate_item_triggers.sql`:
  - Remover trigger `_validate_item_possession` (manter `fn_validate_item_transition`)
  - Incorporar qualquer lógica única de `_validate_item_possession` em `fn_validate_item_transition`
  - Garantir que a função unificada cobre todos os casos de ambas

- [ ] **5.3** — Rodar suite de cautelamentos E2E para validar: `pnpm test:e2e --grep "CT"`

---

## Grupo 6 — MÉDIO: M1 · Rate Limit In-Memory

### Contexto

`apps/bff/src/middleware/rate-limit.ts` usa `Map` em memória. Com múltiplas réplicas
Docker, cada instância tem seu próprio contador — permite bypass por round-robin.

### Decisão de design

Para o volume atual (single-container VPS), o risco é baixo. A solução distribuída exige
Redis, que adiciona infra e custo. **Recomendação: implementar apenas se o BFF escalar
para 2+ réplicas.** Por ora, adicionar comentário explícito e criar issue no backlog.

### Tarefas

- [ ] **6.1** — `apps/bff/src/middleware/rate-limit.ts` — adicionar comentário de limitação:
  ```typescript
  // LIMITAÇÃO: contador em memória — não distribuído entre réplicas.
  // Para multi-réplica, substituir Map por Redis (ioredis + sliding window).
  // Issue: #XXX — migrar para Redis ao escalar para 2+ instâncias.
  ```

- [ ] **6.2** — Se Redis for viável nesta sprint:
  - Adicionar `ioredis` ao BFF
  - Implementar sliding window counter: `INCR key / EXPIRE key 60`
  - Adicionar `REDIS_URL` ao `.env`

---

## Grupo 7 — MÉDIO: M2 · E2E Contra Produção

### Contexto

`apps/web/.env.test` / `ci-cd.yml` aponta para `https://apmcb.pmpb.online`.
Testes podem criar/alterar dados reais e afetar operação em produção.

### Tarefas

- [ ] **7.1** — Criar `apps/web/.env.test.local` (gitignored) e `apps/web/.env.test.ci`:
  ```bash
  # .env.test.ci — aponta para staging
  PLAYWRIGHT_BASE_URL=https://staging.apmcb.pmpb.online
  NEXT_PUBLIC_BFF_URL=https://api-staging.apmcb.pmpb.online
  ```

- [ ] **7.2** — Opção pragmática (sem infraestrutura extra): usar usuários de teste dedicados
  com dados isolados (prefixo `[TEST]`) e cleanup automático pós-suite:
  ```typescript
  // playwright/global-teardown.ts
  // Limpar dados criados por testes: DELETE WHERE nome_de_guerra LIKE '[TEST]%'
  ```

- [ ] **7.3** — `ci-cd.yml` — parametrizar URL via secret `E2E_BASE_URL` em vez de hardcoded

---

## Grupo 8 — MÉDIO: M3 · CI/CD Sem Rollback

### Contexto

Deploy atual: `docker rm -f apmcb-bff && docker compose up -d`. Se a nova imagem
falhar, o container antigo já foi destruído. Sem restore automático.

### Tarefas

- [ ] **8.1** — `ci-cd.yml` — adicionar estratégia blue/green simples:
  ```bash
  # Tag imagem nova com timestamp
  NEW_IMAGE="apmcb-bff:$(date +%Y%m%d%H%M%S)"
  docker build -t $NEW_IMAGE apps/bff/

  # Guardar ID do container atual antes de trocar
  OLD_CONTAINER=$(docker ps -q -f name=apmcb-bff)

  # Subir novo container com nome temporário
  docker run -d --name apmcb-bff-new ... $NEW_IMAGE

  # Health check
  sleep 5
  if curl -sf http://localhost:3001/health; then
    # OK: remover antigo, renomear novo
    docker rm -f $OLD_CONTAINER
    docker rename apmcb-bff-new apmcb-bff
  else
    # FALHA: reverter
    docker rm -f apmcb-bff-new
    echo "Deploy falhou — container antigo mantido"
    exit 1
  fi
  ```

- [ ] **8.2** — Manter as últimas 2 imagens Docker tagged para rollback manual

---

## Grupo 9 — BAIXO: B3 · Endpoints GDPR

### Contexto

Sem direito de apagamento (`DELETE /api/me`) ou exportação de dados pessoais.
Risco legal para uso em órgãos públicos.

### Tarefas

- [ ] **9.1** — `apps/bff/src/routes/usuario.ts` — criar `DELETE /api/usuario/me`:
  - Requer confirmação de senha ou TOTP antes de aceitar
  - Anonimizar: `UPDATE profiles SET nome_completo = 'REMOVIDO', email = uuid() || '@deleted'`
  - Revogar sessões: `UPDATE profiles SET sessions_invalidated_at = NOW()`
  - **NÃO deletar** `audit_logs` — manter para compliance, anonimizar apenas dados PII

- [ ] **9.2** — `apps/bff/src/routes/usuario.ts` — criar `GET /api/usuario/me/export`:
  - Retornar JSON com todos os dados pessoais do usuário autenticado
  - Incluir: perfil, cautelas, solicitações, biometria (hash apenas, não template)

- [ ] **9.3** — Frontend: botão "Exportar meus dados" e "Excluir minha conta" na página `/perfil`

---

## Grupo 10 — BAIXO: B4 · Biometric Re-enrollment Policy

### Contexto

Templates biométricos não têm prazo de expiração. Template comprometido fica válido
indefinidamente sem mecanismo de re-matrícula.

### Tarefas

- [ ] **10.1** — Migration: adicionar `expires_at` em `biometric_templates`:
  ```sql
  ALTER TABLE biometric_templates ADD COLUMN IF NOT EXISTS
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '2 years');
  -- Atualizar templates existentes
  UPDATE biometric_templates SET expires_at = created_at + INTERVAL '2 years'
  WHERE expires_at IS NULL;
  ```

- [ ] **10.2** — BFF: validar `expires_at` ao verificar biometria — rejeitar se expirada

- [ ] **10.3** — Notificação proativa: 30 dias antes de expirar, notificar armeiro responsável

- [ ] **10.4** — Frontend: exibir status de expiração na página de gestão biométrica

---

## Validação Final (após todos os grupos)

- [ ] `pnpm typecheck` — 0 erros (web + bff)
- [ ] `pnpm --filter web build` — build limpo
- [ ] `cd apps/web && pnpm test:e2e` — 0 novos falhos vs baseline
- [ ] Health check BFF: `curl https://api.apmcb.pmpb.online/health`
- [ ] Login funciona end-to-end (incluindo TOTP para nexus)
- [ ] Smoke test: emitir cautela, verificar audit_log, verificar TOTP login

---

## Ordem de Execução Recomendada

```
Sessão 1: M8 (30min) → M6 (30min) → M4 (1h) [risco baixo, alto impacto]
Sessão 2: A1 (2h) [refatoração CSRF — testar bem antes de push]
Sessão 3: C3 (3h) [TOTP encryption — requer env var no VPS]
Sessão 4: M3 (1h) → M2 (1h) [CI/CD hardening]
Sessão 5: M1 (2h) [se escalar para múltiplas réplicas]
Backlog:  B3 · B4 [próxima sprint]
```
