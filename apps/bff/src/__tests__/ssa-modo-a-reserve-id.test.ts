import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// SP4 (achado real, exposto pelo dispatcher reserve_id) — POST /api/ssa/modo-a
// era o ÚNICO dos 2 insert sites de material_requests sem `reserve_id`
// (o outro, POST /requests ~:429, já tinha o fix BUG-RR-04). Sem isso, toda
// saída via código de acesso (Modo A) criava um material_requests com
// reserve_id NULL — e o dispatcher do SP4 (material_request_items deriva de
// material_requests.reserve_id) falharia com RAISE opaco no passo seguinte.
const src = readFileSync(resolve(process.cwd(), "src", "routes", "ssa.ts"), "utf8").replace(/\r\n/g, "\n");

// Achado real (rastreabilidade enterprise, 2026-09-18): a janela de corte
// era um número mágico fixo (5000 chars) a partir de '"/modo-a"' — qualquer
// código novo adicionado ANTES de `reserve_id: reserveId,` dentro do mesmo
// handler (ex: os blocos de auditoria de falha de TOTP) empurra a linha
// pra fora da janela e quebra este teste sem nenhuma mudança real de
// comportamento. Corta no início do PRÓXIMO registro de rota em vez de um
// tamanho fixo — cresce com o handler, não quebra por causa dele.
const modoAStart = src.indexOf('"/modo-a"');
const nextRouteStart = src.indexOf("\nssaRoutes.", modoAStart + 1);
const handler = src.slice(modoAStart, nextRouteStart > modoAStart ? nextRouteStart : modoAStart + 8000);

describe("POST /api/ssa/modo-a — reserve_id no material_requests (SP4)", () => {
  it("lê c.get(\"reserveId\") e recusa cedo se ausente", () => {
    assert.ok(handler.includes('const reserveId = c.get("reserveId")'));
    assert.ok(handler.includes('if (!reserveId) return c.json({ error: "Reserva ativa não identificada na sessão" }, 403)'));
  });

  it("recusa ANTES de validar TOTP/disponibilidade (fail-fast)", () => {
    const guardIdx = handler.indexOf("Reserva ativa não identificada");
    const totpIdx = handler.indexOf("totp_token");
    assert.ok(guardIdx > 0 && guardIdx < handler.indexOf("verifySync"), "guard roda antes da validação TOTP");
  });

  it("inclui reserve_id no insert de material_requests", () => {
    assert.ok(handler.includes("reserve_id: reserveId,"));
    const insertIdx = handler.indexOf('.from("material_requests")\n      .insert({');
    const reserveIdIdx = handler.indexOf("reserve_id: reserveId,");
    assert.ok(insertIdx > 0 && reserveIdIdx > insertIdx && reserveIdIdx < insertIdx + 200);
  });
});
