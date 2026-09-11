import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// SP2 Task 6 (F6) + achados ALTO A3 / MÉDIO M6 do review adversarial —
// elegibilidade de staff por membership DA RESERVA-ALVO, não profiles.role
// global. Source-assertion: a rota é edge com createServerClient via
// cookies(); mockar a cadeia inteira do supabase-js custa mais do que
// afirmar sobre o texto (mesmo padrão de idor-write-scope.test.ts no BFF).
const src = readFileSync(resolve(__dirname, "route.ts"), "utf8").replace(/\r\n/g, "\n");

describe("GET /api/admin/search-profiles — exclude_reserve_staff (SP2)", () => {
  it("valida o param como uuid antes de usar", () => {
    expect(src).toContain("UUID_RE.test(excludeReserveStaff)");
  });

  // Achado A3: a query direta via createServerClient (RLS-bound pela sessão
  // do caller) era um no-op silencioso pra admin_global — a policy
  // reserve_memberships_select não cobre esse papel. Fix: busca via BFF
  // (service_role), forwardando o cookie de sessão.
  it("busca os staff ids via BFF (service_role), não pela sessão RLS-bound do caller", () => {
    expect(src).toContain("async function fetchReserveStaffIds(reserveId: string, cookieHeader: string)");
    expect(src).toContain("`${BFF_URL}/api/reserves/${reserveId}/staff-ids`");
    expect(src).toContain('headers: { cookie: cookieHeader }');
    expect(src).toContain('req.headers.get("cookie")');
  });

  it("busca com folga (24) quando há exclusão, corta pra 8 depois de filtrar (M6)", () => {
    expect(src).toContain("const fetchLimit = excludeReserveId ? 24 : 8");
    expect(src).toContain(".limit(fetchLimit)");
    expect(src).toContain(".filter((h) => !staffIds.has(h.id)).slice(0, 8)");
  });

  it("sem o param, comportamento idêntico (retorna os hits direto)", () => {
    expect(src).toContain("if (excludeReserveId && hits.length > 0)");
    expect(src).toContain("return NextResponse.json(hits)");
  });

  it("falha do BFF é logada e não derruba a busca (fail-open documentado, não fail-closed)", () => {
    expect(src).toContain('"[GET /api/admin/search-profiles] staff-ids falhou"');
    expect(src).toContain('"[GET /api/admin/search-profiles] staff-ids erro de rede"');
  });
});
