import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getIronSession, type SessionOptions } from "iron-session";

// Regressão: POST /api/session/mode (e qualquer rota atrás de authMiddleware
// que chama session.save() com seu próprio getIronSession() — /api/nexus/*,
// /api/totp/*, /api/lendings/*, /api/reserves/*) gerava DOIS headers
// `Set-Cookie: apmcb_session=...` na mesma resposta: um da renovação
// deslizante do authMiddleware (incondicional, ANTES de next()) e outro do
// próprio handler da rota. Cada cookie selado carrega o JWT do Supabase
// (~1.7KB), então dois deles quase dobravam o tamanho dos headers de
// resposta e estouravam o proxy_buffer_size default do nginx (4KB),
// causando 502 "upstream sent too big header" — que o browser reporta como
// bloqueio de CORS, porque o nginx aborta antes de repassar
// Access-Control-Allow-Origin. Reproduzido 100% das vezes em produção via
// curl direto contra api.apmcb.pmpb.online/api/session/mode.
//
// Este teste isola o MECANISMO da correção (checar
// `res.headers.getSetCookie()` depois de next() e pular a renovação se a
// rota já persistiu) sem depender do Supabase real que authMiddleware usa
// para checkSessionValid — testar o mecanismo em isolamento é suficiente
// porque é exatamente o que estourava o header.

interface TestSessionData {
  userId?: string;
  activeMode?: string;
}

const sessionOptions: SessionOptions = {
  password: "test-only-session-secret-padded-to-32-chars-minimum",
  cookieName: "apmcb_session_test",
};

type RouteBehavior = "saves" | "no-op" | "throws-before-saving";

// Replica o padrão real de apps/bff/src/middleware/auth.ts:
// - "middleware" abre sua própria instância de sessão (getIronSession #1)
// - roda `next()` dentro de try/finally (a renovação deve rodar mesmo se a
//   rota lançar, preservando o comportamento original de sempre renovar)
// - a rota downstream PODE abrir a SUA PRÓPRIA instância (getIronSession #2)
//   e persistir mudanças (como /api/session/mode faz com activeMode)
// - a renovação deslizante do middleware só deve rodar se a rota ainda não
//   tiver persistido nada
async function runRequest(
  behavior: RouteBehavior,
): Promise<{ cookies: string[]; threw: boolean }> {
  const req = new Request("http://localhost/test");
  const res = new Response(null);

  const mwSession = await getIronSession<TestSessionData>(req, res, sessionOptions);
  mwSession.userId = "u1";

  let threw = false;
  try {
    // equivalente a `await next()`
    if (behavior === "saves") {
      const routeSession = await getIronSession<TestSessionData>(req, res, sessionOptions);
      routeSession.userId = "u1";
      routeSession.activeMode = "usuario";
      await routeSession.save();
    } else if (behavior === "throws-before-saving") {
      throw new Error("HTTPException simulada (ex: 403 antes de qualquer session.save())");
    }
  } catch {
    // authMiddleware não engole a exceção da rota — só a deixamos propagar
    // até aqui pra poder inspecionar `res` depois do finally, abaixo.
    threw = true;
  } finally {
    // renovação deslizante — só roda se a rota downstream ainda não setou
    // Set-Cookie para o mesmo nome de cookie
    const alreadyPersisted = res.headers
      .getSetCookie()
      .some((v) => v.startsWith("apmcb_session_test="));
    if (!alreadyPersisted) {
      await mwSession.save();
    }
  }

  return {
    cookies: res.headers.getSetCookie().filter((v) => v.startsWith("apmcb_session_test=")),
    threw,
  };
}

describe("authMiddleware — renovação deslizante sem Set-Cookie duplicado", () => {
  it("NÃO duplica Set-Cookie quando a rota downstream já persistiu a própria sessão (bug real: /api/session/mode)", async () => {
    const { cookies } = await runRequest("saves");
    assert.equal(
      cookies.length,
      1,
      `esperava exatamente 1 Set-Cookie apmcb_session, encontrou ${cookies.length} — isso é o que estourava o proxy_buffer_size do nginx (502 "upstream sent too big header")`,
    );
  });

  it("continua renovando a sessão quando a rota downstream não persiste nada (preserva o comportamento original)", async () => {
    const { cookies } = await runRequest("no-op");
    assert.equal(
      cookies.length,
      1,
      "renovação deslizante deve continuar funcionando para rotas que não chamam session.save() sozinhas (ex: /api/auth/me, /api/dashboard)",
    );
  });

  it("continua renovando a sessão mesmo quando a rota downstream lança HTTPException (ex: 403) antes de salvar", async () => {
    const { cookies, threw } = await runRequest("throws-before-saving");
    assert.equal(threw, true, "a simulação deveria ter lançado");
    assert.equal(
      cookies.length,
      1,
      "renovação deslizante deve rodar no finally mesmo quando a rota lança antes de qualquer session.save() — comportamento original preservado",
    );
  });
});
