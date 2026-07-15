import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertUsableBiometricProof, consumeBiometricProof } from "../lib/biometric-proof-consumption.ts";

const repoRoot = resolve(process.cwd(), "..", "..");

function readRepo(relPath: string) {
  return readFileSync(resolve(repoRoot, relPath), "utf8").replace(/\r\n/g, "\n");
}

function migration() {
  const rel = "supabase/migrations/20260714000002_biometric_phase1a1.sql";
  assert.equal(existsSync(resolve(repoRoot, rel)), true, "phase 1A.1 migration must exist");
  return readRepo(rel);
}

const ids = {
  proof: "11111111-1111-4111-8111-111111111111",
  tenant: "22222222-2222-4222-8222-222222222222",
  reserve: "33333333-3333-4333-8333-333333333333",
  actor: "44444444-4444-4444-8444-444444444444",
  matched: "55555555-5555-4555-8555-555555555555",
  expected: "66666666-6666-4666-8666-666666666666",
  document: "77777777-7777-4777-8777-777777777777",
};

function proof(patch: Record<string, unknown> = {}) {
  return {
    id: ids.proof,
    tenant_id: ids.tenant,
    reserve_id: ids.reserve,
    actor_id: ids.actor,
    matched_user_id: ids.matched,
    purpose: "identify",
    document_id: ids.document,
    document_hash: "sha256:abc",
    result: "success",
    created_at: new Date(Date.now() - 10_000).toISOString(),
    consumed: false,
    ...patch,
  };
}

describe("biometric phase 1A.1 schema harness", () => {
  it("adds simulator flag and one-time proof consumption", () => {
    const sql = migration();

    assert.match(sql, /alter table biometric_devices\s+add column if not exists is_simulator boolean not null default false/i);
    assert.match(sql, /create table if not exists biometric_proof_consumptions/i);
    assert.match(sql, /proof_id uuid not null references biometric_proofs\(id\)/i);
    assert.match(sql, /unique\s*\(\s*proof_id\s*\)/i);
    assert.match(sql, /alter table biometric_proof_consumptions enable row level security/i);
    assert.match(sql, /create or replace function public\.record_biometric_proof/i);
    assert.match(sql, /security definer\s+set search_path = public/i);
  });
});

describe("biometric phase 1A.1 BFF harness", () => {
  it("keeps simulator controlled by the server and unavailable in production", () => {
    const biometricRoute = readRepo("apps/bff/src/routes/biometric.ts");
    const index = readRepo("apps/bff/src/index.ts");
    const helper = readRepo("apps/bff/src/lib/biometric-proof-consumption.ts");

    assert.equal(/is_simulator\s*:/.test(biometricRoute), false, "pairDeviceSchema must not accept is_simulator");
    assert.equal(helper.includes("consumed_at"), false, "consumption helper must not depend on nonexistent biometric_proofs.consumed_at");
    assert.ok(helper.includes("biometric_proof_consumptions"), "consumption helper must use biometric_proof_consumptions");
    assert.ok(biometricRoute.includes('"/challenges/:id/result"'), "challenge result endpoint missing");
    assert.ok(biometricRoute.includes("simulator_available"), "devices response must expose simulator availability");
    assert.ok(biometricRoute.includes('.rpc("record_biometric_proof"'), "proof submission must use atomic RPC");
    assert.equal(biometricRoute.includes('.from("biometric_proofs")\n      .insert'), false, "proof submission must not split challenge consume and proof insert");
    assert.ok(index.includes("biometricSimulatorRoutes"), "simulator route import/registration missing");
    assert.match(index, /process\.env\.NODE_ENV !== "production"/);
    assert.match(index, /process\.env\.BIOMETRIC_SIMULATOR_ENABLED === "true"/);
    assert.match(index, /app\.route\("\/api\/biometric\/simulator", biometricSimulatorRoutes\)/);
  });
});

describe("assertUsableBiometricProof", () => {
  it("accepts an unused successful proof bound to the requested operation", () => {
    assert.doesNotThrow(() => assertUsableBiometricProof(proof(), {
      tenantId: ids.tenant,
      reserveId: ids.reserve,
      actorId: ids.actor,
      purpose: "identify",
      expectedUserId: ids.matched,
      documentId: ids.document,
      documentHash: "sha256:abc",
      nowMs: Date.now(),
    }));
  });

  it("rejects scope, identity, document, stale, consumed and failed proofs", () => {
    const ctx = {
      tenantId: ids.tenant,
      reserveId: ids.reserve,
      actorId: ids.actor,
      purpose: "identify",
      expectedUserId: ids.matched,
      documentId: ids.document,
      documentHash: "sha256:abc",
      nowMs: Date.now(),
    };

    assert.throws(() => assertUsableBiometricProof(proof({ tenant_id: ids.reserve }), ctx), /tenant/i);
    assert.throws(() => assertUsableBiometricProof(proof({ reserve_id: ids.tenant }), ctx), /reserve/i);
    assert.throws(() => assertUsableBiometricProof(proof({ actor_id: ids.tenant }), ctx), /actor/i);
    assert.throws(() => assertUsableBiometricProof(proof({ purpose: "return" }), ctx), /purpose/i);
    assert.throws(() => assertUsableBiometricProof(proof({ matched_user_id: ids.expected }), ctx), /expected_user/i);
    assert.throws(() => assertUsableBiometricProof(proof({ document_hash: "sha256:other" }), ctx), /document_hash/i);
    assert.throws(() => assertUsableBiometricProof(proof({ result: "failure" }), ctx), /success/i);
    assert.throws(() => assertUsableBiometricProof(proof({ consumed: true }), ctx), /consumed/i);
    assert.throws(
      () => assertUsableBiometricProof(proof({ created_at: new Date(Date.now() - 10 * 60_000).toISOString() }), ctx),
      /expired/i,
    );
  });
});

describe("consumeBiometricProof", () => {
  it("inserts one consumption row and maps unique violation to replay", async () => {
    const rows: unknown[] = [];
    const db = {
      from(table: "biometric_proof_consumptions") {
        assert.equal(table, "biometric_proof_consumptions");
        return {
          async insert(row: unknown) {
            rows.push(row);
            return { error: null };
          },
        };
      },
    };

    await consumeBiometricProof(db, proof(), {
      proofId: ids.proof,
      tenantId: ids.tenant,
      reserveId: ids.reserve,
      actorId: ids.actor,
      purpose: "identify",
      operationType: "identify_user",
      operationId: null,
      nowMs: Date.now(),
    });

    assert.equal(rows.length, 1);

    const duplicateDb = {
      from() {
        return {
          async insert() {
            return { error: { code: "23505", message: "duplicate key" } };
          },
        };
      },
    };

    await assert.rejects(
      () => consumeBiometricProof(duplicateDb, proof(), {
        proofId: ids.proof,
        tenantId: ids.tenant,
        reserveId: ids.reserve,
        actorId: ids.actor,
        purpose: "identify",
        operationType: "identify_user",
        nowMs: Date.now(),
      }),
      /already consumed/i,
    );
  });
});

describe("biometric phase 1A.1 web harness", () => {
  it("adds the armorer biometric console with safe BFF calls and explicit states", () => {
    const files = [
      "apps/web/src/components/biometric/biometric-bridge-status.tsx",
      "apps/web/src/components/biometric/biometric-capture-dialog.tsx",
      "apps/web/src/app/(dashboard)/reserva/biometria/page.tsx",
      "apps/web/src/app/(dashboard)/reserva/biometria/_biometric-console-client.tsx",
    ];

    for (const file of files) {
      assert.equal(existsSync(resolve(repoRoot, file)), true, `${file} must exist`);
      const content = readRepo(file);
      assert.equal(/http:\/\/(127\.0\.0\.1|localhost)/i.test(content), false, `${file} must not call localhost`);
      assert.equal(/["'`]\/biometric\//.test(content), false, `${file} must not call biometric endpoints without /api`);
      assert.ok(content.includes("data-testid"), `${file} must expose stable test ids`);
    }

    const dialog = readRepo("apps/web/src/components/biometric/biometric-capture-dialog.tsx");
    for (const snippet of ["bffFetch", "friendlyApiError", "expired", "pending", "success", "failure", "retry"]) {
      assert.ok(dialog.includes(snippet), `capture dialog missing ${snippet}`);
    }

    const status = readRepo("apps/web/src/components/biometric/biometric-bridge-status.tsx");
    for (const state of ["active", "missing", "revoked", "offline", "simulator"]) {
      assert.ok(status.includes(state), `bridge status missing ${state}`);
    }

    const home = readRepo("apps/web/src/app/(dashboard)/reserva/page.tsx");
    const page = readRepo("apps/web/src/app/(dashboard)/reserva/biometria/page.tsx");
    const client = readRepo("apps/web/src/app/(dashboard)/reserva/biometria/_biometric-console-client.tsx");
    assert.ok(home.includes("/reserva/biometria"), "reserva dashboard must link to biometric console");
    assert.equal(home.includes("ZKTeco"), false, "reserva dashboard must not hardcode legacy ZKTeco reader");
    assert.ok(page.includes('profile?.role === "admin_global"'), "admin_global console access must not depend only on reserve_memberships");
    assert.ok(client.includes("simulatorAvailable"), "UI must use BFF simulator availability, not device flag alone");
  });
});
