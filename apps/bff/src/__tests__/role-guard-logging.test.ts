import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { roleGuard } from "../middleware/role-guard.ts";
import { requestIdMiddleware } from "../middleware/request-id.ts";
import type { HonoVariables } from "../types/hono.ts";

// Achado real de gap de observabilidade (varredura 2026-08-27): antes,
// negar um 403 de roleGuard só chegava ao log via onError como um
// "http.exception" genérico (status/error/path) — sem saber QUEM tentou e
// QUAL papel tinha vs. o exigido, indistinguível de qualquer outro 403.
// Um sinal de possível escalação de privilégio ficava sem contexto nenhum.
describe("roleGuard — log de negação (role_guard.denied)", () => {
  function makeApp() {
    const app = new Hono<{ Variables: HonoVariables }>();
    app.use("*", requestIdMiddleware);
    app.use("*", async (c, next) => {
      c.set("userId", c.req.header("x-test-user-id") ?? "user-1");
      c.set("role", (c.req.header("x-test-role") ?? "usuario") as never);
      await next();
    });
    app.get("/admin-only", roleGuard("admin_global"), (c) => c.json({ ok: true }));
    return app;
  }

  it("loga userId/role/allowedRoles/path antes de lançar 403", async () => {
    const app = makeApp();
    const calls: unknown[] = [];

    // requestIdMiddleware cria um child logger por request via
    // baseLogger.child(...) — interceptar .child() é o único jeito de
    // capturar o que o handler de fato usa (c.get("log")), sem depender de
    // monkey-patch no singleton global (evita vazar entre testes paralelos).
    const { baseLogger } = await import("../lib/logger.ts");
    const originalChild = baseLogger.child.bind(baseLogger);
    baseLogger.child = ((bindings: Record<string, unknown>) => {
      const child = originalChild(bindings);
      const originalWarn = child.warn.bind(child);
      child.warn = ((obj: unknown, msg?: string) => {
        calls.push({ obj, msg });
        return originalWarn(obj as never, msg as never);
      }) as typeof child.warn;
      return child;
    }) as unknown as typeof baseLogger.child;

    try {
      const res = await app.request("http://localhost/admin-only", {
        headers: { "x-test-user-id": "attacker-uuid", "x-test-role": "usuario" },
      });
      assert.equal(res.status, 403);

      const denial = calls.find((c) => (c as { msg?: string }).msg === "role_guard.denied") as
        | { obj: { userId: string; role: string; allowedRoles: string[]; path: string } }
        | undefined;
      assert.ok(denial, "esperava um log 'role_guard.denied' — a negação não deixou nenhum rastro estruturado");
      assert.equal(denial!.obj.userId, "attacker-uuid");
      assert.equal(denial!.obj.role, "usuario");
      assert.deepEqual(denial!.obj.allowedRoles, ["admin_global"]);
      assert.equal(denial!.obj.path, "/admin-only");
    } finally {
      baseLogger.child = originalChild;
    }
  });

  it("papel permitido não gera log de negação nenhum", async () => {
    const app = makeApp();
    const { baseLogger } = await import("../lib/logger.ts");
    const calls: unknown[] = [];
    const originalChild = baseLogger.child.bind(baseLogger);
    baseLogger.child = ((bindings: Record<string, unknown>) => {
      const child = originalChild(bindings);
      const originalWarn = child.warn.bind(child);
      child.warn = ((obj: unknown, msg?: string) => { calls.push(msg); return originalWarn(obj as never, msg as never); }) as typeof child.warn;
      return child;
    }) as unknown as typeof baseLogger.child;

    try {
      const res = await app.request("http://localhost/admin-only", {
        headers: { "x-test-role": "admin_global" },
      });
      assert.equal(res.status, 200);
      assert.equal(calls.includes("role_guard.denied"), false);
    } finally {
      baseLogger.child = originalChild;
    }
  });
});
