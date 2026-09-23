import { describe, it } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { LocalAuthProvider, type UsuariosRepository } from "../lib/local-auth-provider.ts";
import { AuthError } from "../lib/auth-provider.ts";

function fakeRepo(users: Array<{ id: string; email: string; senha_hash: string }>): UsuariosRepository {
  return {
    async findByEmail(email: string) {
      return users.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null;
    },
  };
}

describe("LocalAuthProvider.login", () => {
  it("autentica com email + senha corretos", async () => {
    const hash = await bcrypt.hash("senha123", 10);
    const repo = fakeRepo([{ id: "u1", email: "a@x.com", senha_hash: hash }]);
    const provider = new LocalAuthProvider(repo);

    const identity = await provider.login("a@x.com", "senha123");

    assert.equal(identity.userId, "u1");
    assert.equal(identity.email, "a@x.com");
  });

  it("email é case-insensitive (mesma normalização da Supabase Auth)", async () => {
    const hash = await bcrypt.hash("senha123", 10);
    const repo = fakeRepo([{ id: "u1", email: "a@x.com", senha_hash: hash }]);
    const provider = new LocalAuthProvider(repo);

    const identity = await provider.login("A@X.com", "senha123");

    assert.equal(identity.userId, "u1");
  });

  it("lança AuthError(invalid_credentials) com senha errada — mesma mensagem de usuário inexistente", async () => {
    const hash = await bcrypt.hash("senha123", 10);
    const repo = fakeRepo([{ id: "u1", email: "a@x.com", senha_hash: hash }]);
    const provider = new LocalAuthProvider(repo);

    await assert.rejects(
      () => provider.login("a@x.com", "senha-errada"),
      (err: unknown) => err instanceof AuthError && err.code === "invalid_credentials" && err.message === "Credenciais inválidas",
    );
  });

  it("lança AuthError(invalid_credentials) idêntico para email inexistente (não revela user enumeration)", async () => {
    const repo = fakeRepo([]);
    const provider = new LocalAuthProvider(repo);

    await assert.rejects(
      () => provider.login("naoexiste@x.com", "qualquer"),
      (err: unknown) => err instanceof AuthError && err.code === "invalid_credentials" && err.message === "Credenciais inválidas",
    );
  });
});

describe("LocalAuthProvider.verifyAccessToken", () => {
  it("lança AuthError(not_supported) — bearer fallback não existe no modo on-prem", async () => {
    const provider = new LocalAuthProvider(fakeRepo([]));

    await assert.rejects(
      () => provider.verifyAccessToken("qualquer-token"),
      (err: unknown) => err instanceof AuthError && err.code === "not_supported",
    );
  });
});
