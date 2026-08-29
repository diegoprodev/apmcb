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

  it("retires the legacy lending return endpoint behind a tenant gate", () => {
    const file = route("lendings.ts");
    assertContains(
      file,
      'if (!c.get("tenantId")) return c.json({ error: "Tenant nao identificado na sessao" }, 400);',
      "PATCH /api/lendings/:id/return must require a tenant",
    );
    assertContains(file, "LEGACY_RETURN_FLOW_RETIRED", "legacy return must not mutate custody directly");
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
    assertContains(saidas, "LEGACY_CUSTODY_FLOW_RETIRED", "legacy saidas creation must be retired");
    assertContains(saidas, '.eq("tenant_id", tenantId);', "GET /api/saidas must scope results by tenant");

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
    assertContains(file, 'p_tenant_id: tenantId', "bulk return RPC must receive the session tenant");
    assertContains(file, 'p_military_id: identity.profile_id', "bulk return RPC must receive the identified military");
    assertContains(file, 'p_reserve_id: identity.reserve_id', "bulk return RPC must receive the identified reserve");
    assertContains(file, 'record_lending_returns', "bulk return must use the atomic database contract");
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

  it("keeps active saida reads and signatures tenant-scoped", () => {
    const file = route("saidas.ts");
    for (const snippet of [
      '.eq("id", id)\n      .eq("tenant_id", tenantId)\n      .eq("status", "emitida")\n      .is("armeiro_signature_id", null)',
      '.eq("id", id)\n      .eq("tenant_id", tenantId)\n      .eq("military_id", militarId)\n      .eq("status", "aguardando_confirmacao")\n      .not("armeiro_signature_id", "is", null)\n      .is("militar_signature_id", null)',
    ]) {
      assertContains(file, snippet, `Missing scoped saida signature operation: ${snippet}`);
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

  it("scopes usuario_associado_id (Registrar Ocorrência dialog) by the caller's tenant", () => {
    // Achado de code review (associação opcional de militar a uma ocorrência
    // de material, ver PATCH /items/:id/ocorrencia): o id chega no corpo do
    // PATCH como texto livre — sem esta checagem de tenant, um
    // usuario_associado_id forjado de outro tenant seria persistido e
    // notificado, um IDOR clássico. Regressão futura nessa checagem passaria
    // despercebida sem este teste (não havia cobertura pra arsenal.ts nesta
    // suíte antes desta ocorrência).
    const file = route("arsenal.ts");
    assertContains(
      file,
      '.eq("id", usuario_associado_id)\n        .eq("default_tenant_id", tenantId)',
      "PATCH /items/:id/ocorrencia must validate usuario_associado_id against the caller's tenant before persisting/notifying",
    );
  });

  // Achado CRÍTICO do usuário (2026-08-28): recebeu de volta uma cautela que
  // nem sequer tinha sido assinada por ele — nem o frontend nem este
  // endpoint checavam armeiro_signature_id/militar_signature_id antes de
  // aceitar a devolução (só checava status="ativa"). Uma cautela só prova
  // cadeia de custódia se as 2 partes assinaram; sem essa checagem, uma
  // devolução apagava esse rastro sem ele nunca ter existido de fato. Teste
  // estático garante que a checagem não seja removida silenciosamente num
  // refactor futuro.
  it("POST /api/cautelamentos/:id/return exige as 2 assinaturas antes de aceitar a devolução", () => {
    const file = route("cautelamentos.ts");
    const returnRouteStart = file.indexOf('"/:id/return"');
    assert.ok(returnRouteStart > -1, "POST /api/cautelamentos/:id/return not found");
    // Achado BAIXO de code review: um limite fixo por tamanho (`+ 2500`) é
    // frágil a churn de comentário (este arquivo tem comentários longos em
    // pt-BR) — o próprio `.update(...)` que marca a cautela como "devolvida"
    // é o limite real e semanticamente correto, não um número mágico.
    const updateIdx = file.indexOf('.update({\n      status: "devolvida"', returnRouteStart);
    assert.ok(updateIdx > -1, "'.update({ status: \"devolvida\" }' não encontrado após a rota — a assinatura da query pode ter mudado");
    const chunk = file.slice(returnRouteStart, updateIdx);

    assertContains(
      chunk,
      "armeiro_signature_id, militar_signature_id",
      "POST /:id/return precisa selecionar as 2 colunas de assinatura antes de poder checá-las",
    );
    assertContains(
      chunk,
      "if (!cautela.armeiro_signature_id || !cautela.militar_signature_id)",
      "POST /:id/return deve recusar a devolução se qualquer uma das 2 assinaturas estiver pendente",
    );
    // A checagem tem que rodar ANTES do .update() (garantido pela própria
    // janela do slice acima, que termina no início do .update()) — a
    // asserção anterior (assertContains) já falharia se o guard não
    // estivesse dentro dessa janela.
  });

  // Mesma classe de bug do teste acima, mesmo dia (achado CRÍTICO de code
  // review durante a revisão do fix de /return): substituir uma cautela
  // também a encerra (status="substituida", libera o item) exatamente como
  // devolver — tinha a mesma ausência de checagem de assinaturas.
  it("POST /api/cautelamentos/:id/substitute exige as 2 assinaturas antes de aceitar a substituição", () => {
    const file = route("cautelamentos.ts");
    const substituteRouteStart = file.indexOf('"/:id/substitute"');
    assert.ok(substituteRouteStart > -1, "POST /api/cautelamentos/:id/substitute not found");
    const updateIdx = file.indexOf('.update({\n      status: "substituida"', substituteRouteStart);
    assert.ok(updateIdx > -1, "'.update({ status: \"substituida\" }' não encontrado após a rota — a assinatura da query pode ter mudado");
    const chunk = file.slice(substituteRouteStart, updateIdx);

    assertContains(
      chunk,
      "armeiro_signature_id, militar_signature_id",
      "POST /:id/substitute precisa selecionar as 2 colunas de assinatura antes de poder checá-las",
    );
    assertContains(
      chunk,
      "if (!antiga.armeiro_signature_id || !antiga.militar_signature_id)",
      "POST /:id/substitute deve recusar a substituição se qualquer uma das 2 assinaturas estiver pendente",
    );
  });

  // docs/enterprise/specs/cautela-lifecycle-enterprise.md (CAULC-04): cancelar
  // é o único fluxo de encerramento que NÃO exige as 2 assinaturas (é
  // justamente o caminho pra desfazer algo antes/durante o processo) — mas
  // precisa bloquear o caso OPOSTO: cautela já assinada por ambas as partes
  // (documento de custódia formalizado — o caminho ali é Devolver).
  it("POST /api/cautelamentos/:id/cancel bloqueia cautela já assinada por ambas as partes", () => {
    const file = route("cautelamentos.ts");
    const cancelRouteStart = file.indexOf('"/:id/cancel"');
    assert.ok(cancelRouteStart > -1, "POST /api/cautelamentos/:id/cancel not found");
    const updateIdx = file.indexOf('.update({\n        status: "cancelada"', cancelRouteStart);
    assert.ok(updateIdx > -1, "'.update({ status: \"cancelada\" }' não encontrado após a rota — a assinatura da query pode ter mudado");
    const chunk = file.slice(cancelRouteStart, updateIdx);

    assertContains(
      chunk,
      "armeiro_signature_id, militar_signature_id",
      "POST /:id/cancel precisa selecionar as 2 colunas de assinatura antes de poder checá-las",
    );
    assertContains(
      chunk,
      "if (cautela.armeiro_signature_id && cautela.militar_signature_id)",
      "POST /:id/cancel deve recusar o cancelamento se AMBAS as assinaturas já existirem (documento formalizado — usar Devolver)",
    );
  });

  // Mesma proteção contra corrida (id + tenant_id + status="ativa" no mesmo
  // update) usada por /return e /substitute — /cancel e PATCH /:id (edição,
  // CAULC-05) precisam da mesma combinação, não só tenant_id sozinho.
  it("POST /:id/cancel e PATCH /:id (cautelamentos) protegem o update contra corrida (id + tenant_id + status=ativa)", () => {
    const file = route("cautelamentos.ts");

    const cancelRouteStart = file.indexOf('"/:id/cancel"');
    const cancelUpdateIdx = file.indexOf('.update({\n        status: "cancelada"', cancelRouteStart);
    const cancelChunk = file.slice(cancelUpdateIdx, cancelUpdateIdx + 300);
    assertContains(cancelChunk, '.eq("id", id)', "/:id/cancel update deve filtrar por id");
    assertContains(cancelChunk, '.eq("tenant_id", tenantId)', "/:id/cancel update deve filtrar por tenant_id");
    assertContains(cancelChunk, '.eq("status", "ativa")', "/:id/cancel update deve exigir status=ativa (fail-closed contra corrida)");

    // PATCH /:id — rota diferente de "/:id/cancel"/"/:id/substitute" etc.,
    // localizada pelo método .patch(.
    const patchRouteStart = file.indexOf('cautelamentosRoutes.patch(\n  "/:id"');
    assert.ok(patchRouteStart > -1, "PATCH /api/cautelamentos/:id not found");
    const patchUpdateIdx = file.indexOf(".update(updateData)", patchRouteStart);
    assert.ok(patchUpdateIdx > -1, "'.update(updateData)' não encontrado após PATCH /:id");
    const patchChunk = file.slice(patchUpdateIdx, patchUpdateIdx + 300);
    assertContains(patchChunk, '.eq("id", id)', "PATCH /:id update deve filtrar por id");
    assertContains(patchChunk, '.eq("tenant_id", tenantId)', "PATCH /:id update deve filtrar por tenant_id");
    assertContains(patchChunk, '.eq("status", "ativa")', "PATCH /:id update deve exigir status=ativa (fail-closed contra corrida)");
  });

  // GET /:id/historico (CAULC-07) usa a service role (bypassa RLS) — sem
  // filtro de tenant explícito, um armeiro de qualquer tenant poderia ler o
  // histórico de qualquer cautela sabendo/enumerando o UUID.
  it("GET /:id/historico (cautelamentos) valida tenant antes de devolver qualquer evento", () => {
    const file = route("cautelamentos.ts");
    const historicoRouteStart = file.indexOf('"/:id/historico"');
    assert.ok(historicoRouteStart > -1, "GET /api/cautelamentos/:id/historico not found");
    const chunk = file.slice(historicoRouteStart, historicoRouteStart + 1600);

    assertContains(
      chunk,
      "if (origem.tenant_id !== tenantId)",
      "GET /:id/historico deve recusar (404) se a cautela pedida não pertencer ao tenant do chamador",
    );
    assertContains(
      chunk,
      '.eq("tenant_id", tenantId)',
      "GET /:id/historico deve filtrar service_log_events por tenant_id (service role bypassa RLS)",
    );
  });

  // Achado CRÍTICO de code review (implementação de CAULC-07): o único
  // fluxo de criação do frontend usa SEMPRE POST /batch (mesmo pra 1 item
  // só), que grava o evento de emissão com subject_type="cautelamento_batch"
  // e subject_id=movement_id — não subject_type="cautelamento"/
  // subject_id=cautelamento_id, que é tudo que a query original de
  // /:id/historico buscava. Sem a 2ª query, o evento "Cautela Emitida"
  // (exatamente o que o usuário pediu — "histórico desde a ABERTURA")
  // nunca aparecia em NENHUMA cautela real do sistema. Teste estático
  // garante que a 2ª query não seja removida silenciosamente.
  it("GET /:id/historico (cautelamentos) também busca eventos de emissão em lote (subject_type=cautelamento_batch por movement_id)", () => {
    const file = route("cautelamentos.ts");
    const historicoRouteStart = file.indexOf('"/:id/historico"');
    assert.ok(historicoRouteStart > -1, "GET /api/cautelamentos/:id/historico not found");
    const chunk = file.slice(historicoRouteStart, historicoRouteStart + 5000);

    assertContains(
      chunk,
      '.select("id, movement_id")',
      "GET /:id/historico precisa buscar os movement_id da cadeia antes de poder consultar eventos de lote",
    );
    assertContains(
      chunk,
      '.eq("subject_type", "cautelamento_batch")',
      "GET /:id/historico deve buscar também eventos de EMISSÃO EM LOTE (subject_type=cautelamento_batch) — sem isso, 'Cautela Emitida' nunca aparece pra nenhuma cautela real (POST /batch é o único fluxo de criação do frontend)",
    );
    assertContains(
      chunk,
      '.in("subject_id", movementIds)',
      "a busca de eventos de lote deve filtrar por movement_id da cadeia, não pelos ids de cautelamento (que nunca batem com o subject_id gravado por POST /batch)",
    );
  });

  // docs/enterprise/specs/alertas-vencimento-unificado-enterprise.md (AVU-10):
  // adiar/silenciar exige as mesmas proteções (tenant + status="ativa" +
  // corrida) já estabelecidas pra /cancel e /return.
  it("POST /:id/vencimento-snooze (cautelamentos) protege o update contra corrida (id + tenant_id + status=ativa)", () => {
    const file = route("cautelamentos.ts");
    const routeStart = file.indexOf('"/:id/vencimento-snooze"');
    assert.ok(routeStart > -1, "POST /api/cautelamentos/:id/vencimento-snooze not found");
    const updateIdx = file.indexOf(".update(updateData)", routeStart);
    assert.ok(updateIdx > -1, "'.update(updateData)' não encontrado após a rota");
    const chunk = file.slice(routeStart, updateIdx + 300);

    assertContains(chunk, '.eq("id", id)', "vencimento-snooze update deve filtrar por id");
    assertContains(chunk, '.eq("tenant_id", tenantId)', "vencimento-snooze update deve filtrar por tenant_id");
    assertContains(chunk, '.eq("status", "ativa")', "vencimento-snooze update deve exigir status=ativa (fail-closed contra corrida)");
    assertContains(chunk, 'roleGuard("armeiro", "admin_reserva", "admin_global")',
      "vencimento-snooze não deve incluir \"usuario\" — adiar/silenciar é decisão de gestão da reserva, não preferência pessoal do militar dono da cautela (spec §6 pergunta 3)");
  });

  // AVU-04: material_validity_alert_dias_padrao só pode conter valores do
  // mesmo conjunto fechado que o CHECK constraint de
  // material_validity_alert_events já exige no banco — um valor fora disso
  // abortaria o cron de validade inteiro, silenciosamente, todo dia (achado
  // CRÍTICO de code review na spec).
  it("PATCH /api/reserves/:id/settings restringe material_validity_alert_dias_padrao ao conjunto {90,180,365}", () => {
    const file = route("reserves.ts");
    const routeStart = file.indexOf('"/:id/settings"');
    assert.ok(routeStart > -1, "PATCH /api/reserves/:id/settings not found");
    const chunk = file.slice(routeStart, routeStart + 3000);

    assertContains(
      chunk,
      "new Set([90, 180, 365])",
      "material_validity_alert_dias_padrao deve ser validado contra o mesmo conjunto fechado do CHECK constraint do banco — sem isso, o cron de validade de material aborta silenciosamente todo dia no primeiro valor fora do conjunto",
    );
  });

  // BAIXO de code review (2026-08-29): sem este teste, uma reordenação ou
  // remoção acidental do SELECT faria o badge de silenciado/adiado
  // (VencimentoAlertaBadge, _cautelas-client.tsx) simplesmente sumir da UI,
  // sem nenhum teste vermelho pra pegar a regressão.
  it("GET /api/cautelamentos retorna vencimento_silenciado e vencimento_snooze_until no SELECT", () => {
    const file = route("cautelamentos.ts");
    const routeStart = file.indexOf('.from("cautelamentos")\n      .select(`');
    assert.ok(routeStart > -1, "GET /api/cautelamentos select not found");
    const selectEnd = file.indexOf("`)", routeStart);
    const chunk = file.slice(routeStart, selectEnd);

    assertContains(chunk, "vencimento_silenciado", "SELECT de GET /api/cautelamentos deve incluir vencimento_silenciado");
    assertContains(chunk, "vencimento_snooze_until", "SELECT de GET /api/cautelamentos deve incluir vencimento_snooze_until");
  });

  // MÉDIO de code review (2026-08-29): `{"silenciar": false}` (sem `dias`)
  // satisfazia o `.refine` antigo (`b.silenciar !== undefined`) e caía no
  // `else` do handler usando `body.dias!` — non-null assertion sem checagem
  // em runtime, estourando `addDiasCalendario` com NaN/RangeError (500 em
  // vez de rejeição limpa 400/422). Testes estáticos: schema exige
  // `silenciar === true` explícito, e o handler nunca faz `body.dias!`.
  it("snoozeSchema exige EXATAMENTE uma ação (dias XOR silenciar XOR reativar)", () => {
    const file = route("cautelamentos.ts");
    assertContains(
      file,
      '[b.reativar === true, b.silenciar === true, typeof b.dias === "number"].filter(Boolean).length === 1',
      "snoozeSchema deve rejeitar combinações ambíguas (ex: {reativar:true, dias:5}), não só exigir 'pelo menos uma' das chaves",
    );
  });

  // Pedido do usuário: botão explícito de "reativar" um alerta silenciado
  // (spec §6.1, pergunta aberta resolvida depois da entrega original).
  it("POST /:id/vencimento-snooze suporta reativar===true (limpa silenciado e snooze)", () => {
    const file = route("cautelamentos.ts");
    const routeStart = file.indexOf('"/:id/vencimento-snooze"');
    assert.ok(routeStart > -1, "POST /api/cautelamentos/:id/vencimento-snooze not found");
    const nextRouteStart = file.indexOf("// POST /api/cautelamentos/:id/substitute", routeStart);
    const chunk = file.slice(routeStart, nextRouteStart > -1 ? nextRouteStart : routeStart + 3000);

    assertContains(chunk, "body.reativar === true", "handler deve tratar reativar===true explicitamente");
  });

  // Achado MÉDIO de code review: sem o guard de no-op, {reativar:true} numa
  // cautela que já não estava silenciada/adiada gravava audit_log +
  // logShiftEvent como se algo tivesse mudado.
  it("POST /:id/vencimento-snooze responde noop sem gravar log quando reativar não muda nada", () => {
    const file = route("cautelamentos.ts");
    const routeStart = file.indexOf('"/:id/vencimento-snooze"');
    assert.ok(routeStart > -1, "POST /api/cautelamentos/:id/vencimento-snooze not found");
    const nextRouteStart = file.indexOf("// POST /api/cautelamentos/:id/substitute", routeStart);
    const chunk = file.slice(routeStart, nextRouteStart > -1 ? nextRouteStart : routeStart + 3000);

    assertContains(
      chunk,
      "body.reativar === true && !cautela.vencimento_silenciado && !cautela.vencimento_snooze_until",
      "handler deve responder noop antes de gravar audit_log/logShiftEvent quando reativar não muda nada",
    );
  });

  it("POST /:id/vencimento-snooze nunca usa 'body.dias!' (non-null assertion sem checagem em runtime)", () => {
    const file = route("cautelamentos.ts");
    const routeStart = file.indexOf('"/:id/vencimento-snooze"');
    assert.ok(routeStart > -1, "POST /api/cautelamentos/:id/vencimento-snooze not found");
    const nextRouteStart = file.indexOf("// POST /api/cautelamentos/:id/substitute", routeStart);
    const chunk = file.slice(routeStart, nextRouteStart > -1 ? nextRouteStart : routeStart + 3000);

    assert.ok(!chunk.includes("body.dias!"), "handler não deve usar body.dias! (non-null assertion) — usar typeof body.dias === \"number\" antes");
    assertContains(chunk, 'typeof body.dias === "number"', "handler deve checar o tipo de body.dias em runtime antes de usá-lo");
  });
});
