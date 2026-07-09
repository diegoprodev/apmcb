# Enterprise Spec — Observabilidade de Logs (BFF-first)

> **Para agentes:** implementar fase-by-fase seguindo os checkboxes abaixo.
> Cada fase é pequena, commitável e independente das seguintes — nunca pular a Fase A.
> DoD canônica: `docs/enterprise/07-canonical-definition-of-done.md`
> Princípios: SRP · DRY · SSOT · KISS · YAGNI · SoC · Fail Fast · Least Surprise

**Status:** 🔴 Pendente
**Data:** 2026-07-08
**Fase:** Observability & Logging Enterprise
**Escopo primário:** `apps/bff` (Hono/Bun, VPS Hetzner) — frontend só na propagação do `X-Request-Id`

---

## 1. Objetivo e Escopo

Logging estruturado JSON **ponta a ponta no BFF**, com correlação de requisições
(requestId), níveis padronizados, eventos nomeados, data masking automático e
retention definida no VPS.

**Dentro do escopo:**
- Substituir `apps/bff/src/lib/logger.ts` (11 linhas, sem redaction) por logger Pino com redact paths
- Middleware `requestId` — UUID por request, propagado via header `X-Request-Id` em request e response
- Propagação do header no frontend via `apps/web/src/lib/bff-client.ts` (`bffFetch`)
- Convenção de eventos nomeados (`totp.validate.failure`, `auth.login.success`, ...)
- Eliminação de `console.*` nas rotas críticas (saidas, admin, audit, zkteco)
- Hardening do `app.onError` (stack no log, nunca no body; requestId como código de suporte)
- Rotação/retention dos logs do container `apmcb-bff` no VPS
- (Opcional, Fase G) Agregação com Grafana Cloud/Loki — com análise custo/benefício honesta

**Fora do escopo (YAGNI):**
- Tracing distribuído OpenTelemetry completo — o BFF é um único serviço; requestId já entrega ~90% do valor de correlação
- Logging estruturado no frontend Next.js (edge runtime CF Pages já tem logs próprios no dashboard CF)
- Métricas (Prometheus) — spec separada quando houver SLO formal

**Restrição inegociável (CLAUDE.md + DoD G08/REP10):** logs NUNCA podem conter
tokens TOTP, secrets, senhas, cookies de sessão (`apmcb_session`, `sb-*`),
`Authorization` header, CSRF token, template biométrico (`template_data`) ou
PII crua (matrícula completa, nome completo). Violação = REP10 = fase REPROVADA.

---

## 2. Diagnóstico do Estado Atual

### 2.1 Logger incipiente — `apps/bff/src/lib/logger.ts`

O arquivo inteiro (11 linhas) é um wrapper de `console.*` com `JSON.stringify`:

```typescript
export const logger = {
  info: (msg: string, data?: Record<string, unknown>) => {
    console.log(JSON.stringify({ level: "info", msg, ...data, ts: new Date().toISOString() }));
  },
  // error, warn idênticos
};
```

**Problemas:**
| # | Problema | Consequência |
|---|----------|--------------|
| P1 | Zero redaction — `...data` vai verbatim ao stdout | Se um caller passar `{ secret }` ou `{ token }`, vaza (REP10) |
| P2 | Sem `debug`/`fatal`, sem `LOG_LEVEL` | Impossível baixar verbosidade em produção ou subir em investigação |
| P3 | Sem child loggers | Impossível anexar `requestId` sem repetir em toda chamada (viola DRY) |
| P4 | `...data` pode sobrescrever `level`/`msg`/`ts` (spread depois das chaves fixas — `ts` sobrevive, `level`/`msg` não) | Linha de log corrompida silenciosamente |
| P5 | `JSON.stringify` lança em objeto circular | Um log pode derrubar o handler (sem try/catch) |

### 2.2 Uso atual do logger

Só **4 call sites** usam o logger estruturado — todos em `apps/bff/src/index.ts`:
- `index.ts:185` — `structuredLogger.warn("http_exception", ...)` no `onError`
- `index.ts:188` — `structuredLogger.error("unhandled_error", ...)` no `onError`
- `index.ts:193` — `structuredLogger.info("bff_start", ...)`

Além disso, `index.ts:39` usa `app.use("*", logger())` do **hono/logger** — que emite
linhas de **texto puro** (`<-- GET /api/... 200 12ms`), quebrando o formato JSON do
stream: metade dos logs é NDJSON, metade é texto. Nenhuma linha tem requestId.

### 2.3 Débito `console.*` (grep executado em 2026-07-08)

**`apps/bff/src` — 14 ocorrências** (excluindo `__tests__`):

| Arquivo | Linhas | Conteúdo | Risco |
|---------|--------|----------|-------|
| `apps/bff/src/lib/logger.ts` | 3, 6, 9 | O próprio wrapper | OK — será substituído (Fase A) |
| `apps/bff/src/middleware/audit.ts` | 100, 108 | Fallback `audit_insert_failed`/`audit_exception` com `JSON.stringify` manual | Duplica o logger (viola DRY); sem requestId |
| `apps/bff/src/routes/admin.ts` | 462 | `console.error("[invite] supabase error:", ...)` | Texto puro, sem estrutura |
| `apps/bff/src/routes/saidas.ts` | 300, 309, 370, 379 | `[sign-armeiro]`/`[confirm]` doc_sig insert/update errors | Rota crítica de assinatura — texto puro |
| `apps/bff/src/services/fingerprint/zkteco.ts` | 23, 28, 41, 55 | Stubs `[ZKTeco]` | Baixo (stub), mas quebra o gate |

**`apps/web/src` — 2 ocorrências:**
- `apps/web/src/app/api/auth/activate-account/route.ts` (1)
- `apps/web/src/app/api/admin/users/route.ts` (1)

### 2.4 Infra de logs no VPS — risco real de disco

- Deploy: container Docker `apmcb-bff` via `docker compose` (ver `.github/workflows/ci-cd.yml:91-141`), atrás de nginx host
- `docker-compose.yml` e `docker-compose.prod.yml` **não têm bloco `logging:`** → driver default `json-file` **sem limite** em `/var/lib/docker/containers/<id>/*-json.log` → crescimento indefinido até encher o disco do VPS
- O volume `bff_logs:/app/logs` declarado em ambos os compose files é **configuração morta** — nada em `apps/bff/src` escreve em `/app/logs` (grep confirma)
- Healthcheck `wget /health` a cada 30s = ~2.880 linhas de access log/dia de puro ruído se logado

### 2.5 O que já está certo (não mexer sem motivo)

- `app.onError` (`index.ts:175-190`) já retorna body sanitizado (`{ error: "Internal server error" }`, sem stack) e propaga CORS — a Fase E só **enriquece** (requestId + stack no log)
- `audit_events` com hash-chain (`apps/bff/src/lib/audit-hash.ts` + `middleware/audit.ts`) é a trilha de **auditoria** imutável — logs desta spec são trilha **operacional**. Não confundir nem fundir (SoC): auditoria responde "quem fez o quê"; logs respondem "o que o sistema fez e por quê falhou"

---

## 3. Decisões de Arquitetura

### 3.1 Por que Pino

| Critério | Pino v9 | Alternativas |
|----------|---------|--------------|
| Redaction nativa | `redact.paths` com censura configurável — elimina P1 por design | winston: precisa formatter custom; consola: não tem |
| Child loggers | `logger.child({ requestId })` — requestId em toda linha sem repetição | manual: viola DRY |
| Performance | Serialização otimizada, ~5x mais rápido que `JSON.stringify` manual | irrelevante no volume atual, mas grátis |
| Formato | NDJSON puro no stdout — exatamente o que `docker logs`/journald/Loki consomem | — |
| Compat Bun | Core do pino funciona em Bun (produção) e em Node (testes rodam via `node --experimental-strip-types --test`, ver `apps/bff/package.json` script `test`) | — |

**⚠️ Caveat Bun (obrigatório respeitar):** *transports* do pino (`pino.transport`,
`pino-pretty` como transport) usam `thread-stream`/worker threads — historicamente
instáveis em Bun. **Regra: pino sem transport, NDJSON síncrono para stdout.**
Em dev, pretty-print via pipe externo: `bun run dev | npx pino-pretty`.

**⚠️ Limite do redact do pino (honestidade técnica):** paths suportam apenas um
wildcard por segmento (`*.secret`, `req.headers.*`), **não** `**` profundo. Defesa
em profundidade obrigatória: (a) redact paths para os campos conhecidos, (b) helpers
`maskMatricula`/`maskNome` no ponto de log para PII, (c) disciplina de payload plano
(logar campos escolhidos, nunca objetos inteiros do Supabase), (d) gate OBS20 de
scan de padrões proibidos.

### 3.2 Convenções de campo (SSOT)

| Campo | Formato | Exemplo |
|-------|---------|---------|
| `level` | string (`debug`\|`info`\|`warn`\|`error`\|`fatal`) — formatter de label, compatível com o formato atual | `"level":"warn"` |
| `time` | ISO 8601 (`pino.stdTimeFunctions.isoTime`) | `"time":"2026-07-08T14:03:22.114Z"` |
| `msg` | evento nomeado `dominio.acao.resultado` (§5) | `"msg":"totp.validate.failure"` |
| `service` | fixo `apmcb-bff` | — |
| `requestId` | UUID v4 de correlação HTTP | — |
| `cf_ray` | header `cf-ray` quando presente — correlação com logs Cloudflare | — |
| `userId`, `tenantId`, `role` | do contexto Hono, quando autenticado | — |
| `duration_ms` | inteiro | — |

**Nota de colisão semântica:** `apps/bff/src/routes/arsenal.ts` usa a variável de
domínio `requestId` (id de `material_requests`, ex. `arsenal.ts:474`) e grava
`metadata.request_id` em audit_events (`arsenal.ts:94,586`). São sinks diferentes
(audit_events vs stdout) — sem conflito de código —, mas ao logar em arsenal.ts
usar `material_request_id` como nome de campo para não ambiguar com a correlação HTTP.

### 3.3 Níveis — semântica canônica

| Nível | Quando usar | Exemplo |
|-------|-------------|---------|
| `debug` | Diagnóstico detalhado; desligado em produção (`LOG_LEVEL=info`) | payload de branch decision |
| `info` | Evento de negócio bem-sucedido, ciclo de vida | `auth.login.success`, `bff.start` |
| `warn` | Falha esperada/recuperável; ação negada | `totp.validate.failure`, `http.exception` (4xx) |
| `error` | Falha inesperada que afetou a request | `saida.sign.persist_failure`, `audit.persist.failure` |
| `fatal` | Processo não pode continuar | falta de env var obrigatória no boot |

`LOG_LEVEL` via env var; default `info` em produção, `debug` em dev.

---

## 4. Fases

### Fase A — Logger estruturado Pino com redaction

**Entregável:** `apps/bff/src/lib/logger.ts` reescrito; API retrocompatível com os
4 call sites de `index.ts` (`logger.info(event, data?)`); redaction ativa.

- [ ] **A.1** — Adicionar dependência: `cd apps/bff && bun add pino` (registrar versão exata no commit)

- [ ] **A.2** — Reescrever `apps/bff/src/lib/logger.ts`:

```typescript
import pino from "pino";

// ─── Redaction (REP10): campos que NUNCA podem aparecer em log ──────────────
// Cobre headers HTTP (Fase C loga req/res) e campos de payload em 1º e 2º nível.
// Pino não suporta wildcard profundo (**) — payloads de log devem ser PLANOS:
// logar campos escolhidos, nunca objetos inteiros vindos do Supabase/request.
const REDACT_PATHS = [
  // Headers (objetos req/res serializados na Fase C)
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  // Segredos e credenciais — 1º e 2º nível
  ...["token", "otp", "secret", "password", "senha",
      "access_token", "refresh_token", "csrfToken",
      "pendingTotpSecret", "template_data", "last_used_token",
      "authorization", "cookie"].flatMap((k) => [k, `*.${k}`]),
];

export const baseLogger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
  base: { service: "apmcb-bff", env: process.env.NODE_ENV ?? "production" },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: { level: (label) => ({ level: label }) }, // "level":"warn" (compat com formato atual)
  redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
  // SEM transport: NDJSON síncrono para stdout (caveat Bun — ver spec §3.1).
});

export type Logger = pino.Logger;

// ─── Masking helpers para PII (usar no ponto de log, nunca logar PII crua) ──
/** "1234567" → "*****67" — mantém 2 últimos dígitos para triagem de suporte */
export function maskMatricula(matricula: string | null | undefined): string {
  if (!matricula) return "";
  return matricula.length <= 2 ? "**" : "*".repeat(matricula.length - 2) + matricula.slice(-2);
}

/** "João da Silva Sauro" → "João S." */
export function maskNome(nome: string | null | undefined): string {
  if (!nome) return "";
  const parts = nome.trim().split(/\s+/);
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

// ─── API retrocompatível (mesma assinatura do logger antigo: msg primeiro) ──
// Mantém os call sites de index.ts:185,188,193 funcionando sem alteração.
export const logger = {
  debug: (msg: string, data?: Record<string, unknown>) => baseLogger.debug(data ?? {}, msg),
  info:  (msg: string, data?: Record<string, unknown>) => baseLogger.info(data ?? {}, msg),
  warn:  (msg: string, data?: Record<string, unknown>) => baseLogger.warn(data ?? {}, msg),
  error: (msg: string, data?: Record<string, unknown>) => baseLogger.error(data ?? {}, msg),
  fatal: (msg: string, data?: Record<string, unknown>) => baseLogger.fatal(data ?? {}, msg),
};
```

- [ ] **A.3** — Unit tests em `apps/bff/src/__tests__/logger.test.ts` (rodam via
  `pnpm test` = `node --experimental-strip-types --test`): capturar stdout com
  destination custom do pino ou `pino(opts, stream)` para stream em memória.
  Cobrir OBS01–OBS07 (§6)

- [ ] **A.4** — `pnpm --filter bff typecheck` — 0 erros; `index.ts` intocado ainda compila

**Commit:** `feat(obs): logger Pino com redaction e masking helpers (Fase A)`

---

### Fase B — Correlação: requestId middleware + propagação frontend

**Entregável:** todo request tem UUID; header `X-Request-Id` no request e response;
child logger com requestId disponível via `c.get("log")`.

- [ ] **B.1** — Estender `apps/bff/src/types/hono.ts` (hoje linhas 3-11):

```typescript
import type { Logger } from "../lib/logger";

export type HonoVariables = {
  userId: string;
  role: Role;
  tenantId: string | null;
  reserveId: string | null;
  originalRole?: Role;
  activeMode?: "usuario";
  nexusAuthorized?: boolean;
  requestId: string;   // novo
  log: Logger;         // novo — child logger com requestId
};
```

- [ ] **B.2** — Criar `apps/bff/src/middleware/request-id.ts`:

```typescript
import type { MiddlewareHandler } from "hono";
import { baseLogger } from "../lib/logger";
import type { HonoVariables } from "../types/hono";

// Aceitar APENAS UUID do cliente — qualquer outro formato é descartado
// (anti log-injection: impede requestId forjado com \n, JSON ou 2KB de lixo).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const requestIdMiddleware: MiddlewareHandler<{ Variables: HonoVariables }> =
  async (c, next) => {
    const incoming = c.req.header("x-request-id");
    const requestId = incoming && UUID_RE.test(incoming) ? incoming : crypto.randomUUID();
    c.set("requestId", requestId);
    c.set("log", baseLogger.child({
      requestId,
      ...(c.req.header("cf-ray") ? { cf_ray: c.req.header("cf-ray") } : {}),
    }));
    c.header("X-Request-Id", requestId);
    await next();
  };
```

- [ ] **B.3** — Registrar em `apps/bff/src/index.ts` como **primeiro** middleware
  (antes do `app.use("*", logger())` da linha 39, que a Fase C substitui):
  `app.use("*", requestIdMiddleware);`

- [ ] **B.4** — Expor o header ao JS do browser — no `cors()` de `index.ts:50-56`
  adicionar `exposeHeaders: ["X-Request-Id"]` (sem isso `res.headers.get(...)` retorna
  `null` cross-origin; `allowHeaders` não precisa mudar — o hono/cors espelha
  `Access-Control-Request-Headers` quando não configurado)

- [ ] **B.5** — Frontend: em `apps/web/src/lib/bffFetch` (`apps/web/src/lib/bff-client.ts:20-48`):

```typescript
const requestId = crypto.randomUUID();
headers.set("X-Request-Id", requestId);
// ... fetch ...
return { ok: res.ok, status: res.status, data,
         requestId: res.headers.get("X-Request-Id") ?? requestId };
```

  Adicionar `requestId: string` à interface `BffResponse` (`bff-client.ts:6-11`).
  Callers de erro podem exibir "Código de suporte: `requestId.slice(0, 8)`" em toasts —
  opcional nesta fase, não obrigatório.

- [ ] **B.6** — Incluir requestId no `onError` (`index.ts:175-190`): trocar os dois
  `structuredLogger.*` para `c.get("log")` (com fallback ao logger base se o
  middleware ainda não rodou) e adicionar `requestId: c.get("requestId")` ao body
  do 500 — é opaco (UUID), não vaza nada, e permite ao usuário reportar o código

- [ ] **B.7** — Testes OBS08–OBS13 (§6); `pnpm typecheck` (web + bff)

**Commit:** `feat(obs): correlação X-Request-Id BFF + bffFetch (Fase B)`

---

### Fase C — Access log estruturado + catálogo de eventos nomeados

**Entregável:** substituir o hono/logger de texto por access log NDJSON com
requestId; catálogo de eventos publicado nesta spec (§5) como SSOT.

- [ ] **C.1** — Criar `apps/bff/src/middleware/access-log.ts`:

```typescript
import type { MiddlewareHandler } from "hono";
import type { HonoVariables } from "../types/hono";

const SKIP_PATHS = new Set(["/health"]); // healthcheck Docker a cada 30s = ruído puro

export const accessLogMiddleware: MiddlewareHandler<{ Variables: HonoVariables }> =
  async (c, next) => {
    if (SKIP_PATHS.has(c.req.path)) { await next(); return; }
    const start = performance.now();
    await next();
    const log = c.get("log");
    if (!log) return;
    log.info({
      method: c.req.method,
      // c.req.path NÃO inclui querystring — nunca logar query crua:
      // /api/verify?hash=..., magic links e tokens em query vazariam (REP10).
      path: c.req.path,
      status: c.res.status,
      duration_ms: Math.round(performance.now() - start),
      userId: c.get("userId") ?? undefined,
      tenantId: c.get("tenantId") ?? undefined,
    }, "http.request.completed");
  };
```

- [ ] **C.2** — `apps/bff/src/index.ts:39` — **remover** `app.use("*", logger())`
  (hono/logger) e o import da linha 3; registrar `accessLogMiddleware` logo após
  `requestIdMiddleware`. A partir daqui, 100% do stdout do BFF é NDJSON

- [ ] **C.3** — Adotar os eventos nomeados do catálogo (§5) nos logs existentes do
  `onError`: `http_exception` → `http.exception`; `unhandled_error` → `http.unhandled_error`;
  `bff_start` → `bff.start` (buscar consumidores antes — grep por `http_exception` em
  scripts/alertas; hoje não há nenhum)

- [ ] **C.4** — Testes OBS14–OBS16 e OBS18 (§6)

**Commit:** `feat(obs): access log NDJSON + eventos nomeados (Fase C)`

---

### Fase D — Migração `console.*` → logger nas rotas críticas + gate anti-regressão

**Entregável:** zero `console.*` em `apps/bff/src` (fora de `lib/logger.ts` e
`__tests__`); gate no CI que impede regressão.

- [ ] **D.1** — `apps/bff/src/middleware/audit.ts:100-113` — substituir os dois
  `console.error(JSON.stringify({...}))` por:
  `logger.error("audit.persist.failure", { actor_id, action, resource_type, error })` e
  `logger.error("audit.persist.exception", { actor_id, action, error })`
  (import de `../lib/logger`; remover os campos `level`/`msg`/`ts` manuais — o pino já os emite)

- [ ] **D.2** — `apps/bff/src/routes/saidas.ts:300,309,370,379` — substituir os 4
  `console.error` por `c.get("log").error(...)` com eventos:
  `saida.sign_armeiro.persist_failure`, `saida.sign_armeiro.lending_update_failure`,
  `saida.confirm.persist_failure`, `saida.confirm.lending_update_failure`.
  Payload: `{ code: sigErr?.code, error: sigErr?.message, tenantId }` — nunca o objeto de erro inteiro

- [ ] **D.3** — `apps/bff/src/routes/admin.ts:462` — `console.error("[invite]...")` →
  `c.get("log").error("admin.invite.failure", { status: inviteError.status, error: inviteError.message })`
  — **não** logar o e-mail convidado (PII); se necessário para triagem, logar domínio apenas

- [ ] **D.4** — `apps/bff/src/services/fingerprint/zkteco.ts:23,28,41,55` — stubs `[ZKTeco]`
  → `logger.debug("biometric.sdk.*", ...)` (`sdk.init`, `capture.start`, `match.search`,
  `sdk.dispose`). **NUNCA** logar template, buffer de captura ou score bruto por militar

- [ ] **D.5** — Instrumentar eventos de negócio nas rotas críticas (usar `c.get("log")`
  e o catálogo §5) — mínimo obrigatório:
  - `apps/bff/src/routes/totp.ts` — `totp.validate.success|failure|locked`,
    `totp.setup.confirm`, `totp.identify.failure` com `{ matricula: maskMatricula(matricula), attempt }`.
    **Atenção TOTP (memória `totp_architecture`):** rodar suite totp-regression antes de
    tocar no handler; jamais logar `token`, `plainSecret`, `data.secret`, `last_used_token`
    (redact cobre, mas payload plano é a 1ª defesa)
  - `apps/bff/src/routes/auth.ts` — `auth.login.success|failure`, `auth.exchange.failure`,
    `auth.logout` — nunca logar senha/JWT; identificar por `userId`, não por e-mail
  - `apps/bff/src/routes/shifts.ts` — `shift.open`, `shift.close`, `shift.handover.sign`,
    falhas de persistência como `shift.*.persist_failure`
  - `apps/bff/src/routes/biometric.ts` — `biometric.match.success|failure` com
    `{ matched: boolean, candidates: n }` apenas

- [ ] **D.6** — Criar gate `apps/bff/scripts/check-no-console.sh`:

```bash
#!/usr/bin/env bash
# Gate OBS17: proíbe console.* em apps/bff/src (fora do próprio logger e testes).
set -euo pipefail
MATCHES=$(grep -rEn 'console\.(log|error|warn|info|debug)' apps/bff/src --include='*.ts' \
  | grep -v '__tests__' | grep -v 'src/lib/logger.ts' || true)
if [ -n "$MATCHES" ]; then
  echo "❌ console.* proibido em apps/bff/src — use lib/logger:"
  echo "$MATCHES"
  exit 1
fi
echo "✅ OBS17: zero console.* em apps/bff/src"
```

- [ ] **D.7** — Integrar o gate ao CI (`.github/workflows/ci.yml`, job de lint/typecheck)
  e como script `"lint:logs"` no `apps/bff/package.json`. Migrar também as 2 ocorrências
  de `apps/web/src/app/api/**` (trocar por resposta de erro sem log ou comentário) —
  o gate cobre só o BFF nesta fase (KISS)

- [ ] **D.8** — Testes OBS17 + regressão: `cd apps/bff && pnpm test` e suites E2E
  afetadas (totp-regression, saidas)

**Commit:** `refactor(obs): console.* → logger em rotas críticas + gate CI (Fase D)`

---

### Fase E — Error handler global hardening

**Entregável:** `app.onError` com log completo (stack incluído) e resposta 100% sanitizada.

Estado atual (`apps/bff/src/index.ts:175-190`): já não vaza stack no body ✅, mas
o log de `unhandled_error` descarta o stack (só `err.message`) — dificulta diagnóstico —
e não tem requestId (resolvido na B.6).

- [ ] **E.1** — Enriquecer o log do `onError` mantendo o body sanitizado:

```typescript
app.onError((err, c) => {
  // ... bloco CORS existente (index.ts:178-183) permanece intacto ...
  const log = c.get("log") ?? baseLogger;
  const requestId = c.get("requestId");
  if (err instanceof HTTPException) {
    log.warn({ status: err.status, error: err.message, path: c.req.path }, "http.exception");
    return c.json({ error: err.message, requestId }, err.status);
  }
  log.error({
    path: c.req.path,
    method: c.req.method,
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined, // stack SÓ no log, NUNCA no body
  }, "http.unhandled_error");
  return c.json({ error: "Internal server error", requestId }, 500);
});
```

- [ ] **E.2** — Verificar que nenhuma rota captura erro e devolve `err.message` cru de
  exceção inesperada no body (grep `err.message` nas rotas; mensagens de erro *construídas*
  são OK, mensagem de exceção do driver/Supabase no body de 500 não é)

- [ ] **E.3** — Testes OBS12–OBS13 (reexecutar) + teste de integração: rota que lança
  `throw new Error("boom com stack")` → body sem `"boom"`, log com stack

**Commit:** `feat(obs): onError com stack em log e requestId como código de suporte (Fase E)`

---

### Fase F — Rotação e retention no VPS

**Entregável:** logs do container com teto de disco garantido e política de retenção documentada.

**Decisão:** stdout → Docker `json-file` com rotação nativa. Sem arquivo em
`/app/logs`, sem logrotate custom, sem sidecar (KISS — o driver já resolve).
journald como alternativa documentada, não adotada (container único, `docker logs` basta).

- [ ] **F.1** — `docker-compose.prod.yml` (serviço `bff`) — adicionar:

```yaml
    logging:
      driver: json-file
      options:
        max-size: "50m"
        max-file: "5"
```

  Teto: 250MB rolling (~semanas de logs no volume atual). Mesmo bloco no
  `docker-compose.yml` base para dev/paridade

- [ ] **F.2** — Remover o volume morto `bff_logs:/app/logs` de ambos os compose files
  e a entrada `volumes: bff_logs` (config morta confunde — Least Surprise). Conferir
  que o `Dockerfile` não referencia `/app/logs`

- [ ] **F.3** — Aplicar no VPS (SSH key `~/.ssh/apmcb_hetzner`):
  `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --force-recreate bff`
  (logging options exigem recreate). Validar: `docker inspect apmcb-bff --format '{{json .HostConfig.LogConfig}}'`

- [ ] **F.4** — Política de retenção (documentar em `docs/enterprise/` runbook curto):
  - **Logs operacionais (stdout/json-file):** ~250MB rolling ≈ 15–30 dias. Contêm
    `userId`/`tenantId`/IP (nginx) — LGPD: retenção curta é feature, não bug
  - **Trilha de auditoria (`audit_events`):** retenção longa no Postgres — fora desta spec
  - **nginx host:** `/var/log/nginx/*` já rotacionado pelo logrotate default do
    sistema (verificar `/etc/logrotate.d/nginx` no VPS; ajustar `rotate 14` se preciso)
  - **Consulta (runbook):** `docker logs apmcb-bff --since 1h | grep <requestId>`;
    por evento: `docker logs apmcb-bff --since 24h | grep '"totp.validate.failure"'`

- [ ] **F.5** — Testes OBS21–OBS22 (§6)

**Commit:** `chore(obs): rotação json-file 50m×5 + remoção volume morto bff_logs (Fase F)`

---

### Fase G — (Opcional/diferencial) Agregação e busca — análise honesta

**Contexto:** um único VPS, um único serviço, equipe de 1. O valor de um stack de
observabilidade completo é limitado hoje.

| Opção | Custo | Benefício | Veredito |
|-------|-------|-----------|----------|
| **G1. Status quo pós-Fase F** (`docker logs` + grep por requestId) | Zero | Correlação já resolvida; busca via SSH | ✅ **Suficiente para o volume atual** |
| **G2. Grafana Cloud free tier + Alloy no VPS** | ~150–200MB RAM (Alloy); free tier: 50GB logs/mês, 14d retention; logs saem do VPS (avaliar LGPD — dados mascarados pela Fase A mitigam) | Busca LogQL via browser, dashboards, alerta em `error`/`fatal` sem SSH | ⚠️ **Adotar quando** houver 2º serviço, ou o MTTR via SSH doer na prática, ou precisar de alerta proativo |
| **G3. Loki + Grafana + Alloy self-hosted no VPS** | +700MB–1GB RAM no mesmo VPS do BFF, superfície de ataque extra (Grafana auth), manutenção de mais 3 serviços | Dados não saem do VPS | ❌ **Não recomendado** — overhead desproporcional para 1 nó |
| **G4. OpenTelemetry tracing** | Instrumentação + collector + backend | Traces distribuídos | ❌ **YAGNI** — 1 serviço; requestId já correlaciona web→BFF→Supabase (via log) |

**Recomendação:** encerrar a spec na Fase F. Se G2 for ativada no futuro:
- [ ] **G.1** — Instalar Grafana Alloy no host (systemd), coletando `/var/lib/docker/containers/*/*-json.log` com pipeline `docker` → push para Grafana Cloud Loki
- [ ] **G.2** — Labels: `service=apmcb-bff`, `level`, `env` — **nunca** labelizar `requestId`/`userId` (alta cardinalidade explode custo no Loki; ficam como campos do JSON, filtráveis via LogQL `| json`)
- [ ] **G.3** — Alerta: `count_over_time({service="apmcb-bff"} | json | level="error" [5m]) > 10`
- [ ] **G.4** — Revalidar masking (Fases A/D) antes do primeiro push — logs saindo do VPS elevam o impacto de qualquer vazamento

---

## 5. Catálogo de Eventos Nomeados (SSOT)

Formato: `dominio.acao[.resultado]`. Novos eventos DEVEM ser adicionados aqui (SSOT)
antes de entrar em código.

| Evento | Nível | Onde | Payload permitido |
|--------|-------|------|-------------------|
| `bff.start` | info | `index.ts:193` (renomeado de `bff_start`) | port, env |
| `http.request.completed` | info | access-log middleware | method, path (sem query), status, duration_ms, userId, tenantId |
| `http.exception` | warn | `onError` | status, error, path |
| `http.unhandled_error` | error | `onError` | path, method, error, stack |
| `auth.login.success` / `auth.login.failure` | info / warn | `routes/auth.ts` | userId (sucesso), motivo genérico (falha) — nunca senha/e-mail |
| `auth.exchange.failure` | warn | `routes/auth.ts` | motivo — nunca o JWT |
| `auth.logout` | info | `routes/auth.ts` | userId |
| `totp.setup.confirm` | info | `routes/totp.ts` | userId |
| `totp.validate.success` / `totp.validate.failure` | info / warn | `routes/totp.ts` | matricula mascarada, attempt — **nunca** token/secret |
| `totp.validate.locked` | warn | `routes/totp.ts` | matricula mascarada, retry_after_seconds |
| `totp.identify.failure` | warn | `checkTotpForMatricula` (`totp.ts:89-98`) | matricula mascarada, attempt |
| `saida.sign_armeiro.persist_failure` | error | `routes/saidas.ts:300` | code, error, tenantId |
| `saida.confirm.persist_failure` | error | `routes/saidas.ts:370` | code, error |
| `shift.open` / `shift.close` / `shift.handover.sign` | info | `routes/shifts.ts` | shiftId, userId, tenantId |
| `biometric.match.success` / `biometric.match.failure` | info / warn | `routes/biometric.ts` | matched, candidates — **nunca** template/score por militar |
| `biometric.sdk.*` | debug | `services/fingerprint/zkteco.ts` | fingerIndex, templates count |
| `admin.invite.failure` | error | `routes/admin.ts:462` | status, error — nunca e-mail |
| `audit.persist.failure` / `audit.persist.exception` | error | `middleware/audit.ts:100,108` | actor_id, action, resource_type, error |

---

## 6. Testes — IDs OBS01..OBS22

Unit/integration em `apps/bff/src/__tests__/` (runner: `pnpm test` =
`node --experimental-strip-types --test`); E2E na suite Playwright
`--project=obs-suite` (`apps/web/e2e/observability.spec.ts`); gates como script CI.

### 6.1 Redaction e masking (Fase A — unit)

| ID | Teste | Critério |
|----|-------|----------|
| OBS01 | Logger emite NDJSON válido | Linha parseável; contém `level` (string), `time` ISO, `msg`, `service:"apmcb-bff"` |
| OBS02 | `{ authorization: "Bearer eyJ..." }` no payload | Sai `"[REDACTED]"` |
| OBS03 | `{ cookie }` e `{ headers: { "set-cookie" } }` (2º nível) | Ambos `"[REDACTED]"` |
| OBS04 | `token`, `otp`, `secret`, `password`, `senha`, `access_token`, `refresh_token`, `csrfToken`, `pendingTotpSecret`, `last_used_token` — em 1º e 2º nível | Todos `"[REDACTED]"` |
| OBS05 | `{ template_data: <base64> }` | `"[REDACTED]"` |
| OBS06 | `maskMatricula("1234567")` | `"*****67"`; edge: `""`→`""`, `"1"`→`"**"`, null→`""` |
| OBS07 | `maskNome("João da Silva Sauro")` | `"João S."`; edge: nome único, null |

### 6.2 Correlação (Fase B — unit + E2E)

| ID | Teste | Critério |
|----|-------|----------|
| OBS08 | Child logger de request | Toda linha logada dentro do request contém o mesmo `requestId` |
| OBS09 | `X-Request-Id: "abc\n{injected}"` (inválido) no request | Descartado; UUID novo gerado (anti log-injection) |
| OBS10 | E2E: response de qualquer rota `/api/*` | Header `X-Request-Id` presente e é UUID |
| OBS11 | Request com `X-Request-Id` UUID válido | Response ecoa o MESMO UUID |
| OBS12 | Rota que lança `Error("boom")` → 500 | Body = `{ error: "Internal server error", requestId }`; **sem** `"boom"`, sem stack; log contém stack |
| OBS13 | `HTTPException(403)` (ex. CSRF) | Body mantém message e status originais + requestId |
| OBS19 | E2E/unit web: `bffFetch` | Envia header `X-Request-Id` UUID; `BffResponse.requestId` preenchido |

### 6.3 Access log e níveis (Fase C — integration)

| ID | Teste | Critério |
|----|-------|----------|
| OBS14 | `GET /health` | **Nenhuma** linha `http.request.completed` emitida |
| OBS15 | `GET /api/dashboard/...` autenticado | Linha com method, path, status, duration_ms, requestId, userId, tenantId |
| OBS16 | `GET /api/verify?hash=SEGREDO` | Log contém `path:"/api/verify"` **sem** a querystring |
| OBS18 | `LOG_LEVEL=warn` | `logger.info(...)` não emite; `warn`/`error` emitem |

### 6.4 Gates (Fases D/F — CI + script)

| ID | Teste | Critério |
|----|-------|----------|
| OBS17 | `apps/bff/scripts/check-no-console.sh` no CI | Exit 0 = zero `console.*` em `apps/bff/src` (exceto `lib/logger.ts`, `__tests__`) |
| OBS20 | Scan de padrões proibidos sobre stdout capturado das suites de integração: regex `eyJ[A-Za-z0-9_-]{20,}` (JWT), `[A-Z2-7]{16,}=*` isolado em campo suspeito (base32 TOTP), `"password"\s*:\s*"[^"[]` | Zero matches fora de `[REDACTED]` (validação da etapa 18 da DoD) |
| OBS21 | VPS: `docker inspect apmcb-bff --format '{{json .HostConfig.LogConfig}}'` | `max-size:"50m"`, `max-file:"5"` |
| OBS22 | VPS: após deploy, `du -sh` do dir de log do container | ≤ 250MB garantido por configuração; runbook de consulta documentado |

---

## 7. Definition of Done

Referência canônica: `docs/enterprise/07-canonical-definition-of-done.md` — em
especial **G08** ("Nenhum dado sensível aparece em logs"), **REP10** (reprovação
automática por senha/token/TOTP/template em log) e a **etapa 18** do ciclo
("Validar logs — dados sensíveis presentes?"), que esta spec transforma de
verificação manual em teste automatizado (OBS20).

- [ ] Fases A–F implementadas na ordem, um commit por fase
- [ ] OBS01..OBS22 passando (unit via `cd apps/bff && pnpm test`; E2E via `pnpm test:e2e --project=obs-suite`)
- [ ] G08/REP10: OBS02–OBS07 + OBS20 verdes — nenhum segredo/PII cru em stdout
- [ ] G11/G12/G13: `pnpm --filter web build` ✅ · `pnpm typecheck` ✅ (web + bff) · `pnpm lint` ✅
- [ ] G14/G15/G16: regressão completa `cd apps/web && pnpm test:e2e` sem novos falhos vs baseline; smoke `--project=chromium` ✅; suite totp-regression ✅ (obrigatória — Fase D toca `routes/totp.ts`)
- [ ] Gate OBS17 integrado ao CI e verde
- [ ] VPS validado: OBS21 + `curl https://api.apmcb.pmpb.online/health` 200 + `docker logs apmcb-bff --tail 20` mostra apenas NDJSON
- [ ] Header `X-Request-Id` visível no browser (DevTools) em chamada real a `api.apmcb.pmpb.online`
- [ ] Code review sênior (sub-agente `code-reviewer`, mandato do CLAUDE.md) executado antes de cada commit de produção; nenhum CRÍTICO/ALTO pendente
- [ ] G17: relatório final em `docs/enterprise/reports/observability-logging-final-report.md`
- [ ] CHANGELOG atualizado (DoD de infra do projeto)

---

## 8. Riscos e Rollback

### 8.1 Riscos

| # | Risco | Prob. | Impacto | Mitigação |
|---|-------|-------|---------|-----------|
| R1 | Pino incompatível com Bun em produção (transports/worker threads) | Baixa | Alto — BFF não sobe | Regra "sem transport" (§3.1); validar `bun run src/index.ts` localmente ANTES do deploy; healthcheck do compose + rollback automático do `ci-cd.yml:129-141` seguram deploy quebrado |
| R2 | Redact paths não cobrem um campo novo (wildcard raso) | Média | Alto — REP10 | Defesa em profundidade: payload plano por convenção (§3.1), catálogo §5 com "payload permitido", OBS20 no CI, code review obrigatório |
| R3 | Renomear eventos (`http_exception`→`http.exception`) quebra consumidor oculto | Baixa | Baixo | Grep por consumidores antes (C.3); hoje não há alerta/parser externo |
| R4 | Gate OBS17 bloqueia CI de PRs antigos com `console.*` | Média | Baixo | Ativar o gate no MESMO commit que zera o débito (Fase D é atômica) |
| R5 | `--force-recreate` na Fase F derruba o BFF por ~10s | Alta | Baixo | Janela de baixo uso; healthcheck valida volta; é o mesmo procedimento do deploy normal |
| R6 | `exposeHeaders` no CORS altera preflight e afeta algum fluxo | Baixa | Baixo | `exposeHeaders` só adiciona `Access-Control-Expose-Headers` na resposta — não restringe nada existente; smoke E2E cobre |
| R7 | Log de `userId`/`tenantId` em access log vira passivo LGPD | Média | Médio | Retenção curta por rotação (Fase F); são identificadores internos (UUID), não PII direta; documentado no runbook F.4 |
| R8 | Aumento de volume de log (access log novo) enche disco | Baixa | Médio | Fase F ANTES do deploy conjunto define teto físico de 250MB; `/health` excluído do access log |

### 8.2 Rollback (alvo: < 30 minutos, padrão do relatório final)

| Fase | Rollback |
|------|----------|
| A | `git revert` do commit — a API do logger é retrocompatível por design (B.6/C dependem só de `baseLogger`/`logger`), então reverter A exige reverter B/C juntos se já mergeadas; por isso 1 commit por fase, revert em ordem inversa (F→A) |
| B | Revert do commit; frontend `bffFetch` sem o header continua funcionando (BFF gera UUID próprio) — deploy web e BFF são independentes |
| C | Revert; hono/logger volta (linha 39) — logs voltam a texto misto, sem perda funcional |
| D | Revert por arquivo se necessário; gate sai do CI junto (mesmo commit) |
| E | Revert — `onError` anterior (index.ts:175-190) já era seguro |
| F | Remover bloco `logging:` do compose + `up -d --force-recreate bff`; imagem `apmcb-bff:rollback` do pipeline (`ci-cd.yml:103-105`) cobre falha de imagem |
| Deploy quebrado no VPS | Mecanismo existente do `ci-cd.yml:129-141`: healthcheck falha → restaura `apmcb-bff:rollback` automaticamente |

---

## 9. Ordem de Execução Recomendada

```
Sessão 1: Fase A (2h) + Fase B (2h)      [núcleo: logger + correlação; deploy conjunto BFF+web]
Sessão 2: Fase C (1h) + Fase E (1h)      [access log + onError; deploy BFF]
Sessão 3: Fase D (3h)                    [migração console.* + eventos de negócio + gate; suite totp-regression obrigatória]
Sessão 4: Fase F (1h)                    [VPS: rotação + runbook + validação OBS21/22]
Backlog:  Fase G                         [somente com gatilho real: 2º serviço, MTTR doendo, ou necessidade de alerta proativo]
```
