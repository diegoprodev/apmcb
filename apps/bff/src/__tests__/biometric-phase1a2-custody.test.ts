import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd(), "..", "..");
const read = (file: string) => readFileSync(resolve(root, file), "utf8").replace(/\r\n/g, "\n");

describe("biometric phase 1A.2 custody harness", () => {
  it("provides atomic enrollment persistence and proof linkage", () => {
    const migration = read("supabase/migrations/20260714000004_biometric_enrollment_rpc.sql");
    const lendingMigration = read("supabase/migrations/20260714000003_biometric_phase1a2.sql");
    const returnMigration = read("supabase/migrations/20260714000005_biometric_phase1a2_return_rpc.sql");
    const batchMigration = read("supabase/migrations/20260714000006_biometric_phase1a2_batch_lending_rpc.sql");
    assert.match(migration, /create or replace function public\.record_biometric_enrollment/i);
    assert.match(migration, /security definer\s+set search_path = public/i);
    assert.match(migration, /update biometric_challenges/i);
    assert.match(migration, /insert into biometric_proofs/i);
    assert.match(migration, /insert into biometric_templates/i);
    assert.match(migration, /sha256\(p_template_data\)/i);
    assert.match(migration, /p_liveness_passed is distinct from true/i);
    assert.match(migration, /d\.status = 'active'/i);
    assert.match(lendingMigration, /biometric_proof_id uuid references biometric_proofs/i);
    assert.match(lendingMigration, /biometric_verified boolean not null default false/i);
    assert.match(returnMigration, /create or replace function public\.record_lending_returns/i);
    assert.match(returnMigration, /status_legacy = 'devolvido'/i);
    assert.match(returnMigration, /biometric_proof_consumptions/i);
    assert.match(returnMigration, /grant execute.*service_role/is);
    assert.match(batchMigration, /create or replace function public\.record_lending_batch/i);
    assert.match(batchMigration, /for update/i);
    assert.match(batchMigration, /biometric_proof_consumptions/i);
  });

  it("requires a scoped proof for lending and supports one proof per movement", () => {
    const route = read("apps/bff/src/routes/lendings.ts");
    assert.ok(route.includes("biometric-proof-service"));
    assert.match(route, /biometric_proof_id: z\.string\(\)\.uuid\(\)\.optional\(\)/);
    assert.match(route, /body\.auth_mode !== "biometria".*body\.biometric_proof_id.*body\.movement_id/s);
    assert.ok(route.includes('purpose: "confirm_saida_militar"'));
    assert.ok(route.includes('p_auth_mode: body.auth_mode'));
    assert.ok(route.includes('"/identify"'));
    assert.ok(route.includes('"/bulk-return"'));
    assert.ok(route.includes('"/batch"'));
    assert.ok(route.includes('record_lending_batch'));
    assert.ok(route.includes('record_lending_returns'));
    assert.equal(route.includes("getFingerprintSDK"), false);
    assert.equal(read("apps/bff/src/routes/saidas.ts").includes("getFingerprintSDK"), false);
  });

  it("keeps enrollment, output and return on the challenge/proof contract", () => {
    const militaryUi = read("apps/web/src/app/(dashboard)/reserva/militares/_militares-table.tsx");
    const outputUi = read("apps/web/src/app/(dashboard)/reserva/saidas/nova/_form.tsx");
    const returnUi = read("apps/web/src/app/(dashboard)/reserva/saidas/_desarmamento-modal.tsx");
    for (const content of [militaryUi, outputUi, returnUi]) {
      assert.equal(/\/biometric\/(register|identify)/.test(content), false);
      assert.ok(content.includes("BiometricCaptureDialog"));
    }
    assert.ok(militaryUi.includes('purpose="enroll"'));
    assert.ok(outputUi.includes("biometric_proof_id"));
    assert.ok(outputUi.includes("/api/lendings/identify"));
    assert.ok(outputUi.includes("/api/lendings/batch"));
    assert.ok(returnUi.includes('purpose="return"'));
    const dialog = read("apps/web/src/components/biometric/biometric-capture-dialog.tsx");
    assert.ok(dialog.includes("/api/biometric/devices"));
    assert.ok(dialog.includes("bridgeAvailable"));
  });
});
