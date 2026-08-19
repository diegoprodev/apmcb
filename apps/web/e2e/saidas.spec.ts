/**
 * APMCB — Fase 5: Saída Diária Enterprise
 *
 * SD01: Emitir saída (POST /api/lendings/batch, TOTP) → 201; lending criado; estoque decrementado
 * SD02: Saída sem estoque suficiente → 409
 * SD03: Saída sem identidade verificada previamente (/identify) → 401 IDENTITY_VERIFICATION_REQUIRED
 * SD04: Devolução (POST /api/lendings/bulk-return) → devolve; estoque volta
 *
 * Reescrito em 2026-08-18: POST /api/saidas e PATCH /api/saidas/:id/return
 * foram definitivamente aposentados — ver LEGACY_CUSTODY_FLOW_RETIRED em
 * apps/bff/src/routes/saidas.ts (retorna 501 sempre) e o teste de segurança
 * dedicado apps/bff/src/__tests__/idor-write-scope.test.ts, que trava essa
 * aposentadoria (falha se alguém reativar a criação pela rota antiga).
 *
 * O fluxo real hoje (POST /api/lendings/batch, a rota usada pela tela "Nova
 * Saída" — apps/web/.../reserva/saidas/nova/_form.tsx) é AGREGADO por
 * quantidade (material_type_id + quantidade), não mais por item_id
 * individual — não existe mais "o item X está em saída". Os antigos
 * SD03/SD04 desta suíte (armeiro assina TOTP → militar confirma, em 2
 * fases separadas) não têm equivalente: a identidade agora é verificada
 * ANTES da emissão, num único passo (POST /api/lendings/identify), que
 * grava a verificação numa sessão por cookie (apmcb_session, HttpOnly) —
 * por isso os testes abaixo precisam capturar o Set-Cookie da resposta de
 * /identify e reenviá-lo na chamada seguinte, exatamente como o navegador
 * já faz sozinho numa sessão real.
 */

import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { BFF_URL, USERS } from "./harness";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function supabaseService() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function loginToken(email: string, password: string): Promise<string> {
  const { data, error } = await supabaseService().auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`Login failed: ${error?.message}`);
  return data.session.access_token;
}

// Mesmo helper de sempre, +cookie: /api/lendings/identify grava a
// verificação numa sessão por cookie (não num campo do body) — as rotas
// seguintes (batch, bulk-return) leem essa sessão. Sem repassar o cookie
// devolvido por /identify na chamada seguinte, a verificação "não existe"
// do ponto de vista do servidor (é exatamente essa checagem que garante
// que ninguém emite saída sem identificar o militar antes).
async function bff(method: string, path: string, token: string, body?: unknown, cookie?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  if (cookie) headers["Cookie"] = cookie;
  const res = await fetch(`${BFF_URL}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  const setCookie = res.headers.getSetCookie().find((c) => c.startsWith("apmcb_session="));
  return { status: res.status, data, cookie: setCookie ? setCookie.split(";")[0] : cookie };
}

// Achado real (2026-08-18): `.from("reserves").select("id").limit(1).single()`
// sem filtro pegava QUALQUER reserva do banco de dev/teste — quebrou depois
// que sessões de pentest passaram a criar reservas extras na mesma tabela.
// A reserva correta é a que o próprio fixture (armeiro@apmcb.dev) realmente
// pertence, via reserve_memberships — mesmo padrão já usado pelo BFF em
// apps/bff/src/middleware/auth.ts (fallback Bearer) pra resolver reserveId.
async function getOwnReserveId(supabase: SupabaseClient, userId: string): Promise<string> {
  const { data } = await supabase.from("reserve_memberships").select("reserve_id").eq("user_id", userId).limit(1).single();
  return data?.reserve_id ?? "";
}

const lastConsumedTotp = new Map<string, string>();
const reconfiguredTotp = new Set<string>();
async function getFreshTotpCode(token: string): Promise<string> {
  for (;;) {
    const { status, data } = await bff("GET", "/api/totp/code", token);
    // Achado real (ambiente de dev/teste compartilhado): o secret TOTP de um
    // fixture pode ficar num estado "corrompido/chave de encriptação
    // divergente" (422 needs_reconfigure) sem relação com o que este teste
    // está exercitando — POST /api/totp/reconfigure é o caminho de
    // autorrecuperação oficial (ver apps/bff/src/routes/totp.ts linha ~199),
    // seguro de chamar aqui porque só regenera se o secret atual já está
    // comprovadamente quebrado (o endpoint recusa com 409 se não estiver).
    if (status === 422 && data?.needs_reconfigure && !reconfiguredTotp.has(token)) {
      reconfiguredTotp.add(token);
      const reconfig = await bff("POST", "/api/totp/reconfigure", token);
      if (reconfig.status !== 200 && reconfig.status !== 201) {
        throw new Error(`POST /api/totp/reconfigure falhou (${reconfig.status}): ${JSON.stringify(reconfig.data)}`);
      }
      continue;
    }
    if (status !== 200) throw new Error(`GET /api/totp/code falhou (${status}): ${JSON.stringify(data)}`);
    if (data.code !== lastConsumedTotp.get(token)) {
      lastConsumedTotp.set(token, data.code);
      return data.code;
    }
    await new Promise((r) => setTimeout(r, (data.seconds_remaining + 1) * 1000));
  }
}

// ─── Setup ────────────────────────────────────────────────────────────────────

let armeiroToken   = "";
let cadeteToken    = "";
let reserveId      = "";
let militarId      = "";
let materialTypeId = "";

test.beforeAll(async () => {
  const supabase = supabaseService();

  armeiroToken = await loginToken(USERS.reserva.email, USERS.reserva.password);
  cadeteToken  = await loginToken(USERS.efetivo.email, USERS.efetivo.password);

  const { data: armProfile } = await supabase.from("profiles").select("id")
    .eq("matricula", USERS.reserva.matricula).single();
  const { data: milProfile } = await supabase.from("profiles").select("id")
    .eq("matricula", USERS.efetivo.matricula).single();
  militarId = milProfile?.id ?? "";

  reserveId = armProfile?.id ? await getOwnReserveId(supabase, armProfile.id) : "";

  // Turno ativo é pré-requisito de /api/lendings/batch e /bulk-return para
  // role=armeiro — mesmo padrão de cautelamentos.spec.ts.
  const { status: activeStatus, data: activeData } = await bff("GET", "/api/shifts/active", armeiroToken);
  if (activeStatus === 200 && !activeData.shift) {
    const code = await getFreshTotpCode(armeiroToken);
    const { status, data } = await bff("POST", "/api/shifts/open", armeiroToken, {
      reserve_id: reserveId, auth_mode: "totp", totp_token: code,
    });
    if (status !== 201) throw new Error(`Setup: falha ao abrir turno do armeiro — ${status}: ${JSON.stringify(data)}`);
  }

  // Material com estoque disponível para a reserva do armeiro.
  const { data: material } = await supabase
    .from("material_availability")
    .select("id, quantidade_disponivel")
    .eq("reserve_id", reserveId)
    .gt("quantidade_disponivel", 1)
    .limit(1)
    .single();
  materialTypeId = material?.id ?? "";
});

// ─── Testes ───────────────────────────────────────────────────────────────────

test.describe.configure({ mode: "serial" });

test.describe("Fase 5 — Saída Diária", () => {
  let lendingId = "";

  test("SD01 — Emitir saída via /api/lendings/batch → 201; estoque decrementado", async () => {
    if (!materialTypeId || !reserveId || !militarId) {
      test.skip(true, "Setup incompleto — sem material/reserva/militar");
      return;
    }

    const supabase = supabaseService();
    const { data: before } = await supabase
      .from("material_availability").select("quantidade_disponivel").eq("id", materialTypeId).single();

    const code = await getFreshTotpCode(cadeteToken);
    const identify = await bff("POST", "/api/lendings/identify", armeiroToken, {
      mode: "totp", matricula: USERS.efetivo.matricula, code, reserve_id: reserveId,
    });
    expect(identify.status, `SD01 identify esperava 200, got ${identify.status}: ${JSON.stringify(identify.data)}`).toBe(200);

    const movementId = randomUUID();
    const { status, data } = await bff("POST", "/api/lendings/batch", armeiroToken, {
      military_id: militarId,
      reserve_id: reserveId,
      movement_id: movementId,
      auth_mode: "totp",
      items: [{ material_type_id: materialTypeId, quantidade: 1 }],
    }, identify.cookie);

    expect(status, `SD01 esperava 201, got ${status}: ${JSON.stringify(data)}`).toBe(201);
    lendingId = data.lendings?.[0]?.lending_id ?? "";
    expect(lendingId, "SD01: lending_id ausente na resposta").toBeTruthy();

    const { data: after } = await supabase
      .from("material_availability").select("quantidade_disponivel").eq("id", materialTypeId).single();
    expect(after?.quantidade_disponivel).toBe((before?.quantidade_disponivel ?? 0) - 1);
  });

  test("SD02 — Saída sem estoque suficiente → 409", async () => {
    if (!materialTypeId || !reserveId || !militarId) { test.skip(true, "Setup incompleto"); return; }

    const supabase = supabaseService();
    const { data: material } = await supabase
      .from("material_availability").select("quantidade_disponivel").eq("id", materialTypeId).single();
    const overQuantity = (material?.quantidade_disponivel ?? 0) + 1;

    const code = await getFreshTotpCode(cadeteToken);
    const identify = await bff("POST", "/api/lendings/identify", armeiroToken, {
      mode: "totp", matricula: USERS.efetivo.matricula, code, reserve_id: reserveId,
    });
    expect(identify.status).toBe(200);

    const { status, data } = await bff("POST", "/api/lendings/batch", armeiroToken, {
      military_id: militarId,
      reserve_id: reserveId,
      movement_id: randomUUID(),
      auth_mode: "totp",
      items: [{ material_type_id: materialTypeId, quantidade: overQuantity }],
    }, identify.cookie);

    expect(status, `SD02 esperava 409, got ${status}: ${JSON.stringify(data)}`).toBe(409);
  });

  test("SD03 — Saída sem identidade verificada previamente → 401", async () => {
    if (!materialTypeId || !reserveId || !militarId) { test.skip(true, "Setup incompleto"); return; }

    // Sem /identify antes (nenhum cookie repassado) — o servidor não tem
    // como saber que o militar foi verificado.
    const { status, data } = await bff("POST", "/api/lendings/batch", armeiroToken, {
      military_id: militarId,
      reserve_id: reserveId,
      movement_id: randomUUID(),
      auth_mode: "totp",
      items: [{ material_type_id: materialTypeId, quantidade: 1 }],
    });

    expect(status, `SD03 esperava 401, got ${status}: ${JSON.stringify(data)}`).toBe(401);
    expect(data.error).toBe("IDENTITY_VERIFICATION_REQUIRED");
  });

  test("SD04 — Devolução via /api/lendings/bulk-return → estoque volta", async () => {
    if (!lendingId) { test.skip(true, "lendingId não disponível (SD01 falhou?)"); return; }

    const supabase = supabaseService();
    const { data: before } = await supabase
      .from("material_availability").select("quantidade_disponivel").eq("id", materialTypeId).single();

    const code = await getFreshTotpCode(cadeteToken);
    const identify = await bff("POST", "/api/lendings/identify", armeiroToken, {
      mode: "totp", matricula: USERS.efetivo.matricula, code, reserve_id: reserveId,
    });
    expect(identify.status).toBe(200);

    const { status, data } = await bff("POST", "/api/lendings/bulk-return", armeiroToken, {
      lending_ids: [lendingId],
    }, identify.cookie);

    expect(status, `SD04 esperava 200, got ${status}: ${JSON.stringify(data)}`).toBe(200);
    expect(data.returned).toBe(1);

    const { data: after } = await supabase
      .from("material_availability").select("quantidade_disponivel").eq("id", materialTypeId).single();
    expect(after?.quantidade_disponivel).toBe((before?.quantidade_disponivel ?? 0) + 1);
  });
});
