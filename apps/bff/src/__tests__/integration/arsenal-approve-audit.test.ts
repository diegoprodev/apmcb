import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { arsenalRoutes } from "../../routes/arsenal.ts";
import { supabase } from "../../services/supabase.ts";
import { baseLogger } from "../../lib/logger.ts";
import type { HonoVariables } from "../../types/hono.ts";

// Fase 3a da spec de rastreabilidade enterprise (histórico completo por
// item de material). Achado real: PATCH /api/arsenal/requests/:id/approve
// (branch material_addition) criava material_items novos via
// `.insert(physicalItems)` SEM `.select()` — os IDs recém-criados nunca
// eram capturados, e nenhum audit_event era gravado. O "nascimento" de um
// item físico não era auditável nem correlacionável a nada. Este teste
// exercita o HANDLER REAL (arsenalRoutes montado num app Hono real, não
// réplica) e afirma que auditLogForItems agrupa corretamente os itens
// criados por material_type_id e grava a indexação certa.
//
// Roda via `bun test` (imports relativos sem extensão só resolvem via
// bun/bundler — mesmo motivo documentado nos outros arquivos desta pasta).

const ORIGINAL_FROM = supabase.from.bind(supabase);

const TENANT_ID = "dddddddd-0000-0000-0000-000000000001";
const REQUEST_ID = "eeeeeeee-0000-0000-0000-000000000001";
const REVIEWER_ID = "ffffffff-0000-0000-0000-000000000001";
const REQUESTOR_ID = "11111111-1111-0000-0000-000000000001";
const MATERIAL_TYPE_ID = "22222222-0000-0000-0000-000000000001";
const MATERIAL_TYPE_ID_2 = "22222222-0000-0000-0000-000000000002";
const ITEM_ID_1 = "33333333-0000-0000-0000-000000000001";
const ITEM_ID_2 = "33333333-0000-0000-0000-000000000002";
const ITEM_ID_3 = "33333333-0000-0000-0000-000000000003";

let auditEventInserts: Array<Record<string, unknown>> = [];
let indexInserts: Array<Record<string, unknown>> = [];
let approvalRequestUpdates: Array<Record<string, unknown>> = [];
let eventIdCounter = 0;

function makeMaterialItem(nome: string, categoriaSlug: string, categoryId: string, seriais: string[]) {
  return {
    nome, categoria: nome, categoria_slug: categoriaSlug,
    category_id: categoryId, // presente de propósito — pula ensureMaterialCategory (sem DB extra)
    quantidade_total: seriais.length, descricao: null, calibre: null,
    has_serial_numbers: true, requires_validity: false, requires_vehicle_fields: false,
    validity_alert_days: null, vehicle_plate: null, vehicle_color: null, vehicle_year: null, vehicle_model: null,
    photo_url: null, photo_storage_path: null, cautela_habilitada: false, quantidade_cautela: 0,
    items: seriais.map((numero_serie) => ({ numero_serie })),
  };
}

// 2 material_types distintos no MESMO lote — cobertura real de que o
// agrupamento por material_type_id gera 2 audit_events SEPARADOS (não 1
// evento colapsando os dois, nem 1 por item). Achado de code review: o
// fixture anterior só tinha 1 material_type, então nunca provava que a
// lógica de agrupamento de fato diferencia grupos.
const REQUEST_PAYLOAD = {
  tenant_id: TENANT_ID,
  reserve_id: null,
  items: [
    makeMaterialItem("Colete Balístico Teste", "colete", "cat-1", ["SN-001", "SN-002"]),
    makeMaterialItem("Rádio Comunicador Teste", "radio", "cat-2", ["SN-100"]),
  ],
};

before(() => {
  // @ts-expect-error monkey-patch intencional do singleton pra teste de integração
  supabase.from = (table: string) => {
    if (table === "admin_approval_requests") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  id: REQUEST_ID, requestor_id: REQUESTOR_ID, material_type_id: null,
                  type: "material_addition", payload: REQUEST_PAYLOAD, status: "pendente",
                },
                error: null,
              }),
            }),
          }),
        }),
        update: (payload: Record<string, unknown>) => ({
          eq: () => ({
            eq: () => ({
              select: () => ({
                maybeSingle: async () => {
                  approvalRequestUpdates.push(payload);
                  return { data: { id: REQUEST_ID }, error: null };
                },
              }),
            }),
          }),
        }),
      };
    }
    if (table === "reserve_memberships") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({ limit: async () => ({ data: [{ reserve_id: "any" }], error: null }) }),
          }),
        }),
      };
    }
    if (table === "material_types") {
      return {
        insert: () => ({
          // Ordem tem que casar com REQUEST_PAYLOAD.items (colete, depois rádio)
          // — o código faz flatMap(insertedMaterials, index => ... payload.items[index]).
          select: async () => ({ data: [{ id: MATERIAL_TYPE_ID }, { id: MATERIAL_TYPE_ID_2 }], error: null }),
        }),
      };
    }
    if (table === "material_items") {
      return {
        insert: () => ({
          select: async () => ({
            data: [
              { id: ITEM_ID_1, material_type_id: MATERIAL_TYPE_ID },
              { id: ITEM_ID_2, material_type_id: MATERIAL_TYPE_ID },
              { id: ITEM_ID_3, material_type_id: MATERIAL_TYPE_ID_2 },
            ],
            error: null,
          }),
        }),
      };
    }
    if (table === "notifications") {
      return { insert: async () => ({ error: null }) };
    }
    if (table === "service_shifts") {
      // Sem turno ativo pro requestor — logShiftEvent retorna cedo, sem
      // precisar mockar o RPC log_shift_event_atomic.
      return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) };
    }
    if (table === "audit_events") {
      return {
        select: () => ({
          order: () => ({
            limit: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
              is: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
            }),
          }),
        }),
        insert: (row: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              auditEventInserts.push(row);
              eventIdCounter += 1;
              return { data: { id: `event-${eventIdCounter}`, created_at: row.created_at }, error: null };
            },
          }),
        }),
      };
    }
    if (table === "material_item_event_index") {
      return {
        insert: async (rows: Array<Record<string, unknown>>) => {
          indexInserts.push(...rows);
          return { error: null };
        },
      };
    }
    throw new Error(`tabela não mockada neste teste: ${table}`);
  };
});

after(() => {
  supabase.from = ORIGINAL_FROM;
});

const app = new Hono<{ Variables: HonoVariables }>();
app.use("/api/arsenal/*", async (c, next) => {
  c.set("userId", REVIEWER_ID);
  c.set("role", "admin_global");
  c.set("tenantId", TENANT_ID);
  c.set("reserveId", null);
  c.set("log", baseLogger);
  await next();
});
app.route("/api/arsenal", arsenalRoutes);

describe("PATCH /api/arsenal/requests/:id/approve (material_addition) — auditoria da criação de item físico", () => {
  it("2 material_types no mesmo lote → 2 audit_events separados, cada um só com os itens do seu grupo", async () => {
    auditEventInserts = [];
    indexInserts = [];
    approvalRequestUpdates = [];
    eventIdCounter = 0;

    const res = await app.request(`/api/arsenal/requests/${REQUEST_ID}/approve`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = await res.json() as { ok?: boolean; error?: string };
    assert.equal(res.status, 200, `esperava 200, recebeu ${res.status}: ${JSON.stringify(body)}`);
    assert.equal(body.ok, true);

    // Reivindicação otimista da solicitação aconteceu (status: aprovado).
    assert.equal(approvalRequestUpdates.length, 1);
    assert.equal(approvalRequestUpdates[0].status, "aprovado");

    // Exatamente 2 audit_events — 1 por material_type criado, nunca 1 por
    // item (achado central da Fase 2: custo O(1) por grupo na hash-chain,
    // não O(n) por item) e nunca 1 único evento colapsando os 2 grupos.
    const creationEvents = auditEventInserts.filter((e) => e.action === "material_item.created");
    assert.equal(creationEvents.length, 2, "deveria gravar 1 evento por material_type criado (2 tipos → 2 eventos)");

    const eventByMaterialType = new Map(creationEvents.map((e) => [e.resource_id as string, e]));
    const coleteEvent = eventByMaterialType.get(MATERIAL_TYPE_ID);
    const radioEvent = eventByMaterialType.get(MATERIAL_TYPE_ID_2);
    assert.ok(coleteEvent, "evento do material_type 1 (colete) não encontrado");
    assert.ok(radioEvent, "evento do material_type 2 (rádio) não encontrado");
    assert.equal(coleteEvent!.resource_type, "material_type");
    assert.deepEqual((coleteEvent!.metadata as Record<string, unknown>).item_ids, [ITEM_ID_1, ITEM_ID_2], "grupo do colete só deve conter os 2 itens do colete, nunca o item do rádio");
    assert.deepEqual((radioEvent!.metadata as Record<string, unknown>).item_ids, [ITEM_ID_3], "grupo do rádio só deve conter o item do rádio, nunca os itens do colete");

    // Os 3 itens físicos criados aparecem indexados, cada um apontando pro
    // audit_event do SEU material_type (não misturados entre grupos).
    assert.equal(indexInserts.length, 3);
    const indexByItem = new Map(indexInserts.map((r) => [r.material_item_id as string, r]));
    assert.equal(indexByItem.get(ITEM_ID_1)?.audit_event_id, "event-1");
    assert.equal(indexByItem.get(ITEM_ID_2)?.audit_event_id, "event-1");
    assert.equal(indexByItem.get(ITEM_ID_3)?.audit_event_id, "event-2");
    for (const row of indexInserts) {
      assert.equal(row.action, "material_item.created");
      assert.equal(row.tenant_id, TENANT_ID);
    }
  });
});
