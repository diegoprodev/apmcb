import type { Context, MiddlewareHandler, Next } from "hono";
import { baseLogger } from "../lib/logger.ts";

// ---------------------------------------------------------------------------
// Sliding-window rate limiter with per-IP isolated stores.
// Each call to createRateLimiter() returns an independent middleware with its
// own Map — so /api/auth/* and /api/* never share counters.
// ---------------------------------------------------------------------------

interface Entry {
  timestamps: number[]; // epoch ms of each request inside the window
}

export const RATE_LIMIT_PROFILES = {
  login: { max: 5, windowMs: 15 * 60_000 },
  exchange: { max: 120, windowMs: 60_000 },
  sensitive: { max: 100, windowMs: 60_000 },
  general: { max: 120, windowMs: 60_000 },
  authMe: { max: 600, windowMs: 60_000 },
  publicVerify: { max: 30, windowMs: 60_000 },
  biometric: { max: 30, windowMs: 60_000 },
  biometricBridge: {
    max: Number.parseInt(process.env.BIOMETRIC_BRIDGE_RATE_LIMIT_MAX ?? "120", 10),
    windowMs: Number.parseInt(process.env.BIOMETRIC_BRIDGE_RATE_LIMIT_WINDOW_SECONDS ?? "60", 10) * 1000,
  },
} as const;

export function trustsProxyHeaders(): boolean {
  return process.env.RATE_LIMIT_TRUST_PROXY_HEADERS === "true" || process.env.NODE_ENV !== "production";
}

const allStores: Map<string, Entry>[] = [];

export function clearRateLimitForIp(ip: string): void {
  for (const store of allStores) {
    store.delete(ip);
  }
}

export function getClientIp(c: Context): string {
  // In production, proxy-derived identity is trusted only after the edge/nginx
  // perimeter is explicitly configured to strip user-supplied forwarding headers.
  if (!trustsProxyHeaders()) {
    return "proxy-headers-untrusted";
  }

  return (
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-real-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0].trim() ??
    "unknown"
  );
}

function createRateLimiter(
  max: number,
  windowMs: number,
  keyFn: (c: Context) => string = getClientIp,
  // Achado real de gap de observabilidade (varredura 2026-08-27): o branch
  // de 429 abaixo sempre respondeu direto via c.json(), nunca lançando
  // exceção — ao contrário de HTTPException, isso NUNCA passa pelo
  // onError/http.exception, então nenhum rate-limit disparado (inclusive em
  // /api/auth/login, a defesa de força bruta) deixava QUALQUER rastro no
  // log. `name` identifica qual perfil disparou (login/exchange/sensitive/
  // etc.) sem precisar inspecionar closures.
  name: string = "unnamed",
  // Achado MÉDIO de code review: `key` no log abaixo tem semântica dupla —
  // IP pra quase todo limiter, mas x-bridge-device-id pro biometric_bridge
  // — sem isto, quem consumir o log programaticamente (dashboard/alerta)
  // precisaria saber de cor "se limiter==='biometric_bridge', key é
  // device_id" pra interpretar certo.
  keyType: "ip" | "device_id" = "ip",
): MiddlewareHandler {
  const store = new Map<string, Entry>();
  allStores.push(store);

  // Prune stale entries every 5 minutes to prevent unbounded Map growth.
  const timer = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [ip, entry] of store) {
      const pruned = entry.timestamps.filter((t) => t > cutoff);
      if (pruned.length === 0) {
        store.delete(ip);
      } else {
        entry.timestamps = pruned;
      }
    }
  }, 5 * 60_000);
  // Prevent the interval from keeping the Bun process alive on shutdown.
  if (typeof timer === "object" && timer !== null && "unref" in timer) {
    (timer as { unref: () => void }).unref();
  }

  return async (c: Context, next: Next) => {
    const ip = keyFn(c);
    const now = Date.now();
    const windowStart = now - windowMs;

    // Sliding window: discard timestamps older than the window.
    const entry = store.get(ip) ?? { timestamps: [] };
    entry.timestamps = entry.timestamps.filter((t) => t > windowStart);
    store.set(ip, entry);

    const count = entry.timestamps.length;
    const resetEpochSec =
      count > 0
        ? Math.ceil((entry.timestamps[0] + windowMs) / 1000)
        : Math.ceil((now + windowMs) / 1000);

    if (count >= max) {
      const retryAfterSec = Math.max(
        1,
        Math.ceil((entry.timestamps[0] + windowMs - now) / 1000)
      );
      // c.get pode não estar tipado com HonoVariables aqui (createRateLimiter
      // é MiddlewareHandler genérico, sem o Env bound de HonoVariables) —
      // acesso via cast, mesmo padrão defensivo de lib/validated-json.ts.
      const log = ((c.get as (key: string) => unknown)("log") as typeof baseLogger | undefined) ?? baseLogger;
      log.warn({
        limiter: name,
        path: c.req.path,
        method: c.req.method,
        // `key` é o que keyFn(c) devolveu — IP na maioria dos limiters, mas
        // x-bridge-device-id pro bucket do biometric bridge (ver
        // rateLimitBiometricBridge abaixo). `key_type` discrimina qual é
        // qual sem depender de conhecimento tácito de qual limiter usa qual.
        key: ip,
        key_type: keyType,
        count,
        max,
        retry_after_seconds: retryAfterSec,
      }, "rate_limit.blocked");
      return c.json(
        { error: "Muitas tentativas. Tente novamente mais tarde.", retry_after_seconds: retryAfterSec },
        429,
        {
          "Retry-After": String(retryAfterSec),
          "X-RateLimit-Limit": String(max),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(resetEpochSec),
        }
      );
    }

    entry.timestamps.push(now);

    await next();

    // Attach informational headers to the actual response.
    c.res.headers.set("X-RateLimit-Limit", String(max));
    c.res.headers.set(
      "X-RateLimit-Remaining",
      String(Math.max(0, max - entry.timestamps.length))
    );
    c.res.headers.set("X-RateLimit-Reset", String(resetEpochSec));
  };
}

// ---------------------------------------------------------------------------
// Pre-built limiters — tuned for each surface's risk profile.
// ---------------------------------------------------------------------------

/**
 * Credential check only (/api/auth/login).
 * Very strict: 5 attempts per 15 minutes per IP.
 * Slows brute-force from one client; distributed credential stuffing also needs
 * account-aware lockout or an edge/WAF layer.
 */
export const rateLimitLogin = createRateLimiter(
  RATE_LIMIT_PROFILES.login.max,
  RATE_LIMIT_PROFILES.login.windowMs,
  getClientIp,
  "login",
);

/**
 * Token exchange (/api/auth/exchange) — magic link / invite flow.
 * 120/min — not a credential check (validates Supabase JWT, not username/password),
 * so brute-force is not a concern. Test suites call this once per test.
 */
export const rateLimitExchange = createRateLimiter(
  RATE_LIMIT_PROFILES.exchange.max,
  RATE_LIMIT_PROFILES.exchange.windowMs,
  getClientIp,
  "exchange",
);

/**
 * Sensitive mutations: TOTP validate, SSA requests, biometric ops.
 * 100 per minute — prevents scripted brute-force while allowing test suites.
 * TOTP already has a secondary DB-level lock (5 fails / 15 min / military).
 */
export const rateLimitSensitive = createRateLimiter(
  RATE_LIMIT_PROFILES.sensitive.max,
  RATE_LIMIT_PROFILES.sensitive.windowMs,
  getClientIp,
  "sensitive",
);

export const rateLimitBiometric = createRateLimiter(
  RATE_LIMIT_PROFILES.biometric.max,
  RATE_LIMIT_PROFILES.biometric.windowMs,
  getClientIp,
  "biometric",
);

/**
 * /api/biometric-bridge/* (Phase 1B, bridge Windows real) — bucket dedicado,
 * separado do bucket "biometric" acima (compartilhado por IP com o console
 * browser-facing /reserva/biometria). O polling do bridge sozinho
 * (challenges/next a cada poll_after_ms=1500) já estoura 30/min em ~45s;
 * somando heartbeat (a cada 15s) e template sync, um bucket por IP também
 * penaliza injustamente múltiplos bridges atrás do mesmo NAT/reserva.
 *
 * Chaveado por X-Bridge-Device-Id (não IP) — cada device tem seu próprio
 * orçamento de requisições, independente de quantos outros bridges/consoles
 * compartilham a mesma saída de internet. O header ainda não foi validado
 * neste ponto (deviceAuthMiddleware roda depois, por rota) — um device_id
 * forjado só cria um contador próprio, não interfere no de device_ids reais;
 * a validação de autenticidade fica inteiramente a cargo do deviceAuthMiddleware.
 * POST /pair não tem device_id ainda (device não existe até parear) — cai no
 * fallback por IP, aceitável dado que pareamento é uma operação pontual.
 */
export const rateLimitBiometricBridge = createRateLimiter(
  RATE_LIMIT_PROFILES.biometricBridge.max,
  RATE_LIMIT_PROFILES.biometricBridge.windowMs,
  (c) => c.req.header("x-bridge-device-id") ?? getClientIp(c),
  "biometric_bridge",
  "device_id",
);

/**
 * General authenticated API (lendings, dashboard, notifications, arsenal…).
 * 120 per minute = 2 req/s — comfortable for any human workflow.
 */
export const rateLimitGeneral = createRateLimiter(
  RATE_LIMIT_PROFILES.general.max,
  RATE_LIMIT_PROFILES.general.windowMs,
  getClientIp,
  "general",
);

/**
 * GET /api/auth/me — leitura pura de sessão (sem mutação, sem dado sensível
 * além da identidade). Chamado agora pelo middleware do frontend em toda
 * navegação do dashboard (mitigação de session-bleed) além do uso normal —
 * bucket dedicado e mais generoso para não competir com o tráfego geral
 * (120/min compartilhado por IP, viável de esgotar com várias praças atrás
 * do mesmo NAT do quartel navegando ao mesmo tempo).
 */
export const rateLimitAuthMe = createRateLimiter(
  RATE_LIMIT_PROFILES.authMe.max,
  RATE_LIMIT_PROFILES.authMe.windowMs,
  getClientIp,
  "auth_me",
);

/**
 * Public unauthenticated verification endpoints (QR-code scan targets).
 * 30/min — tighter than authenticated traffic since there's no session to
 * hold accountable; still comfortable for a human scanning a printed PDF.
 */
export const rateLimitPublicVerify = createRateLimiter(
  RATE_LIMIT_PROFILES.publicVerify.max,
  RATE_LIMIT_PROFILES.publicVerify.windowMs,
  getClientIp,
  "public_verify",
);

/**
 * Single-entry-point middleware that picks the right limiter based on the
 * request path. Apply this to app.use("/api/*") and remove the old flat limiter.
 */
export const routeRateLimiter: MiddlewareHandler = async (c, next) => {
  const path = c.req.path;

  // /api/public/branding é chamado sem sessão a cada carregamento da tela de
  // login — fica no limite geral (120/min), não no de verify (pensado para
  // scans esporádicos de QR code, não para todo carregamento de página).
  if (path.startsWith("/api/public/") && path !== "/api/public/branding") {
    return rateLimitPublicVerify(c, next);
  }

  if (path === "/api/auth/login") {
    return rateLimitLogin(c, next);
  }

  if (path === "/api/auth/exchange") {
    return rateLimitExchange(c, next);
  }

  if (path === "/api/auth/me") {
    return rateLimitAuthMe(c, next);
  }

  if (path.startsWith("/api/auth/")) {
    // /api/auth/logout, etc. — session management, not credential checks
    return rateLimitGeneral(c, next);
  }

  // Checado ANTES de /api/biometric/ — path distinto (sem barra após
  // "biometric"), mas explícito para não depender só da ordem de matching.
  if (path.startsWith("/api/biometric-bridge/")) {
    return rateLimitBiometricBridge(c, next);
  }

  if (path.startsWith("/api/biometric/")) {
    return rateLimitBiometric(c, next);
  }

  if (
    path.startsWith("/api/totp/") ||
    path.startsWith("/api/ssa/")
  ) {
    return rateLimitSensitive(c, next);
  }

  // Endpoints públicos de verificação FORA de /api/public/ — QR-code scan
  // targets sem sessão, mesma razão de ser mais restritivo que o tráfego
  // autenticado (ver rateLimitPublicVerify acima). Achado de code review:
  // /api/handovers/:id/verify e /api/inventory/verify/:id não batiam em
  // nenhum branch acima e caíam no fallback geral (120/min — 4x mais
  // permissivo que o documentado para "sem sessão para responsabilizar").
  // /api/verify/:document_id (assinaturas de Cautela/Saída) tem exatamente
  // o mesmo perfil de risco — mesmo achado, adicionado depois na mesma
  // varredura — e caía no mesmo fallback antes desta linha.
  if (
    (path.startsWith("/api/handovers/") && path.endsWith("/verify") && c.req.method === "GET") ||
    (path.startsWith("/api/inventory/verify/") && c.req.method === "GET") ||
    (path.startsWith("/api/verify/") && c.req.method === "GET")
  ) {
    return rateLimitPublicVerify(c, next);
  }

  return rateLimitGeneral(c, next);
};
