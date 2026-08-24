import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { getIronSession } from "iron-session";
import { authRoutes } from "../../routes/auth.ts";
import { sessionOptions, type SessionData } from "../../lib/session.ts";
import { supabase } from "../../services/supabase.ts";
import type { HonoVariables } from "../../types/hono.ts";

// PERF-03 (docs/enterprise/specs/navegacao-performance-enterprise.md §8):
// achado de code review — auth-me-perf03-parallel.test.ts reimplementa a
// lógica de decisão em código de teste separado (mesmo padrão já aceito em
// auth-middleware-session-renewal.test.ts), então nunca detectaria uma
// regressão na ORDEM real de checagens dentro do handler de produção. Este
// arquivo complementa isso: monta o app Hono real com authRoutes montado
// (mesmo `app.route("/api/auth", authRoutes)` de src/index.ts), chama
// GET /api/auth/me via app.request() de verdade, e só troca o que o
// Supabase responderia (monkey-patch de `supabase.from`/`supabase.rpc` —
// `supabase` é um singleton exportado, mutável, o mesmo objeto que auth.ts
// importa, então sobrescrever seus métodos aqui afeta o código real sem
// precisar de vi.mock/module mocking).
//
// Roda via `bun test` (`npm run test:integration`), NÃO
// `node --experimental-strip-types --test` (o script "test" padrão do
// package.json) — todo o código-fonte de apps/bff/src usa imports relativos
// sem extensão (`from "../services/supabase"`), que só resolvem via bun ou
// um bundler; o resolver ESM nativo do Node exige extensão explícita e
// quebra na 1ª importação transitiva. Por isso nenhum outro teste desta
// suíte importa módulos reais de apps/bff/src — todos usam o padrão de
// "réplica de mecanismo" (ver auth-middleware-session-renewal.test.ts).
// Requer SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY/SESSION_SECRET — bun
// carrega .env automaticamente, sem flag extra.

const ORIGINAL_FROM = supabase.from.bind(supabase);
let mockRevoked: { session_id: string } | null = null;
let mockProfile: { role: string; sessions_invalidated_at: string | null } | null = null;

before(() => {
  // @ts-expect-error monkey-patch intencional do singleton pra teste de integração
  supabase.from = (table: string) => {
    if (table === "revoked_sessions") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: mockRevoked, error: null }),
          }),
        }),
      };
    }
    if (table === "profiles") {
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: mockProfile, error: null }),
          }),
        }),
      };
    }
    throw new Error(`tabela não mockada neste teste: ${table}`);
  };
});

after(() => {
  supabase.from = ORIGINAL_FROM;
});

const app = new Hono<{ Variables: HonoVariables }>();
app.route("/api/auth", authRoutes);

async function sealSession(data: Partial<SessionData>): Promise<string> {
  const req = new Request("http://localhost/seal");
  const res = new Response(null);
  const session = await getIronSession<SessionData>(req, res, sessionOptions);
  Object.assign(session, data);
  await session.save();
  const setCookie = res.headers.getSetCookie().find((v) => v.startsWith(`${sessionOptions.cookieName}=`));
  assert.ok(setCookie, "falha ao selar sessão de teste");
  return setCookie.split(";")[0]; // só "nome=valor", sem os atributos do cookie
}

describe("GET /api/auth/me — handler real (integração via app Hono, não réplica)", () => {
  it("sessão revogada → 401 session_invalidated", async () => {
    mockRevoked = { session_id: "sess-1" };
    mockProfile = { role: "armeiro", sessions_invalidated_at: null };
    const cookie = await sealSession({
      userId: "11111111-1111-1111-1111-111111111111",
      role: "armeiro",
      tenantId: null,
      reserveId: null,
      supabaseAccessToken: "fake",
      sessionId: "sess-1",
      issuedAt: Date.now(),
    });

    const res = await app.request("/api/auth/me", { headers: { cookie } });
    const body = await res.json();
    assert.equal(res.status, 401);
    assert.deepEqual(body, { user: null, reason: "session_invalidated" });
  });

  it("role divergente do DB → 401 role_changed", async () => {
    mockRevoked = null;
    mockProfile = { role: "admin_reserva", sessions_invalidated_at: null };
    const cookie = await sealSession({
      userId: "22222222-2222-2222-2222-222222222222",
      role: "armeiro", // sessão foi selada com "armeiro", DB agora diz "admin_reserva"
      tenantId: null,
      reserveId: null,
      supabaseAccessToken: "fake",
      sessionId: "sess-2",
      issuedAt: Date.now(),
    });

    const res = await app.request("/api/auth/me", { headers: { cookie } });
    const body = await res.json();
    assert.equal(res.status, 401);
    assert.deepEqual(body, { user: null, reason: "role_changed" });
  });

  it("sessão válida, role inalterada → 200 com o usuário", async () => {
    mockRevoked = null;
    mockProfile = { role: "armeiro", sessions_invalidated_at: null };
    const userId = "33333333-3333-3333-3333-333333333333";
    const cookie = await sealSession({
      userId,
      role: "armeiro",
      tenantId: null,
      reserveId: null,
      supabaseAccessToken: "fake",
      sessionId: "sess-3",
      issuedAt: Date.now(),
    });

    const res = await app.request("/api/auth/me", { headers: { cookie } });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(body, { user: { id: userId, role: "armeiro" } });
  });

  it("sem cookie de sessão → 401 com user null (sem chamar Supabase)", async () => {
    const res = await app.request("/api/auth/me");
    const body = await res.json();
    assert.equal(res.status, 401);
    assert.deepEqual(body, { user: null });
  });
});
