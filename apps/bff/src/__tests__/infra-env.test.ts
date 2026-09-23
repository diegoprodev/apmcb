import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadInfraEnv } from "../lib/infra-env.ts";

describe("loadInfraEnv", () => {
  it("lança erro se AMBIENTE_INFRA estiver ausente", () => {
    assert.throws(() => loadInfraEnv({}), /AMBIENTE_INFRA/);
  });

  it("lança erro se AMBIENTE_INFRA tiver valor fora do enum", () => {
    assert.throws(() => loadInfraEnv({ AMBIENTE_INFRA: "AWS" }), /AMBIENTE_INFRA/);
  });

  it("modo SUPABASE exige SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY", () => {
    assert.throws(
      () => loadInfraEnv({ AMBIENTE_INFRA: "SUPABASE" }),
      /SUPABASE_URL/,
    );
  });

  it("modo SUPABASE válido retorna InfraEnv correto", () => {
    const env = loadInfraEnv({
      AMBIENTE_INFRA: "SUPABASE",
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "svc-key",
    });
    assert.equal(env.mode, "SUPABASE");
    assert.equal(env.supabaseUrl, "https://x.supabase.co");
    assert.equal(env.supabaseServiceRoleKey, "svc-key");
  });

  it("modo ON_PREMISE exige DATABASE_URL", () => {
    assert.throws(
      () => loadInfraEnv({ AMBIENTE_INFRA: "ON_PREMISE" }),
      /DATABASE_URL/,
    );
  });

  it("modo ON_PREMISE válido retorna InfraEnv correto", () => {
    const env = loadInfraEnv({
      AMBIENTE_INFRA: "ON_PREMISE",
      DATABASE_URL: "postgres://user:pass@localhost:5432/apmcb",
    });
    assert.equal(env.mode, "ON_PREMISE");
    assert.equal(env.databaseUrl, "postgres://user:pass@localhost:5432/apmcb");
  });
});
