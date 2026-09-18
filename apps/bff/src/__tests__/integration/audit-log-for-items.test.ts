import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { auditLogForItems } from "../../middleware/audit.ts";
import { supabase } from "../../services/supabase.ts";
import type { HonoVariables } from "../../types/hono.ts";

// Fase 2 da spec de rastreabilidade enterprise (histórico completo por item
// de material). `auditLogForItems` grava 1 evento em audit_events (custo
// sequencial O(1) na hash-chain) + N linhas em material_item_event_index
// (insert multi-row, sem dependência entre linhas) — em vez de N audit_events
// sequenciais, que serializariam uma operação em lote inteira na mesma
// cadeia de hash. Este teste exercita a função real contra um app Hono real
// (não réplica), monkey-patch de `supabase` (mesmo padrão de
// email-change-confirm-real-handler.test.ts).
//
// Roda via `bun test` (imports relativos sem extensão só resolvem via
// bun/bundler — mesmo motivo documentado nos outros arquivos desta pasta).

const ORIGINAL_FROM = supabase.from.bind(supabase);

let auditEventInserts: Array<Record<string, unknown>> = [];
let indexInserts: Array<Record<string, unknown>> = [];
let nextEventId = "";
let failIndexInsert = false;

before(() => {
  // @ts-expect-error monkey-patch intencional do singleton pra teste de integração
  supabase.from = (table: string) => {
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
              return { data: { id: nextEventId, created_at: row.created_at }, error: null };
            },
          }),
        }),
      };
    }
    if (table === "material_item_event_index") {
      return {
        insert: async (rows: Array<Record<string, unknown>>) => {
          if (failIndexInsert) return { error: { message: "insert falhou (simulado)" } };
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
app.use("/test/*", async (c, next) => {
  const userId    = c.req.header("x-test-user-id") ?? "";
  const role      = c.req.header("x-test-role") ?? "";
  const tenantId  = c.req.header("x-test-tenant-id") ?? null;
  const reserveId = c.req.header("x-test-reserve-id") ?? null;
  // Cast intencional — este teste simula ausência de sessão via string
  // vazia (falsy, aciona a mesma guarda `!actorId || !actorRole` de
  // produção); HonoVariables tipa userId/role como sempre presentes
  // porque nunca é assim fora de teste.
  c.set("userId", userId as string);
  c.set("role", role as HonoVariables["role"]);
  c.set("tenantId", tenantId);
  c.set("reserveId", reserveId);
  await next();
});
app.post("/test/audit-items", async (c) => {
  const body = await c.req.json() as { itemIds: string[]; reserveId?: string | null };
  await auditLogForItems(
    c,
    { action: "test.batch_action", resource_type: "material_type", resource_id: "type-1", reserve_id: body.reserveId ?? null },
    body.itemIds,
  );
  return c.json({ ok: true });
});

const TENANT_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const RESERVE_ID = "bbbbbbbb-0000-0000-0000-000000000001";
const OTHER_RESERVE_ID = "bbbbbbbb-0000-0000-0000-000000000002";
const USER_ID = "cccccccc-0000-0000-0000-000000000001";

function call(itemIds: string[], opts: { headers?: Record<string, string>; reserveId?: string | null } = {}) {
  return app.request("/test/audit-items", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-test-user-id": USER_ID,
      "x-test-role": "admin_reserva",
      "x-test-tenant-id": TENANT_ID,
      // x-test-reserve-id só popula c.get("reserveId") (sessão do ATOR) —
      // NUNCA deve ser usado como fallback de reserve_id do recurso (achado
      // ALTO do code review). Header presente de propósito em toda chamada
      // pra provar que a função ignora esse valor quando o payload não
      // passa reserve_id explícito.
      "x-test-reserve-id": OTHER_RESERVE_ID,
      ...opts.headers,
    },
    body: JSON.stringify({ itemIds, reserveId: opts.reserveId }),
  });
}

describe("auditLogForItems — grava 1 audit_event + N linhas em material_item_event_index", () => {
  it("3 itens → 1 insert em audit_events + 1 insert multi-row com 3 linhas corretas", async () => {
    auditEventInserts = [];
    indexInserts = [];
    failIndexInsert = false;
    nextEventId = "event-1";

    const itemIds = ["item-1", "item-2", "item-3"];
    const res = await call(itemIds, { reserveId: RESERVE_ID });
    assert.equal(res.status, 200);

    assert.equal(auditEventInserts.length, 1, "deveria gravar exatamente 1 evento, não 1 por item");
    assert.equal(auditEventInserts[0].action, "test.batch_action");
    assert.equal(auditEventInserts[0].reserve_id, RESERVE_ID);
    assert.deepEqual((auditEventInserts[0].metadata as Record<string, unknown>).item_ids, itemIds);

    assert.equal(indexInserts.length, 3, "deveria indexar os 3 itens afetados");
    for (const [i, itemId] of itemIds.entries()) {
      const row = indexInserts[i];
      assert.equal(row.material_item_id, itemId);
      assert.equal(row.audit_event_id, "event-1");
      assert.equal(row.tenant_id, TENANT_ID);
      assert.equal(row.reserve_id, RESERVE_ID);
      assert.equal(row.action, "test.batch_action");
      assert.equal(row.actor_id, USER_ID);
      assert.ok(row.event_created_at, "event_created_at precisa vir preenchido");
    }
  });

  it("lista vazia de itens → grava o evento mas não tenta indexar nada", async () => {
    auditEventInserts = [];
    indexInserts = [];
    nextEventId = "event-2";

    const res = await call([]);
    assert.equal(res.status, 200);
    assert.equal(auditEventInserts.length, 1);
    assert.equal(indexInserts.length, 0);
  });

  it("sem tenantId no contexto → evento gravado, indexação pulada sem lançar (NOT NULL não pode ser violado)", async () => {
    auditEventInserts = [];
    indexInserts = [];
    nextEventId = "event-3";

    const res = await call(["item-x"], { headers: { "x-test-tenant-id": "" } });
    assert.equal(res.status, 200);
    assert.equal(auditEventInserts.length, 1, "audit_event canônico continua sendo gravado mesmo sem tenant");
    assert.equal(indexInserts.length, 0, "sem tenant_id não pode inserir em material_item_event_index (NOT NULL)");
  });

  it("sem actorId/actorRole → no-op total (mesma guarda de auditLog/auditLogDirect)", async () => {
    auditEventInserts = [];
    indexInserts = [];

    const res = await call(["item-y"], { headers: { "x-test-user-id": "" } });
    assert.equal(res.status, 200);
    assert.equal(auditEventInserts.length, 0);
    assert.equal(indexInserts.length, 0);
  });

  it("insert de índice falha → não lança, evento canônico já persistido permanece a fonte recuperável", async () => {
    auditEventInserts = [];
    indexInserts = [];
    failIndexInsert = true;
    nextEventId = "event-4";

    const res = await call(["item-z"], { reserveId: RESERVE_ID });
    assert.equal(res.status, 200, "falha na indexação derivada não pode derrubar a request");
    assert.equal(auditEventInserts.length, 1);
    assert.equal(indexInserts.length, 0);
  });

  it("sem reserve_id explícito no payload → NULL, mesmo com c.get('reserveId') presente na sessão do ator (achado ALTO)", async () => {
    auditEventInserts = [];
    indexInserts = [];
    failIndexInsert = false;
    nextEventId = "event-5";

    // opts.reserveId omitido de propósito — a sessão do ator TEM
    // x-test-reserve-id=OTHER_RESERVE_ID (setado por padrão em `call()`),
    // mas isso nunca deve ser usado como palpite pra reserve_id do recurso.
    const res = await call(["item-w"]);
    assert.equal(res.status, 200);
    assert.equal(auditEventInserts[0].reserve_id, null, "reserve_id do recurso não informado deve ficar NULL, nunca herdar a sessão do ator");
    assert.equal(indexInserts[0].reserve_id, null);
  });

  it("item_id duplicado no payload → dedup antes do insert multi-row, não derruba os outros itens", async () => {
    auditEventInserts = [];
    indexInserts = [];
    failIndexInsert = false;
    nextEventId = "event-6";

    const res = await call(["item-a", "item-b", "item-a"], { reserveId: RESERVE_ID });
    assert.equal(res.status, 200);
    assert.equal(auditEventInserts.length, 1);
    assert.deepEqual((auditEventInserts[0].metadata as Record<string, unknown>).item_ids, ["item-a", "item-b"], "metadata.item_ids também deduplicado");
    assert.equal(indexInserts.length, 2, "duplicata não deveria gerar 2 linhas nem derrubar o insert inteiro");
    assert.deepEqual(indexInserts.map((r) => r.material_item_id), ["item-a", "item-b"]);
  });
});
