import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const route = (name: string) =>
  readFileSync(resolve(process.cwd(), "src", "routes", name), "utf8");

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
});
