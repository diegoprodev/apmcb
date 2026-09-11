import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// SP2 Task 6 (F6) — elegibilidade de staff por membership DA RESERVA-ALVO,
// não profiles.role global. Source-assertion: a rota é edge com createServerClient
// via cookies(); mockar a cadeia inteira do supabase-js custa mais do que
// afirmar sobre o texto (mesmo padrão de idor-write-scope.test.ts no BFF).
const src = readFileSync(resolve(__dirname, "route.ts"), "utf8").replace(/\r\n/g, "\n");

describe("GET /api/admin/search-profiles — exclude_reserve_staff (SP2)", () => {
  it("valida o param como uuid antes de usar", () => {
    expect(src).toContain("UUID_RE.test(excludeReserveStaff)");
  });

  it("exclui só quem é STAFF da reserva-alvo, não qualquer membership", () => {
    expect(src).toContain('.eq("reserve_id", excludeReserveId)');
    expect(src).toContain(".in(\"role\", STAFF_RESERVE_ROLES)");
    expect(src).toContain('STAFF_RESERVE_ROLES = ["armeiro", "admin_reserva", "auditor_reserva"]');
  });

  it("sem o param, comportamento idêntico (retorna os hits direto)", () => {
    expect(src).toContain("if (excludeReserveId && hits.length > 0)");
    expect(src).toContain("return NextResponse.json(hits)");
  });
});
