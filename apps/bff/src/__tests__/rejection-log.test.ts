import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Hono, type Context } from "hono";
import type { HonoVariables } from "../types/hono.ts";
import { logFailure, logRejection, rejectionDetail } from "../lib/rejection-log.ts";

// Achado real (2026-09-24): a saída por digital com o leitor Hamster DX
// falhava com 409 LENDING_BIOMETRIC_PROOF_INVALID e o `docker logs` não
// mostrava nada — o ramo P0001/23505 das RPCs de saída/devolução e as
// recusas da prova biométrica (liveness, assinatura, bridge) respondiam ao
// cliente sem log. Regra do CLAUDE.md: toda negação deixa rastro no BFF.

function appWithCapturedLog(handler: (c: Context<{ Variables: HonoVariables }>) => Response | Promise<Response>) {
  const calls: Array<{ obj: Record<string, unknown>; msg: string }> = [];
  const app = new Hono<{ Variables: HonoVariables }>();
  app.use("*", async (c, next) => {
    c.set("log", { warn: (obj: Record<string, unknown>, msg: string) => calls.push({ obj, msg }) } as never);
    await next();
  });
  app.get("/t", handler);
  return { app, calls };
}

describe("logRejection — negação sempre deixa rastro estruturado", () => {
  it("loga o evento com o contexto e o detalhe", async () => {
    const { app, calls } = appWithCapturedLog((c) => {
      logRejection(c, "lending.batch_create.rejected", { code: "P0001", tenantId: "t1" }, "LENDING_BIOMETRIC_PROOF_INVALID");
      return c.json({}, 409);
    });
    await app.request("http://localhost/t");
    assert.deepEqual(calls, [{
      msg: "lending.batch_create.rejected",
      obj: { code: "P0001", tenantId: "t1", detail: "LENDING_BIOMETRIC_PROOF_INVALID" },
    }]);
  });

  it("limita o detalhe a 200 caracteres (mensagem de RPC não vira log gigante)", async () => {
    const { app, calls } = appWithCapturedLog((c) => {
      logRejection(c, "e", {}, "x".repeat(500));
      return c.json({});
    });
    await app.request("http://localhost/t");
    assert.equal((calls[0].obj.detail as string).length, 200);
  });

  it("sem detalhe, não grava a chave detail", async () => {
    const { app, calls } = appWithCapturedLog((c) => {
      logRejection(c, "e", { reason: "liveness_rejected" }, null);
      return c.json({});
    });
    await app.request("http://localhost/t");
    assert.deepEqual(calls[0].obj, { reason: "liveness_rejected" });
  });

  it("com código de erro no início, loga só o código (RAISE futuro com dado pessoal não vaza)", async () => {
    const { app, calls } = appWithCapturedLog((c) => {
      logRejection(c, "e", {}, "LENDING_MILITARY_BLOCKED: Fulano de Tal mat. 123456");
      return c.json({});
    });
    await app.request("http://localhost/t");
    assert.equal(calls[0].obj.detail, "LENDING_MILITARY_BLOCKED");
  });

  it("rejectionDetail: só trata como código um prefixo com '_' seguido de separador", () => {
    assert.equal(rejectionDetail("LENDING_BIOMETRIC_PROOF_INVALID"), "LENDING_BIOMETRIC_PROOF_INVALID");
    assert.equal(rejectionDetail("LENDING_X: Fulano 123"), "LENDING_X");
    assert.equal(rejectionDetail("TOTP inválido"), "TOTP inválido");
    assert.equal(rejectionDetail("BIOMETRIC_RETURN_2: y"), "BIOMETRIC_RETURN_2");
    assert.equal(rejectionDetail("LENDINGX: sem underscore"), "LENDINGX: sem underscore");
    assert.equal(rejectionDetail("biometric policy score below threshold"), "biometric policy score below threshold");
  });

  it("logFailure cai no logger base quando falta o do contexto", async () => {
    const { baseLogger } = await import("../lib/logger.ts");
    const original = baseLogger.error;
    const seen: string[] = [];
    baseLogger.error = ((_obj: unknown, msg: string) => { seen.push(msg); }) as typeof baseLogger.error;
    try {
      const app = new Hono<{ Variables: HonoVariables }>();
      app.get("/t", (c) => {
        logFailure(c, { code: "XX000" }, "algo.persist_failure");
        return c.json({ ok: true }, 500);
      });
      await app.request("http://localhost/t");
      assert.deepEqual(seen, ["algo.persist_failure"]);
    } finally {
      baseLogger.error = original;
    }
  });

  it("sem logger no contexto (rota sem request-id), cai no logger base — a recusa nunca some", async () => {
    const { baseLogger } = await import("../lib/logger.ts");
    const original = baseLogger.warn;
    const seen: string[] = [];
    baseLogger.warn = ((_obj: unknown, msg: string) => { seen.push(msg); }) as typeof baseLogger.warn;
    try {
      const app = new Hono<{ Variables: HonoVariables }>();
      app.get("/t", (c) => {
        logRejection(c, "sem.request.id", {});
        return c.json({ ok: true });
      });
      const res = await app.request("http://localhost/t");
      assert.equal(res.status, 200);
      assert.deepEqual(seen, ["sem.request.id"]);
    } finally {
      baseLogger.warn = original;
    }
  });
});

// Guarda de fiação (não prova correção — prova que cada ramo de recusa
// chama o helper; a correção do helper está nos testes acima).
describe("fiação — ramos de recusa chamam logRejection", () => {
  const routes = resolve(process.cwd(), "src/routes");
  const read = (f: string) => readFileSync(resolve(routes, f), "utf8");

  // Tolerante a reflow do formatter: espaços/quebras entre os tokens.
  const logged = (src: string, event: string, reason: string) =>
    new RegExp(`logRejection\\(\\s*c,\\s*"${event.replace(/\./g, "\\.")}",\\s*\\{\\s*reason:\\s*${reason}`).test(src);

  it("lendings.ts: identificação, saída em lote, saída avulsa e devolução", () => {
    const src = read("lendings.ts");
    const expected: Record<string, string[]> = {
      "lending.identify.rejected": ['"reserve_forbidden"', "`totp_\\$\\{result\\.reason\\}`", '"no_matched_user"', '"proof_invalid"', '"profile_not_in_tenant"'],
      "lending.batch_create.rejected": ['"shift_required"', '"shift_reserve_mismatch"', '"reserve_forbidden"', '"military_not_in_reserve"', '"military_not_found"', '"military_impedido"', '"identity_required"', '"proof_invalid"', '"rpc_rejected"'],
      "lending.create.rejected": ['"shift_required"', '"reserve_missing"', '"reserve_forbidden"', '"military_not_in_reserve"', '"military_not_found"', '"military_impedido"', '"material_not_found"', '"insufficient_stock"', '"shift_reserve_mismatch"', '"identity_required"', '"proof_missing"', '"proof_invalid"', '"rpc_rejected"'],
      "lending.bulk_return.rejected": ['"identity_required"', '"shift_required"', '"shift_reserve_mismatch"', '"proof_missing"', '"rpc_rejected"'],
    };
    for (const [event, reasons] of Object.entries(expected)) {
      for (const reason of reasons) assert.ok(logged(src, event, reason), `lendings.ts: faltou ${event} com reason ${reason}`);
    }
    // 42501 (assert_actor_in_reserve) é negação de autorização, não 500.
    for (const event of ["lending.batch_create.rejected", "lending.create.rejected", "lending.bulk_return.rejected"]) {
      assert.ok(logged(src, event, '"rpc_forbidden"'), `lendings.ts: faltou ${event} com rpc_forbidden`);
    }
    assert.ok(logged(src, "lending.rejected", '"session_invalid"'), "lendings.ts: faltou log de sessão inválida");
    assert.doesNotMatch(src, /c\.get\("log"\)\??\.error\(/, "lendings.ts: 5xx deve usar logFailure (fallback de logger)");
  });

  it("totp.ts: /api/totp/identify loga o motivo categórico", () => {
    assert.ok(logged(read("totp.ts"), "totp.identify.rejected", "result\\.reason"));
  });

  it("rotas de prova (bridge, submit, simulador): toda recusa loga biometric.proof.rejected", () => {
    const reasons = ["challenge_mismatch", "no_matched_user", "liveness_rejected", "user_not_in_tenant", "proof_rpc_rejected"];
    const bySource: Record<string, string[]> = {
      "biometric-bridge.ts": [...reasons, "device_unauthorized", "signature_invalid", "policy_rejected"],
      "biometric.ts": [...reasons, "device_unauthorized", "signature_invalid", "policy_rejected", "reserve_forbidden"],
      "biometric-simulator.ts": [...reasons, "challenge_not_found", "reserve_forbidden"],
    };
    for (const [file, list] of Object.entries(bySource)) {
      const src = read(file);
      assert.match(src, /logRejection\(\s*c,\s*"biometric\.proof\.rejected"/, `${file}: deny() não loga biometric.proof.rejected`);
      for (const reason of list) assert.ok(src.includes(`deny("${reason}"`), `${file}: faltou log de ${reason}`);
    }
  });
});
