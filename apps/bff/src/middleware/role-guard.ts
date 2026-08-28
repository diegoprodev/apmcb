import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { HonoVariables, Role } from "../types/hono";

export function roleGuard(
  ...allowedRoles: Role[]
): MiddlewareHandler<{ Variables: HonoVariables }> {
  return async (c, next) => {
    const role = c.get("role");
    if (!allowedRoles.includes(role)) {
      // Achado real de gap de observabilidade (varredura 2026-08-27): antes,
      // só o HTTPException genérico chegava ao log (via onError,
      // "http.exception" com status/error/path) — sem saber QUEM tentou e
      // QUAL papel tinha vs. o exigido, um sinal de possível escalação de
      // privilégio ficava indistinguível de qualquer outro 403. warn (não
      // error): é uma negação esperada do sistema funcionando corretamente,
      // não uma falha — mas vale ficar registrado pra monitoramento de
      // segurança (tentativas repetidas do mesmo userId contra rotas fora
      // do seu papel).
      c.get("log")?.warn({
        userId: c.get("userId"),
        role,
        allowedRoles,
        path: c.req.path,
        method: c.req.method,
      }, "role_guard.denied");
      throw new HTTPException(403, { message: "Insufficient permissions" });
    }
    await next();
  };
}
