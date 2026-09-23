import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const authRouteSrc = readFileSync(resolve(process.cwd(), "src/routes/auth.ts"), "utf-8");
const middlewareSrc = readFileSync(resolve(process.cwd(), "src/middleware/auth.ts"), "utf-8");

describe("routes/auth.ts usa AuthProvider em vez de fetch inline", () => {
  it("POST /login não chama mais fetch(.../auth/v1/token...) diretamente", () => {
    assert.doesNotMatch(authRouteSrc, /auth\/v1\/token\?grant_type=password/);
  });

  it("POST /exchange não chama mais fetch(.../auth/v1/user...) diretamente", () => {
    const exchangeOnly = authRouteSrc.split('authRoutes.post("/exchange"')[1] ?? "";
    assert.doesNotMatch(exchangeOnly.split('authRoutes.post("/logout"')[0], /fetch\(/);
  });

  it("importa createAuthProvider", () => {
    assert.match(authRouteSrc, /import\s*\{[^}]*createAuthProvider[^}]*\}\s*from\s*["']\.\.\/lib\/auth-provider-factory["']/);
  });
});

describe("middleware/auth.ts usa AuthProvider no fallback Bearer", () => {
  it("não chama mais fetch(.../auth/v1/user...) diretamente", () => {
    assert.doesNotMatch(middlewareSrc, /auth\/v1\/user/);
  });

  it("trata AuthError(not_supported) devolvendo HTTPException, nunca deixa a exceção subir crua", () => {
    assert.match(middlewareSrc, /not_supported/);
    assert.match(middlewareSrc, /HTTPException/);
  });
});
