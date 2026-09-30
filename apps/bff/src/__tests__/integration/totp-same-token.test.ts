import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { getIronSession } from "iron-session";
import { authMiddleware } from "../../middleware/auth.ts";
import { requestIdMiddleware } from "../../middleware/request-id.ts";
import { sameToken, totpRoutes } from "../../routes/totp.ts";
import { sessionOptions, type SessionData } from "../../lib/session.ts";
import { baseLogger } from "../../lib/logger.ts";
import { supabase } from "../../services/supabase.ts";
import type { HonoVariables } from "../../types/hono.ts";

// Varredura semgrep (2026-09-29): o anti-replay do código dinâmico comparava
// com `===`, cujo tempo depende de quantos caracteres coincidem. sameToken usa
// timingSafeEqual. Roda via bun (totp.ts usa imports sem extensão).
describe("sameToken — anti-replay em tempo constante", () => {
  it("igual → true; diferente, de outro tamanho ou sem código anterior → false", () => {
    assert.equal(sameToken("123456", "123456"), true);
    assert.equal(sameToken("123456", "123457"), false);
    assert.equal(sameToken("123456", "12345"), false);
    assert.equal(sameToken(null, "123456"), false);
    assert.equal(sameToken(undefined, "123456"), false);
    assert.equal(sameToken("", "123456"), false);
  });
});

// Revisão (2026-09-29): o 2º passo do Nexus (POST /api/totp/self-validate)
// bloqueava por tentativas (429) e recusava sem deixar rastro no log do BFF —
// força bruta contra o login de administrador ficava invisível. Handler real.
const ORIGINAL_FROM = supabase.from.bind(supabase);
const ORIGINAL_CHILD = baseLogger.child.bind(baseLogger);
const ADMIN_ID = "94444444-1111-1111-1111-111111111111";
let secretRow: Record<string, unknown> | null = null;
let warns: Array<{ obj: Record<string, unknown>; msg: string }> = [];

function builder(data: unknown): unknown {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === "then") return (resolve: (v: unknown) => void) => resolve({ data, error: null });
      if (prop === "single" || prop === "maybeSingle") return async () => ({ data, error: null });
      return () => new Proxy({}, handler);
    },
  };
  return new Proxy({}, handler);
}

before(() => {
  // @ts-expect-error monkey-patch intencional do singleton pra teste de integração
  supabase.from = (table: string) => {
    if (table === "profiles") return builder({ role: "admin_global", sessions_invalidated_at: null });
    if (table === "totp_secrets") return builder(secretRow);
    return builder(null);
  };
  baseLogger.child = ((bindings: Record<string, unknown>) => {
    const child = ORIGINAL_CHILD(bindings);
    child.warn = ((obj: Record<string, unknown>, msg: string) => { warns.push({ obj, msg }); }) as typeof child.warn;
    return child;
  }) as unknown as typeof baseLogger.child;
});

after(() => {
  supabase.from = ORIGINAL_FROM;
  baseLogger.child = ORIGINAL_CHILD;
});

beforeEach(() => { warns = []; secretRow = null; });

const app = new Hono<{ Variables: HonoVariables }>();
app.use("*", requestIdMiddleware);
app.use("/api/totp/*", authMiddleware);
app.route("/api/totp", totpRoutes);

async function selfValidate() {
  const req = new Request("http://localhost/seal");
  const res = new Response(null);
  const session = await getIronSession<SessionData>(req, res, sessionOptions);
  Object.assign(session, {
    userId: ADMIN_ID, role: "admin_global", tenantId: "94444444-0000-0000-0000-000000000001",
    supabaseAccessToken: "fake", sessionId: "sess-nexus-1", issuedAt: Date.now(),
  } satisfies Partial<SessionData>);
  await session.save();
  const cookie = res.headers.getSetCookie().find((v) => v.startsWith(`${sessionOptions.cookieName}=`))!.split(";")[0];
  return app.request("/api/totp/self-validate", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ token: "123456" }),
  });
}

describe("POST /api/totp/self-validate — recusas deixam rastro (handler real)", () => {
  it("bloqueado por tentativas → 429 e warn totp.self_validate.rejected rate_limited", async () => {
    secretRow = { id: "s1", secret: "irrelevante", failure_count: 5, last_failure_at: new Date().toISOString(), last_used_token: null };
    const res = await selfValidate();
    assert.equal(res.status, 429);
    const w = warns.find((x) => x.msg === "totp.self_validate.rejected");
    assert.ok(w, "força bruta no 2º passo do Nexus sem rastro no log");
    assert.equal(w.obj.reason, "rate_limited");
    assert.equal(w.obj.userId, ADMIN_ID);
  });

  it("sem código configurado → 404 e warn not_configured", async () => {
    secretRow = null;
    const res = await selfValidate();
    assert.equal(res.status, 404);
    const w = warns.find((x) => x.msg === "totp.self_validate.rejected");
    assert.ok(w, "recusa sem rastro no log");
    assert.equal(w.obj.reason, "not_configured");
  });
});
