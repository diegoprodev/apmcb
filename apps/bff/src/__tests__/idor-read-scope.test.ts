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

  // Achado de code review (retrofit de inventory-pdf.ts): a checagem de
  // reserve_ids de admin_reserva em inventory.ts só rodava quando
  // `reserveId` era truthy (`role === "admin_reserva" && reserveId && ...`)
  // — um admin_reserva sem reserve_memberships vigente (transferido/
  // desligado, mas com profiles.role ainda "admin_reserva") tinha
  // reserveId null e a checagem inteira era pulada, vendo/baixando
  // qualquer campanha do tenant. O mesmo padrão fail-open existia em TODAS
  // as 7 checagens de admin_reserva do arquivo, não só na rota de PDF —
  // corrigidas juntas para fail-closed (`!reserveId` bloqueia primeiro).
  // Este teste garante que o padrão fail-open não volte num refactor
  // futuro (ex: alguém "simplificando" de volta para `&& reserveId`).
  it("todas as checagens de admin_reserva em inventory.ts são fail-closed (reserveId ausente bloqueia, não libera)", () => {
    const file = route("inventory.ts");

    const failOpenPattern = /role === "admin_reserva" && reserveId\b/;
    assert.equal(
      failOpenPattern.test(file),
      false,
      "encontrado padrão fail-open 'role === \"admin_reserva\" && reserveId' — reserveId null pula a checagem inteira em vez de bloquear (IDOR)",
    );

    const failClosedOccurrences = (file.match(/role === "admin_reserva"/g) ?? []).length;
    assert.ok(
      failClosedOccurrences >= 7,
      `esperava pelo menos 7 checagens de admin_reserva em inventory.ts (uma por rota protegida), achou ${failClosedOccurrences} — uma rota pode ter perdido a checagem`,
    );
  });

  it("GET /campaigns/:id/pdf nega acesso a admin_reserva sem reserveId (fail-closed)", () => {
    const file = route("inventory.ts");
    const pdfRouteStart = file.indexOf('"/campaigns/:id/pdf",');
    assert.ok(pdfRouteStart > -1, "GET /api/inventory/campaigns/:id/pdf not found");
    const pdfChunk = file.slice(pdfRouteStart, pdfRouteStart + 2000);
    assertContains(
      pdfChunk,
      "if (!reserveId) return c.json",
      "GET /api/inventory/campaigns/:id/pdf deve negar admin_reserva sem reserve vigente, não pular a checagem",
    );
  });

  // Achado CRÍTICO (2026-08-28, investigando por que uma ocorrência
  // reportada por um militar nunca foi vista/resolvida por nenhum armeiro):
  // GET /api/ocorrencias usa a service role (bypassa RLS por completo) e o
  // branch de staff não filtrava por tenant nenhum — qualquer armeiro/
  // admin_reserva/admin_global autenticado, de QUALQUER tenant, recebia
  // TODAS as ocorrências abertas da plataforma inteira. Mesmo dia, mesma
  // classe de vazamento já corrigida em material-photos (RLS) e na policy
  // occ_staff da própria tabela ocorrencias (esta rota é uma 3ª camada
  // independente do mesmo bug — service role não passa por nenhuma das
  // duas). Teste estático garante que o filtro de tenant não seja removido
  // silenciosamente num refactor futuro.
  it("GET /api/ocorrencias filtra o branch de staff por tenant (military.default_tenant_id)", () => {
    const file = route("ocorrencias.ts");
    const getRouteStart = file.indexOf('ocorrenciasRoutes.get("/"');
    assert.ok(getRouteStart > -1, "GET /api/ocorrencias not found");
    const chunk = file.slice(getRouteStart, getRouteStart + 3000);

    assertContains(
      chunk,
      '!inner(nome_completo, posto, matricula, default_tenant_id)',
      "GET /api/ocorrencias precisa do join !inner com default_tenant_id pra poder filtrar o branch de staff por tenant",
    );
    assertContains(
      chunk,
      '.eq("military.default_tenant_id", tenantId)',
      "GET /api/ocorrencias (branch de staff) deve filtrar por tenant do militar que reportou — sem isso, qualquer staff vê ocorrências de qualquer tenant (IDOR cross-tenant, service role bypassa RLS)",
    );

    // Fail-closed: o filtro de tenant tem que estar no branch de staff
    // (else), não só presente em algum lugar do arquivo por acidente —
    // confirma que aparece DEPOIS do branch `if (role === "usuario")`.
    const usuarioIdx = chunk.indexOf('role === "usuario"');
    const tenantFilterIdx = chunk.indexOf('.eq("military.default_tenant_id"');
    assert.ok(usuarioIdx > -1 && tenantFilterIdx > usuarioIdx, "filtro de tenant deve estar no branch de staff (else), não no branch do próprio militar");
  });

  // Achado CRÍTICO de code review (2026-08-28, mesma investigação do GET
  // acima, mesmo arquivo): PATCH /api/ocorrencias/:id (armeiro resolve/
  // atualiza status) usava a mesma service role e não tinha NENHUM filtro
  // de tenant — um armeiro do Tenant A, sabendo/enumerando o UUID de uma
  // ocorrência do Tenant B, conseguia marcá-la como resolvida/improcedente
  // (IDOR de escrita), notificar o militar errado e gravar evento de Livro
  // Digital cross-tenant. Teste estático garante que o filtro não seja
  // removido silenciosamente num refactor futuro.
  it("PATCH /api/ocorrencias/:id filtra por tenant do militar antes de aceitar a atualização", () => {
    const file = route("ocorrencias.ts");
    const patchRouteStart = file.indexOf('ocorrenciasRoutes.patch(');
    assert.ok(patchRouteStart > -1, "PATCH /api/ocorrencias/:id not found");
    const chunk = file.slice(patchRouteStart, patchRouteStart + 2500);

    assertContains(
      chunk,
      '!inner(default_tenant_id)',
      "PATCH /api/ocorrencias/:id precisa do join !inner com default_tenant_id pra poder filtrar por tenant antes de aceitar a atualização",
    );
    assertContains(
      chunk,
      '.eq("military.default_tenant_id", tenantId)',
      "PATCH /api/ocorrencias/:id deve filtrar por tenant do militar dono da ocorrência — sem isso, qualquer armeiro atualiza ocorrência de qualquer tenant (IDOR de escrita, service role bypassa RLS)",
    );

    // O filtro de tenant tem que rodar ANTES do update, não só existir em
    // algum lugar do handler — confirma que aparece antes de `.update(`.
    const tenantFilterIdx = chunk.indexOf('.eq("military.default_tenant_id"');
    const updateIdx = chunk.indexOf('.update(updateData)');
    assert.ok(tenantFilterIdx > -1 && updateIdx > -1 && tenantFilterIdx < updateIdx, "filtro de tenant deve rodar antes do .update(), não depois");
  });
});
