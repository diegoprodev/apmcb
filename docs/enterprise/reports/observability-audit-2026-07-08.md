# Auditoria de Observabilidade — APMCB

**Data:** 2026-07-08 · **Escopo:** apps/bff (Hono/Bun no VPS) + apps/web (Next.js/CF Pages) · **Método:** análise estática de todo `apps/bff/src` e camada de fetch do frontend

---

## 1. Estado atual (o que já existe)

| Componente | Estado |
|---|---|
| `apps/bff/src/lib/logger.ts` | Logger JSON mínimo (info/warn/error) — **usado em apenas 3 call sites**, todos em `index.ts` |
| `hono/logger()` (`index.ts:39`) | Log de request em **texto plano** (`<-- GET /path`), misturado ao JSON no mesmo stdout |
| `app.onError` (`index.ts:175-190`) | Estruturado (evento + path), mas sem stack, sem userId, sem requestId, sem método HTTP |
| `audit_events` + hash-chain | Excelente para compliance — mas é auditoria de negócio, não logging operacional |
| Frontend `bffFetch` | Timeout 10s via AbortController; sem correlação, sem telemetria, sem Sentry |
| Correlação de requisições | **Inexistente** (os `requestId` em `ssa.ts` são IDs de entidade de domínio, não correlação) |

## 2. Problemas encontrados

### CRÍTICO — Falhas silenciosas (catch engole o erro)

**C1. `routes/totp.ts` — 5 catches que descartam a exceção sem logar** (linhas 66, 120, 223, 275, 376).
O catch da linha 223 é **exatamente a origem do 422 do incidente de 2026-07-07** ("Autenticador inválido. Acesse 'Meu Perfil'..."): quando `readSecret()` falha, o erro real (chave divergente? payload corrompido? formato inesperado?) é descartado e o servidor não registra **nada**. A regressão do usuário 000003 é indiagnosticável pelos logs por causa disso.

**C2. `lib/shift-auth.ts:43-45` e `:112-113`** — mesmo padrão: `catch { return 422/503 }` sem logar a exceção do `readSecret`/SDK ZKTeco.

**C3. `routes/auth.ts:67` — `catch {}` vazio** em volta do insert de `auth.login_failed`. Se o Supabase falhar, um evento de **monitoramento de segurança** (tentativa de login inválida) é perdido sem rastro. `routes/nexus.ts:64` tem outro `catch {}` vazio.

**C4. `routes/biometric.ts:90-92`** — `catch { return 503 }` sem registrar qual exceção o SDK lançou.

**C5. ~117 pontos de `return c.json({ error }, 500)` em 21 arquivos de rota, contra apenas 7 `console.error` em rotas.** A imensa maioria dos erros 500 do BFF não deixa nenhuma linha de log. Um 500 em produção hoje é, na prática, invisível.

**C6. `apps/web/src/lib/bff-client.ts:42`** — `res.json().catch(() => ({}))`: resposta malformada vira `{}` silenciosamente. Timeout (AbortError), falha de rede e erro CORS chegam ao caller como um throw indistinto. O spinner infinito em `/efetivo/historico` é exatamente a classe de falha que esse padrão esconde — a página não tem como saber o que falhou nem reportar.

### ALTO — Falta de contexto e correlação

- **Sem requestId**: impossível correlacionar um erro no browser com a linha de log no VPS, ou seguir uma requisição através de middleware → rota → Supabase.
- Logs sem `userId`, `tenantId`, `role`, `method`, `status`, `duration_ms` — o `onError` só tem `path`.
- `hono/logger()` produz texto plano no mesmo stdout do JSON → stream inconsistente, imparseável por Loki/ELK.
- `logger.ts` espalha `...data` **depois** de `level`/`msg` — uma chave `level` ou `msg` no data sobrescreve os campos canônicos (colisão de schema).
- Sem campo `service`/`module` — em um futuro com mais serviços, indistinguível.

### ALTO — Níveis e padronização

- Sem níveis `debug`/`fatal`; sem filtro por env (`LOG_LEVEL`) — tudo é sempre emitido.
- Sem convenção de eventos nomeados: mistura de printf-style (`"[invite] supabase error:"` em `admin.ts:462`) com JSON (`audit.ts:100`) e texto puro (`zkteco.ts`).
- `middleware/audit.ts:100,108` faz `console.error(JSON.stringify(...))` manual em vez de usar o logger — duplicação do schema (viola SSOT).

### MÉDIO — Segurança / PII nos logs

- **Sem camada de redaction**: nada impede que um futuro `logger.error("x", { headers })` vaze `Cookie`/`Authorization`/token TOTP. A proteção hoje é apenas disciplina do dev.
- `auth.ts:65` grava **email em claro + IP** no metadata de `audit_logs` — PII sem política de retenção/mascaramento documentada.
- `hono/logger()` loga a URL completa com query string — hoje nenhuma rota passa token em query (verificado), mas não há guard-rail para o futuro.
- Templates biométricos (Buffer) nunca são logados hoje — mas não existe proteção estrutural contra isso.

### MÉDIO — Infra / retenção

- BFF roda em Docker no VPS; sem `logging: { driver, max-size, max-file }` no compose, o json-file do Docker cresce sem limite.
- Sem agregação (Loki/ELK), sem alerta de taxa de erro, sem métrica além do `/health`.
- Frontend sem error-reporting (Sentry/similar) — erros de produção no browser são invisíveis.

## 3. Recomendações (ordem de prioridade)

1. **Parar de engolir exceções (custo ~1h, valor máximo)** — todo `catch` que retorna erro HTTP DEVE logar antes: `logger.error("totp.read_secret.failure", { userId, error: err instanceof Error ? err.message : String(err) })`. Nunca logar o secret/token em si. Isso teria tornado o incidente do 000003 diagnosticável em segundos.
2. **Adotar Pino** (nativo p/ Bun, ~5x mais rápido que Winston, redaction embutida):

```ts
// apps/bff/src/lib/logger.ts
import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "apmcb-bff", env: process.env.NODE_ENV },
  redact: {
    paths: [
      "*.authorization", "*.cookie", "*.set-cookie",
      "*.token", "*.totp_token", "*.secret", "*.password",
      "*.template_data", "*.access_token", "*.refresh_token",
    ],
    censor: "[REDACTED]",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
```

3. **Middleware de requestId + request-log estruturado** (substitui `hono/logger()`):

```ts
// apps/bff/src/middleware/request-id.ts
export const requestIdMiddleware: MiddlewareHandler = async (c, next) => {
  const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
  c.set("requestId", requestId);
  c.header("X-Request-Id", requestId);
  const start = performance.now();
  await next();
  logger.info({
    event: "http.request",
    requestId,
    method: c.req.method,
    path: c.req.path,           // path, nunca URL com query
    status: c.res.status,
    duration_ms: Math.round(performance.now() - start),
    userId: c.get("userId") ?? null,
    tenantId: c.get("tenantId") ?? null,
  });
};
```

4. **Propagar requestId do frontend**: `bffFetch` gera `crypto.randomUUID()`, envia como `X-Request-Id`, e em caso de erro exibe o código ao usuário ("Erro — informe o código `ab12...`"). Correlação ponta a ponta browser ⇄ VPS.
5. **`bffFetch`: distinguir timeout / rede / resposta inválida** — capturar `AbortError` e lançar erro tipado (`BffTimeoutError`), logar json-parse failure em vez de `() => ({})`.
6. **`app.onError` com stack no log (nunca no body)** + requestId.
7. **Convenção de eventos nomeados**: `dominio.acao.resultado` (ex.: `totp.validate.failure`, `shift.open.success`) — já parcialmente adotada nos audit_logs; estender aos logs operacionais.
8. **Mascaramento de PII**: email → `d***@gmail.com`, matrícula → `0000**`; documentar política de retenção do `audit_logs`.
9. **Rotação no VPS**: no `docker-compose.yml`, `logging: { driver: json-file, options: { max-size: "50m", max-file: "5" } }`.
10. **CI guard**: teste que falha se `console.(log|error|warn)` existir em `apps/bff/src` fora de `lib/logger.ts`.
11. **(Diferencial)** Grafana Loki + Alloy no próprio VPS (footprint ~200MB) para consulta `{service="apmcb-bff"} |= "requestId"`; OpenTelemetry apenas quando houver >1 serviço — antes disso é overhead sem retorno.

## 4. Arquitetura-alvo

```
Browser ──X-Request-Id──▶ CF Pages (web) ──X-Request-Id──▶ nginx host ──▶ BFF (Hono/Bun)
                                                                      │
                                              pino JSON (stdout, redacted)
                                                                      │
                                                    Docker json-file (rotação 50m×5)
                                                                      │
                                              [Fase 2] Alloy ──▶ Loki ──▶ Grafana (alertas)

Trilhas paralelas:
- audit_events (Supabase, hash-chain)  → compliance/negócio (já existe, manter)
- logs operacionais (pino)             → debugging/SRE (este projeto)
```

**Spec de implementação:** `docs/enterprise/specs/observability-logging-enterprise.md` (fases, testes OBSnn, DoD).
