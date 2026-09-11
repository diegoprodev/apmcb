import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// SP2 Task 4 — /api/admin/users (criação de militar) deve vincular o novo
// usuário a uma reserva (reserve_memberships), igual ao BFF /api/admin/militares.
// Source-assertion: a rota é edge + iron-session, pesada de integrar; o padrão
// do repo (idor-write-scope.test.ts no BFF) é afirmar sobre o texto.
const src = readFileSync(resolve(__dirname, "route.ts"), "utf8").replace(/\r\n/g, "\n");

describe("POST /api/admin/users — reserve_membership (SP2)", () => {
  it("getCallerSession carrega active_reserve_id", () => {
    expect(src).toContain("role, default_tenant_id, active_reserve_id");
    expect(src).toContain("activeReserveId: profile.active_reserve_id ?? null");
  });

  it("resolve a reserva do criador e exige seletor quando em matriz", () => {
    expect(src).toContain("const creationReserveId = body.reserve_id ?? session!.activeReserveId ?? null");
    expect(src).toContain('return NextResponse.json({ error: "Selecione a reserva do militar." }, { status: 400 })');
    // a checagem roda ANTES de criar o auth user
    expect(src.indexOf("creationReserveId")).toBeLessThan(src.indexOf("auth.admin.inviteUserByEmail"));
  });

  it("insere reserve_memberships role 'usuario' (ou staff) idempotente", () => {
    expect(src).toContain('.from("reserve_memberships").upsert(');
    expect(src).toContain('STAFF_RESERVE_ROLES.includes(userRole) ? userRole : "usuario"');
    expect(src).toContain('onConflict: "reserve_id,user_id"');
  });

  it("loga falha do reserve_membership sem lançar", () => {
    expect(src).toContain("falha ao criar reserve_membership");
  });
});
