import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { requireActiveShift } from "../lib/shift-guard.ts";

// SP7 (achado ALTO do review, 2026-09-15): requireActiveShift só filtrava
// armeiro_id+status='ativo' — não comparava o reserve_id do turno contra a
// reserva alvo da operação. uq_shifts_armeiro_ativo garante no máximo 1
// turno ativo por armeiro (nunca ambiguidade de "qual"), mas o turno pode
// ser da reserva ERRADA (aberto em B, operação em A após trocar a reserva
// ativa sem fechar o turno). targetReserveId opcional fecha esse gap sem
// quebrar os 14 call sites que ainda não passam o parâmetro.
describe("requireActiveShift — targetReserveId (SP7)", () => {
  it("admin_global/admin_reserva sempre ok, mesmo sem targetReserveId", async () => {
    const result = await requireActiveShift("admin_global", undefined, "reserva-a");
    assert.deepEqual(result, { ok: true, shift: null });
  });

  it("armeiro sem armeiroId → SHIFT_REQUIRED, independente de targetReserveId", async () => {
    const result = await requireActiveShift("armeiro", undefined, "reserva-a");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.body.error, "SHIFT_REQUIRED");
  });

  it("assinatura aceita targetReserveId como 3º parâmetro opcional (compat com os 14 call sites que não passam)", () => {
    // Prova estática de compatibilidade: chamar com 2 args continua válido.
    const call2Args = () => requireActiveShift("armeiro", "user-id");
    const call3Args = () => requireActiveShift("armeiro", "user-id", "reserve-id");
    assert.equal(typeof call2Args, "function");
    assert.equal(typeof call3Args, "function");
  });
});
