import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// SP2 review achado ALTO A1 — checagens de AUTORIDADE DO ATOR (abrir turno,
// criar passagem, operar biometria, lendings) validavam só "existe alguma
// reserve_membership", sem filtrar role. Desde a Task 3/4 (militar comum
// ganha linha role='usuario'), isso vira uma escalação horizontal: um
// armeiro globalmente, com uma membership 'usuario' esquecida em outra
// reserva (de quando era só efetivo lá), conseguia operar como armeiro
// nessa outra reserva. Checagens de "o ALVO pertence à reserva" (militar
// recebendo material, requisitante SSA) continuam existence-only de
// propósito — usuario legitimamente pertence.
function route(name: string) {
  return readFileSync(resolve(process.cwd(), "src", "routes", name), "utf8").replace(/\r\n/g, "\n");
}

describe("Checagens de autoridade do ATOR filtram STAFF_RESERVE_ROLES (SP2 review A1)", () => {
  it("lendings.ts assertActorReserveAccess", () => {
    const src = route("lendings.ts");
    const fn = src.slice(src.indexOf("async function assertActorReserveAccess"), src.indexOf("async function assertMilitaryBelongsToReserve"));
    assert.ok(fn.includes('.in("role", STAFF_RESERVE_ROLES)'));
    // o check do MILITAR-ALVO continua existence-only (usuario pertence de verdade)
    const targetFn = src.slice(src.indexOf("async function assertMilitaryBelongsToReserve"));
    assert.ok(!targetFn.slice(0, 400).includes('.in("role", STAFF_RESERVE_ROLES)'), "target check não filtra role — usuario pertence de verdade");
  });

  it("shifts.ts POST /open", () => {
    const src = route("shifts.ts");
    assert.ok(src.includes('.eq("reserve_id", reserve_id)\n      .eq("reserves.tenant_id", tenantId)\n      .in("role", STAFF_RESERVE_ROLES)'));
  });

  it("handovers.ts POST /", () => {
    const src = route("handovers.ts");
    assert.ok(src.includes('.eq("reserve_id", body.reserve_id)\n      .in("role", STAFF_RESERVE_ROLES)'));
  });

  it("biometric.ts actorCanAccessReserve", () => {
    const src = route("biometric.ts");
    const fn = src.slice(src.indexOf("async function actorCanAccessReserve"));
    assert.ok(fn.slice(0, 800).includes('.in("role", STAFF_RESERVE_ROLES)'));
  });
});
