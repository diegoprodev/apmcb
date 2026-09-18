import { Hono } from "hono";
import { zValidator } from "../lib/validated-json";
import { z } from "zod";
import { generateSync, verifySync } from "otplib";
import { readSecret } from "./totp";
import { roleGuard } from "../middleware/role-guard";
import { auditLog } from "../middleware/audit";
import { supabase } from "../services/supabase";
import { logger } from "../lib/logger";
import { requireActiveShift } from "../lib/shift-guard";
import { logShiftEvent } from "../lib/shift-events";
import { checkSsaRegistrationGate } from "../lib/ssa-registration-gate";
import { scopedReserveIds } from "../lib/reserve-scope";
import type { HonoVariables } from "../types/hono";

const EXPIRY_HOURS = 6;
const BFF_URL = process.env.BFF_URL ?? `http://localhost:${process.env.PORT ?? 3001}`;
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET ?? "";

export const ssaRoutes = new Hono<{ Variables: HonoVariables }>();

// ── Helper: notify one user + fire push ──────────────────────

async function notifyUser(
  userId: string,
  type: string,
  title: string,
  body: string,
  metadata: Record<string, unknown> = {},
  url = "/efetivo/solicitacoes"
) {
  const { error } = await supabase.from("notifications").insert({
    user_id: userId,
    type,
    title,
    body,
    metadata,
  });
  // Fire-and-forget por design (não bloqueia a resposta HTTP no caller) —
  // mas uma falha de insert NÃO pode ficar muda. Achado real: type
  // "armament_cancelled" não existia em notification_type_enum por meses e
  // toda notificação de cancelamento falhava em silêncio, sem log nenhum.
  if (error) {
    logger.error("ssa.notify_user.insert_failure", { user_id: userId, type, error: error.message });
  }

  if (INTERNAL_SECRET) {
    fetch(`${BFF_URL}/api/push/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": INTERNAL_SECRET,
      },
      body: JSON.stringify({ user_id: userId, title, body, url }),
    }).catch(() => {});
  }
}

// ── Helper: notify armeios of a specific tenant (BUG-RR-02 fix) ──

async function notifyArmeiosOfTenant(
  tenantId: string,
  type: string,
  title: string,
  body: string,
  metadata: Record<string, unknown> = {}
) {
  const { data: armeios } = await supabase
    .from("profiles")
    .select("id")
    .eq("role", "armeiro")
    .eq("default_tenant_id", tenantId)          // BUG-RR-02: isolado por tenant
    .eq("registration_status", "complete");

  if (!armeios) return;

  await Promise.allSettled(
    armeios.map((a) =>
      notifyUser(
        a.id,
        type,
        title,
        body,
        metadata,
        "/reserva/solicitacoes"                  // BUG-RR-05: deep link correto para armeiro
      )
    )
  );
}

// ── GET /api/ssa/available-materials ─────────────────────────
// Returns only materials with stock available — NO quantity numbers exposed.

ssaRoutes.get("/available-materials", async (c) => {
  await supabase.rpc("expire_material_requests");

  const tenantId = c.get("tenantId");
  const userId   = c.get("userId");
  const reserveId = c.req.query("reserve_id");

  if (!tenantId) return c.json({ error: "tenant não identificado" }, 403);

  // BUG-RR-06: verificar se a reserva permite acesso remoto para usuários externos
  let allowedCategories: string[] | null = null;

  if (reserveId) {
    const { data: reserve } = await supabase
      .from("reserves")
      .select("allow_remote_requests, remote_allowed_categories")
      .eq("id", reserveId)
      .eq("tenant_id", tenantId)
      .single();

    if (reserve && !reserve.allow_remote_requests) {
      // Verificar se o usuário é membro da reserva
      const { data: membership } = await supabase
        .from("reserve_memberships")
        .select("reserve_id")
        .eq("user_id", userId)
        .eq("reserve_id", reserveId)
        .maybeSingle();

      if (!membership) {
        return c.json({ error: "Esta reserva não aceita requisições externas." }, 403);
      }
    }

    if (reserve && reserve.remote_allowed_categories?.length > 0) {
      // Verificar se usuário é membro (membros veem todas as categorias)
      const { data: membership } = await supabase
        .from("reserve_memberships")
        .select("reserve_id")
        .eq("user_id", userId)
        .eq("reserve_id", reserveId)
        .maybeSingle();

      if (!membership) {
        allowedCategories = reserve.remote_allowed_categories;
      }
    }
  }

  let query = supabase
    .from("material_availability")
    .select("id, nome, categoria, quantidade_disponivel, ativo")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .gt("quantidade_disponivel", 0)
    .order("categoria")
    .order("nome");

  if (reserveId) {
    query = (query as typeof query).eq("reserve_id", reserveId);
  }

  if (allowedCategories && allowedCategories.length > 0) {
    query = (query as typeof query).in("categoria", allowedCategories);
  }

  const { data, error } = await query;
  if (error) return c.json({ error: error.message }, 500);

  const safe = (data ?? []).map((m) => ({
    id: m.id,
    nome: m.nome,
    categoria: m.categoria,
    disponivel: true,
  }));

  return c.json(safe);
});

// ── GET /api/ssa/requests ─────────────────────────────────────

ssaRoutes.get("/requests", async (c) => {
  await supabase.rpc("expire_material_requests");

  const userId    = c.get("userId");
  const role      = c.get("role");
  const tenantId  = c.get("tenantId");
  const reserveId = c.get("reserveId");

  let query = supabase
    .from("material_requests")
    .select(`
      id, status, notes, denial_reason, armeiro_nota,
      remote_reason, is_external_request, cancellation_reason,
      reserve_id, tenant_id,
      totp_validated, totp_validated_at,
      requested_at, approved_at, rejected_at,
      delivered_at, cancelled_at, expires_at,
      created_at, updated_at,
      military:profiles!material_requests_military_id_fkey(
        id, nome_completo, posto, matricula, foto_url
      ),
      reserva:profiles!material_requests_reserva_id_fkey(
        id, nome_completo, posto
      ),
      items:material_request_items(
        id, material_type_id,
        material_nome_snapshot, material_categoria_snapshot,
        requested_quantity, delivered_quantity
      )
    `)
    .order("requested_at", { ascending: false });

  if (role === "usuario") {
    query = query.eq("military_id", userId).limit(20);
  } else {
    // BUG-RR-07: staff só vê requests do próprio tenant.
    // Achado real (SP9.5, 2026-09-18): faltava confinamento por reserva —
    // BFF usa service role (bypassa RLS), então sem `.in("reserve_id", ...)`
    // qualquer staff via solicitações do TENANT INTEIRO. Ver lib/reserve-scope.ts.
    const reserveIds = await scopedReserveIds(role, reserveId, tenantId);
    if (reserveIds.length === 0) return c.json([]);
    query = query.in("reserve_id", reserveIds);
    if (tenantId) {
      query = query.eq("tenant_id", tenantId);
    }
    query = query.limit(50);
  }

  const { data, error } = await query;
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data ?? []);
});

// ── POST /api/ssa/requests ────────────────────────────────────

ssaRoutes.post(
  "/requests",
  roleGuard("usuario"),
  zValidator(
    "json",
    z.object({
      items: z
        .array(
          z.object({
            material_type_id: z.string().uuid(),
            quantity: z.number().int().min(1).max(10), // BUG-RR-09: limite de quantidade
          })
        )
        .min(1, "Selecione ao menos um material"),
      totp_token: z.string().length(6).regex(/^\d{6}$/),
      notes: z.string().max(500).optional(),
      reserve_id: z.string().uuid().optional(),
      remote_reason: z.string().min(10).max(500).optional(), // RR-05
    })
  ),
  async (c) => {
    const militaryId = c.get("userId");
    const tenantId   = c.get("tenantId");
    // Achado de code review (2026-08-19): o BFF usa a service role key, que
    // ignora RLS inteiramente — sem esta guarda, `tenant_id: tenantId ?? null`
    // no insert abaixo gravaria uma solicitação órfã (tenant_id NULL) sempre
    // que a sessão não tivesse tenantId resolvido (ex: caminho Bearer token
    // do authMiddleware, que não tem o mesmo fallback pra profiles.
    // default_tenant_id que o caminho iron-session tem). Uma linha órfã fica
    // permanentemente invisível pro staff sob a policy corrigida em
    // 20260819020000 — reintroduziria o mesmo bug crítico aos poucos, um
    // request de cada vez, sem nenhum sinal de erro visível. Mesmo padrão já
    // usado em GET /available-materials logo acima.
    if (!tenantId) return c.json({ error: "Tenant não identificado na sessão" }, 403);

    // Gate de conta suspensa: `inactive` / `impedimento_administrativo` não
    // abrem solicitação. `pending_biometric` PASSA — a biometria não bloqueia
    // uso, é só o selo de cadastro 100% (decisão do dono 2026-09-09). Ver
    // lib/ssa-registration-gate.ts.
    const { data: reqProfile, error: reqProfileErr } = await supabase
      .from("profiles")
      .select("registration_status")
      .eq("id", militaryId)
      .maybeSingle();
    const gate = checkSsaRegistrationGate(reqProfile?.registration_status, !!reqProfileErr);
    if (!gate.allowed) {
      if (reqProfileErr) {
        logger.error("ssa.requests.registration_gate.lookup_failure", { military_id: militaryId, error: reqProfileErr.message });
      } else {
        logger.warn("ssa.requests.registration_gate.blocked", {
          military_id: militaryId, registration_status: reqProfile?.registration_status ?? null,
        });
      }
      return c.json({ error: gate.error }, gate.status ?? 403);
    }

    const { items, totp_token, notes, reserve_id, remote_reason } = c.req.valid("json");

    // SP4 (achado CRÍTICO do review — C2): reserve_id é opcional no payload
    // (o corpo aceita "remota" — militar pedindo material de OUTRA reserva —
    // e "própria" — sem reserve_id, deveria cair na reserva ativa da
    // sessão). Sem este fallback, o caminho "própria" gravava
    // material_requests.reserve_id NULL → o dispatcher do SP4 (Task
    // reserve_id_child_tables_dispatcher) falha com RAISE opaco no INSERT de
    // material_request_items alguns passos depois. Resolve explícito >
    // sessão > 400 claro (nunca grava NULL).
    const effectiveReserveId = reserve_id ?? c.get("reserveId") ?? null;
    if (!effectiveReserveId) {
      return c.json({ error: "Reserva não identificada — selecione uma reserva ou acesse pela sua reserva ativa." }, 400);
    }

    let isExternalRequest = false;

    // Defense-in-depth: verificar allow_remote_requests na reserva alvo
    if (reserve_id && tenantId) {
      const { data: reserve } = await supabase
        .from("reserves")
        .select("allow_remote_requests, remote_allowed_categories")
        .eq("id", reserve_id)
        .eq("tenant_id", tenantId)
        .single();

      const { data: membership } = await supabase
        .from("reserve_memberships")
        .select("reserve_id")
        .eq("user_id", militaryId)
        .eq("reserve_id", reserve_id)
        .maybeSingle();

      isExternalRequest = !membership;

      if (reserve && !reserve.allow_remote_requests && isExternalRequest) {
        return c.json({ error: "Esta reserva não aceita requisições externas." }, 403);
      }

      // Motivo obrigatório para externos (RR-05)
      if (isExternalRequest && (!remote_reason || remote_reason.trim().length < 10)) {
        return c.json(
          { error: "Informe o motivo da solicitação remota (mínimo 10 caracteres)." },
          400
        );
      }

      // Validar categorias permitidas para externos
      if (
        isExternalRequest &&
        reserve?.remote_allowed_categories?.length > 0
      ) {
        const itemIds = items.map((i) => i.material_type_id);
        const { data: materials } = await supabase
          .from("material_availability")
          .select("id, categoria")
          .in("id", itemIds);

        const deniedItem = (materials ?? []).find(
          (m) => !reserve?.remote_allowed_categories.includes(m.categoria)
        );
        if (deniedItem) {
          return c.json(
            { error: `A categoria "${deniedItem.categoria}" não está disponível para solicitações externas nesta reserva.` },
            403
          );
        }
      }
    }

    // 1. Check for existing pending/approved request
    const { data: existing } = await supabase
      .from("material_requests")
      .select("id, status")
      .eq("military_id", militaryId)
      .in("status", ["pendente", "aprovado"])
      .maybeSingle();

    if (existing) {
      return c.json(
        {
          error:
            existing.status === "pendente"
              ? "Você já possui uma solicitação pendente. Aguarde a resposta da Reserva de Armamento."
              : "Você possui uma solicitação aprovada. Retire o material antes de criar outra.",
        },
        403
      );
    }

    // 2. Validate TOTP
    const { data: totpData } = await supabase
      .from("totp_secrets")
      .select("id, secret, failure_count, last_failure_at, last_used_token")
      .eq("user_id", militaryId)
      .eq("enabled", true)
      .maybeSingle();

    if (!totpData) {
      return c.json(
        { error: "Configure seu código de acesso antes de fazer uma solicitação." },
        400
      );
    }

    const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
    if (totpData.failure_count >= 5 && totpData.last_failure_at) {
      const elapsed = Date.now() - new Date(totpData.last_failure_at).getTime();
      if (elapsed < RATE_LIMIT_WINDOW_MS) {
        // Achado real de code review (rastreabilidade enterprise): nenhum
        // dos 4 pontos de falha de TOTP deste arquivo deixava rastro em
        // lugar nenhum (nem log, nem audit_events) — a mesma classe de gap
        // já corrigida em outras rotas em 2026-08-27 (regra canônica do
        // CLAUDE.md: "todo evento de negação/bloqueio precisa deixar
        // rastro"). Sem isso, um brute-force do TOTP de um militar (pra
        // liberar armamento remotamente) era invisível até o próprio 429.
        logger.warn("ssa.totp.rate_limited", { military_id: militaryId, totp_id: totpData.id });
        auditLog(c, {
          action: "ssa.totp_rate_limited",
          resource_type: "totp_secrets",
          resource_id: totpData.id,
          metadata: { military_id: militaryId },
        });
        return c.json({ error: "Conta bloqueada por tentativas excessivas." }, 429);
      }
    }

    let plainSecret: string;
    try {
      plainSecret = await readSecret(totpData.secret);
    } catch {
      return c.json({ error: "Código dinâmico inválido. Reconfigure o autenticador." }, 400);
    }

    let isValid: boolean;
    try {
      ({ valid: isValid } = verifySync({ secret: plainSecret, token: totp_token, afterTimeStep: 1 }));
    } catch {
      return c.json({ error: "Código dinâmico inválido." }, 401);
    }

    if (!isValid) {
      await supabase
        .from("totp_secrets")
        .update({
          failure_count: (totpData.failure_count || 0) + 1,
          last_failure_at: new Date().toISOString(),
        })
        .eq("id", totpData.id);

      logger.warn("ssa.totp.validation_failed", { military_id: militaryId, totp_id: totpData.id, failure_count: (totpData.failure_count || 0) + 1 });
      auditLog(c, {
        action: "ssa.totp_validation_failed",
        resource_type: "totp_secrets",
        resource_id: totpData.id,
        metadata: { military_id: militaryId },
      });
      return c.json({ error: "Código inválido. Verifique o código e tente novamente." }, 400);
    }

    if (totpData.last_used_token === totp_token) {
      return c.json({ error: "Código já utilizado neste período. Aguarde o próximo." }, 400);
    }

    // 3. Validate material availability
    const materialIds = items.map((i) => i.material_type_id);
    const { data: availability } = await supabase
      .from("material_availability")
      .select("id, nome, categoria, quantidade_disponivel")
      .in("id", materialIds);

    const availMap = new Map((availability ?? []).map((m) => [m.id, m]));

    for (const item of items) {
      const avail = availMap.get(item.material_type_id);
      if (!avail || avail.quantidade_disponivel < item.quantity) {
        return c.json(
          {
            error: `Material "${avail?.nome ?? item.material_type_id}" indisponível na quantidade solicitada.`,
            material_type_id: item.material_type_id,
          },
          409
        );
      }
    }

    // 4. Create request — BUG-RR-04: salvar reserve_id, tenant_id, is_external_request, remote_reason
    const now = new Date().toISOString();
    const { data: request, error: reqError } = await supabase
      .from("material_requests")
      .insert({
        military_id: militaryId,
        tenant_id: tenantId ?? null,
        reserve_id: effectiveReserveId,            // BUG-RR-04 fix + SP4 review C2 (nunca NULL)
        is_external_request: isExternalRequest,   // novo campo
        remote_reason: remote_reason ?? null,     // novo campo (RR-05)
        notes: notes ?? null,
        totp_validated: true,
        totp_validated_at: now,
      })
      .select("id")
      .single();

    if (reqError || !request) {
      return c.json({ error: "Falha ao criar solicitação." }, 500);
    }

    // 5. Insert items with snapshots
    // tenant_id: achado real (2026-08-19) — nunca era populado aqui, apesar
    // da coluna existir desde 20260620000001_multitenant_foundation.sql. A
    // policy RLS de staff (ssa_items_staff_select/write, ver migration
    // 20260819020000) depende dessa coluna pra evitar um EXISTS
    // correlacionado por linha contra material_requests — a causa raiz real
    // do timeout de 8s+ que travava reserva/solicitacoes inteira.
    // military_id: mesmo achado, descoberto depois (2026-08-22) — a policy
    // ssa_items_military_select também tinha EXISTS correlacionado e não
    // tinha sido corrigida junto (ver migration
    // 20260822000000_fix_ssa_items_military_rls_correlated_subquery.sql).
    const itemRows = items.map((item) => {
      const mat = availMap.get(item.material_type_id);
      if (!mat) {
        throw new Error(`Material ${item.material_type_id} não encontrado no mapa de disponibilidade`);
      }
      return {
        request_id: request.id,
        tenant_id: tenantId ?? null,
        military_id: militaryId,
        material_type_id: item.material_type_id,
        material_nome_snapshot: mat.nome ?? "N/A",
        material_categoria_snapshot: mat.categoria ?? "N/A",
        requested_quantity: item.quantity,
      };
    });

    let itemsError;
    try {
      ({ error: itemsError } = await supabase
        .from("material_request_items")
        .insert(itemRows));
    } catch (mapErr) {
      await supabase.from("material_requests").delete().eq("id", request.id);
      return c.json({ error: "Material inválido na solicitação." }, 409);
    }

    if (itemsError) {
      await supabase.from("material_requests").delete().eq("id", request.id);
      return c.json({ error: "Falha ao registrar materiais da solicitação." }, 500);
    }

    // Achado real (rastreabilidade enterprise): ssa.ts não tinha NENHUMA
    // chamada de auditoria (confirmado por grep, 0 ocorrências) — toda a
    // superfície de solicitação/aprovação/rejeição/cancelamento/entrega de
    // armamento remoto não deixava rastro em audit_events nem audit_logs.
    // effectiveReserveId é o valor REAL já usado no insert acima (linha
    // 457), não um palpite de sessão desconectado.
    auditLog(c, {
      action: "ssa.request_created",
      resource_type: "material_request",
      resource_id: request.id,
      reserve_id: effectiveReserveId,
      metadata: { military_id: militaryId, items, is_external_request: isExternalRequest },
    });

    // 6. Reset TOTP failure count + store used token
    await supabase
      .from("totp_secrets")
      .update({ failure_count: 0, last_failure_at: null, last_validated_at: now, last_used_token: totp_token })
      .eq("id", totpData.id);

    // 7. Notify armeios do tenant (BUG-RR-02 + BUG-RR-05 fix)
    const { data: military } = await supabase
      .from("profiles")
      .select("nome_completo, posto, matricula")
      .eq("id", militaryId)
      .maybeSingle();

    const materialSummary = items
      .map((i) => availMap.get(i.material_type_id)?.nome)
      .join(", ");

    if (tenantId) {
      notifyArmeiosOfTenant(
        tenantId,
        "armament_requested",
        "Nova Solicitação de Armamento",
        `${military?.posto ?? ""} ${military?.nome_completo ?? "Militar"} solicitou: ${materialSummary}`,
        { request_id: request.id, military_id: militaryId, reserve_id: effectiveReserveId }
      );
    }

    return c.json({ request_id: request.id, status: "pendente" }, 201);
  }
);

// ── PATCH /api/ssa/requests/:id/approve ──────────────────────

ssaRoutes.patch(
  "/requests/:id/approve",
  roleGuard("armeiro", "admin_global", "admin_reserva"),
  zValidator("json", z.object({ nota: z.string().max(500).optional() }).optional()),
  async (c) => {
    const reservaId = c.get("userId");
    const tenantId  = c.get("tenantId");
    const role      = c.get("role");
    const requestId = c.req.param("id");
    const nota = c.req.valid("json")?.nota ?? null;

    // Regra canônica: aprovar solicitação remota de armamento é uma
    // movimentação do armeiro — não pode ocorrer com o turno fechado.
    // SP7 (achado ALTO do review): compara contra a reserva ativa da
    // sessão — sem isso, um turno aberto numa reserva antiga (esquecido,
    // não fechado) passava o gate pra operar em outra.
    const shiftCheck = await requireActiveShift(role, reservaId, c.get("reserveId"));
    if (!shiftCheck.ok) return c.json(shiftCheck.body, 403);

    const { data: req, error: fetchErr } = await supabase
      .from("material_requests")
      .select(`
        id, status, military_id, tenant_id, reserve_id,
        items:material_request_items(material_type_id, requested_quantity)
      `)
      .eq("id", requestId)
      .maybeSingle();

    if (fetchErr || !req) return c.json({ error: "Solicitação não encontrada." }, 404);

    // Tenant isolation check
    if (tenantId && req.tenant_id && req.tenant_id !== tenantId) {
      return c.json({ error: "Sem permissão para esta solicitação." }, 403);
    }

    if (req.status !== "pendente") {
      return c.json({ error: `Solicitação não pode ser aprovada (status: ${req.status}).` }, 409);
    }

    const materialIds = req.items.map((i: { material_type_id: string }) => i.material_type_id);
    const { data: availability } = await supabase
      .from("material_availability")
      .select("id, nome, quantidade_disponivel")
      .in("id", materialIds);

    const availMap = new Map((availability ?? []).map((m) => [m.id, m]));
    for (const item of req.items as { material_type_id: string; requested_quantity: number }[]) {
      const avail = availMap.get(item.material_type_id);
      if (!avail || avail.quantidade_disponivel < item.requested_quantity) {
        return c.json(
          { error: `Material "${avail?.nome ?? item.material_type_id}" não tem mais estoque suficiente.` },
          409
        );
      }
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + EXPIRY_HOURS * 3600 * 1000);

    const { error: updateErr } = await supabase
      .from("material_requests")
      .update({
        status: "aprovado",
        reserva_id: reservaId,
        approved_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        armeiro_nota: nota,
      })
      .eq("id", requestId)
      .eq("status", "pendente");

    if (updateErr) return c.json({ error: updateErr.message }, 500);

    // Achado real (rastreabilidade enterprise) — mesmo gap de POST /requests.
    auditLog(c, {
      action: "ssa.request_approved",
      resource_type: "material_request",
      resource_id: requestId,
      reserve_id: req.reserve_id,
      metadata: { military_id: req.military_id, nota, approved_by: reservaId },
    });

    const expiresAtHHmm = expiresAt.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });

    notifyUser(
      req.military_id,
      "armament_approved",
      "Solicitação Aprovada ✓",
      `Sua solicitação foi aprovada. Retire o material até ${expiresAtHHmm}.${nota ? `\nObs: ${nota}` : ""}`,
      { request_id: requestId, expires_at: expiresAt.toISOString() },
      "/efetivo/solicitacoes"
    );

    // Livro Digital: aqui quem age É o armeiro (aprovador), diferente do
    // fluxo de categorias/materiais onde o evento vai pro turno de quem
    // SOLICITOU — em SSA o armeiro é sempre quem aprova/rejeita/entrega.
    await logShiftEvent({
      actorId: reservaId!, tenantId: tenantId!,
      eventType: "solicitacao_aprovada",
      description: `Solicitação remota de armamento aprovada${nota ? ` — ${nota}` : ""}`,
      subjectId: requestId, subjectType: "material_request",
      metadata: { military_id: req.military_id },
    }).catch(() => {});

    return c.json({ ok: true, expires_at: expiresAt.toISOString() });
  }
);

// ── PATCH /api/ssa/requests/:id/reject ───────────────────────

ssaRoutes.patch(
  "/requests/:id/reject",
  roleGuard("armeiro", "admin_global", "admin_reserva"),
  zValidator(
    "json",
    z.object({
      reason: z.string().min(5, "Informe o motivo da rejeição (mínimo 5 caracteres)."),
    })
  ),
  async (c) => {
    const reservaId = c.get("userId");
    const tenantId  = c.get("tenantId");
    const role      = c.get("role");
    const requestId = c.req.param("id");
    const { reason } = c.req.valid("json");

    // SP7 (achado ALTO do review) — ver comentário equivalente em /approve.
    const shiftCheck = await requireActiveShift(role, reservaId, c.get("reserveId"));
    if (!shiftCheck.ok) return c.json(shiftCheck.body, 403);

    const { data: req } = await supabase
      .from("material_requests")
      .select("id, status, military_id, tenant_id, reserve_id")
      .eq("id", requestId)
      .maybeSingle();

    if (!req) return c.json({ error: "Solicitação não encontrada." }, 404);

    if (tenantId && req.tenant_id && req.tenant_id !== tenantId) {
      return c.json({ error: "Sem permissão para esta solicitação." }, 403);
    }

    if (req.status !== "pendente") {
      return c.json({ error: `Solicitação não pode ser rejeitada (status: ${req.status}).` }, 409);
    }

    const { error } = await supabase
      .from("material_requests")
      .update({
        status: "rejeitado",
        reserva_id: reservaId,
        denial_reason: reason,
        rejected_at: new Date().toISOString(),
      })
      .eq("id", requestId)
      .eq("status", "pendente");

    if (error) return c.json({ error: error.message }, 500);

    // Achado real (rastreabilidade enterprise) — mesmo gap de POST /requests.
    auditLog(c, {
      action: "ssa.request_rejected",
      resource_type: "material_request",
      resource_id: requestId,
      reserve_id: req.reserve_id,
      metadata: { military_id: req.military_id, reason, rejected_by: reservaId },
    });

    notifyUser(
      req.military_id,
      "armament_rejected",
      "Solicitação Não Aprovada",
      `Sua solicitação foi rejeitada. Motivo: ${reason}`,
      { request_id: requestId, reason },
      "/efetivo/solicitacoes"
    );

    await logShiftEvent({
      actorId: reservaId!, tenantId: tenantId!,
      eventType: "solicitacao_negada",
      description: `Solicitação remota de armamento rejeitada — motivo: ${reason}`,
      subjectId: requestId, subjectType: "material_request",
      metadata: { military_id: req.military_id },
    }).catch(() => {});

    return c.json({ ok: true });
  }
);

// ── PATCH /api/ssa/requests/:id/cancel ───────────────────────
// Efetivo cancela própria solicitação (pendente ou aprovada) com motivo obrigatório.
// Armeiro/admin: cancela com notificação ao efetivo.

ssaRoutes.patch(
  "/requests/:id/cancel",
  zValidator(
    "json",
    z.object({
      cancellation_reason: z
        .string()
        .min(10, "Informe o motivo do cancelamento (mínimo 10 caracteres)."),
    })
  ),
  async (c) => {
    const userId    = c.get("userId");
    const role      = c.get("role");
    const tenantId  = c.get("tenantId");
    const requestId = c.req.param("id");
    const { cancellation_reason } = c.req.valid("json");

    const { data: req } = await supabase
      .from("material_requests")
      .select("id, status, military_id, tenant_id, reserve_id")
      .eq("id", requestId)
      .maybeSingle();

    if (!req) return c.json({ error: "Solicitação não encontrada." }, 404);

    const isMilitary = role === "usuario";
    const isStaff    = ["armeiro", "admin_global", "admin_reserva"].includes(role ?? "");
    const isOwner    = req.military_id === userId;

    // Tenant isolation for staff
    if (isStaff && tenantId && req.tenant_id && req.tenant_id !== tenantId) {
      return c.json({ error: "Sem permissão para esta solicitação." }, 403);
    }

    // Military can only cancel own requests
    if (isMilitary && !isOwner) {
      return c.json({ error: "Sem permissão para cancelar esta solicitação." }, 403);
    }

    // Allowed statuses for cancellation
    const cancellableStatuses =
      isMilitary
        ? ["pendente", "aprovado"]           // RR-08: efetivo pode cancelar mesmo aprovado
        : ["pendente", "aprovado"];

    if (!cancellableStatuses.includes(req.status)) {
      return c.json(
        { error: `Não é possível cancelar solicitação com status "${req.status}".` },
        409
      );
    }

    const { error } = await supabase
      .from("material_requests")
      .update({
        status: "cancelado",
        cancelled_at: new Date().toISOString(),
        cancellation_reason,                     // novo campo (Migration C)
      })
      .eq("id", requestId);

    if (error) return c.json({ error: error.message }, 500);

    // Achado real (rastreabilidade enterprise) — mesmo gap de POST /requests.
    // Mesma action do endpoint legado DELETE /:id (achado MÉDIO de code
    // review: cancelamento é o mesmo efeito de negócio independente de
    // qual rota HTTP foi usada — a distinção fica em metadata.via, não em
    // 2 actions diferentes, senão um auditor futuro precisa saber de
    // antemão que existem 2 nomes pra reconstruir o histórico completo).
    auditLog(c, {
      action: "ssa.request_cancelled",
      resource_type: "material_request",
      resource_id: requestId,
      reserve_id: req.reserve_id,
      metadata: { military_id: req.military_id, cancellation_reason, cancelled_by: userId, cancelled_by_role: role, via: "patch_cancel" },
    });

    if (isMilitary) {
      // Notificar armeios do tenant sobre cancelamento pelo efetivo
      if (tenantId) {
        notifyArmeiosOfTenant(
          tenantId,
          "armament_cancelled",
          "Solicitação Cancelada pelo Militar",
          `Solicitação cancelada. Motivo: ${cancellation_reason}`,
          { request_id: requestId, military_id: userId }
        );
      }
    } else if (isStaff && !isOwner) {
      // Notificar o efetivo sobre cancelamento pelo armeiro
      notifyUser(
        req.military_id,
        "armament_cancelled",
        "Solicitação Cancelada",
        `Sua solicitação foi cancelada. Motivo: ${cancellation_reason}`,
        { request_id: requestId },
        "/efetivo/solicitacoes"
      );
    }

    return c.json({ ok: true });
  }
);

// ── PATCH /api/ssa/requests/:id/deliver ──────────────────────

ssaRoutes.patch(
  "/requests/:id/deliver",
  roleGuard("armeiro", "admin_global", "admin_reserva"),
  async (c) => {
    const reservaId = c.get("userId");
    const tenantId  = c.get("tenantId");
    const role      = c.get("role");
    const requestId = c.req.param("id");

    // Confirmar entrega efetivamente cria lendings (saída de material) —
    // mesma regra canônica de qualquer outra saída. SP7 (achado ALTO do
    // review) — ver comentário equivalente em /approve.
    const shiftCheck = await requireActiveShift(role, reservaId, c.get("reserveId"));
    if (!shiftCheck.ok) return c.json(shiftCheck.body, 403);

    await supabase.rpc("expire_material_requests");

    const { data: req } = await supabase
      .from("material_requests")
      .select(`
        id, status, military_id, expires_at, tenant_id, reserve_id,
        items:material_request_items(
          id, material_type_id, requested_quantity, delivered_quantity
        )
      `)
      .eq("id", requestId)
      .maybeSingle();

    if (!req) return c.json({ error: "Solicitação não encontrada." }, 404);

    if (tenantId && req.tenant_id && req.tenant_id !== tenantId) {
      return c.json({ error: "Sem permissão para esta solicitação." }, 403);
    }

    // SP6 (achado C1 do review): lendings.tenant_id/reserve_id são NOT NULL
    // (grupo B do isolamento por reserva) — sem isso o INSERT abaixo falha
    // com 23502. Usa o reserve_id/tenant_id da PRÓPRIA solicitação (não da
    // sessão do armeiro) — é o dado correto mesmo se o armeiro tiver mudado
    // de reserva ativa entre aprovar e entregar.
    if (!req.tenant_id || !req.reserve_id) {
      return c.json({ error: "Solicitação sem reserva/tenant associado — não é possível entregar." }, 400);
    }

    if (req.status === "expirado") {
      return c.json({ error: "Solicitação expirada. O prazo de 6h foi ultrapassado." }, 409);
    }
    if (req.status !== "aprovado") {
      return c.json({ error: `Solicitação não pode ser entregue (status: ${req.status}).` }, 409);
    }
    if (req.expires_at && new Date(req.expires_at) < new Date()) {
      return c.json({ error: "Solicitação expirada. O prazo de 6h foi ultrapassado." }, 409);
    }

    const now = new Date().toISOString();

    const lendingRows = req.items.map(
      (item: {
        material_type_id: string;
        requested_quantity: number;
        delivered_quantity: number | null;
      }) => ({
        military_id: req.military_id,
        master_id: reservaId,
        material_type_id: item.material_type_id,
        quantidade: item.delivered_quantity ?? item.requested_quantity,
        issued_at: now,
        status_legacy: "ativo",
        notes: `Solicitação SSA #${requestId.slice(0, 8)}`,
        auth_mode: "totp",
        material_request_id: requestId,
        tenant_id: req.tenant_id,
        reserve_id: req.reserve_id,
      })
    );

    const { data: lendings, error: lendingErr } = await supabase
      .from("lendings")
      .insert(lendingRows)
      .select("id");

    if (lendingErr) return c.json({ error: lendingErr.message }, 500);

    const { error: updateErr } = await supabase
      .from("material_requests")
      .update({
        status: "retirado",
        reserva_id: reservaId,
        delivered_at: now,
      })
      .eq("id", requestId)
      .eq("status", "aprovado");

    if (updateErr) return c.json({ error: updateErr.message }, 500);

    // Achado real (rastreabilidade enterprise): esta rota insere direto em
    // `lendings` (linha ~893) sem passar por lendings.ts — bypassa por
    // completo a auditoria já corrigida ali (Fase 3c). req.reserve_id é o
    // valor REAL já usado no insert dos lendings acima, não um palpite.
    // Achado ALTO de review (rastreabilidade enterprise): 2 auditLog() em
    // sequência sem await entre si liam o mesmo previousHash via
    // getLastEventHash() antes de qualquer INSERT completar — os 2 novos
    // audit_events reivindicavam o mesmo previous_hash, bifurcando a cadeia
    // em 100% das entregas via SSA. `await` no primeiro serializa a leitura.
    await auditLog(c, {
      action: "ssa.request_delivered",
      resource_type: "material_request",
      resource_id: requestId,
      reserve_id: req.reserve_id,
      metadata: { military_id: req.military_id, delivered_by: reservaId, lending_ids: lendings?.map((l) => l.id) },
    });
    // Achado ALTO de code review: o evento acima documenta o ciclo de vida
    // da SOLICITAÇÃO, mas não substitui o evento de criação da(s)
    // LENDING(S) em si — sem isto, `audit_events WHERE action=
    // 'lending.created'` (a query natural pra "toda saída de material",
    // já usada por lendings.ts) tem um buraco sistemático pra 100% das
    // saídas originadas de SSA. Mesma action/resource_type de lendings.ts,
    // resource_id = requestId (não existe movement_id aqui — o id da
    // solicitação já cumpre o papel de correlacionar o lote).
    auditLog(c, {
      action: "lending.created",
      resource_type: "lending",
      resource_id: requestId,
      reserve_id: req.reserve_id,
      metadata: { military_id: req.military_id, lending_ids: lendings?.map((l) => l.id), via: "ssa" },
    });

    notifyUser(
      req.military_id,
      "armament_delivered",
      "Material Retirado ✓",
      "Sua retirada de material foi confirmada pela Reserva de Armamento.",
      { request_id: requestId, lending_ids: lendings?.map((l) => l.id) },
      "/efetivo/solicitacoes"
    );

    await logShiftEvent({
      actorId: reservaId!, tenantId: tenantId!,
      eventType: "saida_autorizada",
      description: `Saída autorizada — retirada de solicitação remota confirmada`,
      subjectId: requestId, subjectType: "material_request",
      metadata: { military_id: req.military_id, lending_ids: lendings?.map((l) => l.id) },
    }).catch(() => {});

    return c.json({ ok: true, lending_ids: lendings?.map((l) => l.id) ?? [] });
  }
);

// ── GET /api/ssa/lookup-military ─────────────────────────────

ssaRoutes.get("/lookup-military", roleGuard("armeiro", "admin_global", "admin_reserva"), async (c) => {
  const matricula = c.req.query("matricula");
  if (!matricula) return c.json({ error: "Parâmetro 'matricula' obrigatório." }, 400);

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, nome_completo, posto, matricula")
    .eq("matricula", matricula)
    .eq("role", "usuario")
    .maybeSingle();

  if (error) return c.json({ error: error.message }, 500);
  if (!profile) return c.json({ error: "Matrícula não encontrada." }, 404);

  return c.json(profile);
});

// ── POST /api/ssa/modo-a ──────────────────────────────────────

ssaRoutes.post(
  "/modo-a",
  roleGuard("armeiro", "admin_global", "admin_reserva"),
  zValidator(
    "json",
    z.object({
      military_id: z.string().uuid(),
      totp_token: z.string().length(6).regex(/^\d{6}$/),
      local: z.string().max(100).optional(),
      items: z
        .array(z.object({ material_type_id: z.string().uuid(), quantity: z.number().int().min(1).max(10) }))
        .min(1),
    })
  ),
  async (c) => {
    const reservaId = c.get("userId");
    const tenantId  = c.get("tenantId");
    const reserveId = c.get("reserveId");
    // Mesmo achado do guard em POST /requests acima — sem isto, o insert de
    // material_request_items abaixo gravaria tenant_id NULL, invisível pro
    // staff sob a policy corrigida em 20260819020000.
    if (!tenantId) return c.json({ error: "Tenant não identificado na sessão" }, 403);
    // SP4 (achado real): este era o ÚNICO dos 2 insert sites de
    // material_requests sem `reserve_id` — o outro (POST /requests, ~:429)
    // já tinha o fix BUG-RR-04. Sem isso, o dispatcher de reserve_id do SP4
    // (material_request_items deriva de material_requests.reserve_id) falha
    // com RAISE opaco no passo 5 — melhor recusar aqui, cedo, com mensagem clara.
    if (!reserveId) return c.json({ error: "Reserva ativa não identificada na sessão" }, 403);
    const { military_id, totp_token, local, items } = c.req.valid("json");

    const { data: militaryStatus } = await supabase
      .from("profiles")
      .select("registration_status")
      .eq("id", military_id)
      .single();

    if (militaryStatus?.registration_status === "impedimento_administrativo") {
      return c.json(
        { error: "Militar com impedimento administrativo. Para dúvidas, procure o Departamento de Pessoas de sua unidade." },
        403
      );
    }

    const { data: totpData } = await supabase
      .from("totp_secrets")
      .select("id, secret, failure_count, last_failure_at")
      .eq("user_id", military_id)
      .eq("enabled", true)
      .maybeSingle();

    if (!totpData) {
      return c.json({ error: "Militar não possui código de acesso configurado." }, 400);
    }

    const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
    if (totpData.failure_count >= 5 && totpData.last_failure_at) {
      const elapsed = Date.now() - new Date(totpData.last_failure_at).getTime();
      if (elapsed < RATE_LIMIT_WINDOW_MS) {
        const remaining = Math.ceil((RATE_LIMIT_WINDOW_MS - elapsed) / 1000);
        // Mesmo achado de POST /requests — sem log/audit, brute-force do
        // TOTP era invisível até o próprio 429.
        logger.warn("ssa.totp.rate_limited", { military_id, totp_id: totpData.id, via: "modo_a" });
        auditLog(c, {
          action: "ssa.totp_rate_limited",
          resource_type: "totp_secrets",
          resource_id: totpData.id,
          metadata: { military_id, via: "modo_a" },
        });
        return c.json(
          { error: "Militar bloqueado por tentativas excessivas.", retry_after_seconds: remaining },
          429
        );
      }
    }

    let plainSecret2: string;
    try {
      plainSecret2 = await readSecret(totpData.secret);
    } catch {
      return c.json({ error: "Código dinâmico inválido. Reconfigure o autenticador." }, 400);
    }

    let isValid2: boolean;
    try {
      ({ valid: isValid2 } = verifySync({ secret: plainSecret2, token: totp_token, afterTimeStep: 1 }));
    } catch {
      return c.json({ error: "Código dinâmico inválido." }, 401);
    }

    if (!isValid2) {
      await supabase
        .from("totp_secrets")
        .update({ failure_count: (totpData.failure_count || 0) + 1, last_failure_at: new Date().toISOString() })
        .eq("id", totpData.id);
      logger.warn("ssa.totp.validation_failed", { military_id, totp_id: totpData.id, failure_count: (totpData.failure_count || 0) + 1, via: "modo_a" });
      auditLog(c, {
        action: "ssa.totp_validation_failed",
        resource_type: "totp_secrets",
        resource_id: totpData.id,
        metadata: { military_id, via: "modo_a" },
      });
      return c.json({ error: "Código dinâmico inválido." }, 400);
    }

    const materialIds = items.map((i) => i.material_type_id);
    const { data: availability } = await supabase
      .from("material_availability")
      .select("id, nome, categoria, quantidade_disponivel")
      .in("id", materialIds);

    const availMap = new Map((availability ?? []).map((m) => [m.id, m]));
    for (const item of items) {
      const avail = availMap.get(item.material_type_id);
      if (!avail || avail.quantidade_disponivel < item.quantity) {
        return c.json(
          { error: `Material "${avail?.nome ?? item.material_type_id}" indisponível na quantidade solicitada.` },
          409
        );
      }
    }

    // Achado ALTO de code review: este update cancelava silenciosamente
    // qualquer solicitação pendente/aprovada do militar (efeito colateral
    // de despachar Modo A pro mesmo militar com uma solicitação remota já
    // em aberto) sem `.select()` (erro nunca checado, IDs afetados nunca
    // conhecidos), sem log, sem audit_event. É uma mutação real de
    // material_requests — exatamente a entidade que esta fase existe pra
    // instrumentar.
    const { data: autoCancelled, error: autoCancelErr } = await supabase
      .from("material_requests")
      .update({ status: "cancelado", cancelled_at: new Date().toISOString() })
      .eq("military_id", military_id)
      .in("status", ["pendente", "aprovado"])
      .select("id, reserve_id");

    if (autoCancelErr) {
      logger.error("ssa.modo_a.auto_cancel_failure", { military_id, error: autoCancelErr.message });
    } else {
      // await por iteração: mesmo risco de bifurcação de hash-chain se
      // >1 solicitação pendente/aprovada for auto-cancelada no mesmo dispatch.
      for (const cancelled of autoCancelled ?? []) {
        await auditLog(c, {
          action: "ssa.request_auto_cancelled",
          resource_type: "material_request",
          resource_id: cancelled.id,
          reserve_id: cancelled.reserve_id,
          metadata: { military_id, reason: "modo_a_dispatch", cancelled_by: reservaId },
        });
      }
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + EXPIRY_HOURS * 3600 * 1000);

    const { data: request, error: reqError } = await supabase
      .from("material_requests")
      .insert({
        military_id,
        tenant_id: tenantId ?? null,
        reserve_id: reserveId,
        reserva_id: reservaId,
        status: "aprovado",
        totp_validated: true,
        totp_validated_at: now.toISOString(),
        requested_at: now.toISOString(),
        approved_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        notes: "Saída presencial via código de acesso (Modo A)",
      })
      .select("id")
      .single();

    if (reqError || !request) return c.json({ error: "Falha ao criar solicitação." }, 500);

    const itemRows = items.map((item) => {
      const mat = availMap.get(item.material_type_id)!;
      return {
        request_id: request.id,
        tenant_id: tenantId ?? null,
        military_id,
        material_type_id: item.material_type_id,
        material_nome_snapshot: mat.nome,
        material_categoria_snapshot: mat.categoria,
        requested_quantity: item.quantity,
        delivered_quantity: item.quantity,
      };
    });

    const { error: itemsError } = await supabase.from("material_request_items").insert(itemRows);
    if (itemsError) {
      await supabase.from("material_requests").delete().eq("id", request.id);
      return c.json({ error: itemsError.message }, 500);
    }

    const lendingRows = items.map((item) => ({
      military_id,
      master_id: reservaId,
      material_type_id: item.material_type_id,
      quantidade: item.quantity,
      issued_at: now.toISOString(),
      status_legacy: "ativo",
      local: local ?? null,
      notes: `Saída Modo A — SSA #${request.id.slice(0, 8)}`,
      auth_mode: "totp",
      material_request_id: request.id,
      // SP6 (achado C1 do review): lendings.tenant_id/reserve_id são NOT
      // NULL (grupo B). tenantId/reserveId já garantidos non-null pelos
      // guards 403 no início da rota.
      tenant_id: tenantId,
      reserve_id: reserveId,
    }));

    const { data: lendings, error: lendingErr } = await supabase
      .from("lendings")
      .insert(lendingRows)
      .select("id");

    if (lendingErr) {
      await supabase.from("material_requests").delete().eq("id", request.id);
      return c.json({ error: lendingErr.message }, 500);
    }

    await supabase
      .from("material_requests")
      .update({ status: "retirado", delivered_at: now.toISOString() })
      .eq("id", request.id);

    await supabase
      .from("totp_secrets")
      .update({ failure_count: 0, last_failure_at: null, last_validated_at: now.toISOString() })
      .eq("id", totpData.id);

    // Achado real (rastreabilidade enterprise) — mesmo gap de POST /requests
    // e /deliver. reserveId aqui é a sessão do armeiro, mas é o valor REAL
    // já usado nos 3 inserts acima (material_requests/material_request_items/
    // lendings, linhas ~1071/1121) — não é um palpite desconectado.
    // Achado ALTO de review — mesma razão do comentário equivalente em
    // /deliver: `await` serializa a leitura de previousHash entre os 2 auditLog().
    await auditLog(c, {
      action: "ssa.modo_a_delivered",
      resource_type: "material_request",
      resource_id: request.id,
      reserve_id: reserveId,
      metadata: { military_id, delivered_by: reservaId, lending_ids: lendings?.map((l) => l.id), local },
    });
    // Achado ALTO de code review — mesma razão do comentário equivalente
    // em /deliver: sem isto, saídas via Modo A também ficam de fora de
    // `audit_events WHERE action='lending.created'`.
    auditLog(c, {
      action: "lending.created",
      resource_type: "lending",
      resource_id: request.id,
      reserve_id: reserveId,
      metadata: { military_id, lending_ids: lendings?.map((l) => l.id), via: "ssa_modo_a" },
    });

    notifyUser(
      military_id,
      "armament_delivered",
      "Material Retirado via Código ✓",
      "Saída presencial registrada pela Reserva de Armamento com seu código de acesso.",
      { request_id: request.id, lending_ids: lendings?.map((l) => l.id) },
      "/efetivo/solicitacoes"
    );

    return c.json({ ok: true, request_id: request.id, lending_ids: lendings?.map((l) => l.id) ?? [] });
  }
);

// ── DELETE /api/ssa/requests/:id ─────────────────────────────
// Legacy endpoint — mantido para retrocompatibilidade.
// Novo fluxo: usar PATCH /api/ssa/requests/:id/cancel com motivo.

ssaRoutes.delete("/requests/:id", async (c) => {
  const userId    = c.get("userId");
  const role      = c.get("role");
  const tenantId  = c.get("tenantId");
  const requestId = c.req.param("id");

  const { data: req } = await supabase
    .from("material_requests")
    .select("id, status, military_id, tenant_id, reserve_id")
    .eq("id", requestId)
    .maybeSingle();

  if (!req) return c.json({ error: "Solicitação não encontrada." }, 404);

  const isMilitary = role === "usuario";
  const isStaff    = role === "armeiro" || role === "admin_global";
  const isOwner    = req.military_id === userId;

  if (isStaff && tenantId && req.tenant_id && req.tenant_id !== tenantId) {
    return c.json({ error: "Sem permissão para esta solicitação." }, 403);
  }

  if (isMilitary && !isOwner) {
    return c.json({ error: "Sem permissão para cancelar esta solicitação." }, 403);
  }
  if (isMilitary && req.status !== "pendente") {
    return c.json(
      { error: "Apenas solicitações pendentes podem ser canceladas pelo militar." },
      403
    );
  }
  if (isStaff && !["pendente", "aprovado"].includes(req.status)) {
    return c.json({ error: `Não é possível cancelar solicitação com status "${req.status}".` }, 409);
  }

  let cancelReason: string | undefined;
  try {
    const body = await c.req.json<{ reason?: string }>();
    if (body?.reason?.trim()) cancelReason = body.reason.trim();
  } catch { /* body absent — OK */ }

  const { error } = await supabase
    .from("material_requests")
    .update({
      status: "cancelado",
      cancelled_at: new Date().toISOString(),
      cancellation_reason: cancelReason ?? null,
    })
    .eq("id", requestId);

  if (error) return c.json({ error: error.message }, 500);

  // Achado real (rastreabilidade enterprise) — mesmo gap de POST /requests.
  // Mesma action de PATCH /cancel (achado MÉDIO de code review: efeito de
  // negócio idêntico, a rota HTTP é detalhe de transporte) — distinção
  // fica em metadata.via, pra quem quiser isolar "uso da rota legada" sem
  // fragmentar o histórico da entidade em 2 nomes de action.
  auditLog(c, {
    action: "ssa.request_cancelled",
    resource_type: "material_request",
    resource_id: requestId,
    reserve_id: req.reserve_id,
    metadata: { military_id: req.military_id, cancellation_reason: cancelReason ?? null, cancelled_by: userId, cancelled_by_role: role, via: "legacy_delete" },
  });

  if (isStaff && req.military_id !== userId) {
    notifyUser(
      req.military_id,
      "armament_cancelled",
      "Solicitação Cancelada",
      "Sua solicitação de armamento foi cancelada pela Reserva de Armamento.",
      { request_id: requestId },
      "/efetivo/solicitacoes"
    );
  }

  return c.json({ ok: true });
});
