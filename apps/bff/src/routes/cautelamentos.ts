import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { roleGuard } from "../middleware/role-guard";
import { auditLog } from "../middleware/audit";
import { supabase } from "../services/supabase";
import { hashDocument } from "../lib/document-hash";
import { getFingerprintSDK } from "../services/fingerprint/index";
import type { HonoVariables } from "../types/hono";
import { checkTotpGuard } from "../lib/totp-guard";
import { readSecret } from "./totp";
import { logShiftEvent } from "../lib/shift-events";
import { requireActiveShift } from "../lib/shift-guard";

export const cautelamentosRoutes = new Hono<{ Variables: HonoVariables }>();

const createSchema = z.object({
  item_id:         z.string().uuid(),
  militar_id:      z.string().uuid(),
  reserve_id:      z.string().uuid(),
  motivo_emissao:  z.string().min(3).max(500),
  condicao_emissao: z.enum(["novo","bom","regular","ruim"]).default("bom"),
  prazo_proxima_conferencia: z.string().optional(),
});

const returnSchema = z.object({
  condicao_devolucao: z.enum(["bom","regular","ruim","inapto"]),
  motivo_devolucao:   z.string().optional(),
});

const substituteSchema = z.object({
  novo_item_id:       z.string().uuid(),
  condicao_devolucao: z.enum(["bom","regular","ruim","inapto"]),
  motivo_emissao:     z.string().min(3).max(500),
  condicao_emissao:   z.enum(["novo","bom","regular","ruim"]).default("bom"),
});

// Cautela com múltiplos materiais — payload aceita N itens (cada um é um
// material_items físico, sem conceito de quantidade), agrupados pelo mesmo
// movement_id gerado no frontend. Espelha o schema de POST /api/lendings/
// batch, adaptado à granularidade de item físico da cautela.
const batchItemSchema = z.object({
  item_id:                   z.string().uuid(),
  condicao_emissao:          z.enum(["novo","bom","regular","ruim"]).default("bom"),
  prazo_proxima_conferencia: z.string().optional(),
});

const createBatchSchema = z.object({
  militar_id:      z.string().uuid(),
  reserve_id:      z.string().uuid(),
  motivo_emissao:  z.string().min(3).max(500),
  movement_id:     z.string().uuid(),
  items:           z.array(batchItemSchema).min(1).max(50),
});

function makeDocHash(fields: Record<string, unknown>): string {
  return hashDocument({
    document_type: "handover",
    document_id:   (fields.id as string | undefined) ?? "new",
    data:          fields,
  });
}

async function validateTotp(
  userId: string,
  token: string
): Promise<{ ok: boolean; error?: string; status?: number }> {
  const { data: row, error } = await supabase
    .from("totp_secrets")
    .select("id, secret, failure_count, last_failure_at, last_used_token")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !row) return { ok: false, error: "TOTP não configurado", status: 404 };

  let plainSecret: string;
  try {
    plainSecret = await readSecret(row.secret);
  } catch {
    return { ok: false, error: "TOTP secret inválido. Reconfigure o autenticador em 'Meu Perfil'.", status: 400 };
  }

  const result = checkTotpGuard({ ...row, secret: plainSecret }, token);

  if (!result.ok) {
    if (result.status === 400 && result.error === "TOTP inválido") {
      await supabase.from("totp_secrets")
        .update({ failure_count: (row.failure_count ?? 0) + 1, last_failure_at: new Date().toISOString() })
        .eq("id", row.id);
    }
    return result;
  }

  // Achado de code review (assinatura em lote de cautela): duas requisições
  // concorrentes com o mesmo código (duplo clique) passavam ambas pelo
  // checkTotpGuard acima ANTES de qualquer uma gravar last_used_token —
  // SELECT e UPDATE eram round-trips separados, sem lock entre eles. Fix:
  // o UPDATE em si vira a fonte de verdade do consumo único, condicionado
  // a last_used_token ainda ser diferente do token — um único statement é
  // atômico no Postgres, então das duas requisições concorrentes só uma
  // encontra a condição satisfeita e recebe uma linha de volta. isDistinct
  // trata NULL como valor comparável (primeiro uso), diferente de .neq()
  // puro — sem precisar replicar a semântica manualmente com .or().
  const { data: consumed } = await supabase.from("totp_secrets")
    .update({ last_used_token: token, failure_count: 0 })
    .eq("id", row.id)
    .isDistinct("last_used_token", token)
    .select("id");

  if (!consumed || consumed.length === 0) {
    return { ok: false, error: "Código já utilizado", status: 400 };
  }

  return { ok: true };
}

async function validateBiometric(
  expectedUserId: string
): Promise<{ ok: boolean; error?: string; status?: number }> {
  try {
    const sdk = await getFingerprintSDK();
    const captured = await sdk.capture(1);

    const { data: templates } = await supabase
      .from("biometric_templates")
      .select("user_id, template_data")
      .eq("user_id", expectedUserId);

    if (!templates || templates.length === 0) {
      return { ok: false, error: "Biometria não registrada para este usuário", status: 404 };
    }

    const result = await sdk.identify(
      captured.data,
      templates.map((t) => ({ userId: t.user_id, templateData: Buffer.from(t.template_data) }))
    );

    if (!result || result.userId !== expectedUserId) {
      return { ok: false, error: "Biometria não reconhecida ou não corresponde ao signatário esperado", status: 401 };
    }

    return { ok: true };
  } catch {
    return { ok: false, error: "Erro no hardware biométrico — tente TOTP", status: 503 };
  }
}

// Schema de assinatura: aceita TOTP ou biometria (nunca nenhum)
const signBodySchema = z
  .object({
    totp_token:   z.string().length(6).regex(/^\d{6}$/).optional(),
    use_biometric: z.boolean().optional(),
  })
  .refine((d) => d.totp_token || d.use_biometric, {
    message: "Informe totp_token ou use_biometric: true",
  });

/**
 * Resolve QUEM deve provar identidade ao assinar como militar numa cautela.
 *
 * Achado real: a assinatura do militar tem dois fluxos legítimos e
 * distintos — (a) self-sign, o próprio militar logado em
 * /efetivo/minhas-cautelas assina a própria cautela; (b) facilitação, o
 * armeiro/admin em /reserva/cautelas opera o dispositivo (leitor
 * biométrico ou digitação do TOTP) EM NOME do militar, que pode nem estar
 * logado. Em (b) a prova de identidade (TOTP/biometria) sempre precisa ser
 * verificada contra `cautela.militar_id` — nunca contra quem está logado —
 * senão a checagem valida a pessoa errada. Bug anterior: usava
 * `c.get("userId")` (o chamador) pros dois casos, o que sempre resultava
 * em 403 no caso (b) antes mesmo de tentar validar qualquer código, já que
 * armeiro.id !== cautela.militar_id.
 */
// Allow-list explícita (não "tudo que não é usuario") — operação sensível
// o bastante (completar a assinatura de outra pessoa) pra não depender de
// quem mais o roleGuard desta rota vier a permitir no futuro (ex: auditor).
const STAFF_FACILITATOR_ROLES = new Set(["armeiro", "admin_reserva", "admin_global"]);

function resolveSigningIdentity(
  cautela: { militar_id: string },
  callerId: string,
  callerRole: string | undefined
): { targetId: string } | { error: string; status: 403 } {
  if (callerRole === "usuario") {
    if (cautela.militar_id !== callerId) {
      return { error: "Apenas o militar responsável pode assinar", status: 403 };
    }
    return { targetId: callerId };
  }
  if (callerRole && STAFF_FACILITATOR_ROLES.has(callerRole)) {
    // Facilitando: a prova de identidade é sempre da pessoa física dona da
    // cautela, não de quem opera o teclado.
    return { targetId: cautela.militar_id };
  }
  return { error: "Role não autorizado a assinar por terceiros", status: 403 };
}

// Traduz os códigos crus de exception (RAISE EXCEPTION 'CODIGO') das RPCs de
// lote pra mensagens em pt-BR — achado de code review: friendlyApiError no
// frontend só filtra mensagens JÁ conhecidas como cruas (allowlist/blocklist
// pré-existente), então um código novo sem tradução aqui vaza pro toast do
// usuário exatamente como o Postgres o gerou (ex: "CAUTELA_ITEM_NOT_ELIGIBLE").
const CAUTELA_BATCH_ERROR_MESSAGES: Record<string, string> = {
  CAUTELA_BATCH_INPUT_INVALID: "Dados do lote inválidos.",
  CAUTELA_MOVEMENT_SCOPE_INVALID: "Este lote já foi registrado para outro militar ou reserva.",
  CAUTELA_MOVEMENT_ITEMS_MISMATCH: "Este lote já foi registrado com uma lista de materiais diferente.",
  CAUTELA_MILITAR_NOT_FOUND: "Militar não encontrado.",
  CAUTELA_RESERVE_NOT_FOUND: "Reserva não encontrada.",
  CAUTELA_BATCH_ITEM_INVALID: "Um dos itens do lote está com dados inválidos.",
  CAUTELA_BATCH_DUPLICATE_ITEM: "O mesmo item foi selecionado mais de uma vez no lote.",
  CAUTELA_ITEM_NOT_FOUND: "Um dos itens do lote não foi encontrado.",
  CAUTELA_ITEM_NOT_AVAILABLE: "Um dos itens do lote não está mais disponível.",
  CAUTELA_ITEM_NOT_ELIGIBLE: "Um dos itens do lote não está habilitado para cautela.",
  CAUTELA_ITEM_EXPIRED: "Um dos itens do lote está com a validade vencida.",
  CAUTELA_SIGN_BATCH_INPUT_INVALID: "Dados da assinatura em lote inválidos.",
  CAUTELA_MOVEMENT_NOT_FOUND: "Lote não encontrado.",
};

function translateBatchError(code: string | undefined, fallback: string): string {
  return (code && CAUTELA_BATCH_ERROR_MESSAGES[code]) ?? fallback;
}

// GET /api/cautelamentos — listar cautelas
cautelamentosRoutes.get(
  "/",
  roleGuard("armeiro", "admin_reserva", "admin_global", "auditor"),
  async (c) => {
    const tenantId = c.get("tenantId");
    const { status, militar_id } = c.req.query();

    let query = supabase
      .from("cautelamentos")
      .select(`
        id,
        status,
        motivo_emissao,
        condicao_emissao,
        data_emissao,
        prazo_proxima_conferencia,
        armeiro_signature_id,
        militar_signature_id,
        movement_id,
        item:material_items!cautelamentos_item_id_fkey(id, numero_serie, status_operacional, material_type:material_types(nome, categoria)),
        militar:profiles!cautelamentos_militar_id_fkey(id, nome_completo, matricula, posto),
        armeiro:profiles!cautelamentos_armeiro_id_fkey(id, nome_completo, matricula)
      `)
      .order("created_at", { ascending: false });

    if (tenantId)   query = query.eq("tenant_id", tenantId);
    if (status)     query = query.eq("status", status);
    if (militar_id) query = query.eq("militar_id", militar_id);

    const { data, error } = await query;
    if (error) return c.json({ error: error.message }, 500);
    return c.json({ cautelamentos: data ?? [] });
  }
);

// GET /api/cautelamentos/ativos — cautelas ativas do próprio usuário
cautelamentosRoutes.get(
  "/ativos",
  roleGuard("usuario", "armeiro", "admin_reserva"),
  async (c) => {
    const userId   = c.get("userId")!;
    const tenantId = c.get("tenantId");

    let query = supabase
      .from("cautelamentos")
      .select(`
        *,
        item:material_items!cautelamentos_item_id_fkey(id, numero_serie, status_operacional, material_type:material_types(nome, categoria)),
        armeiro:profiles!cautelamentos_armeiro_id_fkey(nome_completo, matricula)
      `)
      .eq("militar_id", userId)
      .eq("status", "ativa");

    if (tenantId) query = query.eq("tenant_id", tenantId);
    const { data, error } = await query;
    if (error) return c.json({ error: error.message }, 500);
    return c.json({ cautelamentos: data ?? [] });
  }
);

// GET /api/cautelamentos/history/item/:material_id
cautelamentosRoutes.get(
  "/history/item/:material_id",
  roleGuard("armeiro", "admin_reserva", "admin_global", "auditor"),
  async (c) => {
    const materialId = c.req.param("material_id");
    const tenantId   = c.get("tenantId");

    let query = supabase
      .from("cautelamentos")
      .select(`*, militar:profiles!cautelamentos_militar_id_fkey(nome_completo, matricula, posto)`)
      .eq("item_id", materialId)
      .order("data_emissao", { ascending: false });

    if (tenantId) query = query.eq("tenant_id", tenantId);
    const { data, error } = await query;
    if (error) return c.json({ error: error.message }, 500);
    return c.json({ history: data ?? [] });
  }
);

// GET /api/cautelamentos/history/militar/:user_id
cautelamentosRoutes.get(
  "/history/militar/:user_id",
  roleGuard("armeiro", "admin_reserva", "admin_global"),
  async (c) => {
    const userId   = c.req.param("user_id");
    const tenantId = c.get("tenantId");

    let query = supabase
      .from("cautelamentos")
      .select(`*, item:material_items!cautelamentos_item_id_fkey(numero_serie, material_type:material_types(nome, categoria))`)
      .eq("militar_id", userId)
      .order("data_emissao", { ascending: false });

    if (tenantId) query = query.eq("tenant_id", tenantId);
    const { data, error } = await query;
    if (error) return c.json({ error: error.message }, 500);
    return c.json({ history: data ?? [] });
  }
);

// POST /api/cautelamentos — emitir Termo de Cautela
cautelamentosRoutes.post(
  "/",
  roleGuard("armeiro", "admin_reserva", "admin_global"),
  zValidator("json", createSchema),
  async (c) => {
    const body      = c.req.valid("json");
    const tenantId  = c.get("tenantId");
    const armeiroId = c.get("userId")!;
    const role      = c.get("role");
    if (!tenantId) return c.json({ error: "Tenant não identificado na sessão" }, 400);

    // Armeiro deve ter turno ativo para registrar movimentações — extraído
    // pra lib/shift-guard.ts (ver comentário lá: regra canônica de produto,
    // agora aplicada consistentemente em todo endpoint de mutação de
    // cautelamento, não só na criação).
    const shiftCheck = await requireActiveShift(role, armeiroId);
    if (!shiftCheck.ok) return c.json(shiftCheck.body, 403);

    const { data: item, error: itemErr } = await supabase
      .from("material_items")
      .select("id, status_operacional, tenant_id, validade_item, cautela_elegivel, material_type:material_types(nome, cautela_habilitada)")
      .eq("id", body.item_id)
      .single();

    if (itemErr || !item) return c.json({ error: "Item não encontrado" }, 404);
    if (tenantId && item.tenant_id !== tenantId) return c.json({ error: "Item não encontrado" }, 404);
    if (item.status_operacional !== "disponivel") {
      return c.json({ error: `Item não disponível: ${item.status_operacional}` }, 409);
    }

    // CAU-06 — fronteira de segurança real desta feature: sem isto, o
    // checkbox "Disponibilizar para cautela" seria só decoração de UI (o
    // backend continuaria aceitando qualquer item_id disponível, mesmo
    // manipulando o payload diretamente, fora do autocomplete filtrado por
    // CAU-07). Mesmo raciocínio de "nunca confiar só no frontend" já
    // aplicado em toda fronteira de permissão deste repositório. Dois
    // gates independentes desde a elegibilidade por item (achado do
    // usuário: gestão às vezes quer disponibilizar só alguns itens
    // específicos do acervo, não todos): o TIPO precisa estar habilitado
    // E o ITEM específico precisa estar marcado como elegível.
    const materialType = Array.isArray(item.material_type) ? item.material_type[0] : item.material_type;
    if (!materialType?.cautela_habilitada) {
      return c.json({ error: "Este material não está habilitado para cautela." }, 409);
    }
    if (!item.cautela_elegivel) {
      return c.json({ error: "Este item específico não está disponível para cautela." }, 409);
    }
    // validade_item só gerava alerta visual até aqui — sem este bloqueio, um
    // colete/item com validade vencida podia ser cautelado normalmente.
    // Comparação por data local (não UTC): validade_item é DATE puro, e
    // `new Date(string) < new Date()` compara contra meia-noite UTC — no
    // horário de Brasília (UTC-3) isso bloquearia o item ~3h antes do fim
    // real do seu último dia válido. Comparar string yyyy-mm-dd evita isso.
    const hojeLocal = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    if (item.validade_item && item.validade_item < hojeLocal) {
      return c.json({ error: `Item com validade vencida em ${item.validade_item} — regularize antes de cautelar` }, 409);
    }

    const { data: militarProfile } = await supabase
      .from("profiles")
      .select("id, nome_completo, matricula, posto")
      .eq("id", body.militar_id)
      .eq("default_tenant_id", tenantId)
      .single();
    if (!militarProfile) return c.json({ error: "Militar não encontrado" }, 404);

    const { data: reserve } = await supabase
      .from("reserves")
      .select("id")
      .eq("id", body.reserve_id)
      .eq("tenant_id", tenantId)
      .single();
    if (!reserve) return c.json({ error: "Reserva não encontrada" }, 404);

    const docHash = makeDocHash({
      item_id: body.item_id, militar_id: body.militar_id, armeiro_id: armeiroId,
      motivo_emissao: body.motivo_emissao, data_emissao: new Date().toISOString(),
    });

    const { data: cautela, error: cErr } = await supabase
      .from("cautelamentos")
      .insert({
        tenant_id:                 tenantId,
        reserve_id:                body.reserve_id,
        item_id:                   body.item_id,
        militar_id:                body.militar_id,
        armeiro_id:                armeiroId,
        motivo_emissao:            body.motivo_emissao,
        condicao_emissao:          body.condicao_emissao,
        prazo_proxima_conferencia: body.prazo_proxima_conferencia ?? null,
        document_hash:             docHash,
      })
      .select()
      .single();

    if (cErr || !cautela) return c.json({ error: cErr?.message ?? "Erro ao criar cautela" }, 500);

    const { data: reservedItem, error: miErr } = await supabase
      .from("material_items")
      .update({
        status_operacional:     "cautelado",
        current_holder_user_id: body.militar_id,
        active_cautelamento_id: cautela.id,
        last_movement_at:       new Date().toISOString(),
      })
      .eq("id", body.item_id)
      .eq("tenant_id", tenantId)
      .eq("status_operacional", "disponivel")
      .select("id")
      .single();

    if (miErr || !reservedItem) {
      await supabase.from("cautelamentos").delete().eq("id", cautela.id).eq("tenant_id", tenantId);
      return c.json({ error: "Item não está mais disponível" }, 409);
    }

    auditLog(c, {
      action: "cautelamento.created", resource_type: "cautelamento", resource_id: cautela.id,
      after_snapshot: { item_id: body.item_id, militar_id: body.militar_id },
    });

    // Livro Digital: registro automático — nome do material + militar em vez de UUIDs.
    // Reaproveita `materialType`, já normalizado logo acima para o gate CAU-06 (DRY).
    const cautelaMilitarLabel = [militarProfile.posto, militarProfile.nome_completo].filter(Boolean).join(" ");
    await logShiftEvent({
      actorId: armeiroId, tenantId: tenantId!,
      eventType: "cautela_emitida",
      description: `Cautela emitida — ${materialType?.nome ?? "material"} para ${cautelaMilitarLabel} (mat. ${militarProfile.matricula}) — motivo: ${body.motivo_emissao}`,
      subjectId: cautela.id, subjectType: "cautelamento",
      metadata: { item_id: body.item_id, militar_id: body.militar_id, motivo: body.motivo_emissao },
    }).catch(() => {});

    return c.json({ cautelamento: cautela }, 201);
  }
);

// POST /api/cautelamentos/batch — cautela com múltiplos materiais numa
// única operação, agrupados por movement_id. Delega a criação inteira pra
// record_cautelamento_batch (RPC transacional, ver migration
// 20260821000001) — nunca confiar que o frontend só ofereceu itens
// elegíveis/disponíveis, a RPC revalida tudo dentro da mesma transação do
// insert. Mesmo padrão de POST /api/lendings/batch (record_lending_batch):
// erros da RPC (código P0001) viram a mensagem exata da exception, sem
// tradução — rota nova, sem teste legado que dependa de outro texto.
cautelamentosRoutes.post(
  "/batch",
  roleGuard("armeiro", "admin_reserva", "admin_global"),
  zValidator("json", createBatchSchema),
  async (c) => {
    const body      = c.req.valid("json");
    const tenantId  = c.get("tenantId");
    const armeiroId = c.get("userId")!;
    const role      = c.get("role");
    if (!tenantId) return c.json({ error: "Tenant não identificado na sessão" }, 400);

    const shiftCheck = await requireActiveShift(role, armeiroId);
    if (!shiftCheck.ok) return c.json(shiftCheck.body, 403);

    const nowIso = new Date().toISOString();
    const itemsPayload = body.items.map((item) => ({
      item_id: item.item_id,
      condicao_emissao: item.condicao_emissao,
      prazo_proxima_conferencia: item.prazo_proxima_conferencia ?? null,
      // document_hash calculado aqui (TypeScript, hashDocument()) — nunca
      // recalculado em SQL, pra não divergir do algoritmo canônico usado
      // pelo fluxo singular e por toda verificação de integridade documental.
      document_hash: makeDocHash({
        item_id: item.item_id, militar_id: body.militar_id, armeiro_id: armeiroId,
        motivo_emissao: body.motivo_emissao, movement_id: body.movement_id,
        data_emissao: nowIso,
      }),
    }));

    const { data, error } = await supabase.rpc("record_cautelamento_batch", {
      p_tenant_id: tenantId,
      p_armeiro_id: armeiroId,
      p_militar_id: body.militar_id,
      p_reserve_id: body.reserve_id,
      p_movement_id: body.movement_id,
      p_motivo_emissao: body.motivo_emissao,
      p_items: itemsPayload,
    });

    if (error?.code === "P0001") {
      return c.json({ error: translateBatchError(error.message, "Lote de cautela rejeitado") }, 409);
    }
    if (error || !data) {
      c.get("log").error({ code: error?.code, tenantId, armeiroId }, "cautelamento.batch_create.persist_failure");
      return c.json({ error: error?.message ?? "Erro ao criar cautelas em lote" }, 500);
    }

    const rows = data as { cautelamento_id: string; item_id: string }[];

    const { data: militarProfile } = await supabase
      .from("profiles").select("nome_completo, matricula, posto")
      .eq("id", body.militar_id).maybeSingle();

    auditLog(c, {
      action: "cautelamento.batch_created", resource_type: "cautelamento", resource_id: body.movement_id,
      after_snapshot: { movement_id: body.movement_id, militar_id: body.militar_id, count: rows.length },
    });

    const militarLabel = militarProfile
      ? [militarProfile.posto, militarProfile.nome_completo].filter(Boolean).join(" ")
      : "";
    await logShiftEvent({
      actorId: armeiroId, tenantId,
      eventType: "cautela_emitida",
      description: `Cautela em lote emitida — ${rows.length} ite${rows.length === 1 ? "m" : "ns"} para ${militarLabel} (mat. ${militarProfile?.matricula ?? "?"}) — motivo: ${body.motivo_emissao}`,
      subjectId: body.movement_id, subjectType: "cautelamento_batch",
      metadata: { movement_id: body.movement_id, militar_id: body.militar_id, items: rows },
    }).catch(() => {});

    return c.json({ cautelamentos: rows }, 201);
  }
);

// POST /api/cautelamentos/:id/sign-armeiro
cautelamentosRoutes.post(
  "/:id/sign-armeiro",
  roleGuard("armeiro", "admin_reserva", "admin_global"),
  zValidator("json", signBodySchema),
  async (c) => {
    const id        = c.req.param("id");
    const body      = c.req.valid("json");
    const tenantId  = c.get("tenantId");
    const armeiroId = c.get("userId")!;
    const role      = c.get("role");
    if (!tenantId) return c.json({ error: "Tenant não identificado na sessão" }, 400);

    // Regra canônica: nenhuma movimentação de cautela com turno fechado —
    // achado real de produto (armeiro conseguia assinar/receber devolução
    // sem turno aberto, gate existia só em POST / de criação).
    const shiftCheck = await requireActiveShift(role, armeiroId);
    if (!shiftCheck.ok) return c.json(shiftCheck.body, 403);

    const { data: cautela } = await supabase
      .from("cautelamentos")
      .select("id, status, document_hash, armeiro_signature_id, tenant_id")
      .eq("id", id)
      .single();

    if (!cautela) return c.json({ error: "Cautela não encontrada" }, 404);
    if (tenantId && cautela.tenant_id !== tenantId) return c.json({ error: "Cautela não encontrada" }, 404);
    if (cautela.status !== "ativa") return c.json({ error: "Cautela não está ativa" }, 422);
    if (cautela.armeiro_signature_id) return c.json({ error: "Armeiro já assinou" }, 422);

    let authVerified = false;
    let authMethod: "totp" | "biometric" = "totp";

    if (body.use_biometric) {
      const bioResult = await validateBiometric(armeiroId);
      if (!bioResult.ok) return c.json({ error: bioResult.error }, (bioResult.status ?? 400) as 400 | 401 | 404 | 503);
      authVerified = true;
      authMethod = "biometric";
    } else {
      const totpResult = await validateTotp(armeiroId, body.totp_token!);
      if (!totpResult.ok) return c.json({ error: totpResult.error }, (totpResult.status ?? 400) as 400 | 404 | 429);
      authVerified = true;
    }

    if (!authVerified) return c.json({ error: "Falha na verificação" }, 400);

    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "127.0.0.1";
    const { data: sig } = await supabase
      .from("document_signatures")
      .insert({
        tenant_id: tenantId, document_id: cautela.id, document_type: "handover",
        signer_id: armeiroId, signer_role: "armeiro", signed_at: new Date().toISOString(),
        document_hash: cautela.document_hash,
        signature_proof: `${cautela.document_hash}:${armeiroId}:armeiro`,
        ip,
        totp_verified: authMethod === "totp",
        biometric_verified: authMethod === "biometric",
      })
      .select("id")
      .single();

    if (!sig) return c.json({ error: "Erro ao criar assinatura" }, 500);

    const { data: signedCautela, error: cautelaUpdateErr } = await supabase
      .from("cautelamentos")
      .update({ armeiro_signature_id: sig.id })
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .eq("status", "ativa")
      .is("armeiro_signature_id", null)
      .select("id")
      .single();
    if (cautelaUpdateErr || !signedCautela) {
      await supabase.from("document_signatures").delete().eq("id", sig.id).eq("tenant_id", tenantId);
      return c.json({ error: "Cautela não encontrada ou já alterada" }, 409);
    }
    auditLog(c, { action: "signature.created", resource_type: "cautelamento", resource_id: id,
      metadata: { signer_role: "armeiro", auth_method: authMethod } });

    return c.json({ ok: true, signature_id: sig.id, auth_method: authMethod });
  }
);

// POST /api/cautelamentos/:id/sign-militar
cautelamentosRoutes.post(
  "/:id/sign-militar",
  roleGuard("usuario", "armeiro", "admin_reserva", "admin_global"),
  zValidator("json", signBodySchema),
  async (c) => {
    const id       = c.req.param("id");
    const body     = c.req.valid("json");
    const tenantId = c.get("tenantId");
    const callerId = c.get("userId")!;
    const role     = c.get("role");
    if (!tenantId) return c.json({ error: "Tenant não identificado na sessão" }, 400);

    // Gate de turno é sobre quem está OPERANDO agora (o chamador) — se for
    // staff facilitando, é o turno do armeiro que precisa estar aberto, não
    // o do militar (que pode nem ter conceito de turno).
    const shiftCheck = await requireActiveShift(role, callerId);
    if (!shiftCheck.ok) return c.json(shiftCheck.body, 403);

    const { data: cautela } = await supabase
      .from("cautelamentos")
      .select("id, status, militar_id, document_hash, armeiro_signature_id, militar_signature_id, tenant_id")
      .eq("id", id)
      .single();

    if (!cautela) return c.json({ error: "Cautela não encontrada" }, 404);
    if (tenantId && cautela.tenant_id !== tenantId) return c.json({ error: "Cautela não encontrada" }, 404);

    // A prova de identidade (TOTP/biometria) e o signer_id gravado são
    // sempre da pessoa dona da cautela — nunca de quem está logado quando é
    // staff facilitando (ver comentário de resolveSigningIdentity acima).
    const identity = resolveSigningIdentity(cautela, callerId, role);
    if ("error" in identity) return c.json({ error: identity.error }, identity.status);
    const militarId = identity.targetId;

    if (cautela.status !== "ativa") return c.json({ error: "Cautela não está ativa" }, 422);
    if (!cautela.armeiro_signature_id) return c.json({ error: "Armeiro ainda não assinou" }, 422);
    if (cautela.militar_signature_id) return c.json({ error: "Militar já assinou" }, 422);

    let authMethod: "totp" | "biometric" = "totp";

    if (body.use_biometric) {
      // Biometria: captura o dedo do militar no leitor e valida identidade
      const bioResult = await validateBiometric(militarId);
      if (!bioResult.ok) return c.json({ error: bioResult.error }, (bioResult.status ?? 400) as 400 | 401 | 404 | 503);
      authMethod = "biometric";
    } else {
      const totpResult = await validateTotp(militarId, body.totp_token!);
      if (!totpResult.ok) return c.json({ error: totpResult.error }, (totpResult.status ?? 400) as 400 | 404 | 429);
    }

    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "127.0.0.1";
    const { data: sig } = await supabase
      .from("document_signatures")
      .insert({
        tenant_id: tenantId, document_id: cautela.id, document_type: "handover",
        signer_id: militarId, signer_role: "militar", signed_at: new Date().toISOString(),
        document_hash: cautela.document_hash,
        signature_proof: `${cautela.document_hash}:${militarId}:militar`,
        ip,
        totp_verified: authMethod === "totp",
        biometric_verified: authMethod === "biometric",
      })
      .select("id")
      .single();

    if (!sig) return c.json({ error: "Erro ao criar assinatura" }, 500);

    const { data: signedCautela, error: cautelaUpdateErr } = await supabase
      .from("cautelamentos")
      .update({ militar_signature_id: sig.id })
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .eq("militar_id", militarId)
      .eq("status", "ativa")
      .not("armeiro_signature_id", "is", null)
      .is("militar_signature_id", null)
      .select("id")
      .single();
    if (cautelaUpdateErr || !signedCautela) {
      await supabase.from("document_signatures").delete().eq("id", sig.id).eq("tenant_id", tenantId);
      return c.json({ error: "Cautela não encontrada ou já alterada" }, 409);
    }
    auditLog(c, { action: "signature.created", resource_type: "cautelamento", resource_id: id,
      metadata: {
        signer_role: "militar", auth_method: authMethod,
        // Rastreabilidade: quando staff facilita, quem operou o dispositivo
        // (auditLog já registra o ator via sessão) é diferente de quem a
        // assinatura pertence (signer_id acima) — deixa isso explícito.
        facilitated_by_staff: callerId !== militarId,
      } });

    return c.json({ ok: true, signature_id: sig.id, auth_method: authMethod });
  }
);

// POST /api/cautelamentos/batch/:movementId/sign-armeiro — assinatura em
// lote: 1 verificação de TOTP/biometria do armeiro cobre todas as N
// cautelas do movement_id, mas grava N document_signatures independentes
// via sign_cautelamento_batch (migration 20260821000002). Armeiro sempre
// assina como si mesmo — sem conceito de facilitação aqui (só a
// assinatura do militar pode ser facilitada, ver resolveSigningIdentity).
cautelamentosRoutes.post(
  "/batch/:movementId/sign-armeiro",
  roleGuard("armeiro", "admin_reserva", "admin_global"),
  zValidator("json", signBodySchema),
  async (c) => {
    const movementId = c.req.param("movementId");
    const body        = c.req.valid("json");
    const tenantId    = c.get("tenantId");
    const armeiroId   = c.get("userId")!;
    const role        = c.get("role");
    if (!tenantId) return c.json({ error: "Tenant não identificado na sessão" }, 400);

    const shiftCheck = await requireActiveShift(role, armeiroId);
    if (!shiftCheck.ok) return c.json(shiftCheck.body, 403);

    // Achado de code review: sem isto, clicar "assinar" num lote já
    // totalmente resolvido (encerrado/já assinado) ainda consumia um
    // código TOTP fresco antes de descobrir, via a RPC, que tudo seria
    // pulado — gasto à toa de um código que só pode ser usado 1x a cada
    // ~30s. Mesmo padrão de early-exit do fluxo singular (linhas de
    // sign-armeiro acima, que checam status/assinatura antes de validar).
    const { count: assinavelCount } = await supabase
      .from("cautelamentos")
      .select("id", { count: "exact", head: true })
      .eq("movement_id", movementId).eq("tenant_id", tenantId)
      .eq("status", "ativa").is("armeiro_signature_id", null);
    if (!assinavelCount) return c.json({ error: "Nenhuma cautela deste lote está pendente de assinatura do armeiro" }, 422);

    let authMethod: "totp" | "biometric" = "totp";
    if (body.use_biometric) {
      const bioResult = await validateBiometric(armeiroId);
      if (!bioResult.ok) return c.json({ error: bioResult.error }, (bioResult.status ?? 400) as 400 | 401 | 404 | 503);
      authMethod = "biometric";
    } else {
      const totpResult = await validateTotp(armeiroId, body.totp_token!);
      if (!totpResult.ok) return c.json({ error: totpResult.error }, (totpResult.status ?? 400) as 400 | 404 | 429);
    }

    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "127.0.0.1";
    const { data, error } = await supabase.rpc("sign_cautelamento_batch", {
      p_tenant_id: tenantId,
      p_movement_id: movementId,
      p_signer_role: "armeiro",
      p_signer_id: armeiroId,
      p_auth_method: authMethod,
      p_ip: ip,
    });

    if (error?.code === "P0001") return c.json({ error: translateBatchError(error.message, "Lote rejeitado") }, 409);
    if (error || !data) return c.json({ error: error?.message ?? "Erro ao assinar lote" }, 500);

    auditLog(c, { action: "signature.batch_created", resource_type: "cautelamento", resource_id: movementId,
      metadata: { signer_role: "armeiro", auth_method: authMethod, results: data } });

    return c.json({ ok: true, results: data, auth_method: authMethod });
  }
);

// POST /api/cautelamentos/batch/:movementId/sign-militar — mesma lógica de
// facilitação de resolveSigningIdentity (não reimplementada — reusada
// diretamente): self-sign exige callerId===militar_id; staff facilitando
// sempre valida contra o militar dono do lote.
cautelamentosRoutes.post(
  "/batch/:movementId/sign-militar",
  roleGuard("usuario", "armeiro", "admin_reserva", "admin_global"),
  zValidator("json", signBodySchema),
  async (c) => {
    const movementId = c.req.param("movementId");
    const body      = c.req.valid("json");
    const tenantId  = c.get("tenantId");
    const callerId  = c.get("userId")!;
    const role      = c.get("role");
    if (!tenantId) return c.json({ error: "Tenant não identificado na sessão" }, 400);

    const shiftCheck = await requireActiveShift(role, callerId);
    if (!shiftCheck.ok) return c.json(shiftCheck.body, 403);

    // Todas as cautelas do mesmo movement_id compartilham o mesmo
    // militar_id por construção (validado por record_cautelamento_batch) —
    // basta uma linha qualquer pra resolver a identidade do lote inteiro.
    const { data: anyCautela } = await supabase
      .from("cautelamentos")
      .select("militar_id")
      .eq("movement_id", movementId)
      .eq("tenant_id", tenantId)
      .limit(1)
      .maybeSingle();
    if (!anyCautela) return c.json({ error: "Lote não encontrado" }, 404);

    const identity = resolveSigningIdentity(anyCautela, callerId, role);
    if ("error" in identity) return c.json({ error: identity.error }, identity.status);
    const militarId = identity.targetId;

    // Mesmo early-exit do sign-armeiro em lote acima — evita gastar um
    // código TOTP/captura biométrica à toa num lote já resolvido.
    const { count: assinavelCount } = await supabase
      .from("cautelamentos")
      .select("id", { count: "exact", head: true })
      .eq("movement_id", movementId).eq("tenant_id", tenantId)
      .eq("status", "ativa").not("armeiro_signature_id", "is", null).is("militar_signature_id", null);
    if (!assinavelCount) return c.json({ error: "Nenhuma cautela deste lote está pendente de assinatura do militar" }, 422);

    let authMethod: "totp" | "biometric" = "totp";
    if (body.use_biometric) {
      const bioResult = await validateBiometric(militarId);
      if (!bioResult.ok) return c.json({ error: bioResult.error }, (bioResult.status ?? 400) as 400 | 401 | 404 | 503);
      authMethod = "biometric";
    } else {
      const totpResult = await validateTotp(militarId, body.totp_token!);
      if (!totpResult.ok) return c.json({ error: totpResult.error }, (totpResult.status ?? 400) as 400 | 404 | 429);
    }

    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "127.0.0.1";
    const { data, error } = await supabase.rpc("sign_cautelamento_batch", {
      p_tenant_id: tenantId,
      p_movement_id: movementId,
      p_signer_role: "militar",
      p_signer_id: militarId,
      p_auth_method: authMethod,
      p_ip: ip,
    });

    if (error?.code === "P0001") return c.json({ error: translateBatchError(error.message, "Lote rejeitado") }, 409);
    if (error || !data) return c.json({ error: error?.message ?? "Erro ao assinar lote" }, 500);

    auditLog(c, { action: "signature.batch_created", resource_type: "cautelamento", resource_id: movementId,
      metadata: {
        signer_role: "militar", auth_method: authMethod, results: data,
        facilitated_by_staff: callerId !== militarId,
      } });

    return c.json({ ok: true, results: data, auth_method: authMethod });
  }
);

// POST /api/cautelamentos/:id/return
cautelamentosRoutes.post(
  "/:id/return",
  roleGuard("armeiro", "admin_reserva", "admin_global"),
  zValidator("json", returnSchema),
  async (c) => {
    const id   = c.req.param("id");
    const body = c.req.valid("json");
    const tenantId  = c.get("tenantId");
    const armeiroId = c.get("userId");
    const role       = c.get("role");
    if (!tenantId) return c.json({ error: "Tenant não identificado na sessão" }, 400);

    // Achado real de produto: era possível receber/encerrar uma cautela
    // (devolução) mesmo com o turno do armeiro fechado — o gate de turno
    // só existia na criação (POST /), não aqui. Regra canônica: nenhuma
    // movimentação com livro fechado.
    const shiftCheck = await requireActiveShift(role, armeiroId);
    if (!shiftCheck.ok) return c.json(shiftCheck.body, 403);

    const { data: cautela } = await supabase
      .from("cautelamentos")
      .select(`
        id, status, item_id, tenant_id,
        item:material_items!cautelamentos_item_id_fkey(material_type:material_types(nome)),
        militar:profiles!cautelamentos_militar_id_fkey(nome_completo, matricula, posto)
      `)
      .eq("id", id)
      .single();

    if (!cautela) return c.json({ error: "Cautela não encontrada" }, 404);
    if (tenantId && cautela.tenant_id !== tenantId) return c.json({ error: "Cautela não encontrada" }, 404);
    if (cautela.status !== "ativa") return c.json({ error: "Apenas cautelas ativas podem ser encerradas" }, 422);

    const { data: returnedCautela, error: returnErr } = await supabase.from("cautelamentos").update({
      status: "devolvida", condicao_devolucao: body.condicao_devolucao,
      motivo_devolucao: body.motivo_devolucao ?? null, data_devolucao: new Date().toISOString(),
    })
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .eq("status", "ativa")
      .select("id")
      .single();
    if (returnErr || !returnedCautela) {
      return c.json({ error: "Cautela não encontrada ou já alterada" }, 409);
    }

    const novoStatus = body.condicao_devolucao === "inapto" ? "inapto" : "disponivel";
    const { error: itemErr } = await supabase.from("material_items").update({
      status_operacional: novoStatus, current_holder_user_id: null,
      active_cautelamento_id: null, last_movement_at: new Date().toISOString(),
    })
      .eq("id", cautela.item_id)
      .eq("tenant_id", tenantId)
      .eq("active_cautelamento_id", id)
      .select("id")
      .single();
    if (itemErr) {
      await supabase
        .from("cautelamentos")
        .update({
          status: "ativa",
          condicao_devolucao: null,
          motivo_devolucao: null,
          data_devolucao: null,
        })
        .eq("id", id)
        .eq("tenant_id", tenantId)
        .eq("status", "devolvida");
      return c.json({ error: "Item da cautela não pôde ser liberado" }, 409);
    }

    auditLog(c, {
      action: "cautelamento.returned", resource_type: "cautelamento", resource_id: id,
      after_snapshot: { condicao: body.condicao_devolucao, novo_status_item: novoStatus },
    });

    // Livro Digital: registro automático — nome do material + militar em vez de UUIDs.
    const returnedCautelaItem = Array.isArray(cautela.item) ? cautela.item[0] : cautela.item;
    const returnedCautelaMaterialType = returnedCautelaItem ? (Array.isArray(returnedCautelaItem.material_type) ? returnedCautelaItem.material_type[0] : returnedCautelaItem.material_type) : null;
    const returnedCautelaMilitar = Array.isArray(cautela.militar) ? cautela.militar[0] : cautela.militar;
    const returnedCautelaMilitarLabel = returnedCautelaMilitar ? [returnedCautelaMilitar.posto, returnedCautelaMilitar.nome_completo].filter(Boolean).join(" ") : null;
    await logShiftEvent({
      actorId: c.get("userId")!, tenantId: tenantId!,
      eventType: "cautela_devolvida",
      description: `Cautela devolvida${returnedCautelaMaterialType?.nome ? ` — ${returnedCautelaMaterialType.nome}` : ""}${returnedCautelaMilitarLabel ? ` de ${returnedCautelaMilitarLabel}` : ""} — condição: ${body.condicao_devolucao}`,
      subjectId: id, subjectType: "cautelamento",
      metadata: { condicao: body.condicao_devolucao, novo_status: novoStatus },
    }).catch(() => {});

    return c.json({ ok: true });
  }
);

// POST /api/cautelamentos/:id/substitute
cautelamentosRoutes.post(
  "/:id/substitute",
  roleGuard("armeiro", "admin_reserva", "admin_global"),
  zValidator("json", substituteSchema),
  async (c) => {
    const id   = c.req.param("id");
    const body = c.req.valid("json");
    const tenantId  = c.get("tenantId");
    const armeiroId = c.get("userId")!;
    const role      = c.get("role");
    if (!tenantId) return c.json({ error: "Tenant não identificado na sessão" }, 400);

    const shiftCheck = await requireActiveShift(role, armeiroId);
    if (!shiftCheck.ok) return c.json(shiftCheck.body, 403);

    const { data: antiga } = await supabase
      .from("cautelamentos")
      .select(`
        id, status, item_id, militar_id, reserve_id, tenant_id,
        item:material_items!cautelamentos_item_id_fkey(material_type:material_types(nome))
      `)
      .eq("id", id)
      .single();

    if (!antiga) return c.json({ error: "Cautela não encontrada" }, 404);
    if (tenantId && antiga.tenant_id !== tenantId) return c.json({ error: "Cautela não encontrada" }, 404);
    if (antiga.status !== "ativa") return c.json({ error: "Apenas cautelas ativas podem ser substituídas" }, 422);

    const { data: novoItem } = await supabase
      .from("material_items")
      .select("id, status_operacional, tenant_id, material_type:material_types(nome)")
      .eq("id", body.novo_item_id)
      .single();

    if (!novoItem) return c.json({ error: "Novo item não encontrado" }, 404);
    if (tenantId && novoItem.tenant_id !== tenantId) return c.json({ error: "Novo item não encontrado" }, 404);
    if (novoItem.status_operacional !== "disponivel") {
      return c.json({ error: `Novo item não disponível: ${novoItem.status_operacional}` }, 409);
    }

    const docHash = makeDocHash({
      item_id: body.novo_item_id, militar_id: antiga.militar_id, armeiro_id: armeiroId,
      motivo_emissao: body.motivo_emissao, data_emissao: new Date().toISOString(),
    });

    const { data: nova } = await supabase
      .from("cautelamentos")
      .insert({
        tenant_id: tenantId, reserve_id: antiga.reserve_id, item_id: body.novo_item_id,
        militar_id: antiga.militar_id, armeiro_id: armeiroId, motivo_emissao: body.motivo_emissao,
        condicao_emissao: body.condicao_emissao, document_hash: docHash, substitui: id,
      })
      .select("id")
      .single();

    if (!nova) return c.json({ error: "Erro ao criar nova cautela" }, 500);

    const { data: substitutedCautela, error: substituteErr } = await supabase.from("cautelamentos").update({
      status: "substituida", condicao_devolucao: body.condicao_devolucao,
      data_substituicao: new Date().toISOString(), substituido_por: nova.id,
    })
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .eq("status", "ativa")
      .select("id")
      .single();
    if (substituteErr || !substitutedCautela) {
      await supabase.from("cautelamentos").delete().eq("id", nova.id).eq("tenant_id", tenantId);
      return c.json({ error: "Cautela não encontrada ou já alterada" }, 409);
    }

    const statusAntigo = body.condicao_devolucao === "inapto" ? "inapto" : "disponivel";
    const { error: oldItemErr } = await supabase.from("material_items").update({
      status_operacional: statusAntigo, current_holder_user_id: null,
      active_cautelamento_id: null, last_movement_at: new Date().toISOString(),
    })
      .eq("id", antiga.item_id)
      .eq("tenant_id", tenantId)
      .eq("active_cautelamento_id", id)
      .select("id")
      .single();
    if (oldItemErr) {
      await supabase.from("cautelamentos").delete().eq("id", nova.id).eq("tenant_id", tenantId);
      await supabase
        .from("cautelamentos")
        .update({ status: "ativa", substituido_por: null })
        .eq("id", id)
        .eq("tenant_id", tenantId);
      return c.json({ error: "Item antigo não pôde ser liberado" }, 409);
    }

    const { error: miErr } = await supabase.from("material_items").update({
      status_operacional: "cautelado", current_holder_user_id: antiga.militar_id,
      active_cautelamento_id: nova.id, last_movement_at: new Date().toISOString(),
    })
      .eq("id", body.novo_item_id)
      .eq("tenant_id", tenantId)
      .eq("status_operacional", "disponivel")
      .select("id")
      .single();

    if (miErr) {
      await supabase.from("cautelamentos").delete().eq("id", nova.id).eq("tenant_id", tenantId);
      await supabase
        .from("cautelamentos")
        .update({ status: "ativa", substituido_por: null })
        .eq("id", id)
        .eq("tenant_id", tenantId);
      await supabase
        .from("material_items")
        .update({
          status_operacional: "cautelado",
          current_holder_user_id: antiga.militar_id,
          active_cautelamento_id: id,
        })
        .eq("id", antiga.item_id)
        .eq("tenant_id", tenantId);
      return c.json({ error: "Novo item não pôde ser cautelado" }, 409);
    }

    auditLog(c, {
      action: "cautelamento.substituted", resource_type: "cautelamento", resource_id: nova.id,
      metadata: { item_antigo: antiga.item_id, item_novo: body.novo_item_id, cautela_antiga: id },
    });

    const antigaItem = Array.isArray(antiga.item) ? antiga.item[0] : antiga.item;
    const antigaMaterialType = antigaItem ? (Array.isArray(antigaItem.material_type) ? antigaItem.material_type[0] : antigaItem.material_type) : null;
    const novoMaterialType = Array.isArray(novoItem.material_type) ? novoItem.material_type[0] : novoItem.material_type;
    await logShiftEvent({
      actorId: armeiroId, tenantId: tenantId!,
      eventType: "cautela_emitida",
      description: `Cautela substituída — ${antigaMaterialType?.nome ?? "material anterior"} trocado por ${novoMaterialType?.nome ?? "novo material"}`,
      subjectId: nova.id, subjectType: "cautelamento",
      metadata: { item_antigo: antiga.item_id, item_novo: body.novo_item_id, cautela_antiga: id },
    }).catch(() => {});

    return c.json({ ok: true, nova_cautela_id: nova.id });
  }
);

// GET /api/cautelamentos/:id/pdf
cautelamentosRoutes.get(
  "/:id/pdf",
  roleGuard("armeiro", "admin_reserva", "admin_global", "usuario"),
  async (c) => {
    const id       = c.req.param("id");
    const tenantId = c.get("tenantId");
    const role     = c.get("role");
    const userId   = c.get("userId");

    const { data: cautela } = await supabase
      .from("cautelamentos")
      .select(`
        *,
        item:material_items!cautelamentos_item_id_fkey(id, numero_serie, material_type:material_types(nome, categoria), validade_item, condicao),
        militar:profiles!cautelamentos_militar_id_fkey(nome_completo, matricula, posto),
        armeiro:profiles!cautelamentos_armeiro_id_fkey(nome_completo, matricula),
        reserve:reserves(nome, acronym)
      `)
      .eq("id", id)
      .single();

    if (!cautela) return c.json({ error: "Cautela não encontrada" }, 404);
    const r = cautela as Record<string, unknown>;
    if (tenantId && r.tenant_id !== tenantId) return c.json({ error: "Cautela não encontrada" }, 404);
    if (role === "usuario" && r.militar_id !== userId) return c.json({ error: "Cautela não encontrada" }, 404);

    // Termo de cautela é documento oficial — só é válido com ambas as
    // assinaturas. Sem esse guard, o PDF (que já estampa "ASSINATURAS" com
    // linhas em branco) poderia circular como comprovante antes de ser
    // juridicamente válido.
    if (!r.armeiro_signature_id || !r.militar_signature_id) {
      return c.json({
        error: "Documento indisponível: assinaturas pendentes.",
        pending_armeiro: !r.armeiro_signature_id,
        pending_militar: !r.militar_signature_id,
      }, 422);
    }

    const { generateCautelaPdf } = await import("../lib/pdf/cautela-pdf");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfBytes = await generateCautelaPdf({ ...(cautela as any), tenantId });
    const buf = Buffer.from(pdfBytes);

    return new Response(buf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="cautela-${id.slice(0, 8)}.pdf"`,
      },
    });
  }
);
