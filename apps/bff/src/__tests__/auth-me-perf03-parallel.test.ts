import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// PERF-03 (docs/enterprise/specs/navegacao-performance-enterprise.md), §8:
// GET /api/auth/me (apps/bff/src/routes/auth.ts) paralelizou as queries de
// revoked_sessions + profiles via Promise.all — antes eram sequenciais
// (await ... await ...), dobrando a latência do heartbeat que o frontend
// chama a cada navegação. Este teste tem 2 partes:
//
// 1) Guarda estática contra regressão: falha se alguém "simplificar" /me de
//    volta pra duas queries sequenciais (regressão de performance
//    silenciosa, sem quebrar nenhum teste funcional, já que o
//    COMPORTAMENTO observável é idêntico nos dois casos).
// 2) Réplica comportamental do mecanismo (mesmo padrão de
//    auth-middleware-session-renewal.test.ts: isola o MECANISMO sem
//    depender do Supabase real) — confirma que as 3 saídas continuam
//    corretas: sessão revogada → 401 session_invalidated; role mudou no DB
//    → 401 role_changed; sessão válida → 200 com o usuário.

const authRoutePath = resolve(process.cwd(), "src/routes/auth.ts");
const authRouteSrc = readFileSync(authRoutePath, "utf-8");

describe("GET /api/auth/me — PERF-03 paralelização de revoked_sessions + profiles", () => {
  it("[guarda estática] as duas queries continuam dentro de um único Promise.all no handler /me", () => {
    const meHandlerMatch = authRouteSrc.match(
      /authRoutes\.get\(["']\/me["'],[\s\S]*?^\}\);/m,
    );
    assert.ok(meHandlerMatch, "não encontrou o handler GET /me em auth.ts — arquivo foi reestruturado?");
    const handlerBody = meHandlerMatch[0];

    const promiseAllMatch = handlerBody.match(/Promise\.all\(\[([\s\S]*?)\]\)/);
    assert.ok(
      promiseAllMatch,
      "handler /me não contém mais um Promise.all — regressão do PERF-03 (voltou a ser sequencial, dobrando a latência do heartbeat)",
    );
    const promiseAllBody = promiseAllMatch[1];
    assert.match(
      promiseAllBody,
      /revoked_sessions/,
      "Promise.all de /me não inclui mais a query de revoked_sessions",
    );
    assert.match(
      promiseAllBody,
      /\.from\(["']profiles["']\)/,
      "Promise.all de /me não inclui mais a query de profiles",
    );
  });

  interface FakeProfile {
    role: string;
    sessions_invalidated_at: string | null;
  }

  // Réplica fiel da lógica de decisão de apps/bff/src/routes/auth.ts:389-413
  // (revokedErr log-and-continue, revoked→destroy+401, invalidatedAt/role
  // check, senão 200) — parametrizada por resultados injetados em vez do
  // Supabase real.
  async function runMeDecision(opts: {
    sessionRole: string;
    sessionIssuedAt: number;
    revoked: { session_id: string } | null;
    profile: FakeProfile | null;
    callOrder: string[];
  }): Promise<{ status: number; body: unknown }> {
    const revokedQuery = (async () => {
      opts.callOrder.push("revoked:start");
      await new Promise((r) => setTimeout(r, 5));
      opts.callOrder.push("revoked:end");
      return { data: opts.revoked, error: null };
    })();
    const profileQuery = (async () => {
      opts.callOrder.push("profile:start");
      await new Promise((r) => setTimeout(r, 5));
      opts.callOrder.push("profile:end");
      return { data: opts.profile };
    })();

    const [{ data: revoked }, { data: profile }] = await Promise.all([revokedQuery, profileQuery]);

    if (revoked) {
      return { status: 401, body: { user: null, reason: "session_invalidated" } };
    }

    if (profile) {
      const invalidatedAt = profile.sessions_invalidated_at
        ? new Date(profile.sessions_invalidated_at).getTime()
        : null;
      if (invalidatedAt && opts.sessionIssuedAt && opts.sessionIssuedAt < invalidatedAt) {
        return { status: 401, body: { user: null, reason: "session_invalidated" } };
      }
      if (profile.role !== opts.sessionRole) {
        return { status: 401, body: { user: null, reason: "role_changed" } };
      }
    }

    return { status: 200, body: { user: { id: "u1", role: opts.sessionRole } } };
  }

  it("as duas queries realmente rodam concorrentes, não uma depois da outra (evidência de call order intercalada)", async () => {
    const callOrder: string[] = [];
    await runMeDecision({
      sessionRole: "armeiro",
      sessionIssuedAt: 1000,
      revoked: null,
      profile: { role: "armeiro", sessions_invalidated_at: null },
      callOrder,
    });

    // Sequencial seria [revoked:start, revoked:end, profile:start, profile:end].
    // Concorrente via Promise.all começa as duas ANTES de qualquer uma terminar.
    assert.deepEqual(callOrder.slice(0, 2).sort(), ["profile:start", "revoked:start"].sort());
  });

  it("sessão revogada → 401 session_invalidated, mesmo com profile válido resolvido em paralelo", async () => {
    const { status, body } = await runMeDecision({
      sessionRole: "armeiro",
      sessionIssuedAt: 1000,
      revoked: { session_id: "s1" },
      profile: { role: "armeiro", sessions_invalidated_at: null },
      callOrder: [],
    });
    assert.equal(status, 401);
    assert.deepEqual(body, { user: null, reason: "session_invalidated" });
  });

  it("role mudou no DB desde o login → 401 role_changed", async () => {
    const { status, body } = await runMeDecision({
      sessionRole: "usuario",
      sessionIssuedAt: 1000,
      revoked: null,
      profile: { role: "armeiro", sessions_invalidated_at: null },
      callOrder: [],
    });
    assert.equal(status, 401);
    assert.deepEqual(body, { user: null, reason: "role_changed" });
  });

  it("sessão emitida antes de sessions_invalidated_at → 401 session_invalidated (invalidação administrativa em massa)", async () => {
    const { status, body } = await runMeDecision({
      sessionRole: "armeiro",
      sessionIssuedAt: 1000,
      revoked: null,
      profile: { role: "armeiro", sessions_invalidated_at: new Date(2000).toISOString() },
      callOrder: [],
    });
    assert.equal(status, 401);
    assert.deepEqual(body, { user: null, reason: "session_invalidated" });
  });

  it("sessão válida, role inalterada → 200 com o usuário", async () => {
    const { status, body } = await runMeDecision({
      sessionRole: "armeiro",
      sessionIssuedAt: 1000,
      revoked: null,
      profile: { role: "armeiro", sessions_invalidated_at: null },
      callOrder: [],
    });
    assert.equal(status, 200);
    assert.deepEqual(body, { user: { id: "u1", role: "armeiro" } });
  });
});
