import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// SP2 Task 9 — POST /switch/:id chama a RPC bump_reserve_preference (que
// incrementa selection_count de verdade) em vez do upsert antigo que gravava
// selection_count: 1 fixo em toda troca.
const src = readFileSync(resolve(process.cwd(), "src", "routes", "reserves.ts"), "utf8").replace(/\r\n/g, "\n");

describe("POST /switch/:id — bump_reserve_preference via RPC (SP2)", () => {
  it("chama a RPC com os params certos", () => {
    assert.ok(src.includes('.rpc("bump_reserve_preference", { p_user_id: userId, p_reserve_id: reserve.id })'));
  });

  it("não upserta mais selection_count fixo em 1", () => {
    assert.ok(!src.includes("selection_count: 1"), "upsert antigo (fixo em 1) removido");
  });

  it("best-effort: continua non-blocking (void + .then com log.warn nos 2 ramos)", () => {
    const rpcCall = src.slice(src.indexOf('.rpc("bump_reserve_preference"'));
    assert.ok(rpcCall.slice(0, 400).includes("reserve.preference.bump_failed"));
    const voidLine = src.slice(0, src.indexOf('.rpc("bump_reserve_preference"')).lastIndexOf("void supabase");
    assert.ok(voidLine > 0, "a chamada continua void (não bloqueia o switch)");
  });
});
