import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getIronSession } from "iron-session";
import { roleGuard } from "../middleware/role-guard";
import { auditAction } from "../middleware/audit";
import { supabase } from "../services/supabase";
import { sessionOptions, type SessionData } from "../lib/session";
import { checkTotpForMatricula } from "./totp";
import { logShiftEvent } from "../lib/shift-events";
import { getFingerprintSDK } from "../services/fingerprint/index";
import type { HonoVariables } from "../types/hono";

const IDENTITY_TTL_MS = 120_000;
const BIOMETRIC_MIN_SCORE = parseFloat(process.env.BIOMETRIC_MIN_SCORE ?? "0.92");

export const lendingRoutes = new Hono<{ Variables: HonoVariables }>();

// GET /api/lendings/:id — full detail with all relations
lendingRoutes.get("/:id", roleGuard("admin_global", "armeiro", "admin_reserva"), async (c) => {
  const id = c.req.param("id");
  const tenantId = c.get("tenantId");
  if (!tenantId) return c.json({ error: "Tenant não identificado na sessão" }, 400);

  const { data, error } = await supabase
    .from("lendings")
    .select(`
      *,
      material_type:material_types(nome, categoria),
      military:profiles!lendings_military_id_fkey(nome_completo, matricula, posto, foto_url),
      master:profiles!lendings_master_id_fkey(nome_completo, matricula, posto),
      material_request:material_requests(id, status, notes, totp_validated)
    `)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .single();

  if (error || !data) return c.json({ error: "Saída não encontrada." }, 404);
  return c.json(data);
});

lendingRoutes.get("/", roleGuard("admin_global", "armeiro", "admin_reserva"), async (c) => {
  const { military_id, status, material_type_id } = c.req.query();
  const tenantId = c.get("tenantId");
  if (!tenantId) return c.json({ error: "Tenant não identificado na sessão" }, 400);

  let query = supabase
    .from("lendings")
    .select(`
      *,
      material_type:material_types(nome, categoria),
      military:profiles!lendings_military_id_fkey(nome_completo, matricula, posto),
      master:profiles!lendings_master_id_fkey(nome_completo)
    `)
    .eq("tenant_id", tenantId)
    .order("issued_at", { ascending: false });
  if (military_id) query = query.eq("military_id", military_id);
  // status agora em status_legacy (Fase 5 criará coluna status canônica)
  if (status) query = query.eq("status_legacy", status);
  if (material_type_id) query = query.eq("material_type_id", material_type_id);

  const { data, error } = await query;
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

lendingRoutes.post(
  "/",
  roleGuard("admin_global", "armeiro", "admin_reserva"),
  zValidator(
    "json",
    z.object({
      material_type_id: z.string().uuid(),
      military_id: z.string().uuid(),
      quantidade: z.number().int().min(1).default(1),
      notes: z.string().optional(),
      auth_mode: z.enum(["biometria", "totp", "manual"]).default("manual"),
      material_request_id: z.string().uuid().optional(),
      movement_id: z.string().uuid().optional(),
    })
  ),
  auditAction("lending.created", "lendings"),
  async (c) => {
    const body = c.req.valid("json");
    const masterId = c.get("userId");
    const tenantId = c.get("tenantId");
    const role = c.get("role");
    if (!tenantId) return c.json({ error: "Tenant não identificado na sessão" }, 400);

    // Armeiro deve ter turno ativo para registrar movimentações
    if (role === "armeiro" && masterId) {
      const { data: activeShift } = await supabase
        .from("service_shifts")
        .select("id")
        .eq("armeiro_id", masterId)
        .eq("status", "ativo")
        .maybeSingle();
      if (!activeShift) {
        return c.json({ error: "SHIFT_REQUIRED", message: "Inicie um turno no Livro Digital antes de registrar movimentações." }, 403);
      }
    }

    // Block armament for military with administrative impediment
    const { data: militaryProfile } = await supabase
      .from("profiles")
      .select("registration_status, nome_completo, matricula, posto")
      .eq("id", body.military_id)
      .eq("default_tenant_id", tenantId)
      .single();

    if (!militaryProfile) return c.json({ error: "Militar não encontrado" }, 404);
    if (militaryProfile?.registration_status === "impedimento_administrativo") {
      return c.json(
        { error: "Militar com impedimento administrativo. Para dúvidas, procure o Departamento de Pessoas de sua unidade." },
        403
      );
    }

    const { data: material } = await supabase
      .from("material_types")
      .select("quantidade_total, nome")
      .eq("id", body.material_type_id)
      .eq("tenant_id", tenantId)
      .single();

    if (!material) return c.json({ error: "Material not found" }, 404);

    const { data: activeCount } = await supabase
      .from("lendings")
      .select("quantidade")
      .eq("material_type_id", body.material_type_id)
      .eq("tenant_id", tenantId)
      .eq("status_legacy", "ativo");

    const totalActive = (activeCount ?? []).reduce(
      (sum, r) => sum + r.quantidade,
      0
    );

    if (totalActive + body.quantidade > material.quantidade_total) {
      return c.json({ error: "Insufficient stock" }, 409);
    }

    const { data, error } = await supabase
      .from("lendings")
      .insert({
        tenant_id:         tenantId,
        material_type_id:  body.material_type_id,
        military_id:       body.military_id,
        quantidade:        body.quantidade,
        notes:             body.notes,
        auth_mode:         body.auth_mode,
        material_request_id: body.material_request_id ?? null,
        master_id:         masterId,
        movement_id:       body.movement_id ?? null,
      })
      .select()
      .single();

    if (error) return c.json({ error: error.message }, 500);

    await supabase.from("notifications").insert({
      user_id:   body.military_id,
      tenant_id: tenantId,
      type:      "material_issued",
      title:     "Material recebido",
      body:      `Você recebeu ${body.quantidade}x material da Reserva de Armamento.`,
      metadata:  { lending_id: data.id, material_type_id: body.material_type_id },
    });

    if (masterId) {
      const militarLabel = [militaryProfile.posto, militaryProfile.nome_completo].filter(Boolean).join(" ");
      await logShiftEvent({
        actorId: masterId, tenantId,
        eventType: "cautela_emitida",
        description: `Cautela emitida — ${body.quantidade}x ${material.nome ?? "material"} para ${militarLabel} (mat. ${militaryProfile.matricula})`,
        subjectId: data.id, subjectType: "lending",
        metadata: { material_type_id: body.material_type_id, military_id: body.military_id, quantidade: body.quantidade },
      }).catch(() => {});
    }

    return c.json(data, 201);
  }
);

lendingRoutes.patch(
  "/:id/return",
  roleGuard("admin_global", "armeiro", "admin_reserva"),
  auditAction("lending.returned", "lendings"),
  async (c) => {
    const id = c.req.param("id");
    const tenantId = c.get("tenantId");
    if (!tenantId) return c.json({ error: "Tenant não identificado na sessão" }, 400);

    const { data, error } = await supabase
      .from("lendings")
      .update({ status_legacy: "devolvido", returned_at: new Date().toISOString() })
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .eq("status_legacy", "ativo")
      .select(`
        *,
        military:profiles!lendings_military_id_fkey(id, nome_completo, matricula, posto),
        material_type:material_types(nome)
      `)
      .single();

    if (error || !data) return c.json({ error: "Lending not found or already returned" }, 404);

    await supabase.from("notifications").insert({
      user_id: (data.military as any).id,
      type: "material_returned",
      title: "Material devolvido",
      body: "Sua devolução de material foi registrada com sucesso.",
      metadata: { lending_id: id },
    });

    const actorId = c.get("userId");
    if (actorId && tenantId) {
      const returnedMilitary = Array.isArray(data.military) ? data.military[0] : data.military;
      const returnedMaterialType = Array.isArray(data.material_type) ? data.material_type[0] : data.material_type;
      const returnedMilitarLabel = returnedMilitary ? [returnedMilitary.posto, returnedMilitary.nome_completo].filter(Boolean).join(" ") : null;
      await logShiftEvent({
        actorId, tenantId,
        eventType: "cautela_devolvida",
        description: `Cautela devolvida${returnedMaterialType?.nome ? ` — ${data.quantidade ?? 1}x ${returnedMaterialType.nome}` : ""}${returnedMilitarLabel ? ` de ${returnedMilitarLabel}` : ""}`,
        subjectId: id, subjectType: "lending",
        metadata: { lending_id: id },
      }).catch(() => {});
    }

    return c.json(data);
  }
);

// ── POST /api/lendings/identify ───────────────────────────────
// Identifica o militar antes da devolução (identity-first).
// Armazena pendingIdentity na sessão com TTL de 2min.
const identifySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("totp"), matricula: z.string().min(1).max(20), code: z.string().length(6).regex(/^\d{6}$/) }),
  z.object({ mode: z.literal("biometria") }),
  z.object({ mode: z.literal("manual"), military_id: z.string().uuid() }),
]);

lendingRoutes.post(
  "/identify",
  roleGuard("admin_global", "armeiro", "admin_reserva"),
  zValidator("json", identifySchema),
  async (c) => {
    const actorId = c.get("userId");
    const tenantId = c.get("tenantId");
    if (!tenantId) return c.json({ error: "Tenant não identificado" }, 400);

    const body = c.req.valid("json");
    const session = await getIronSession<SessionData>(c.req.raw, c.res, sessionOptions);

    let profileResult: { id: string; nome_completo: string; matricula: string; posto: string | null; foto_url: string | null } | null = null;
    let auth_mode: "totp" | "biometria" | "manual" = body.mode;
    let match_score: number | undefined;

    if (body.mode === "totp") {
      const result = await checkTotpForMatricula(body.matricula, tenantId, body.code, actorId);
      if (!result.ok) {
        return c.json({ error: result.error, retry_after_seconds: (result as any).retry_after_seconds }, result.status as 404 | 422 | 429 | 401);
      }
      profileResult = result.profile;
    } else if (body.mode === "biometria") {
      const sdk = await getFingerprintSDK();
      const captured = await sdk.capture(1);
      const { data: templates } = await supabase.from("biometric_templates").select("user_id, template_data");
      const result = await sdk.identify(captured.data, (templates ?? []).map((t) => ({
        userId: t.user_id, templateData: Buffer.from(t.template_data),
      })));
      if (!result || result.score < BIOMETRIC_MIN_SCORE) {
        return c.json({ error: "Confiança biométrica insuficiente", score: result?.score ?? 0, threshold: BIOMETRIC_MIN_SCORE }, 401);
      }
      match_score = result.score;
      const { data: prof } = await supabase
        .from("profiles")
        .select("id, nome_completo, matricula, posto, foto_url")
        .eq("id", result.userId)
        .eq("default_tenant_id", tenantId)
        .maybeSingle();
      if (!prof) return c.json({ error: "Militar não encontrado neste tenant" }, 404);
      profileResult = prof;
    } else {
      // manual — apenas admin_global
      const role = c.get("role") as string;
      if (role !== "admin_global") return c.json({ error: "Modo manual disponível apenas para admin_global" }, 403);
      const { data: prof } = await supabase
        .from("profiles")
        .select("id, nome_completo, matricula, posto, foto_url")
        .eq("id", body.military_id)
        .eq("default_tenant_id", tenantId)
        .maybeSingle();
      if (!prof) return c.json({ error: "Militar não encontrado" }, 404);
      profileResult = prof;
    }

    // Busca lendings ativos
    const { data: activeLendings } = await supabase
      .from("lendings")
      .select("id, quantidade, issued_at, movement_id, material_type:material_types(nome, categoria)")
      .eq("military_id", profileResult.id)
      .eq("tenant_id", tenantId)
      .eq("status_legacy", "ativo")
      .order("issued_at", { ascending: false });

    session.pendingIdentity = {
      profile_id: profileResult.id,
      tenant_id: tenantId,
      identified_at: Date.now(),
      auth_mode,
      match_score,
    };
    await session.save();

    await supabase.from("audit_logs").insert({
      actor_id: actorId, action: `lending.identify.${auth_mode}`,
      resource_type: "lendings", resource_id: null,
      metadata: { military_id: profileResult.id, match_score, tenant_id: tenantId },
    });

    return c.json({ profile: profileResult, active_lendings: activeLendings ?? [] });
  }
);

// ── POST /api/lendings/bulk-return ────────────────────────────
// Devolução em lote vinculada ao pendingIdentity da sessão.
lendingRoutes.post(
  "/bulk-return",
  roleGuard("admin_global", "armeiro", "admin_reserva"),
  zValidator("json", z.object({
    lending_ids: z.array(z.string().uuid()).min(1).max(50),
    notes: z.string().max(500).optional(),
  })),
  async (c) => {
    const actorId = c.get("userId");
    const tenantId = c.get("tenantId");
    if (!tenantId) return c.json({ error: "Tenant não identificado" }, 400);

    const session = await getIronSession<SessionData>(c.req.raw, c.res, sessionOptions);
    const identity = session.pendingIdentity;

    if (!identity) return c.json({ error: "Sessão de identificação não encontrada. Identifique o militar primeiro." }, 401);
    if (Date.now() - identity.identified_at > IDENTITY_TTL_MS) {
      delete session.pendingIdentity;
      await session.save();
      return c.json({ error: "Sessão de identificação expirada. Identifique o militar novamente." }, 401);
    }
    if (identity.tenant_id !== tenantId) return c.json({ error: "Tenant inválido" }, 403);

    const { lending_ids, notes } = c.req.valid("json");

    // Valida que todos os lendings pertencem ao militar identificado e ao tenant
    const { data: lendings, error: fetchErr } = await supabase
      .from("lendings")
      .select("id, status_legacy, military_id, tenant_id, item_id")
      .in("id", lending_ids);

    if (fetchErr) return c.json({ error: fetchErr.message }, 500);

    const unauthorized = (lendings ?? []).find(
      (l) => l.military_id !== identity.profile_id || l.tenant_id !== tenantId
    );
    if (unauthorized) return c.json({ error: "Um ou mais materiais não pertencem ao militar identificado" }, 403);

    const activeIds = (lendings ?? []).filter((l) => l.status_legacy === "ativo").map((l) => l.id);
    const skipped = lending_ids.length - activeIds.length;

    if (activeIds.length > 0) {
      const { data: updatedLendings, error: updateErr } = await supabase
        .from("lendings")
        .update({ status_legacy: "devolvido", returned_at: new Date().toISOString(), notes: notes ?? null })
        .in("id", activeIds)
        .eq("tenant_id", tenantId)
        .eq("status_legacy", "ativo")
        .select("id");

      if (updateErr) return c.json({ error: updateErr.message }, 500);
      if ((updatedLendings ?? []).length !== activeIds.length) {
        return c.json({ error: "Um ou mais materiais mudaram de estado antes da devolução" }, 409);
      }

      // Phase 5 compat: atualiza material_items se rastreados
      const trackedItems = (lendings ?? []).filter((l) => l.item_id && activeIds.includes(l.id));
      if (trackedItems.length > 0) {
        const { data: updatedItems, error: itemErr } = await supabase
          .from("material_items")
          .update({ status_operacional: "disponivel", current_holder_user_id: null, active_lending_id: null })
          .in("active_lending_id", activeIds)
          .eq("tenant_id", tenantId)
          .select("id");
        if (itemErr) return c.json({ error: itemErr.message }, 500);
        if ((updatedItems ?? []).length !== trackedItems.length) {
          return c.json({ error: "Um ou mais itens não puderam ser liberados" }, 409);
        }
      }
    }

    // Notificação ao militar
    if (activeIds.length > 0) {
      await supabase.from("notifications").insert({
        user_id: identity.profile_id,
        type: "material_returned",
        title: "Materiais recebidos",
        body: `${activeIds.length} ${activeIds.length === 1 ? "material foi recebido" : "materiais foram recebidos"} pelo armeiro.`,
        metadata: { lending_ids: activeIds, returned_by: actorId },
      });
    }

    delete session.pendingIdentity;
    await session.save();

    await supabase.from("audit_logs").insert({
      actor_id: actorId, action: "lending.bulk_returned",
      resource_type: "lendings", resource_id: null,
      metadata: {
        military_id: identity.profile_id, lending_ids: activeIds,
        count: activeIds.length, skipped, auth_mode: identity.auth_mode,
        match_score: identity.match_score, tenant_id: tenantId,
      },
    });

    return c.json({ returned: activeIds.length, skipped, lending_ids: activeIds });
  }
);

// DELETE /api/lendings/:id — rollback de lending ativo recém-criado pelo próprio armeiro
// Usado apenas para compensação atômica quando múltiplos itens são enviados sequencialmente
// e um falha depois de outros já terem sido criados com sucesso.
lendingRoutes.delete("/:id", roleGuard("armeiro", "admin_global", "admin_reserva"), async (c) => {
  const id = c.req.param("id");
  const tenantId = c.get("tenantId");
  const actorId = c.get("userId");
  if (!tenantId) return c.json({ error: "Tenant não identificado na sessão" }, 400);

  // Só permite deletar lendings ativos do próprio tenant
  const { data: lending, error } = await supabase
    .from("lendings")
    .select("id, status_legacy, master_id, tenant_id")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .single();

  if (error || !lending) return c.json({ error: "Lending não encontrado" }, 404);
  if (lending.status_legacy !== "ativo") return c.json({ error: "Apenas lendings ativos podem ser cancelados" }, 422);

  const { data: deletedLending, error: delError } = await supabase
    .from("lendings")
    .delete()
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .eq("status_legacy", "ativo")
    .select("id")
    .single();
  if (delError || !deletedLending) return c.json({ error: "Falha ao cancelar lending" }, 500);

  await supabase.from("audit_logs").insert({
    actor_id: actorId, action: "lending.rollback",
    resource_type: "lendings", resource_id: id,
    metadata: { tenant_id: tenantId, reason: "atomic_submission_rollback" },
  });

  return c.json({ ok: true });
});
