import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Normaliza CRLF→LF: os snippets abaixo usam \n, e um checkout Windows com
// core.autocrlf=true materializa as rotas com CRLF — sem a normalização, a
// comparação por .includes() falha por causa da quebra de linha, não por
// uma regressão real de escopo (achado ao investigar falha nesta suíte que
// passava limpo no checkout principal mas falhava neste worktree isolado).
const route = (name: string) =>
  readFileSync(resolve(process.cwd(), "src", "routes", name), "utf8").replace(/\r\n/g, "\n");

function assertContains(file: string, snippet: string, message: string) {
  assert.ok(file.includes(snippet), message);
}

// Irmão de idor-write-scope.test.ts, focado em leituras (SELECT) que retornam
// dado sensível (armamento, PII de militares) direto do BFF pra popular
// seletores no client — ver GET /api/arsenal/items/disponiveis e
// GET /api/profiles/usuarios, adicionadas ao corrigir o bug de sessão sb-*
// HttpOnly quebrando queries diretas do client Supabase (2026-07-11).
describe("IDOR scoped reads in new list routes", () => {
  it("scopes material_items listing by tenant_id", () => {
    const file = route("arsenal.ts");
    assertContains(
      file,
      '.eq("tenant_id", tenantId)\n      .eq("status_operacional", "disponivel")',
      "GET /api/arsenal/items/disponiveis must filter by tenant_id before status_operacional",
    );
  });

  it("keeps superadmin out of the material_items listing route", () => {
    const file = route("arsenal.ts");
    const routeStart = file.indexOf('"/items/disponiveis"');
    assert.ok(routeStart > -1, "GET /api/arsenal/items/disponiveis not found");
    const routeChunk = file.slice(routeStart, routeStart + 400);
    assert.equal(routeChunk.includes('"superadmin"'), false, "items/disponiveis must not include superadmin in roleGuard");
  });

  it("scopes profiles listing by default_tenant_id", () => {
    const file = route("profiles.ts");
    assertContains(
      file,
      '.eq("default_tenant_id", tenantId)\n      .eq("role", "usuario")',
      "GET /api/profiles/usuarios must filter by default_tenant_id before role",
    );
  });

  it("keeps superadmin out of the profiles listing route", () => {
    const file = route("profiles.ts");
    const routeStart = file.indexOf('"/usuarios"');
    assert.ok(routeStart > -1, "GET /api/profiles/usuarios not found");
    const routeChunk = file.slice(routeStart, routeStart + 400);
    assert.equal(routeChunk.includes('"superadmin"'), false, "profiles/usuarios must not include superadmin in roleGuard");
  });

  // Achado de code review (reforma de geração de PDF, retrofit de
  // handover-pdf.ts): GET /:id/pdf tinha o mesmo roleGuard de GET /:id
  // (armeiro, admin_reserva, admin_global, auditor) mas SEM a checagem de
  // participação que GET /:id já tinha — um armeiro de qualquer reserva do
  // tenant podia baixar o PDF (nomes, matrículas, observações, snapshot do
  // arsenal) de QUALQUER passagem de turno do tenant, não só as que
  // participa. Corrigido replicando a mesma checagem; teste estático
  // garante que as duas rotas não voltem a divergir num refactor futuro.
  it("GET /:id/pdf checks armeiro participation, same as GET /:id", () => {
    const file = route("handovers.ts");

    const jsonRouteStart = file.indexOf('"/:id",');
    assert.ok(jsonRouteStart > -1, "GET /api/handovers/:id not found");
    const jsonChunk = file.slice(jsonRouteStart, jsonRouteStart + 2000);
    assertContains(
      jsonChunk,
      'if (role === "armeiro")',
      "GET /api/handovers/:id must check armeiro participation",
    );

    const pdfRouteStart = file.indexOf('"/:id/pdf",');
    assert.ok(pdfRouteStart > -1, "GET /api/handovers/:id/pdf not found");
    const pdfChunk = file.slice(pdfRouteStart, pdfRouteStart + 2000);
    assertContains(
      pdfChunk,
      'if (role === "armeiro")',
      "GET /api/handovers/:id/pdf must check armeiro participation — same guard as GET /:id, previously missing (IDOR: any armeiro in the tenant could download any handover's PDF)",
    );
    assertContains(
      pdfChunk,
      '"Acesso negado"',
      "GET /api/handovers/:id/pdf must reject non-participating armeiro with 403",
    );
  });
});
