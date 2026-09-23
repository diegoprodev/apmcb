import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { generateTempPassword, provisionLocalUser } from "../../scripts/provision-local-user.ts";

describe("generateTempPassword", () => {
  it("gera senha com pelo menos 16 caracteres (12 bytes em base64url)", () => {
    const pw = generateTempPassword();
    assert.ok(pw.length >= 16);
  });

  it("gera senhas diferentes a cada chamada", () => {
    assert.notEqual(generateTempPassword(), generateTempPassword());
  });
});

describe("provisionLocalUser", () => {
  function fakePool(tenantId: string | null) {
    const queries: Array<{ sql: string; params: any[] }> = [];
    const client = {
      query: mock.fn(async (sql: string, params?: any[]) => {
        queries.push({ sql, params: params || [] });
        if (sql.includes("SELECT id FROM public.tenants")) {
          return { rows: tenantId ? [{ id: tenantId }] : [] };
        }
        return { rows: [] };
      }),
      release: mock.fn(),
    };
    return { connect: async () => client, _queries: queries, _client: client };
  }

  it("insere nas 3 tabelas com o mesmo id, dentro de BEGIN/COMMIT", async () => {
    const pool = fakePool("tenant-1");
    const result = await provisionLocalUser(pool as never, {
      email: "admin@orgao.gov.br",
      nome: "Admin",
      tenantSlug: "orgao-x",
      matricula: "ADM001",
      password: "senha-temp",
    });

    assert.ok(result.userId);

    // Verify transaction structure
    assert.ok(pool._queries.some((q) => q.sql.includes("BEGIN")));
    assert.ok(pool._queries.some((q) => q.sql.includes("INSERT INTO auth.users")));
    assert.ok(pool._queries.some((q) => q.sql.includes("INSERT INTO public.usuarios")));
    assert.ok(pool._queries.some((q) => q.sql.includes("INSERT INTO public.profiles")));
    assert.ok(pool._queries.some((q) => q.sql.includes("COMMIT")));

    // Verify same userId across all three INSERTs
    const authUsersQuery = pool._queries.find((q) => q.sql.includes("INSERT INTO auth.users"));
    const usuariosQuery = pool._queries.find((q) => q.sql.includes("INSERT INTO public.usuarios"));
    const profilesQuery = pool._queries.find((q) => q.sql.includes("INSERT INTO public.profiles"));

    assert.ok(authUsersQuery, "auth.users INSERT should exist");
    assert.ok(usuariosQuery, "public.usuarios INSERT should exist");
    assert.ok(profilesQuery, "public.profiles INSERT should exist");

    const authUserId = authUsersQuery!.params[0];
    const usuariosUserId = usuariosQuery!.params[0];
    const profilesUserId = profilesQuery!.params[0];

    assert.equal(authUserId, result.userId, "auth.users userId should match returned userId");
    assert.equal(usuariosUserId, result.userId, "public.usuarios userId should match returned userId");
    assert.equal(profilesUserId, result.userId, "public.profiles userId should match returned userId");
    assert.equal(authUserId, usuariosUserId, "auth.users and public.usuarios should have same userId");
    assert.equal(usuariosUserId, profilesUserId, "public.usuarios and public.profiles should have same userId");

    // C2: matricula é NOT NULL UNIQUE em public.profiles — o INSERT precisa
    // incluí-la, e registration_status precisa ir como 'complete' (não o
    // default 'pending_biometric') para o admin provisionado conseguir usar
    // o sistema de fato.
    assert.ok(profilesQuery!.sql.includes("matricula"), "profiles INSERT should include matricula column");
    assert.ok(profilesQuery!.sql.includes("registration_status"), "profiles INSERT should include registration_status column");
    assert.ok(profilesQuery!.params.includes("ADM001"), "profiles INSERT params should include the matricula value");
    assert.match(profilesQuery!.sql, /'complete'/, "profiles INSERT should set registration_status = 'complete'");
  });

  it("dá ROLLBACK e lança erro se o tenant não existir", async () => {
    const pool = fakePool(null);

    await assert.rejects(
      () => provisionLocalUser(pool as never, {
        email: "admin@orgao.gov.br",
        nome: "Admin",
        tenantSlug: "tenant-inexistente",
        matricula: "ADM002",
        password: "senha-temp",
      }),
      /tenant com slug "tenant-inexistente" não existe/,
    );
    assert.ok(pool._queries.some((q) => q.sql.includes("ROLLBACK")));
  });
});
