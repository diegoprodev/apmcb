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

function writeChains(file: string, table: string) {
  const regex = new RegExp(`\\.from\\("${table}"\\)([\\s\\S]*?);`, "g");
  return [...file.matchAll(regex)]
    .map((match) => match[0])
    .filter((chain) => chain.includes(".update(") || chain.includes(".delete("));
}

describe("IDOR scoped writes in custody routes", () => {
  it("keeps superadmin out of operational custody routes", () => {
    for (const name of ["lendings.ts", "saidas.ts", "cautelamentos.ts"]) {
      const file = route(name);
      assert.equal(file.includes('"superadmin"'), false, `${name} must keep superadmin Nexus-only`);
    }
  });

  it("scopes lending return updates by tenant_id", () => {
    const file = route("lendings.ts");
    assertContains(
      file,
      '.eq("id", id)\n      .eq("tenant_id", tenantId)\n      .eq("status_legacy", "ativo")',
      "PATCH /api/lendings/:id/return must update by id + tenant_id + active status",
    );
  });

  it("scopes body ids used by custody creation flows", () => {
    const lendings = route("lendings.ts");
    for (const snippet of [
      '.eq("id", body.military_id)\n      .eq("default_tenant_id", tenantId)',
      '.eq("id", body.material_type_id)\n      .eq("tenant_id", tenantId)',
      '.eq("material_type_id", body.material_type_id)\n      .eq("tenant_id", tenantId)',
    ]) {
      assertContains(lendings, snippet, `Missing scoped lending create lookup: ${snippet}`);
    }

    const saidas = route("saidas.ts");
    assertContains(
      saidas,
      '.eq("id", body.militar_id)\n      .eq("default_tenant_id", tenantId)',
      "POST /api/saidas must validate militar_id in the session tenant",
    );

    const cautelamentos = route("cautelamentos.ts");
    for (const snippet of [
      '.eq("id", body.militar_id)\n      .eq("default_tenant_id", tenantId)',
      '.eq("id", body.reserve_id)\n      .eq("tenant_id", tenantId)',
    ]) {
      assertContains(cautelamentos, snippet, `Missing scoped cautelamento create lookup: ${snippet}`);
    }
  });

  it("scopes lending bulk-return and rollback writes by tenant_id", () => {
    const file = route("lendings.ts");
    for (const snippet of [
      '.in("id", activeIds)\n        .eq("tenant_id", tenantId)\n        .eq("status_legacy", "ativo")',
      '.in("active_lending_id", activeIds)\n          .eq("tenant_id", tenantId)\n          .select("id");',
      '.delete()\n    .eq("id", id)\n    .eq("tenant_id", tenantId)\n    .eq("status_legacy", "ativo")',
    ]) {
      assertContains(file, snippet, `Missing scoped lending write: ${snippet}`);
    }
  });

  it("does not leave critical custody writes scoped only by id", () => {
    for (const name of ["lendings.ts", "saidas.ts", "cautelamentos.ts"]) {
      const file = route(name);
      for (const table of ["lendings", "cautelamentos", "material_items"]) {
        for (const chain of writeChains(file, table)) {
          assert.ok(
            chain.includes('.eq("tenant_id", tenantId)'),
            `${name} has unscoped ${table} write chain:\n${chain}`,
          );
        }
      }
    }
  });

  it("scopes saida lending writes by tenant_id", () => {
    const file = route("saidas.ts");
    for (const snippet of [
      '.eq("id", body.item_id)\n      .eq("tenant_id", tenantId)',
      '.eq("id", body.item_id)\n      .eq("tenant_id", tenantId)\n      .eq("status_operacional", "disponivel")\n      .select("id")\n      .single();',
      '.delete().eq("id", saida.id).eq("tenant_id", tenantId);',
      '.eq("id", id)\n      .eq("tenant_id", tenantId)\n      .eq("status", "emitida")\n      .is("armeiro_signature_id", null)',
      '.eq("id", id)\n      .eq("tenant_id", tenantId)\n      .eq("military_id", militarId)\n      .eq("status", "aguardando_confirmacao")\n      .not("armeiro_signature_id", "is", null)\n      .is("militar_signature_id", null)',
      '.eq("id", id)\n      .eq("tenant_id", tenantId)\n      .not("item_id", "is", null)',
      '.not("item_id", "is", null)\n      .eq("status_legacy", "ativo")',
      '.not("item_id", "is", null)\n      .eq("status_legacy", "ativo")\n      .eq("status", "ativa")\n      .select("id")\n      .single();',
      '.eq("id", saida.item_id)\n        .eq("tenant_id", tenantId)',
      '.update({\n            status: saida.status,\n            status_legacy: saida.status_legacy,',
    ]) {
      assertContains(file, snippet, `Missing scoped saida write: ${snippet}`);
    }
  });

  it("validates reserve_id against caller's reserve_memberships before opening a shift", () => {
    // POST /api/shifts/open recebe reserve_id do body — sem essa checagem, um
    // armeiro autenticado poderia abrir turno (e ler o snapshot de armamento)
    // numa reserva de outro tenant ou de uma reserva à qual não pertence.
    const file = route("shifts.ts");
    assertContains(
      file,
      '.from("reserve_memberships")',
      "POST /api/shifts/open must validate reserve_id against reserve_memberships",
    );
    assertContains(
      file,
      '.eq("user_id", userId)\n      .eq("reserve_id", reserve_id)\n      .eq("reserves.tenant_id", tenantId)',
      "reserve_memberships lookup must scope by caller + reserve + tenant together",
    );
  });

  it("scopes cautelamento writes by tenant_id", () => {
    const file = route("cautelamentos.ts");
    for (const snippet of [
      '.eq("id", body.item_id)\n      .eq("tenant_id", tenantId)',
      '.eq("id", body.item_id)\n      .eq("tenant_id", tenantId)\n      .eq("status_operacional", "disponivel")\n      .select("id")\n      .single();',
      '.delete().eq("id", cautela.id).eq("tenant_id", tenantId);',
      '.update({ armeiro_signature_id: sig.id })\n      .eq("id", id)\n      .eq("tenant_id", tenantId)\n      .eq("status", "ativa")\n      .is("armeiro_signature_id", null)\n      .select("id")',
      '.update({ armeiro_signature_id: sig.id })\n      .eq("id", id)\n      .eq("tenant_id", tenantId)\n      .eq("status", "ativa")\n      .is("armeiro_signature_id", null)',
      '.update({ militar_signature_id: sig.id })\n      .eq("id", id)\n      .eq("tenant_id", tenantId)\n      .eq("militar_id", militarId)\n      .eq("status", "ativa")\n      .not("armeiro_signature_id", "is", null)\n      .is("militar_signature_id", null)\n      .select("id")',
      '.update({ militar_signature_id: sig.id })\n      .eq("id", id)\n      .eq("tenant_id", tenantId)\n      .eq("militar_id", militarId)\n      .eq("status", "ativa")\n      .not("armeiro_signature_id", "is", null)\n      .is("militar_signature_id", null)',
      '.eq("id", id)\n      .eq("tenant_id", tenantId)\n      .eq("status", "ativa")',
      '.eq("id", id)\n      .eq("tenant_id", tenantId)\n      .eq("status", "ativa")\n      .select("id")\n      .single();',
      '.eq("id", cautela.item_id)\n      .eq("tenant_id", tenantId)',
      '.update({\n          status: "ativa",',
      '.eq("id", antiga.item_id)\n      .eq("tenant_id", tenantId)',
      '.eq("id", body.novo_item_id)\n      .eq("tenant_id", tenantId)',
      '.delete().eq("id", nova.id).eq("tenant_id", tenantId);',
    ]) {
      assertContains(file, snippet, `Missing scoped cautelamento write: ${snippet}`);
    }
  });
});
