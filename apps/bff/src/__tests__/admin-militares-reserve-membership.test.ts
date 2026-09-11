import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// SP2 Task 3 — POST /api/admin/militares deve vincular o militar a uma reserva
// (reserve_memberships) já na criação. Source-assertion: a rota é iron-session
// pesada de integrar; o padrão do repo (idor-write-scope.test.ts) é ler o
// arquivo e afirmar sobre o texto.
const admin = readFileSync(resolve(process.cwd(), "src", "routes", "admin.ts"), "utf8").replace(/\r\n/g, "\n");

// recorta o handler de POST /militares (do marcador até a próxima rota)
const handler = admin.slice(
  admin.indexOf("POST /api/admin/militares"),
  admin.indexOf("POST /api/admin/users/enviar-acesso"),
);

describe("POST /api/admin/militares — reserve_memberships (SP2)", () => {
  it("resolve a reserva do militar via resolveCreationReserveId", () => {
    assert.ok(handler.includes("resolveCreationReserveId("), "deve chamar resolveCreationReserveId");
    assert.ok(handler.includes('creatorActiveReserveId: c.get("reserveId")'), "usa a reserva ativa do criador");
    assert.ok(handler.includes("explicitReserveId: callerRole"), "seletor do form só pra admin_global (IDOR, ver teste dedicado)");
  });

  it("exige seletor e loga quando o criador está em matriz sem reserva", () => {
    assert.ok(handler.includes("needsSelector"), "checa needsSelector");
    assert.ok(handler.includes('"admin.militares.reserve_selector_required"'), "loga o evento de negação");
    assert.ok(
      handler.indexOf("needsSelector") < handler.indexOf("auth/v1/admin/users"),
      "a checagem de seletor roda ANTES de criar o auth user (fail-fast)",
    );
  });

  it("insere reserve_memberships com role 'usuario' para militar comum", () => {
    assert.ok(handler.includes('.from("reserve_memberships").upsert('), "faz upsert em reserve_memberships");
    assert.ok(handler.includes('isStaffReserveRole(userRole) ? userRole : "usuario"'), "militar comum entra como 'usuario'");
    assert.ok(handler.includes('onConflict: "reserve_id,user_id"'), "upsert idempotente");
  });

  it("loga falha do upsert de reserve_membership", () => {
    assert.ok(handler.includes('"admin.militar.reserve_membership_failure"'), "loga falha de reserve_membership");
  });

  it("body aceita reserve_id opcional", () => {
    assert.ok(admin.includes("reserve_id:       z.string().uuid().nullable().optional()"), "reserve_id no zValidator");
  });

  // Achado de code review (IDOR): body.reserve_id chegava direto no upsert
  // sem validar tenant/status/autoridade — um armeiro do tenant A podia
  // plantar reserve_id de outro tenant. Fix: só admin_global escolhe
  // explicitamente; a reserva resultante é revalidada.
  it("só admin_global pode escolher reserve_id explicitamente (IDOR)", () => {
    assert.ok(
      handler.includes('explicitReserveId: callerRole === "admin_global" ? (body.reserve_id ?? null) : null'),
      "armeiro/admin_reserva nunca usam body.reserve_id — sempre a própria ativa",
    );
  });

  it("revalida a reserva resultante contra tenant + status ativa antes de criar qualquer coisa", () => {
    assert.ok(handler.includes('.eq("tenant_id", tenantId)'), "filtra pelo tenant do caller");
    assert.ok(handler.includes('.eq("status", "ativa")'), "exige status ativa");
    assert.ok(handler.includes('"admin.militares.reserve_invalid"'), "loga quando a reserva é inválida");
    const revalidateIdx = handler.indexOf('"admin.militares.reserve_invalid"');
    const createUserIdx = handler.indexOf("auth/v1/admin/users");
    assert.ok(revalidateIdx > 0 && revalidateIdx < createUserIdx, "revalidação roda ANTES de criar o auth user");
  });
});
