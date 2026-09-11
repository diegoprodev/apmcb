import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// SP2 Task 8 (MÉDIO-3, F11) + achados ALTO/MÉDIO do review adversarial —
// DELETE /api/admin/reserves/:id:
//  1. pre-check completo (RESERVE_DELETE_BLOCKERS, ~15 tabelas com FK RESTRICT
//     pra reserves) ANTES de qualquer escrita destrutiva — não só
//     material_types+staff. O pre-check original deixava passar reservas com
//     cautelamento/turno/biometria pendente, que só quebravam no DELETE FINAL
//     depois de já ter apagado memberships e zerado active_reserve_id.
//  2. pre-check de membros só bloqueia por STAFF_RESERVE_ROLES, não qualquer
//     membership (militar comum role='usuario' não deve travar a exclusão)
//  3. status='inativa' só DEPOIS do 1º pre-check limpo, com um 2º pre-check
//     logo em seguida (fecha a race de entrada numa janela estreita); reverte
//     pro status ORIGINAL (não força 'ativa') se o 2º achar algo
//  4. checa o `error` de toda escrita — nenhuma segue destruindo em silêncio
const admin = readFileSync(resolve(process.cwd(), "src", "routes", "admin.ts"), "utf8").replace(/\r\n/g, "\n");

const blockersBlock = admin.slice(
  admin.indexOf("const RESERVE_DELETE_BLOCKERS"),
  admin.indexOf("GET /api/admin/branding"),
);

describe("DELETE /api/admin/reserves/:id — MÉDIO-3 + review (SP2)", () => {
  it("RESERVE_DELETE_BLOCKERS cobre as tabelas com FK RESTRICT pra reserves (confirmadas no staging)", () => {
    for (const table of [
      "material_types", "material_items", "lendings", "cautelamentos", "material_requests",
      "service_handovers", "service_shifts", "inventory_reserve_checks", "audit_events",
      "biometric_devices", "biometric_challenges", "biometric_pairing_codes", "biometric_proofs",
      "biometric_proof_consumptions", "totp_identity_claims",
    ]) {
      assert.ok(blockersBlock.includes(`"${table}"`), `deve checar ${table}`);
    }
    // as com ON DELETE CASCADE não precisam entrar (category_requests,
    // material_categories, material_validity_alert_events, reserve_memberships,
    // user_reserve_preferences) — não afirmamos ausência (nomes curtos demais
    // pra um includes() confiável), só que a lista cobre o essencial acima.
  });

  it("pre-check de membros filtra por STAFF_RESERVE_ROLES, não conta usuario", () => {
    assert.ok(blockersBlock.includes('.in("role", STAFF_RESERVE_ROLES)'));
  });

  it("pre-check completo roda ANTES de status='inativa' e de qualquer escrita destrutiva", () => {
    const preCheckIdx = blockersBlock.indexOf("const pre = await countReserveDeleteBlockers(id);");
    const statusIdx = blockersBlock.indexOf('.update({ status: "inativa" })');
    const clearActiveIdx = blockersBlock.indexOf('.update({ active_reserve_id: null })');
    assert.ok(preCheckIdx > 0 && preCheckIdx < statusIdx, "pre-check ANTES do status inativa");
    assert.ok(statusIdx < clearActiveIdx, "status inativa ANTES da limpeza destrutiva");
  });

  it("re-checa depois do status='inativa' e reverte pro status ORIGINAL (não força 'ativa')", () => {
    assert.ok(blockersBlock.includes("const post = await countReserveDeleteBlockers(id);"));
    assert.ok(
      blockersBlock.includes('.update({ status: reserve.status }).eq("id", id)'),
      "reverte pro status que a reserva JÁ TINHA, não hardcoded 'ativa' (não reativa uma reserva desativada de propósito)",
    );
  });

  it("checa o error de CADA escrita destrutiva e aborta (não só loga e segue)", () => {
    for (const [errVar, evt] of [
      ["clearActiveErr", "admin.reserve.delete_clear_active_failure"],
      ["clearMembershipsErr", "admin.reserve.delete_clear_memberships_failure"],
      ["deleteErr", "admin.reserve.delete_failure"],
    ] as const) {
      const errIdx = blockersBlock.indexOf(`error: ${errVar} }`);
      assert.ok(errIdx > 0, `captura ${errVar}`);
      const nearby = blockersBlock.slice(errIdx, errIdx + 300);
      assert.ok(nearby.includes(`if (${errVar})`), `checa ${errVar} logo em seguida`);
      assert.ok(nearby.includes(evt), `loga ${evt}`);
      assert.ok(nearby.includes("return c.json"), `${errVar} ABORTA com response de erro, não só loga e segue`);
    }
  });
});
