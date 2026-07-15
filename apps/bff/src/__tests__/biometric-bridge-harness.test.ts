import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(process.cwd(), "..", "..");

function readRepo(relPath: string) {
  return readFileSync(resolve(repoRoot, relPath), "utf8").replace(/\r\n/g, "\n");
}

function migration() {
  const rel = "supabase/migrations/20260714000001_biometric_bridge_foundation.sql";
  assert.equal(existsSync(resolve(repoRoot, rel)), true, "biometric bridge migration must exist");
  return readRepo(rel);
}

describe("biometric bridge schema harness", () => {
  it("creates devices, challenges and immutable proofs", () => {
    const sql = migration();
    for (const table of ["biometric_devices", "biometric_challenges", "biometric_proofs"]) {
      assert.match(sql, new RegExp(`create table if not exists ${table}`, "i"), `${table} table missing`);
      assert.match(sql, new RegExp(`alter table ${table} enable row level security`, "i"), `${table} RLS missing`);
    }

    assert.match(sql, /create rule no_update_biometric_proofs/i);
    assert.match(sql, /create rule no_delete_biometric_proofs/i);
    assert.match(sql, /create or replace function assert_biometric_bridge_scope/i);
    assert.match(sql, /create trigger biometric_devices_scope_guard/i);
    assert.match(sql, /create trigger biometric_challenges_scope_guard/i);
    assert.match(sql, /create trigger biometric_proofs_scope_guard/i);
    assert.match(sql, /ch\.device_id is null or ch\.device_id = new\.device_id/i);
    assert.match(sql, /public_key\s+text\s+not null/i);
    assert.match(sql, /challenge_id\s+uuid\s+not null\s+unique\s+references biometric_challenges\(id\)/i);
    assert.match(sql, /bridge_signature\s+text\s+not null/i);
    assert.match(sql, /expires_at\s+timestamptz\s+not null/i);
  });

  it("hardens biometric_templates for tenant-wide matching", () => {
    const sql = migration();
    assert.match(sql, /add column if not exists tenant_id uuid references tenants\(id\)/i);
    assert.match(sql, /update biometric_templates bt\s+set tenant_id = p\.default_tenant_id/i);
    assert.match(sql, /biometric_templates contains rows without tenant_id/i);
    assert.match(sql, /alter table biometric_templates\s+alter column tenant_id set not null/i);
    for (const column of [
      "template_hash",
      "format",
      "sdk_version",
      "quality",
      "encryption_key_version",
      "enrolled_device_id",
      "revoked_at",
      "revoked_by",
      "revoked_reason",
    ]) {
      assert.match(sql, new RegExp(`add column if not exists ${column}\\b`, "i"), `${column} missing`);
    }
  });
});

describe("biometric bridge BFF harness", () => {
  it("exposes challenge/proof and device lifecycle routes", () => {
    const file = readRepo("apps/bff/src/routes/biometric.ts");
    for (const snippet of [
      '"/devices/pair"',
      '"/devices"',
      '"/devices/:id/revoke"',
      '"/challenges"',
      '"/challenges/:id"',
      '"/challenges/:id/submit"',
    ]) {
      assert.ok(file.includes(snippet), `missing biometric route ${snippet}`);
    }
    assert.ok(file.includes("verifyBridgeSignature"), "proof submission must verify bridge signature");
    assert.ok(file.includes("assertChallengeAcceptsProof"), "proof submission must validate challenge binding");
    assert.ok(file.includes('.eq("reserve_id", body.proof.reserve_id)'), "proof submission must bind device to the challenge reserve");
    assert.ok(file.includes('.from("reserve_memberships")'), "biometric routes must scope admin_reserva/armeiro by reserve membership");
    assert.ok(file.includes("assertBiometricPolicy"), "proof submission must enforce biometric policy server-side");
    assert.ok(file.includes("BIOMETRIC_MIN_SCORE"), "proof submission must enforce a configured minimum score");
    assert.ok(file.includes('.rpc("record_biometric_proof"'), "proof submission must atomically consume challenge and insert proof");
  });

  it("does not perform server-side fingerprint capture in biometric route", () => {
    const file = readRepo("apps/bff/src/routes/biometric.ts");
    assert.equal(file.includes("getFingerprintSDK"), false, "BFF biometric route must not import server-side SDK");
    assert.equal(/\.capture\s*\(/.test(file), false, "BFF biometric route must not capture USB fingerprints");
    assert.equal(/\.identify\s*\(/.test(file), false, "BFF biometric route must not match through local SDK");
    assert.equal(/\.verify\s*\(/.test(file), false, "BFF biometric route must not verify through local SDK");
  });
});
