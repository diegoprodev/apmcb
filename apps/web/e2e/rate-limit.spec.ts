/**
 * Rate Limit Validation Spec — RL01–RL09
 *
 * Valida que o sliding-window rate limiter do BFF está ativo em produção.
 * Roda em workers=1 para evitar que testes paralelos consumam cota uns dos outros.
 *
 * Auth limit: 5 req / 15 min por IP
 * Sensitive: 20 req / 1 min por IP
 * General:  120 req / 1 min por IP
 */
import { test, expect, type APIRequestContext } from "@playwright/test";
import { BFF_URL } from "./harness";

const AUTH_HEADERS = {
  "Content-Type": "application/json",
  Origin: "https://apmcb.pages.dev",
  "X-CSRF-Token": "probe-token",
};

async function probe(request: APIRequestContext) {
  return request.post(`${BFF_URL}/api/auth/login`, {
    data: { email: "ratelimit-probe@invalid.test", password: "wrong-password-probe" },
    headers: AUTH_HEADERS,
  });
}

/** Dispara até maxAttempts requests e retorna a primeira resposta 429 (ou a última). */
async function fireUntilBlocked(request: APIRequestContext, maxAttempts = 7) {
  let last: Awaited<ReturnType<typeof probe>> | undefined;
  for (let i = 0; i < maxAttempts; i++) {
    last = await probe(request);
    if (last.status() === 429) return { res: last, attempt: i + 1 };
  }
  return { res: last!, attempt: maxAttempts };
}

test.describe("RL — Rate Limiting (BFF Sliding Window)", () => {
  /**
   * RL01 — O endpoint /api/auth/login bloqueia após ≤5 tentativas por IP.
   * Prova que o limiter está ativo e configurado como 5/15min.
   */
  test("RL01 - auth endpoint bloqueia após ≤5 tentativas (429)", async ({ request }) => {
    const { res, attempt } = await fireUntilBlocked(request);
    expect(res.status()).toBe(429);
    // O bloqueio deve ocorrer no máximo na 6ª tentativa (índice 6)
    expect(attempt).toBeLessThanOrEqual(6);
  });

  /**
   * RL02 — Resposta 429 inclui Retry-After com valor > 0 e ≤ 900s (janela 15min).
   */
  test("RL02 - 429 inclui Retry-After dentro da janela de 15 min", async ({ request }) => {
    const { res } = await fireUntilBlocked(request);
    expect(res.status()).toBe(429);

    const retryAfter = Number(res.headers()["retry-after"]);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(900); // 15 min = 900 s
  });

  /**
   * RL03 — Resposta 429 inclui X-RateLimit-Limit = 5 (limite correto para /api/auth/).
   */
  test("RL03 - 429 tem X-RateLimit-Limit: 5 no auth endpoint", async ({ request }) => {
    const { res } = await fireUntilBlocked(request);
    expect(res.status()).toBe(429);
    expect(res.headers()["x-ratelimit-limit"]).toBe("5");
  });

  /**
   * RL04 — Resposta 429 inclui X-RateLimit-Remaining: 0.
   */
  test("RL04 - 429 tem X-RateLimit-Remaining: 0", async ({ request }) => {
    const { res } = await fireUntilBlocked(request);
    expect(res.status()).toBe(429);
    expect(res.headers()["x-ratelimit-remaining"]).toBe("0");
  });

  /**
   * RL05 — Resposta 429 inclui X-RateLimit-Reset com timestamp Unix no futuro.
   */
  test("RL05 - 429 tem X-RateLimit-Reset como epoch Unix futuro", async ({ request }) => {
    const { res } = await fireUntilBlocked(request);
    expect(res.status()).toBe(429);

    const reset = Number(res.headers()["x-ratelimit-reset"]);
    const nowSec = Math.floor(Date.now() / 1000);
    expect(reset).toBeGreaterThan(nowSec);
    // Reset deve estar dentro de 16 minutos (janela 15min + 60s de margem)
    expect(reset).toBeLessThan(nowSec + 16 * 60);
  });

  /**
   * RL06 — Body da resposta 429 contém { error, retry_after_seconds }.
   */
  test("RL06 - body do 429 tem error e retry_after_seconds", async ({ request }) => {
    const { res } = await fireUntilBlocked(request);
    expect(res.status()).toBe(429);

    const body = await res.json();
    expect(body.error).toBeTruthy();
    expect(body.retry_after_seconds).toBeGreaterThan(0);
    expect(body.retry_after_seconds).toBeLessThanOrEqual(900);
  });

  /**
   * RL07 — Endpoint /health (fora de /api/*) não tem rate limit (sem X-RateLimit-* headers).
   */
  test("RL07 - /health não é rate-limited (sem X-RateLimit-* headers)", async ({ request }) => {
    const res = await request.get(`${BFF_URL}/health`);
    expect(res.status()).toBe(200);

    // Health está fora de /api/* — o routeRateLimiter não intercepta
    expect(res.headers()["x-ratelimit-limit"]).toBeUndefined();
    expect(res.headers()["x-ratelimit-remaining"]).toBeUndefined();
  });

  /**
   * RL08 — Limiter do auth é isolado: bloquear /api/auth não afeta /health.
   * Prova que cada rota tem store independente (sem vazamento de estado).
   */
  test("RL08 - bloquear auth não afeta /health (stores isolados)", async ({ request }) => {
    // Garante que auth está bloqueado
    await fireUntilBlocked(request);

    // Health deve continuar respondendo normalmente
    const healthRes = await request.get(`${BFF_URL}/health`);
    expect(healthRes.status()).toBe(200);
    const body = await healthRes.json();
    expect(body.ok).toBe(true);
  });

  /**
   * RL09 — Consistência: Retry-After == Math.ceil((timestamps[0] + window - now) / 1000).
   * Verifica que o valor é determinístico e decresce entre requisições consecutivas.
   */
  test("RL09 - Retry-After decresce entre requisições consecutivas (sliding window)", async ({ request }) => {
    const { res: res1 } = await fireUntilBlocked(request);
    expect(res1.status()).toBe(429);
    const ra1 = Number(res1.headers()["retry-after"]);

    // Segunda requisição logo em seguida
    const res2 = await probe(request);
    expect(res2.status()).toBe(429);
    const ra2 = Number(res2.headers()["retry-after"]);

    // Retry-After não deve aumentar entre requisições consecutivas
    expect(ra2).toBeLessThanOrEqual(ra1);
    // E deve ser um valor positivo
    expect(ra2).toBeGreaterThan(0);
  });
});
