import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { queryUnifiedEvents, type UnifiedAuditFilters } from "../lib/unified-audit-reader.ts";

// Fase 5 da spec de rastreabilidade enterprise. Fake query builder que
// FILTRA/ORDENA/PAGINA de verdade contra um dataset em memória (não só
// grava chamadas e devolve dado fixo) — a correção da paginação por
// merge (pedir `limit` de cada fonte, mesclar, cortar) é sutil o
// suficiente pra merecer um teste que realmente exercita múltiplas
// páginas, não só a 1ª.

interface Row {
  id: string;
  tenant_id: string;
  actor_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  reserve_id?: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

// O código de produção valida cursor.id contra um regex de UUID (achado
// ALTO de code review — proteção contra filter injection no .or() do
// PostgREST) — os ids de teste precisam ser UUIDs de verdade. Mantém
// rótulos legíveis (`idFor`/`labelFor`) pras asserções continuarem claras.
const labelToUuid = new Map<string, string>();
const uuidToLabel = new Map<string, string>();
let uuidCounter = 0;
function idFor(label: string): string {
  if (!labelToUuid.has(label)) {
    uuidCounter += 1;
    const hex = uuidCounter.toString(16).padStart(12, "0");
    const uuid = `00000000-0000-4000-8000-${hex}`;
    labelToUuid.set(label, uuid);
    uuidToLabel.set(uuid, label);
  }
  return labelToUuid.get(label)!;
}
function labelFor(uuid: string): string {
  return uuidToLabel.get(uuid) ?? uuid;
}

function makeFakeTable(rows: Row[]) {
  let calledCount = 0;
  const calls: Array<{ method: string; args: unknown[] }> = [];

  function field<K extends keyof Row>(r: Row, key: K): Row[K] {
    return r[key];
  }

  // ORDER BY multi-coluna: PostgREST/Postgres aplicam TODAS as colunas de
  // uma vez (created_at desc, id desc), não "reordena do zero a cada
  // .order() encadeado" — um mock que reordenasse ingenuamente a cada
  // chamada destruiria a ordenação primária ao aplicar a segunda coluna.
  // Acumula as specs e só resolve o comparador completo, aplicado de uma
  // vez, refletindo o comportamento real do banco.
  type OrderSpec = { fieldName: keyof Row; ascending: boolean };

  function builder(currentRows: Row[], orderSpecs: OrderSpec[] = []) {
    const api = {
      eq(fieldName: keyof Row, value: unknown) {
        calls.push({ method: "eq", args: [fieldName, value] });
        return builder(currentRows.filter((r) => field(r, fieldName) === value), orderSpecs);
      },
      in(fieldName: keyof Row, values: unknown[]) {
        calls.push({ method: "in", args: [fieldName, values] });
        return builder(currentRows.filter((r) => values.includes(field(r, fieldName))), orderSpecs);
      },
      gte(fieldName: keyof Row, value: string) {
        calls.push({ method: "gte", args: [fieldName, value] });
        return builder(currentRows.filter((r) => String(field(r, fieldName)) >= value), orderSpecs);
      },
      lte(fieldName: keyof Row, value: string) {
        calls.push({ method: "lte", args: [fieldName, value] });
        return builder(currentRows.filter((r) => String(field(r, fieldName)) <= value), orderSpecs);
      },
      or(expr: string) {
        calls.push({ method: "or", args: [expr] });
        // Só o formato usado pelo código real: "created_at.lt.X,and(created_at.eq.X,id.lt.Y)"
        const ltMatch = expr.match(/^created_at\.lt\.([^,]+),and\(created_at\.eq\.([^,]+),id\.lt\.([^)]+)\)$/);
        if (!ltMatch) throw new Error(`formato de .or() inesperado no teste: ${expr}`);
        const [, ltTs, eqTs, ltId] = ltMatch;
        return builder(currentRows.filter((r) => r.created_at < ltTs || (r.created_at === eqTs && r.id < ltId)), orderSpecs);
      },
      order(fieldName: keyof Row, opts: { ascending: boolean }) {
        const nextSpecs = [...orderSpecs, { fieldName, ascending: opts.ascending }];
        calls.push({ method: "order", args: [fieldName, opts] });
        const sorted = [...currentRows].sort((a, b) => {
          for (const spec of nextSpecs) {
            const av = String(field(a, spec.fieldName));
            const bv = String(field(b, spec.fieldName));
            if (av === bv) continue;
            const cmp = av < bv ? -1 : 1;
            return spec.ascending ? cmp : -cmp;
          }
          return 0;
        });
        return builder(sorted, nextSpecs);
      },
      limit(n: number) {
        calls.push({ method: "limit", args: [n] });
        calledCount += 1;
        return Promise.resolve({ data: currentRows.slice(0, n), error: null });
      },
      select(_cols: string) {
        return builder(currentRows, orderSpecs);
      },
    };
    return api;
  }

  return {
    from: () => builder(rows),
    calls,
    get callCount() { return calledCount; },
  };
}

function makeFakeSupabase(eventsRows: Row[], logsRows: Row[]) {
  const eventsTable = makeFakeTable(eventsRows);
  const logsTable = makeFakeTable(logsRows);
  return {
    supabase: {
      from(table: string) {
        if (table === "audit_events") return eventsTable.from();
        if (table === "audit_logs") return logsTable.from();
        throw new Error(`tabela não mockada: ${table}`);
      },
    },
    eventsTable,
    logsTable,
  };
}

const TENANT_ID = "tenant-1";

function row(label: string, createdAt: string, extra: Partial<Row> = {}): Row {
  return {
    id: idFor(label), tenant_id: TENANT_ID, actor_id: "actor-1", action: "test.action",
    resource_type: "test_resource", resource_id: null, reserve_id: null,
    created_at: createdAt, metadata: null, ...extra,
  };
}

function labels(events: Array<{ id: string }>): string[] {
  return events.map((e) => labelFor(e.id));
}

describe("queryUnifiedEvents — merge de audit_events + audit_logs", () => {
  it("mescla as 2 fontes por created_at desc, id desc como tie-breaker", async () => {
    const eventsRows = [row("e2", "2026-01-01T00:00:03Z"), row("e1", "2026-01-01T00:00:01Z")];
    const logsRows = [row("l1", "2026-01-01T00:00:02Z")];
    const { supabase } = makeFakeSupabase(eventsRows, logsRows);

    const filters: UnifiedAuditFilters = { tenantId: TENANT_ID, limit: 10 };
    const page = await queryUnifiedEvents(supabase as never, filters);

    assert.deepEqual(labels(page.events), ["e2", "l1", "e1"], "ordem mesclada correta, mais recente primeiro");
    assert.equal(page.events[0].source, "audit_events");
    assert.equal(page.events[1].source, "audit_logs");
    assert.equal(page.hasMore, false);
    assert.equal(page.nextCursor, null);
    assert.deepEqual(page.excludedSources, []);
  });

  it("empate no created_at usa id desc como tie-breaker, de forma estável entre as 2 fontes", async () => {
    const eventsRows = [row("e-b", "2026-01-01T00:00:00Z")];
    const logsRows = [row("e-a", "2026-01-01T00:00:00Z")]; // mesmo timestamp
    const { supabase } = makeFakeSupabase(eventsRows, logsRows);

    const page = await queryUnifiedEvents(supabase as never, { tenantId: TENANT_ID, limit: 10 });
    // id desc: idFor("e-b") foi gerado ANTES de idFor("e-a") neste arquivo
    // (contador crescente) só na 1ª vez que cada label aparece — o teste
    // não depende de qual string alfabética "ganha", só confirma que a
    // ordem bate com a comparação real de id (desc) entre os dois ids
    // efetivamente gerados.
    const expectedFirst = idFor("e-b") > idFor("e-a") ? "e-b" : "e-a";
    const expectedSecond = expectedFirst === "e-b" ? "e-a" : "e-b";
    assert.deepEqual(labels(page.events), [expectedFirst, expectedSecond]);
  });

  it("paginação cursor-based: página 1 e página 2 juntas cobrem todos os itens, sem repetir nem pular", async () => {
    // 7 itens em audit_events, 3 em audit_logs, todos com timestamps distintos.
    const eventsRows = Array.from({ length: 7 }, (_, i) =>
      row(`ev-${i}`, `2026-01-01T00:00:${String(10 - i).padStart(2, "0")}Z`));
    const logsRows = Array.from({ length: 3 }, (_, i) =>
      row(`lg-${i}`, `2026-01-01T00:00:${String(9 - i * 3).padStart(2, "0")}Z`));
    const { supabase } = makeFakeSupabase(eventsRows, logsRows);

    const filters: UnifiedAuditFilters = { tenantId: TENANT_ID, limit: 4 };
    const page1 = await queryUnifiedEvents(supabase as never, filters);
    assert.equal(page1.events.length, 4);
    assert.equal(page1.hasMore, true);
    assert.ok(page1.nextCursor);

    const page2 = await queryUnifiedEvents(supabase as never, { ...filters, cursor: page1.nextCursor! });
    const page3 = await queryUnifiedEvents(supabase as never, { ...filters, cursor: page2.nextCursor ?? page1.nextCursor! });

    const allIds = [...page1.events, ...page2.events, ...(page2.hasMore ? page3.events : [])].map((e) => e.id);
    const uniqueIds = new Set(allIds);
    assert.equal(uniqueIds.size, allIds.length, "nenhum item repetido entre páginas");
    assert.equal(uniqueIds.size, 10, "os 10 itens (7+3) aparecem no total, nenhum pulado");

    // Confirma que a ordem global (concatenando as páginas) é estritamente
    // decrescente por created_at — prova que o merge realmente respeita a
    // ordem cronológica cross-source, não só dentro de cada fonte.
    const allEvents = [...page1.events, ...page2.events, ...(page2.hasMore ? page3.events : [])];
    for (let i = 1; i < allEvents.length; i++) {
      assert.ok(
        allEvents[i - 1].created_at >= allEvents[i].created_at,
        `ordem quebrada entre posição ${i - 1} (${allEvents[i - 1].created_at}) e ${i} (${allEvents[i].created_at})`,
      );
    }
  });

  it("empate de created_at ENTRE as 2 fontes bem na fronteira de corte de página — tie-break por id decide quem fica e quem vai pra próxima página", async () => {
    // 4 itens: ev-high (timestamp maior, sem empate), um par empatado
    // (ev-mid/lg-mid, mesmo created_at, fontes diferentes) e ev-low
    // (timestamp menor). limit=2 corta exatamente no meio do par
    // empatado — só 1 dos 2 cabe na página 1.
    const tsHigh = "2026-01-01T00:00:03Z";
    const tsMid  = "2026-01-01T00:00:02Z"; // aqui mora o empate cross-source
    const tsLow  = "2026-01-01T00:00:01Z";
    const eventsRows = [row("ev-high", tsHigh), row("ev-mid", tsMid), row("ev-low", tsLow)];
    const logsRows = [row("lg-mid", tsMid)]; // empata com ev-mid
    const { supabase } = makeFakeSupabase(eventsRows, logsRows);

    const midWinner = idFor("ev-mid") > idFor("lg-mid") ? "ev-mid" : "lg-mid";
    const midLoser = midWinner === "ev-mid" ? "lg-mid" : "ev-mid";

    const page1 = await queryUnifiedEvents(supabase as never, { tenantId: TENANT_ID, limit: 2 });
    assert.deepEqual(labels(page1.events), ["ev-high", midWinner], "ev-high (sem empate) primeiro; do par empatado, só o de id maior cabe");
    assert.equal(page1.hasMore, true);

    const page2 = await queryUnifiedEvents(supabase as never, { tenantId: TENANT_ID, limit: 2, cursor: page1.nextCursor! });
    assert.deepEqual(labels(page2.events), [midLoser, "ev-low"], "o perdedor do empate some da página 1 e reaparece intacto no topo da página 2, seguido de ev-low");
    assert.equal(page2.hasMore, false);
  });

  it("reserveScope restrito com lista vazia retorna vazio sem consultar o banco", async () => {
    const { supabase, eventsTable, logsTable } = makeFakeSupabase([row("e1", "2026-01-01T00:00:00Z")], []);
    const page = await queryUnifiedEvents(supabase as never, {
      tenantId: TENANT_ID, reserveScope: { mode: "restricted", reserveIds: [] },
    });
    assert.deepEqual(page, { events: [], hasMore: false, nextCursor: null, excludedSources: ["audit_logs"] });
    assert.equal(eventsTable.callCount, 0, "não deveria nem tentar consultar audit_events");
    assert.equal(logsTable.callCount, 0, "não deveria nem tentar consultar audit_logs");
  });

  it("reserveScope restrito (lista não-vazia) exclui audit_logs por completo e filtra audit_events pela lista, sinalizando em excludedSources", async () => {
    const eventsRows = [
      row("e-in", "2026-01-01T00:00:02Z", { reserve_id: "reserve-A" }),
      row("e-out", "2026-01-01T00:00:01Z", { reserve_id: "reserve-B" }),
    ];
    const logsRows = [row("l1", "2026-01-01T00:00:03Z")];
    const { supabase, logsTable } = makeFakeSupabase(eventsRows, logsRows);

    const page = await queryUnifiedEvents(supabase as never, {
      tenantId: TENANT_ID, reserveScope: { mode: "restricted", reserveIds: ["reserve-A"] },
    });
    assert.deepEqual(labels(page.events), ["e-in"], "só o evento da reserva permitida aparece");
    assert.deepEqual(page.excludedSources, ["audit_logs"], "resposta sinaliza que audit_logs foi excluída por design, não por falta de dado");
    assert.equal(logsTable.callCount, 0, "audit_logs não tem reserve_id — não pode ser consultada em modo restrito");
  });

  it("reserveScope omitido (irrestrito) inclui as 2 fontes sem sinalizar exclusão", async () => {
    const { supabase } = makeFakeSupabase([row("e1", "2026-01-01T00:00:01Z")], [row("l1", "2026-01-01T00:00:02Z")]);
    const page = await queryUnifiedEvents(supabase as never, { tenantId: TENANT_ID });
    assert.deepEqual(labels(page.events), ["l1", "e1"]);
    assert.deepEqual(page.excludedSources, []);
  });

  it("filtros (actorId/action/resourceType) são aplicados nas duas fontes", async () => {
    const eventsRows = [
      row("match", "2026-01-01T00:00:02Z", { actor_id: "actor-X", action: "foo.bar", resource_type: "widget" }),
      row("no-match-actor", "2026-01-01T00:00:01Z", { actor_id: "actor-Y", action: "foo.bar", resource_type: "widget" }),
    ];
    const { supabase } = makeFakeSupabase(eventsRows, []);

    const page = await queryUnifiedEvents(supabase as never, {
      tenantId: TENANT_ID, actorId: "actor-X", action: "foo.bar", resourceType: "widget",
    });
    assert.deepEqual(labels(page.events), ["match"]);
  });

  it("cursor com formato inválido (não-UUID/não-ISO) lança em vez de repassar pro filtro .or() do PostgREST sem validar", async () => {
    const { supabase } = makeFakeSupabase([row("e1", "2026-01-01T00:00:01Z")], []);
    await assert.rejects(
      () => queryUnifiedEvents(supabase as never, { tenantId: TENANT_ID, cursor: { createdAt: "2026-01-01T00:00:01Z", id: "not-a-uuid" } }),
      /formato inválido/,
    );
    await assert.rejects(
      () => queryUnifiedEvents(supabase as never, { tenantId: TENANT_ID, cursor: { createdAt: "not-a-timestamp", id: idFor("e1") } }),
      /formato inválido/,
    );
  });
});
