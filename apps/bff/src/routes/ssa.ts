import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { generateSync, verifySync } from "otplib";
import { roleGuard } from "../middleware/role-guard";
import { supabase } from "../services/supabase";
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
  metadata: Record<string, unknown> = {}
) {
  await supabase.from("notifications").insert({
    user_id: userId,
    type,
    title,
    body,
    metadata,
  });

  if (INTERNAL_SECRET) {
    fetch(`${BFF_URL}/api/push/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": INTERNAL_SECRET,
      },
      body: JSON.stringify({ user_id: userId, title, body, url: "/cadete/solicitacoes" }),
    }).catch(() => {});
  }
}

// ── Helper: notify all active armeios ────────────────────────

async function notifyAllArmeios(
  title: string,
  body: string,
  metadata: Record<string, unknown> = {}
) {
  const { data: armeios } = await supabase
    .from("profiles")
    .select("id")
    .eq("role", "master")
    .eq("registration_status", "complete");

  if (!armeios) return;

  await Promise.allSettled(
    armeios.map((a) => notifyUser(a.id, "armament_requested", title, body, metadata))
  );
}

// ── GET /api/ssa/available-materials ─────────────────────────
// Returns ALL active materials with disponivel flag — NO quantity numbers exposed.
// Unavailable items shown so military knows what exists but can't select them.

ssaRoutes.get("/available-materials", async (c) => {
  // Lazy-run expiry before any SSA read
  await supabase.rpc("expire_material_requests");

  const { data, error } = await supabase
    .from("material_availability")
    .select("id, nome, categoria, quantidade_disponivel, ativo")
    .eq("ativo", true)
    .order("categoria")
    .order("nome");

  if (error) return c.json({ error: error.message }, 500);

  // Strip all quantity numbers — military only sees availability status
  const safe = (data ?? []).map((m) => ({
    id: m.id,
    nome: m.nome,
    categoria: m.categoria,
    disponivel: (m.quantidade_disponivel ?? 0) > 0,
  }));

  return c.json(safe);
});

// ── GET /api/ssa/requests ─────────────────────────────────────
// Military: own requests. Armeiro/Admin: all pending + approved + today's.

ssaRoutes.get("/requests", async (c) => {
  await supabase.rpc("expire_material_requests");

  const userId = c.get("userId");
  const role = c.get("role");

  let query = supabase
    .from("material_requests")
    .select(`
      id, status, notes, denial_reason,
      totp_validated, totp_validated_at,
      requested_at, approved_at, rejected_at,
      delivered_at, cancelled_at, expires_at,
      created_at, updated_at,
      military:profiles!material_requests_military_id_fkey(
        id, nome_completo, posto, matricula, foto_url
      ),
      armeiro:profiles!material_requests_armeiro_id_fkey(
        id, nome_completo, posto
      ),
      items:material_request_items(
        id, material_type_id,
        material_nome_snapshot, material_categoria_snapshot,
        requested_quantity, delivered_quantity
      )
    `)
    .order("requested_at", { ascending: false });

  if (role === "military") {
    query = query.eq("military_id", userId).limit(20);
  } else {
    query = query.limit(50);
  }

  const { data, error } = await query;
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data ?? []);
});

// ── POST /api/ssa/requests ────────────────────────────────────
// Submit a new material request. TOTP validated at submit time.

ssaRoutes.post(
  "/requests",
  roleGuard("military"),
  zValidator(
    "json",
    z.object({
      items: z
        .array(
          z.object({
            material_type_id: z.string().uuid(),
            quantity: z.number().int().min(1),
          })
        )
        .min(1, "Selecione ao menos um material"),
      totp_token: z.string().length(6).regex(/^\d{6}$/),
      notes: z.string().max(500).optional(),
    })
  ),
  async (c) => {
    const militaryId = c.get("userId");
    const { items, totp_token, notes } = c.req.valid("json");

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
              ? "Você já possui uma solicitação pendente. Aguarde a resposta do armeiro."
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
        return c.json({ error: "Conta bloqueada por tentativas excessivas." }, 429);
      }
    }

    const { valid: isValid } = verifySync({ secret: totpData.secret, token: totp_token, afterTimeStep: 1 });
    if (!isValid) {
      await supabase
        .from("totp_secrets")
        .update({
          failure_count: (totpData.failure_count || 0) + 1,
          last_failure_at: new Date().toISOString(),
        })
        .eq("id", totpData.id);

      return c.json({ error: "Código inválido. Verifique o código e tente novamente." }, 400);
    }

    // Anti-replay: reject if this exact code was already used in this period
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

    // 4. Create request
    const now = new Date().toISOString();
    const { data: request, error: reqError } = await supabase
      .from("material_requests")
      .insert({
        military_id: militaryId,
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
    const itemRows = items.map((item) => {
      const mat = availMap.get(item.material_type_id)!;
      return {
        request_id: request.id,
        material_type_id: item.material_type_id,
        material_nome_snapshot: mat.nome,
        material_categoria_snapshot: mat.categoria,
        requested_quantity: item.quantity,
      };
    });

    const { error: itemsError } = await supabase
      .from("material_request_items")
      .insert(itemRows);

    if (itemsError) {
      // Rollback request
      await supabase.from("material_requests").delete().eq("id", request.id);
      return c.json({ error: "Falha ao registrar materiais da solicitação." }, 500);
    }

    // 6. Reset TOTP failure count + store used token (anti-replay)
    await supabase
      .from("totp_secrets")
      .update({ failure_count: 0, last_failure_at: null, last_validated_at: now, last_used_token: totp_token })
      .eq("id", totpData.id);

    // 7. Notify all armeios (fire-and-forget)
    const { data: military } = await supabase
      .from("profiles")
      .select("nome_completo, posto, matricula")
      .eq("id", militaryId)
      .maybeSingle();

    const materialSummary = items
      .map((i) => availMap.get(i.material_type_id)?.nome)
      .join(", ");

    notifyAllArmeios(
      "Nova Solicitação de Armamento",
      `${military?.posto ?? ""} ${military?.nome_completo ?? "Militar"} solicitou: ${materialSummary}`,
      { request_id: request.id, military_id: militaryId }
    );

    return c.json({ request_id: request.id, status: "pendente" }, 201);
  }
);

// ── PATCH /api/ssa/requests/:id/approve ──────────────────────

ssaRoutes.patch(
  "/requests/:id/approve",
  roleGuard("master", "admin"),
  async (c) => {
    const armeiroId = c.get("userId");
    const requestId = c.req.param("id");

    const { data: req, error: fetchErr } = await supabase
      .from("material_requests")
      .select(`
        id, status, military_id,
        items:material_request_items(material_type_id, requested_quantity)
      `)
      .eq("id", requestId)
      .maybeSingle();

    if (fetchErr || !req) return c.json({ error: "Solicitação não encontrada." }, 404);
    if (req.status !== "pendente") {
      return c.json({ error: `Solicitação não pode ser aprovada (status: ${req.status}).` }, 409);
    }

    // Double-check availability at approve time (stock may have changed)
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
        armeiro_id: armeiroId,
        approved_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
      })
      .eq("id", requestId)
      .eq("status", "pendente"); // guard against concurrent updates

    if (updateErr) return c.json({ error: updateErr.message }, 500);

    const expiresAtHHmm = expiresAt.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });

    notifyUser(
      req.military_id,
      "armament_approved",
      "Solicitação Aprovada ✓",
      `Sua solicitação foi aprovada. Retire o material até ${expiresAtHHmm}.`,
      { request_id: requestId, expires_at: expiresAt.toISOString() }
    );

    return c.json({ ok: true, expires_at: expiresAt.toISOString() });
  }
);

// ── PATCH /api/ssa/requests/:id/reject ───────────────────────

ssaRoutes.patch(
  "/requests/:id/reject",
  roleGuard("master", "admin"),
  zValidator(
    "json",
    z.object({
      reason: z.string().min(5, "Informe o motivo da rejeição (mínimo 5 caracteres)."),
    })
  ),
  async (c) => {
    const armeiroId = c.get("userId");
    const requestId = c.req.param("id");
    const { reason } = c.req.valid("json");

    const { data: req } = await supabase
      .from("material_requests")
      .select("id, status, military_id")
      .eq("id", requestId)
      .maybeSingle();

    if (!req) return c.json({ error: "Solicitação não encontrada." }, 404);
    if (req.status !== "pendente") {
      return c.json({ error: `Solicitação não pode ser rejeitada (status: ${req.status}).` }, 409);
    }

    const { error } = await supabase
      .from("material_requests")
      .update({
        status: "rejeitado",
        armeiro_id: armeiroId,
        denial_reason: reason,
        rejected_at: new Date().toISOString(),
      })
      .eq("id", requestId)
      .eq("status", "pendente");

    if (error) return c.json({ error: error.message }, 500);

    notifyUser(
      req.military_id,
      "armament_rejected",
      "Solicitação Não Aprovada",
      `Sua solicitação foi rejeitada. Motivo: ${reason}`,
      { request_id: requestId, reason }
    );

    return c.json({ ok: true });
  }
);

// ── PATCH /api/ssa/requests/:id/deliver ──────────────────────
// Confirms physical pickup. Creates lending records for each item.

ssaRoutes.patch(
  "/requests/:id/deliver",
  roleGuard("master", "admin"),
  async (c) => {
    const armeiroId = c.get("userId");
    const requestId = c.req.param("id");

    await supabase.rpc("expire_material_requests");

    const { data: req } = await supabase
      .from("material_requests")
      .select(`
        id, status, military_id, expires_at,
        items:material_request_items(
          id, material_type_id, requested_quantity, delivered_quantity
        )
      `)
      .eq("id", requestId)
      .maybeSingle();

    if (!req) return c.json({ error: "Solicitação não encontrada." }, 404);

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

    // Create lending records for each item
    const lendingRows = req.items.map(
      (item: {
        material_type_id: string;
        requested_quantity: number;
        delivered_quantity: number | null;
      }) => ({
        military_id: req.military_id,
        master_id: armeiroId,
        material_type_id: item.material_type_id,
        quantidade: item.delivered_quantity ?? item.requested_quantity,
        issued_at: now,
        status: "ativo",
        notes: `Solicitação SSA #${requestId.slice(0, 8)}`,
      })
    );

    const { data: lendings, error: lendingErr } = await supabase
      .from("lendings")
      .insert(lendingRows)
      .select("id");

    if (lendingErr) return c.json({ error: lendingErr.message }, 500);

    // Update request status
    const { error: updateErr } = await supabase
      .from("material_requests")
      .update({
        status: "retirado",
        armeiro_id: armeiroId,
        delivered_at: now,
      })
      .eq("id", requestId)
      .eq("status", "aprovado");

    if (updateErr) return c.json({ error: updateErr.message }, 500);

    notifyUser(
      req.military_id,
      "armament_delivered",
      "Material Retirado ✓",
      "Sua retirada de material foi confirmada pelo armeiro.",
      { request_id: requestId, lending_ids: lendings?.map((l) => l.id) }
    );

    return c.json({ ok: true, lending_ids: lendings?.map((l) => l.id) ?? [] });
  }
);

// ── GET /api/ssa/lookup-military ─────────────────────────────
// Armeiro/Admin: resolve matricula → profile (id, nome_completo, posto, matricula)

ssaRoutes.get("/lookup-military", roleGuard("master", "admin"), async (c) => {
  const matricula = c.req.query("matricula");
  if (!matricula) return c.json({ error: "Parâmetro 'matricula' obrigatório." }, 400);

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, nome_completo, posto, matricula")
    .eq("matricula", matricula)
    .eq("role", "military")
    .maybeSingle();

  if (error) return c.json({ error: error.message }, 500);
  if (!profile) return c.json({ error: "Matrícula não encontrada." }, 404);

  return c.json(profile);
});

// ── POST /api/ssa/modo-a ──────────────────────────────────────
// Modo A (presencial rápido): armeiro valida TOTP do militar on-behalf-of
// e cria + aprova + entrega em uma operação atômica.
// Body: { military_id, totp_token, items: [{material_type_id, quantity}] }

ssaRoutes.post(
  "/modo-a",
  roleGuard("master", "admin"),
  zValidator(
    "json",
    z.object({
      military_id: z.string().uuid(),
      totp_token: z.string().length(6).regex(/^\d{6}$/),
      items: z
        .array(z.object({ material_type_id: z.string().uuid(), quantity: z.number().int().min(1) }))
        .min(1),
    })
  ),
  async (c) => {
    const armeiroId = c.get("userId");
    const { military_id, totp_token, items } = c.req.valid("json");

    // 1. Validate TOTP for the military
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
        return c.json(
          { error: "Militar bloqueado por tentativas excessivas.", retry_after_seconds: remaining },
          429
        );
      }
    }

    const { valid: isValid } = verifySync({ secret: totpData.secret, token: totp_token, afterTimeStep: 1 });
    if (!isValid) {
      await supabase
        .from("totp_secrets")
        .update({ failure_count: (totpData.failure_count || 0) + 1, last_failure_at: new Date().toISOString() })
        .eq("id", totpData.id);
      return c.json({ error: "Código TOTP inválido." }, 400);
    }

    // 2. Validate availability
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

    // 3. Cancel any existing pending/approved request for this military (Modo A bypasses the 1-active rule)
    await supabase
      .from("material_requests")
      .update({ status: "cancelado", cancelled_at: new Date().toISOString() })
      .eq("military_id", military_id)
      .in("status", ["pendente", "aprovado"]);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + EXPIRY_HOURS * 3600 * 1000);

    // 4. Create request (already validated)
    const { data: request, error: reqError } = await supabase
      .from("material_requests")
      .insert({
        military_id,
        armeiro_id: armeiroId,
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

    // 5. Insert items
    const itemRows = items.map((item) => {
      const mat = availMap.get(item.material_type_id)!;
      return {
        request_id: request.id,
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

    // 6. Create lending records immediately (Modo A = entrega imediata)
    const lendingRows = items.map((item) => ({
      military_id,
      master_id: armeiroId,
      material_type_id: item.material_type_id,
      quantidade: item.quantity,
      issued_at: now.toISOString(),
      status: "ativo",
      notes: `Saída Modo A — SSA #${request.id.slice(0, 8)}`,
    }));

    const { data: lendings, error: lendingErr } = await supabase
      .from("lendings")
      .insert(lendingRows)
      .select("id");

    if (lendingErr) {
      await supabase.from("material_requests").delete().eq("id", request.id);
      return c.json({ error: lendingErr.message }, 500);
    }

    // 7. Mark as delivered
    await supabase
      .from("material_requests")
      .update({ status: "retirado", delivered_at: now.toISOString() })
      .eq("id", request.id);

    // 8. Reset TOTP failure count
    await supabase
      .from("totp_secrets")
      .update({ failure_count: 0, last_failure_at: null, last_validated_at: now.toISOString() })
      .eq("id", totpData.id);

    // 9. Notify military
    notifyUser(
      military_id,
      "armament_delivered",
      "Material Retirado via Código ✓",
      "Saída presencial registrada pelo armeiro com seu código de acesso.",
      { request_id: request.id, lending_ids: lendings?.map((l) => l.id) }
    );

    return c.json({ ok: true, request_id: request.id, lending_ids: lendings?.map((l) => l.id) ?? [] });
  }
);

// ── DELETE /api/ssa/requests/:id ─────────────────────────────
// Military: cancel own PENDING request.
// Armeiro/Admin: cancel pending OR approved requests.

ssaRoutes.delete("/requests/:id", async (c) => {
  const userId = c.get("userId");
  const role = c.get("role");
  const requestId = c.req.param("id");

  const { data: req } = await supabase
    .from("material_requests")
    .select("id, status, military_id")
    .eq("id", requestId)
    .maybeSingle();

  if (!req) return c.json({ error: "Solicitação não encontrada." }, 404);

  const isMilitary = role === "military";
  const isStaff = role === "master" || role === "admin";
  const isOwner = req.military_id === userId;

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

  const { error } = await supabase
    .from("material_requests")
    .update({ status: "cancelado", cancelled_at: new Date().toISOString() })
    .eq("id", requestId);

  if (error) return c.json({ error: error.message }, 500);

  // Notify military if cancelled by armeiro
  if (isStaff && req.military_id !== userId) {
    notifyUser(
      req.military_id,
      "armament_rejected",
      "Solicitação Cancelada",
      "Sua solicitação de armamento foi cancelada pelo armeiro.",
      { request_id: requestId }
    );
  }

  return c.json({ ok: true });
});
