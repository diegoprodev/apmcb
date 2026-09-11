import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// SP4 review achado CRÍTICO C2 — POST /api/ssa/requests: reserve_id é
// opcional no payload (aceita "remota", pra outra reserva, e "própria",
// sem reserve_id — deveria cair na reserva ativa da sessão). Sem fallback,
// o caminho "própria" gravava material_requests.reserve_id NULL, e o
// dispatcher do SP4 falhava com RAISE opaco no INSERT de
// material_request_items alguns passos depois.
const src = readFileSync(resolve(process.cwd(), "src", "routes", "ssa.ts"), "utf8").replace(/\r\n/g, "\n");

const handler = src.slice(src.indexOf("const { items, totp_token, notes, reserve_id, remote_reason }"), src.indexOf("return c.json({ request_id: request.id"));

describe("POST /api/ssa/requests — reserve_id nunca NULL (SP4 review C2)", () => {
  it("resolve effectiveReserveId: body > sessão, 400 se nenhum", () => {
    assert.ok(handler.includes('const effectiveReserveId = reserve_id ?? c.get("reserveId") ?? null'));
    assert.ok(handler.includes("if (!effectiveReserveId) {"));
    const guardIdx = handler.indexOf("if (!effectiveReserveId)");
    assert.ok(guardIdx > 0, "guard existe");
  });

  it("guard roda ANTES de qualquer escrita (fail-fast)", () => {
    const guardIdx = handler.indexOf("if (!effectiveReserveId)");
    const insertIdx = handler.indexOf('.from("material_requests")\n      .insert({');
    assert.ok(guardIdx > 0 && insertIdx > guardIdx, "guard roda antes do insert");
  });

  it("insert usa effectiveReserveId, nunca reserve_id ?? null", () => {
    assert.ok(handler.includes("reserve_id: effectiveReserveId,"));
    assert.ok(!handler.includes("reserve_id: reserve_id ?? null"), "não sobrou o ?? null antigo (NULL silencioso)");
  });
});
