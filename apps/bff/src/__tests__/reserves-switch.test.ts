import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// SP1 do isolamento por reserva — asserções de fonte sobre routes/reserves.ts
// (mesmo padrão de idor-write-scope.test.ts: as rotas com getIronSession são
// difíceis de montar em node --test; a validação de dados de verdade é o trigger
// profiles_validate_active_reserve, já testado por transação revertida em prod).
const file = readFileSync(
  resolve(process.cwd(), "src", "routes", "reserves.ts"),
  "utf8",
).replace(/\r\n/g, "\n");

describe("POST /api/reserves/switch — SP1", () => {
  it("switch/:id inclui usuario e auditor no roleGuard", () => {
    const block = file.slice(file.indexOf('"/switch/:id"'));
    const guard = block.slice(0, block.indexOf("async (c)"));
    assert.match(guard, /"usuario"/, "usuario tem que poder trocar de reserva");
    assert.match(guard, /"auditor"/);
    assert.match(guard, /"armeiro"/);
    assert.match(guard, /"admin_reserva"/);
    assert.match(guard, /"admin_global"/);
  });

  it("switch/:id grava profiles.active_reserve_id (fonte de verdade do RLS)", () => {
    const block = file.slice(file.indexOf('"/switch/:id"'), file.indexOf('"/switch/:id"') + 2500);
    assert.match(block, /\.from\("profiles"\)\s*\.update\(\{ active_reserve_id: reserve\.id \}\)/);
    assert.match(block, /session\.reserveId = reserve\.id/, "espelha em session.reserveId");
  });

  it("switch/:id loga toda negação (reserve.switch.denied) e o sucesso", () => {
    const block = file.slice(file.indexOf('"/switch/:id"'), file.indexOf('"/switch/:id"') + 2500);
    assert.match(block, /reason: "not_found".*"reserve\.switch\.denied"/s);
    assert.match(block, /reason: "not_member".*"reserve\.switch\.denied"/s);
    assert.match(block, /"reserve\.switch\.ok"/);
    assert.match(block, /"reserve\.switch\.failed"/);
  });

  it("admin_global e auditor pulam a checagem de membership; os outros não", () => {
    const block = file.slice(file.indexOf('"/switch/:id"'), file.indexOf('"/switch/:id"') + 2500);
    assert.match(block, /role !== "admin_global" && role !== "auditor"/);
  });

  it("switch/matriz é registrada ANTES de switch/:id (senão :id captura 'matriz')", () => {
    assert.ok(
      file.indexOf('"/switch/matriz"') < file.indexOf('"/switch/:id"'),
      "ordem de rota errada",
    );
  });

  it("switch/matriz: só admin_global/auditor, zera active_reserve_id + session.reserveId", () => {
    const block = file.slice(file.indexOf('"/switch/matriz"'), file.indexOf('"/switch/:id"'));
    assert.match(block, /roleGuard\("admin_global", "auditor"\)/);
    assert.match(block, /\.update\(\{ active_reserve_id: null \}\)/);
    assert.match(block, /session\.reserveId = null/);
    assert.match(block, /"reserve\.matriz\.entered"/);
  });
});
