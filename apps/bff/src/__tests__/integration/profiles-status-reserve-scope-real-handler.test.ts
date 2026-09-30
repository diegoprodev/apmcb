import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { getIronSession } from "iron-session";
import { authMiddleware } from "../../middleware/auth.ts";
import { requestIdMiddleware } from "../../middleware/request-id.ts";
import { profileRoutes } from "../../routes/profiles.ts";
import { totpRoutes } from "../../routes/totp.ts";
import { sessionOptions, type SessionData } from "../../lib/session.ts";
import { baseLogger } from "../../lib/logger.ts";
import { supabase } from "../../services/supabase.ts";
import type { HonoVariables } from "../../types/hono.ts";

// Achado da revisão da spec da Ficha Operacional (2026-09-30), brecha viva:
// PATCH /api/profiles/:id/status (e o campo registration_status de
// PATCH /api/profiles/:id) conferiam só o tenant. Um armeiro da reserva B
// mandava {status:"reactivate"} para um militar da reserva A e derrubava o
// impedimento dele — o militar voltava a armar em A. E o armeiro, que não
// pode APLICAR impedimento, podia RETIRAR. Também: POST /api/totp/admin-provision
// criava código dinâmico para qualquer user_id, de qualquer tenant.
// Handler real (padrão *-real-handler.test.ts), roda via bun. Ids prefixo "93".

const ORIGINAL_FROM = supabase.from.bind(supabase);
const ORIGINAL_CHILD = baseLogger.child.bind(baseLogger);
const TENANT_ID = "93333333-0000-0000-0000-000000000001";
const RESERVE_B = "93333333-0000-0000-0000-00000000000b";
// Um id por papel: checkSessionValid faz cache por userId (mesmo cuidado dos
// outros *-real-handler.test.ts).
const ACTOR_IDS = {
  armeiro: "93333333-1111-1111-1111-111111111111",
  admin_reserva: "93333333-1111-1111-1111-111111111112",
  admin_global: "93333333-1111-1111-1111-111111111113",
} as const;
const TARGET_ID = "93333333-2222-2222-2222-222222222222";

let actorRole: "armeiro" | "admin_reserva" | "admin_global" = "armeiro";
let target: { registration_status: string; nome_completo: string; role: string } | null = null;
let targetInActorReserve = true;
let membershipQueryFails = false;
let targetQueryFails = false;
let raceLost = false;
let membershipWrites: string[] = [];
let errorsLogged: Array<{ obj: Record<string, unknown>; msg: string }> = [];
let targetInTenant = true;
let updates: Array<{ table: string; row: Record<string, unknown> }> = [];
let inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
let warns: Array<{ obj: Record<string, unknown>; msg: string }> = [];
// Filtros efetivamente aplicados (.eq/.in/...) por tabela e operação — o
// teste prova que a trava de reserva e o lock otimista ESTÃO na consulta,
// não só que o handler mapeia o resultado.
let filters: Array<{ table: string; op: string; method: string; args: unknown[] }> = [];

function builder(
  data: unknown,
  extra: Record<string, unknown> = {},
  rec?: { table: string; op: string },
  listData?: unknown,
): unknown {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === "then") return (resolve: (v: unknown) => void) => resolve({ data: listData ?? data, error: null, ...extra });
      if (prop === "single" || prop === "maybeSingle") return async () => ({ data, error: null, ...extra });
      return (...args: unknown[]) => {
        if (rec) filters.push({ ...rec, method: String(prop), args });
        return new Proxy({}, handler);
      };
    },
  };
  return new Proxy({}, handler);
}
const hasFilter = (table: string, op: string, column: string, value: unknown) =>
  filters.some((x) => x.table === table && x.op === op && x.method === "eq" && x.args[0] === column && x.args[1] === value);

// Alguns testes sobrescrevem supabase.from direto (cenários que precisam de
// filtros mais finos que o builder genérico dá conta) — nomeado e reatribuído
// em beforeEach() pra não vazar entre testes (achado 2026-09-30: um teste
// que não restaurava fazia o SEGUINTE herdar o mock errado em silêncio).
function defaultFromMock(table: string) {
    if (table === "revoked_sessions") return builder(null);
    if (table === "profiles") {
      return {
        select: (cols: string) => {
          // authMiddleware lê o papel do ATOR; a rota lê o ALVO.
          if (cols.includes("sessions_invalidated_at")) return builder({ role: actorRole, sessions_invalidated_at: null });
          if (targetQueryFails) return builder(null, { error: { message: "connection reset" } });
          return builder(targetInTenant ? target : null, {}, { table, op: "select" });
        },
        update: (row: Record<string, unknown>) => {
          // raceLost: a situação mudou entre a leitura e o UPDATE condicional.
          if (raceLost) return builder(null, {}, { table, op: "update" });
          updates.push({ table, row });
          return builder({ id: TARGET_ID }, {}, { table, op: "update" });
        },
      };
    }
    if (table === "reserve_memberships") {
      return {
        select: () => (membershipQueryFails
          ? builder(null, { error: { message: "connection reset" } })
          : builder(targetInActorReserve ? { reserve_id: RESERVE_B } : null, {}, { table, op: "select" }, [])),
        delete: () => { membershipWrites.push("delete"); return builder(null); },
        update: () => { membershipWrites.push("update"); return builder(null); },
        upsert: () => { membershipWrites.push("upsert"); return builder(null); },
        insert: () => { membershipWrites.push("insert"); return builder(null); },
      };
    }
    if (table === "reserves") return builder(null, {}, undefined, [{ id: RESERVE_B }]);
    if (table === "biometric_templates") return builder(null, { count: 1 });
    if (table === "totp_secrets") {
      return {
        select: () => builder(null),
        insert: (row: Record<string, unknown>) => { inserts.push({ table, row }); return builder(null); },
      };
    }
    return {
      select: () => builder(null),
      insert: (row: Record<string, unknown>) => { inserts.push({ table, row }); return builder(null); },
      update: (row: Record<string, unknown>) => { updates.push({ table, row }); return builder(null); },
    };
}

before(() => {
  // @ts-expect-error monkey-patch intencional do singleton pra teste de integração
  supabase.from = defaultFromMock;
  baseLogger.child = ((bindings: Record<string, unknown>) => {
    const child = ORIGINAL_CHILD(bindings);
    child.warn = ((obj: Record<string, unknown>, msg: string) => { warns.push({ obj, msg }); }) as typeof child.warn;
    child.error = ((obj: Record<string, unknown>, msg: string) => { errorsLogged.push({ obj, msg }); }) as typeof child.error;
    return child;
  }) as unknown as typeof baseLogger.child;
});

after(() => {
  supabase.from = ORIGINAL_FROM;
  baseLogger.child = ORIGINAL_CHILD;
});

beforeEach(() => {
  // @ts-expect-error monkey-patch intencional do singleton pra teste de integração
  supabase.from = defaultFromMock;
  actorRole = "armeiro";
  target = { registration_status: "inactive", nome_completo: "Militar Alvo", role: "usuario" };
  targetInActorReserve = true;
  membershipQueryFails = false;
  targetQueryFails = false;
  raceLost = false;
  membershipWrites = [];
  errorsLogged = [];
  targetInTenant = true;
  updates = [];
  inserts = [];
  warns = [];
  filters = [];
});

const app = new Hono<{ Variables: HonoVariables }>();
app.use("*", requestIdMiddleware);
app.use("/api/*", authMiddleware);
app.route("/api/profiles", profileRoutes);
app.route("/api/totp", totpRoutes);

async function request(method: string, path: string, body: unknown, reserveId: string | null = RESERVE_B) {
  filters = [];
  const req = new Request("http://localhost/seal");
  const res = new Response(null);
  const session = await getIronSession<SessionData>(req, res, sessionOptions);
  Object.assign(session, {
    userId: ACTOR_IDS[actorRole], role: actorRole, tenantId: TENANT_ID, reserveId,
    supabaseAccessToken: "fake", sessionId: `sess-${actorRole}-${reserveId ?? "matriz"}`, issuedAt: Date.now(),
  } satisfies Partial<SessionData>);
  await session.save();
  const cookie = res.headers.getSetCookie().find((v) => v.startsWith(`${sessionOptions.cookieName}=`))!.split(";")[0];
  return app.request(path, { method, headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
}

const profileUpdates = () => updates.filter((u) => u.table === "profiles" && "registration_status" in u.row);

describe("PATCH /api/profiles/:id/status — confinado à reserva do ator", () => {
  it("armeiro da reserva B NÃO reativa militar de outra reserva → 404 genérico, nada gravado, log com motivo", async () => {
    targetInActorReserve = false;
    const res = await request("PATCH", `/api/profiles/${TARGET_ID}/status`, { status: "reactivate" });
    assert.equal(res.status, 404);
    assert.equal(profileUpdates().length, 0, "a situação de militar de outra reserva foi alterada");
    const w = warns.find((x) => x.msg === "profile.status.rejected");
    assert.ok(w, "recusa sem rastro no log");
    assert.equal(w.obj.reason, "target_outside_reserve");
  });

  it("armeiro reativa militar da própria reserva → 200", async () => {
    const res = await request("PATCH", `/api/profiles/${TARGET_ID}/status`, { status: "reactivate" });
    assert.equal(res.status, 200);
    assert.equal(profileUpdates().length, 1);
  });

  it("armeiro NÃO retira impedimento, nem na própria reserva (quem não aplica não retira) → 403", async () => {
    target = { registration_status: "impedimento_administrativo", nome_completo: "Militar Alvo", role: "usuario" };
    const res = await request("PATCH", `/api/profiles/${TARGET_ID}/status`, { status: "reactivate" });
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: "Apenas administradores podem remover impedimento administrativo." });
    assert.equal(profileUpdates().length, 0);
  });

  it("admin_reserva também não retira impedimento → 403", async () => {
    actorRole = "admin_reserva";
    target = { registration_status: "impedimento_administrativo", nome_completo: "Militar Alvo", role: "usuario" };
    const res = await request("PATCH", `/api/profiles/${TARGET_ID}/status`, { status: "reactivate" });
    assert.equal(res.status, 403);
    assert.equal(profileUpdates().length, 0);
  });

  it("admin_global em modo matriz retira impedimento de militar de qualquer reserva do tenant → 200", async () => {
    actorRole = "admin_global";
    targetInActorReserve = false;
    target = { registration_status: "impedimento_administrativo", nome_completo: "Militar Alvo", role: "usuario" };
    const res = await request("PATCH", `/api/profiles/${TARGET_ID}/status`, { status: "reactivate" }, null);
    assert.equal(res.status, 200);
    assert.equal(profileUpdates().length, 1);
  });

  it("admin_global em modo filial (reserva ativa) fica confinado à própria reserva → 404", async () => {
    actorRole = "admin_global";
    targetInActorReserve = false;
    const res = await request("PATCH", `/api/profiles/${TARGET_ID}/status`, { status: "reactivate" });
    assert.equal(res.status, 404);
    assert.equal(profileUpdates().length, 0);
  });
});

describe("PATCH /api/profiles/:id — mudança de registration_status confinada à reserva do ator", () => {
  it("armeiro da reserva B NÃO muda a situação de militar de outra reserva → 404, nada gravado", async () => {
    targetInActorReserve = false;
    const res = await request("PATCH", `/api/profiles/${TARGET_ID}`, { registration_status: "reactivate" });
    assert.equal(res.status, 404);
    assert.equal(profileUpdates().length, 0);
    assert.ok(warns.some((x) => x.msg === "profile.update.rejected" && x.obj.reason === "target_outside_reserve"));
  });

  it("armeiro NÃO retira impedimento pela edição de perfil → 403", async () => {
    target = { registration_status: "impedimento_administrativo", nome_completo: "Militar Alvo", role: "usuario" };
    const res = await request("PATCH", `/api/profiles/${TARGET_ID}`, { registration_status: "reactivate" });
    assert.equal(res.status, 403);
    assert.equal(profileUpdates().length, 0);
  });
});

describe("POST /api/totp/admin-provision — alvo confinado ao tenant e à reserva do ator", () => {
  it("user_id de outro tenant → 404, nenhum segredo criado, log com motivo", async () => {
    targetInTenant = false;
    const res = await request("POST", "/api/totp/admin-provision", { user_id: TARGET_ID });
    assert.equal(res.status, 404);
    assert.equal(inserts.filter((i) => i.table === "totp_secrets").length, 0, "segredo criado para usuário de outro tenant");
    assert.equal(updates.length, 0);
    const w = warns.find((x) => x.msg === "totp.admin_provision.rejected");
    assert.ok(w);
    assert.equal(w.obj.reason, "target_not_found");
  });

  it("militar de outra reserva do mesmo tenant → 404, nenhum segredo criado", async () => {
    targetInActorReserve = false;
    const res = await request("POST", "/api/totp/admin-provision", { user_id: TARGET_ID });
    assert.equal(res.status, 404);
    assert.equal(inserts.filter((i) => i.table === "totp_secrets").length, 0);
    assert.ok(warns.some((x) => x.msg === "totp.admin_provision.rejected" && x.obj.reason === "target_outside_reserve"));
  });

  it("militar da própria reserva (fluxo do cadastro) → 201 com segredo criado", async () => {
    const res = await request("POST", "/api/totp/admin-provision", { user_id: TARGET_ID });
    assert.equal(res.status, 201);
    assert.equal(inserts.filter((i) => i.table === "totp_secrets").length, 1);
  });
});

// Revisão (2026-09-30): PATCH /:id só confinava a MUDANÇA DE SITUAÇÃO — o
// resto da edição de alguém de outra reserva seguia livre (nome, posto e,
// pior, papel: admin_reserva de B rebaixava armeiro de A ou virava um
// usuario de A em auditor de matriz).
describe("PATCH /api/profiles/:id — qualquer edição confinada à reserva do ator", () => {
  it("nome de militar de outra reserva → 404, nada gravado", async () => {
    targetInActorReserve = false;
    const res = await request("PATCH", `/api/profiles/${TARGET_ID}`, { nome_completo: "Outro Nome" });
    assert.equal(res.status, 404);
    assert.equal(updates.filter((u) => u.table === "profiles").length, 0);
    assert.ok(warns.some((x) => x.msg === "profile.update.rejected" && x.obj.reason === "target_outside_reserve"));
  });

  it("admin_reserva rebaixando armeiro de outra reserva → 404, nenhum vínculo tocado", async () => {
    actorRole = "admin_reserva";
    targetInActorReserve = false;
    target = { registration_status: "complete", nome_completo: "Armeiro de A", role: "armeiro" };
    const res = await request("PATCH", `/api/profiles/${TARGET_ID}`, { role: "usuario" });
    assert.equal(res.status, 404);
    assert.equal(updates.filter((u) => u.table === "profiles").length, 0);
    assert.deepEqual(membershipWrites, []);
  });

  it("edição legítima na própria reserva reenviando a mesma situação (padrão do _edit-dialog) → 200", async () => {
    target = { registration_status: "complete", nome_completo: "Militar Alvo", role: "usuario" };
    const res = await request("PATCH", `/api/profiles/${TARGET_ID}`, { nome_completo: "Nome Corrigido", registration_status: "complete" });
    assert.equal(res.status, 200);
    assert.equal(updates.filter((u) => u.table === "profiles").length, 1);
  });

  it("admin_global em matriz retira impedimento pela edição de perfil → 200", async () => {
    actorRole = "admin_global";
    targetInActorReserve = false;
    target = { registration_status: "impedimento_administrativo", nome_completo: "Militar Alvo", role: "usuario" };
    const res = await request("PATCH", `/api/profiles/${TARGET_ID}`, { registration_status: "reactivate" }, null);
    assert.equal(res.status, 200);
  });
});

describe("robustez e rastro das recusas", () => {
  it("falha do banco ao conferir a reserva → 503 amigável + log de erro, sem fingir que não encontrou", async () => {
    membershipQueryFails = true;
    const res = await request("PATCH", `/api/profiles/${TARGET_ID}/status`, { status: "inactive" });
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: "Não foi possível concluir agora. Tente novamente." });
    assert.ok(errorsLogged.some((e) => e.msg === "reserve_scope.target_query_failure" && e.obj.targetId === TARGET_ID));
    assert.equal(profileUpdates().length, 0);
  });

  it("situação mudou entre a leitura e a gravação (corrida com o admin aplicando impedimento) → 409", async () => {
    raceLost = true;
    const res = await request("PATCH", `/api/profiles/${TARGET_ID}/status`, { status: "inactive" });
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: "A situação desta pessoa acabou de mudar. Atualize a página e tente de novo." });
    assert.ok(warns.some((x) => x.msg === "profile.status.rejected" && x.obj.reason === "changed_concurrently"));
  });

  it("armeiro tentando aplicar impedimento → 403 com rastro impedimento_apply_forbidden", async () => {
    const res = await request("PATCH", `/api/profiles/${TARGET_ID}/status`, { status: "impedimento_administrativo" });
    assert.equal(res.status, 403);
    assert.ok(warns.some((x) => x.msg === "profile.status.rejected" && x.obj.reason === "impedimento_apply_forbidden"));
  });

  it("armeiro mudando situação de administrador → 403 com rastro role_ceiling", async () => {
    target = { registration_status: "complete", nome_completo: "Admin", role: "admin_reserva" };
    const res = await request("PATCH", `/api/profiles/${TARGET_ID}/status`, { status: "inactive" });
    assert.equal(res.status, 403);
    assert.ok(warns.some((x) => x.msg === "profile.status.rejected" && x.obj.reason === "role_ceiling"));
  });

  // Teto de convite (armeiro só cadastra usuario): antes uma lista fixa de
  // papéis proibidos deixava um armeiro desativar outro armeiro.
  it("armeiro desativando outro armeiro da mesma reserva → 403 role_ceiling", async () => {
    target = { registration_status: "complete", nome_completo: "Outro Armeiro", role: "armeiro" };
    const res = await request("PATCH", `/api/profiles/${TARGET_ID}/status`, { status: "inactive" });
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: "Sem permissão para alterar a situação desta pessoa." });
    assert.equal(profileUpdates().length, 0);
  });

  it("admin_reserva desativa armeiro da própria reserva (dentro do teto) → 200", async () => {
    actorRole = "admin_reserva";
    target = { registration_status: "complete", nome_completo: "Armeiro", role: "armeiro" };
    const res = await request("PATCH", `/api/profiles/${TARGET_ID}/status`, { status: "inactive" });
    assert.equal(res.status, 200);
  });

  it("armeiro provisionando código de um admin_reserva (acima do teto) → 403, nenhum segredo criado", async () => {
    target = { registration_status: "complete", nome_completo: "Admin", role: "admin_reserva" };
    const res = await request("POST", "/api/totp/admin-provision", { user_id: TARGET_ID });
    assert.equal(res.status, 403);
    assert.equal(inserts.filter((i) => i.table === "totp_secrets").length, 0);
    assert.ok(warns.some((x) => x.msg === "totp.admin_provision.rejected" && x.obj.reason === "role_ceiling"));
  });

  it("admin_global em matriz provisiona código de militar de qualquer reserva do tenant → 201", async () => {
    actorRole = "admin_global";
    targetInActorReserve = false;
    const res = await request("POST", "/api/totp/admin-provision", { user_id: TARGET_ID }, null);
    assert.equal(res.status, 201);
  });
});

// Revisão (2026-09-30, 2ª rodada): o teto de papel só rodava quando o papel
// MUDAVA — um admin_reserva mexia nas reservas de um par (tirava o acesso
// dele em A e dava admin em C) e editava campos de quem está acima dele.
describe("PATCH /api/profiles/:id — teto de papel em QUALQUER edição de outra pessoa", () => {
  it("admin_reserva mexendo nas reservas de um par admin_reserva → 403 role_ceiling, nenhum vínculo tocado", async () => {
    actorRole = "admin_reserva";
    target = { registration_status: "complete", nome_completo: "Par", role: "admin_reserva" };
    const res = await request("PATCH", `/api/profiles/${TARGET_ID}`, { reserve_ids: [RESERVE_B] });
    assert.equal(res.status, 403);
    assert.deepEqual(membershipWrites, []);
    assert.equal(updates.filter((u) => u.table === "profiles").length, 0);
    assert.ok(warns.some((x) => x.msg === "profile.update.rejected" && x.obj.reason === "role_ceiling"));
  });

  it("armeiro editando o telefone de um admin_reserva → 403", async () => {
    target = { registration_status: "complete", nome_completo: "Admin", role: "admin_reserva" };
    const res = await request("PATCH", `/api/profiles/${TARGET_ID}`, { telefone: "83999990000" });
    assert.equal(res.status, 403);
    assert.equal(updates.filter((u) => u.table === "profiles").length, 0);
  });

  it("armeiro editando o próprio nome → 200, sem conferir reserva (é ele mesmo)", async () => {
    target = { registration_status: "complete", nome_completo: "Eu", role: "armeiro" };
    const res = await request("PATCH", `/api/profiles/${ACTOR_IDS.armeiro}`, { nome_completo: "Eu Corrigido" });
    assert.equal(res.status, 200);
    assert.ok(!filters.some((x) => x.table === "reserve_memberships"), "edição do próprio perfil não deve depender de vínculo com reserva");
  });

  it("admin_global em matriz promove usuário a armeiro de uma reserva → 200 e grava o vínculo", async () => {
    actorRole = "admin_global";
    targetInActorReserve = false;
    target = { registration_status: "complete", nome_completo: "Promovido", role: "usuario" };
    const res = await request("PATCH", `/api/profiles/${TARGET_ID}`, { role: "armeiro", reserve_ids: [RESERVE_B] }, null);
    assert.equal(res.status, 200);
    assert.ok(membershipWrites.length > 0, "o vínculo da nova reserva não foi gravado");
  });

  it("admin_global em modo filial editando alguém de outra reserva → 404", async () => {
    actorRole = "admin_global";
    targetInActorReserve = false;
    const res = await request("PATCH", `/api/profiles/${TARGET_ID}`, { nome_completo: "X" });
    assert.equal(res.status, 404);
  });
});

describe("filtros de fato aplicados nas consultas", () => {
  it("a checagem de reserva filtra por reserva ativa e por tenant; o UPDATE de situação carrega o lock otimista", async () => {
    const res = await request("PATCH", `/api/profiles/${TARGET_ID}/status`, { status: "reactivate" });
    assert.equal(res.status, 200);
    assert.ok(hasFilter("reserve_memberships", "select", "reserve_id", RESERVE_B), "checagem sem filtro de reserva ativa");
    assert.ok(hasFilter("reserve_memberships", "select", "reserves.tenant_id", TENANT_ID), "checagem sem filtro de tenant");
    assert.ok(hasFilter("reserve_memberships", "select", "user_id", TARGET_ID), "checagem sem filtro do alvo");
    assert.ok(hasFilter("profiles", "update", "registration_status", "inactive"), "UPDATE sem o lock otimista na situação lida");
    assert.ok(hasFilter("profiles", "update", "default_tenant_id", TENANT_ID), "UPDATE sem filtro de tenant");
  });

  it("'reativar' quem já está ativo (resolve para o mesmo valor) → 200, sem 409 espúrio", async () => {
    target = { registration_status: "complete", nome_completo: "Ativo", role: "usuario" };
    const res = await request("PATCH", `/api/profiles/${TARGET_ID}/status`, { status: "reactivate" });
    assert.equal(res.status, 200);
  });

  it("falha do banco ao ler o alvo em /status → 503 amigável, sem fingir 'não encontrado'", async () => {
    targetQueryFails = true;
    const res = await request("PATCH", `/api/profiles/${TARGET_ID}/status`, { status: "inactive" });
    assert.equal(res.status, 503);
    assert.ok(errorsLogged.some((e) => e.msg === "profile.status.target_query_failure"));
    assert.ok(!warns.some((x) => x.obj.reason === "target_not_found"));
  });
});

describe("PATCH /api/profiles/:id — situação reenviada sem mudar não sobrescreve corrida concorrente", () => {
  it("editar telefone reenviando o mesmo registration_status não grava status no UPDATE (sem apagar impedimento aplicado em paralelo)", async () => {
    target = { registration_status: "complete", nome_completo: "Militar Alvo", role: "usuario" };
    const res = await request("PATCH", `/api/profiles/${TARGET_ID}`, { telefone: "83999990000", registration_status: "complete" });
    assert.equal(res.status, 200);
    const write = updates.find((u) => u.table === "profiles");
    assert.ok(write, "UPDATE não executado");
    assert.ok(!("registration_status" in write.row), "registration_status foi incluído no UPDATE mesmo sem mudar — pode sobrescrever uma corrida concorrente");
  });
});

describe("PATCH /api/profiles/:id — reserve_ids: reenviar reserva existente fora da autoridade do ator não é bloqueado (armeiro multi-reserva)", () => {
  it("admin_reserva de B edita armeiro que também atua em A (fora do alcance dele), reserve_ids inclui A e B → 200, A não é tocada", async () => {
    actorRole = "admin_reserva";
    target = { registration_status: "complete", nome_completo: "Armeiro multi-reserva", role: "armeiro" };
    const RESERVE_A = "93333333-0000-0000-0000-00000000000a";
    // membership existente do alvo em A e B (a query de reserve_memberships é
    // genérica no mock; simulamos via listData por builder direto).
    supabase.from = ((table: string) => {
      if (table === "reserve_memberships") {
        return {
          select: (cols: string) => {
            if (cols.includes("reserves!inner")) return builder(targetInActorReserve ? { reserve_id: RESERVE_B } : null);
            // ownAdminReserves do ator: só B (select("reserve_id")).
            if (cols === "reserve_id") return builder(null, {}, undefined, [{ reserve_id: RESERVE_B }]);
            // existingRows do alvo: A e B (select("id, reserve_id")).
            return builder(null, {}, undefined, [{ id: "m-a", reserve_id: RESERVE_A }, { id: "m-b", reserve_id: RESERVE_B }]);
          },
          delete: () => { membershipWrites.push("delete"); return builder(null); },
          update: () => { membershipWrites.push("update"); return builder(null); },
          upsert: () => { membershipWrites.push("upsert"); return builder(null); },
          insert: () => { membershipWrites.push("insert"); return builder(null); },
        };
      }
      if (table === "profiles") {
        return {
          select: (cols: string) => cols.includes("sessions_invalidated_at") ? builder({ role: actorRole, sessions_invalidated_at: null }) : builder(target),
          update: (row: Record<string, unknown>) => { updates.push({ table, row }); return builder({ id: TARGET_ID }); },
        };
      }
      return builder(null);
    }) as typeof supabase.from;

    const res = await request("PATCH", `/api/profiles/${TARGET_ID}`, { reserve_ids: [RESERVE_A, RESERVE_B] });
    assert.equal(res.status, 200, `esperava 200, veio ${res.status}: ${JSON.stringify(await res.clone().json())}`);
    assert.deepEqual(membershipWrites.filter((w) => w === "delete"), [], "a membership de A foi tocada, mas está fora da autoridade do admin_reserva");
  });
});

describe("PATCH /api/profiles/:id — troca de papel por admin_reserva não mexe em vínculo de outra reserva", () => {
  it("admin_reserva de B rebaixa armeiro (staff também em A) para 'usuario' → só o vínculo em B é rebaixado", async () => {
    actorRole = "admin_reserva";
    target = { registration_status: "complete", nome_completo: "Armeiro multi-reserva", role: "armeiro" };
    const RESERVE_A = "93333333-0000-0000-0000-00000000000a";
    let downgradeFilters: unknown[] = [];
    // Só a cadeia iniciada por .update(...) registra filtros — a cadeia de
    // .select(...) (usada por targetReserveAccess/checagem de vínculo) não
    // deve poluir a asserção sobre o UPDATE de downgrade.
    function selectHandler(): ProxyHandler<object> {
      return {
        get(_t, prop) {
          // ownReserves do ator: só B (usado sem .maybeSingle(), via "then").
          if (prop === "then") return (resolve: (v: unknown) => void) => resolve({ data: [{ reserve_id: RESERVE_B }], error: null });
          // targetReserveAccess usa .maybeSingle() — um vínculo do alvo em B.
          if (prop === "maybeSingle") return async () => ({ data: { reserve_id: RESERVE_B }, error: null });
          return () => new Proxy({}, selectHandler());
        },
      };
    }
    function updateHandler(): ProxyHandler<object> {
      return {
        get(_t, prop) {
          if (prop === "then") return (resolve: (v: unknown) => void) => resolve({ data: null, error: null });
          if (prop === "eq" || prop === "in") return (...args: unknown[]) => { downgradeFilters.push({ method: prop, args }); return new Proxy({}, updateHandler()); };
          return () => new Proxy({}, updateHandler());
        },
      };
    }
    supabase.from = ((table: string) => {
      if (table === "reserve_memberships") {
        return {
          select: () => new Proxy({}, selectHandler()),
          update: (row: Record<string, unknown>) => { membershipWrites.push("update:" + JSON.stringify(row)); return new Proxy({}, updateHandler()); },
          delete: () => new Proxy({}, updateHandler()),
          upsert: () => builder(null),
          insert: () => builder(null),
        };
      }
      if (table === "profiles") {
        return {
          select: (cols: string) => cols.includes("sessions_invalidated_at") ? builder({ role: actorRole, sessions_invalidated_at: null }) : builder(target),
          update: (row: Record<string, unknown>) => { updates.push({ table, row }); return builder({ id: TARGET_ID }); },
        };
      }
      return builder(null);
    }) as typeof supabase.from;

    const res = await request("PATCH", `/api/profiles/${TARGET_ID}`, { role: "usuario" });
    assert.equal(res.status, 200, `esperava 200, veio ${res.status}`);
    const scoped = downgradeFilters.some((f) => (f as { args: unknown[] }).args[0] === "reserve_id");
    assert.ok(scoped, "o rebaixamento de papel de staff não foi restrito à reserva do ator — pode ter alterado o vínculo em outra reserva");
  });
});

describe("GET /api/profiles/:id/reserves — confinado à reserva do ator", () => {
  it("armeiro consultando reservas administradas por alguém de outra reserva → 404", async () => {
    targetInActorReserve = false;
    const res = await request("GET", `/api/profiles/${TARGET_ID}/reserves`, undefined);
    assert.equal(res.status, 404);
  });

  it("armeiro consultando reservas de alguém da própria reserva → 200", async () => {
    const res = await request("GET", `/api/profiles/${TARGET_ID}/reserves`, undefined);
    assert.equal(res.status, 200);
  });
});
