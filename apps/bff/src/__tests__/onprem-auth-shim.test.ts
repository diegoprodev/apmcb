import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const shimPath = resolve(process.cwd(), "../../supabase/onprem-bootstrap/000_auth_shim.sql");
const shimSrc = readFileSync(shimPath, "utf-8");

describe("supabase/onprem-bootstrap/000_auth_shim.sql", () => {
  it("cria o schema auth de forma idempotente", () => {
    assert.match(shimSrc, /CREATE SCHEMA IF NOT EXISTS auth/i);
  });

  it("cria auth.users com id uuid PRIMARY KEY (satisfaz o FK de profiles.id)", () => {
    assert.match(shimSrc, /CREATE TABLE IF NOT EXISTS auth\.users/i);
    assert.match(shimSrc, /id\s+uuid PRIMARY KEY/i);
  });

  it("cria auth.uid() lendo request.jwt.claims via current_setting", () => {
    assert.match(shimSrc, /CREATE OR REPLACE FUNCTION auth\.uid\(\)/i);
    assert.match(shimSrc, /current_setting\(\s*'request\.jwt\.claims'/i);
  });

  it("nunca usa DROP ou referencia storage/realtime (escopo mínimo, não é um clone da Supabase)", () => {
    assert.doesNotMatch(shimSrc, /DROP\s+(TABLE|SCHEMA)/i);
    assert.doesNotMatch(shimSrc, /storage\.|realtime\./i);
  });
});
