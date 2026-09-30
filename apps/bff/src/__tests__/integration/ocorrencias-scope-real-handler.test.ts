import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "../../lib/session.ts";
import { requestIdMiddleware } from "../../middleware/request-id.ts";
import { supabase } from "../../services/supabase.ts";
import { createFakePostgrest, type Row, type Tables } from "../helpers/fake-postgrest.ts";
import type { HonoVariables } from "../../types/hono.ts";

// R-37 lote 1 (verification/r37-batch1): GET /api/ocorrencias é a fonte de
// dados da página /reserva/ocorrencias depois do lote. Handler REAL:
// authMiddleware + ocorrenciasRoutes montados como em src/index.ts, sessão
// iron-session selada de verdade, banco em memória que aplica os filtros
// (fake-postgrest). Cada ocorrência tem um id nomeado; os casos comparam o
// CONJUNTO exato de ids devolvidos, então qualquer vazamento (outra reserva,
// outro tenant, resolvida, dado de staff em Modo Usuário) aparece como id
// sobrando. Identidades e dados artificiais. Roda via bun.

const T_A = "37a00000-0000-0000-0000-00000000000a";
const T_B = "37b00000-0000-0000-0000-00000000000b";
const R_A1 = "37a10000-0000-0000-0000-0000000000a1";
const R_A2 = "37a20000-0000-0000-0000-0000000000a2";
const R_B1 = "37b10000-0000-0000-0000-0000000000b1";

type U = { id: string; role: string; tenant: string | null; reserve: string | null };
const USERS: Record<string, U> = {
  "tok-staff-a1": { id: "37000000-0000-0000-0000-00000000005a", role: "admin_reserva", tenant: T_A, reserve: R_A1 },
  "tok-mil-a": { id: "37000000-0000-0000-0000-0000000000d1", role: "usuario", tenant: T_A, reserve: null },
  "tok-mil-a-other": { id: "37000000-0000-0000-0000-0000000000d2", role: "usuario", tenant: T_A, reserve: null },
  "tok-staff-b1": { id: "37000000-0000-0000-0000-00000000005b", role: "armeiro", tenant: T_B, reserve: R_B1 },
  "tok-mil-b": { id: "37000000-0000-0000-0000-0000000000d3", role: "usuario", tenant: T_B, reserve: null },
  "tok-staff-no-tenant": { id: "37000000-0000-0000-0000-00000000005c", role: "admin_reserva", tenant: null, reserve: R_A1 },
  "tok-global-a": { id: "37000000-0000-0000-0000-00000000005d", role: "admin_global", tenant: T_A, reserve: null },
};
const ID = (tok: string) => USERS[tok].id;

// SupabaseAuthProvider captura o `fetch` global na construção (import do
// middleware): o mock de /auth/v1/user tem de existir ANTES do import (ver
// mode-user-auth-paths.test.ts). Em `bun test` com vários arquivos o cache de
// módulos é compartilhado — se outro arquivo importou o middleware antes, o
// provider guardou o mock DELE e o Bearer daqui toma 401. Por isso o
// middleware é importado com um specifier próprio (`?r37-ocorrencias`): uma
// instância nova de auth.ts, com provider construído sobre o mock abaixo. As
// dependências (services/supabase, lib/session) continuam as compartilhadas.
// Se isso deixar de isolar, os casos de Bearer falham (401) — nunca passam
// por engano.
const ORIGINAL_FETCH = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.endsWith("/auth/v1/user")) {
    const auth = new Headers(init?.headers).get("Authorization") ?? "";
    const u = USERS[auth.replace("Bearer ", "")];
    return u ? Response.json({ id: u.id, email: `${u.role}@example.invalid` }) : new Response("{}", { status: 401 });
  }
  return ORIGINAL_FETCH(input, init);
}) as typeof fetch;
// Specifier não-literal: o tsc não resolve `?query`; o tipo vem do módulo real.
const AUTH_ISOLATED = "../../middleware/auth.ts?r37-ocorrencias";
const { authMiddleware } = (await import(AUTH_ISOLATED)) as typeof import("../../middleware/auth.ts");
const { ocorrenciasRoutes } = await import("../../routes/ocorrencias.ts");

const L_A1 = "37e00000-0000-0000-0000-0000000000a1";
const L_A2 = "37e00000-0000-0000-0000-0000000000a2";
const L_B1 = "37e00000-0000-0000-0000-0000000000b1";
const MT_A1 = "37f00000-0000-0000-0000-0000000000a1";

// Ocorrências (ids legíveis de propósito: a mensagem de falha diz o que vazou).
const OC = {
  A1_MIL: "oc-a1-mil-a-aberta",
  A1_MIL_OTHER: "oc-a1-mil-a-other-em-analise",
  A1_VIA_MT: "oc-a1-via-material-type",
  A1_STAFF: "oc-a1-reportada-pelo-staff",
  A1_RESOLVED: "oc-a1-mil-a-resolvida",
  A2_MIL: "oc-a2-mil-a-aberta",
  B1_MIL: "oc-b1-mil-b-aberta",
  A_ORPHAN: "oc-a-orfa-sem-reserva",
};

function buildTables(): Tables {
  const oc = (id: string, military: string, status: string, lending: string | null, mt: string | null = null): Row =>
    ({ id, military_id: ID(military), status, lending_id: lending, material_type_id: mt, titulo: id, created_at: "2026-09-30T00:00:00.000Z" });
  const users = Object.values(USERS);
  return {
    profiles: {
      columns: ["id", "role", "active_reserve_id", "sessions_invalidated_at", "default_tenant_id", "nome_completo", "posto", "matricula"],
      rows: users.map((u) => ({ id: u.id, role: u.role, active_reserve_id: u.reserve, sessions_invalidated_at: null, default_tenant_id: u.tenant, nome_completo: `Artificial ${u.role}`, posto: "X", matricula: u.id.slice(-4) })),
    },
    tenant_memberships: { columns: ["tenant_id", "user_id"], rows: users.filter((u) => u.tenant).map((u) => ({ tenant_id: u.tenant, user_id: u.id })) },
    revoked_sessions: { columns: ["session_id"], rows: [] },
    reserves: { columns: ["id", "tenant_id"], rows: [{ id: R_A1, tenant_id: T_A }, { id: R_A2, tenant_id: T_A }, { id: R_B1, tenant_id: T_B }] },
    lendings: { columns: ["id", "reserve_id"], rows: [{ id: L_A1, reserve_id: R_A1 }, { id: L_A2, reserve_id: R_A2 }, { id: L_B1, reserve_id: R_B1 }] },
    material_types: { columns: ["id", "reserve_id"], rows: [{ id: MT_A1, reserve_id: R_A1 }] },
    ocorrencias: {
      columns: ["id", "military_id", "status", "lending_id", "material_type_id", "titulo", "created_at"],
      rows: [
        oc(OC.A1_MIL, "tok-mil-a", "aberta", L_A1),
        oc(OC.A1_MIL_OTHER, "tok-mil-a-other", "em_analise", L_A1),
        oc(OC.A1_VIA_MT, "tok-mil-a-other", "aberta", null, MT_A1),
        oc(OC.A1_STAFF, "tok-staff-a1", "aberta", L_A1),
        oc(OC.A1_RESOLVED, "tok-mil-a", "resolvida", L_A1),
        oc(OC.A2_MIL, "tok-mil-a", "aberta", L_A2),
        oc(OC.B1_MIL, "tok-mil-b", "aberta", L_B1),
        oc(OC.A_ORPHAN, "tok-mil-a", "aberta", null, null),
      ],
    },
  };
}

const ORIGINAL_FROM = supabase.from.bind(supabase);
before(() => { const fake = createFakePostgrest(buildTables()); supabase.from = ((t: string) => fake.from(t)) as unknown as typeof supabase.from; });
after(() => { supabase.from = ORIGINAL_FROM; globalThis.fetch = ORIGINAL_FETCH; });

// Montagem idêntica a src/index.ts (app.use("/api/ocorrencias/*", authMiddleware)).
const app = new Hono<{ Variables: HonoVariables }>();
app.use("*", requestIdMiddleware);
app.use("/api/ocorrencias/*", authMiddleware);
app.route("/api/ocorrencias", ocorrenciasRoutes);

let sessionSeq = 0;
async function seal(tok: string, opts: { mode?: "usuario"; tenant?: string | null } = {}): Promise<string> {
  const u = USERS[tok];
  const res = new Response(null);
  const session = await getIronSession<SessionData>(new Request("http://localhost/seal"), res, sessionOptions);
  Object.assign(session, {
    userId: u.id, role: u.role as SessionData["role"],
    tenantId: opts.tenant !== undefined ? opts.tenant : u.tenant, reserveId: u.reserve,
    supabaseAccessToken: tok, sessionId: `r37-sess-${++sessionSeq}`, issuedAt: Date.now(),
    ...(opts.mode ? { activeMode: "usuario", originalRole: u.role as SessionData["originalRole"] } : {}),
  } satisfies Partial<SessionData>);
  await session.save();
  return res.headers.getSetCookie().find((v) => v.startsWith(`${sessionOptions.cookieName}=`))!.split(";")[0];
}

async function list(headers: Record<string, string>) {
  const r = await app.request("/api/ocorrencias", { headers });
  const body = r.headers.get("content-type")?.includes("json") ? await r.json() : null;
  return { status: r.status, body: body as Row[] | Record<string, unknown> };
}
async function ids(headers: Record<string, string>): Promise<string[]> {
  const r = await list(headers);
  assert.equal(r.status, 200, `esperado 200, veio ${r.status}: ${JSON.stringify(r.body)}`);
  const rows = r.body as Row[];
  for (const row of rows) {
    // A rota remove campos usados só para escopo; não podem sair para o cliente.
    assert.ok(!("lending_id" in row) && !("material_type_id" in row), `campo interno vazou: ${JSON.stringify(row)}`);
  }
  return rows.map((row) => String(row.id)).sort();
}
const set = (...xs: string[]) => [...xs].sort();

const STAFF_A1_VIEW = set(OC.A1_MIL, OC.A1_MIL_OTHER, OC.A1_VIA_MT, OC.A1_STAFF);
const STAFF_A1_OWN = set(OC.A1_STAFF);
const MIL_A_OWN = set(OC.A1_MIL, OC.A1_RESOLVED, OC.A2_MIL, OC.A_ORPHAN);

describe("R-37 lote 1 — GET /api/ocorrencias (authMiddleware + rota reais)", () => {
  it("A. staff A1 em sessão normal: só abertas/em análise de A1 (inclui a própria), nada de A2/B1, nada resolvido", async () => {
    const got = await ids({ cookie: await seal("tok-staff-a1") });
    assert.deepEqual(got, STAFF_A1_VIEW);
    for (const leaked of [OC.A2_MIL, OC.B1_MIL, OC.A1_RESOLVED, OC.A_ORPHAN]) assert.ok(!got.includes(leaked), `vazou ${leaked}`);
  });

  it("B. mesmo staff em Modo Usuário: só as ocorrências reportadas por ele", async () => {
    assert.deepEqual(await ids({ cookie: await seal("tok-staff-a1", { mode: "usuario" }) }), STAFF_A1_OWN);
  });

  it("B'. Modo Usuário + Bearer do próprio staff não restaura a visão de staff", async () => {
    assert.deepEqual(await ids({ cookie: await seal("tok-staff-a1", { mode: "usuario" }), Authorization: "Bearer tok-staff-a1" }), STAFF_A1_OWN);
  });

  it("C. militar comum de A: só as próprias (de qualquer reserva/status), nenhuma de outro militar", async () => {
    assert.deepEqual(await ids({ cookie: await seal("tok-mil-a") }), MIL_A_OWN);
    assert.deepEqual(await ids({ cookie: await seal("tok-mil-a-other") }), set(OC.A1_MIL_OTHER, OC.A1_VIA_MT));
  });

  it("D. staff de B1: só as de B1 (nada do tenant A)", async () => {
    assert.deepEqual(await ids({ cookie: await seal("tok-staff-b1") }), set(OC.B1_MIL));
  });

  it("E. reserva: staff A1 não vê A2 (mesmo tenant)", async () => {
    const got = await ids({ cookie: await seal("tok-staff-a1") });
    assert.ok(!got.includes(OC.A2_MIL), "ocorrência de A2 vazou para staff de A1");
  });

  it("F. cookie do militar A + Bearer do staff A1: identidade e escopo só do militar (sem mistura)", async () => {
    assert.deepEqual(await ids({ cookie: await seal("tok-mil-a"), Authorization: "Bearer tok-staff-a1" }), MIL_A_OWN);
  });

  it("G. staff sem tenant na sessão: 403 (nunca lista vazia/global)", async () => {
    const r = await list({ cookie: await seal("tok-staff-no-tenant", { tenant: null }) });
    assert.equal(r.status, 403);
  });

  it("H. Bearer do staff sem sessão: teto usuario, só as próprias", async () => {
    assert.deepEqual(await ids({ Authorization: "Bearer tok-staff-a1" }), STAFF_A1_OWN);
  });

  it("I (extra). admin_global em matriz de A: tenant A inteiro (A1+A2+órfã), nada de B1 — único caso sem filtro de reserva", async () => {
    const got = await ids({ cookie: await seal("tok-global-a") });
    assert.deepEqual(got, set(OC.A1_MIL, OC.A1_MIL_OTHER, OC.A1_VIA_MT, OC.A1_STAFF, OC.A2_MIL, OC.A_ORPHAN));
    assert.ok(!got.includes(OC.B1_MIL), "ocorrência do tenant B vazou para matriz de A");
  });

  it("sem sessão e sem Bearer: 401", async () => {
    assert.equal((await list({})).status, 401);
  });

  it("MULTI_SESSION: sessão X (staff) e Y (Modo Usuário) do mesmo usuário não se contaminam", async () => {
    const x = await seal("tok-staff-a1");
    const y = await seal("tok-staff-a1", { mode: "usuario" });
    assert.deepEqual(await ids({ cookie: x }), STAFF_A1_VIEW, "X deveria ver A1");
    assert.deepEqual(await ids({ cookie: y }), STAFF_A1_OWN, "Y deveria ver só as próprias");
    assert.deepEqual(await ids({ cookie: x }), STAFF_A1_VIEW, "X, de novo, depois de Y");
    assert.deepEqual(await ids({ cookie: y }), STAFF_A1_OWN, "Y, de novo, depois de X");
  });
});
