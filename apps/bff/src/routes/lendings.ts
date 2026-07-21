import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getIronSession } from "iron-session";
import { roleGuard } from "../middleware/role-guard";
import { auditAction } from "../middleware/audit";
import { supabase } from "../services/supabase";
import { sessionOptions, type SessionData } from "../lib/session";
import { checkTotpForMatricula } from "./totp";
import { logShiftEvent } from "../lib/shift-events";
import { assertProofScopeAndFreshness, loadBiometricProof } from "../lib/biometric-proof-service";
import type { HonoVariables } from "../types/hono";

const IDENTITY_TTL_MS = 120_000;

const lendingIdentitySchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("totp"),
    matricula: z.string().min(1).max(20),
    code: z.string().length(6).regex(/^\d{6}$/),
    reserve_id: z.string().uuid(),
  }),
  z.object({
    mode: z.literal("biometria"),
    reserve_id: z.string().uuid(),
    biometric_proof_id: z.string().uuid(),
  }),
]);

const lendingBulkReturnSchema = z.object({
  lending_ids: z.array(z.string().uuid()).min(1).max(100),
  notes: z.string().trim().max(1000).optional(),
  operation_id: z.string().uuid().optional(),
});

const lendingBatchSchema = z.object({
  military_id: z.string().uuid(),
  reserve_id: z.string().uuid(),
  movement_id: z.string().uuid(),
  notes: z.string().trim().max(2000).optional(),
  auth_mode: z.enum(["biometria", "totp"]),
  biometric_proof_id: z.string().uuid().optional(),
  items: z.array(z.object({
    material_type_id: z.string().uuid(),
    quantidade: z.number().int().min(1).max(1000),
  })).min(1).max(100),
}).refine(
  (body) => body.auth_mode !== "biometria" || !!body.biometric_proof_id,
  { message: "biometric_proof_id obrigatorio para biometria" },
);

// Acesso do ATOR logado à reserva — admin_global tem escopo cruzado por design
// (Privilege Ceiling H-RBAC), então dispensa checar reserve_memberships próprio.
async function assertActorReserveAccess(actorId: string, role: string | undefined, tenantId: string, reserveId: string) {
  const { data: reserve } = await supabase
    .from("reserves")
    .select("id")
    .eq("id", reserveId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!reserve) return false;
  if (role === "admin_global") return true;

  const { data: membership } = await supabase
    .from("reserve_memberships")
    .select("reserve_id, reserves!inner(tenant_id)")
    .eq("user_id", actorId)
    .eq("reserve_id", reserveId)
    .eq("reserves.tenant_id", tenantId)
    .maybeSingle();
  return !!membership;
}

// Vínculo do MILITAR-ALVO (quem recebe/devolve o material) com a reserva —
// sempre verifica reserve_memberships de fato, mesmo quando o ator é
// admin_global. O privilégio amplo do admin_global é sobre QUEM PODE OPERAR,
// não sobre relaxar a integridade de "esse militar pertence a essa reserva"
// (achado de code review: reusar assertReserveAccess aqui pulava esse check
// silenciosamente sempre que o ator fosse admin_global).
async function assertMilitaryBelongsToReserve(militaryId: string, tenantId: string, reserveId: string) {
  const { data: membership } = await supabase
    .from("reserve_memberships")
    .select("reserve_id, reserves!inner(tenant_id)")
    .eq("user_id", militaryId)
    .eq("reserve_id", reserveId)
    .eq("reserves.tenant_id", tenantId)
    .maybeSingle();
  return !!membership;
}

export const lendingRoutes = new Hono<{ Variables: HonoVariables }>();

// GET /api/lendings/:id — full detail with all relations
lendingRoutes.get("/:id", roleGuard("admin_global", "armeiro", "admin_reserva"), async (c) => {
  const id = c.req.param("id");
  const tenantId = c.get("tenantId");
  const role = c.get("role");
  const reserveId = c.get("reserveId");
  if (!tenantId) return c.json({ error: "Tenant não identificado na sessão" }, 400);
  if (role !== "admin_global" && !reserveId) return c.json({ error: "Reserva nao identificada na sessao" }, 400);

  let query = supabase
    .from("lendings")
    .select(`
      *,
      material_type:material_types(nome, categoria),
      military:profiles!lendings_military_id_fkey(nome_completo, matricula, posto, foto_url),
      master:profiles!lendings_master_id_fkey(nome_completo, matricula, posto),
      material_request:material_requests(id, status, notes, totp_validated)
    `)
    .eq("id", id)
    .eq("tenant_id", tenantId);
  if (role !== "admin_global" && reserveId) query = query.eq("reserve_id", reserveId);
  const { data, error } = await query.single();

  if (error || !data) return c.json({ error: "Saída não encontrada." }, 404);
  return c.json(data);
});

lendingRoutes.get("/", roleGuard("admin_global", "armeiro", "admin_reserva"), async (c) => {
  const { military_id, status, material_type_id } = c.req.query();
  const tenantId = c.get("tenantId");
  const role = c.get("role");
  const reserveId = c.get("reserveId");
  if (!tenantId) return c.json({ error: "Tenant não identificado na sessão" }, 400);
  if (role !== "admin_global" && !reserveId) return c.json({ error: "Reserva nao identificada na sessao" }, 400);

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
  if (role !== "admin_global" && reserveId) query = query.eq("reserve_id", reserveId);
  if (military_id) query = query.eq("military_id", military_id);
  // status agora em status_legacy (Fase 5 criará coluna status canônica)
  if (status) query = query.eq("status_legacy", status);
  if (material_type_id) query = query.eq("material_type_id", material_type_id);

  const { data, error } = await query;
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

lendingRoutes.post(
  "/identify",
  roleGuard("admin_global", "armeiro", "admin_reserva"),
  zValidator("json", lendingIdentitySchema),
  async (c) => {
    const actorId = c.get("userId");
    const tenantId = c.get("tenantId");
    const role = c.get("role");
    const body = c.req.valid("json");
    if (!tenantId || !actorId) return c.json({ error: "Sessao operacional invalida" }, 401);
    if (!(await assertActorReserveAccess(actorId, role, tenantId, body.reserve_id))) {
      return c.json({ error: "Reserva nao autorizada" }, 403);
    }

    let profileId: string;
    let authMode: "totp" | "biometria";
    let biometricProofId: string | undefined;
    let totpClaimId: string | undefined;

    if (body.mode === "totp") {
      const result = await checkTotpForMatricula(body.matricula, tenantId, body.code, actorId);
      if (!result.ok) return c.json({ error: result.error, retry_after_seconds: result.retry_after_seconds }, result.status);
      profileId = result.profile.id;
      authMode = "totp";
      // Claim de consumo único real (travado FOR UPDATE dentro da RPC, não no
      // cookie da sessão — ver 20260714000009_totp_identity_claims.sql).
      // Sem "purpose": este endpoint é compartilhado pelos fluxos de nova
      // saída (/batch, /) e devolução (/bulk-return) — a intenção só fica
      // clara depois, quando o armeiro escolhe a ação na UI. A RPC consumidora
      // grava o próprio operation_id (movement_id ou operation_id) no claim,
      // o que já garante consumo único por operação real.
      const { data: claim, error: claimError } = await supabase
        .from("totp_identity_claims")
        .insert({
          tenant_id: tenantId,
          reserve_id: body.reserve_id,
          actor_id: actorId,
          profile_id: profileId,
        })
        .select("id")
        .single();
      if (claimError || !claim) {
        c.get("log").error({ error: claimError?.message, tenantId, actorId }, "lending.identify.claim_creation_failure");
        return c.json({ error: "Nao foi possivel registrar a identificacao" }, 500);
      }
      totpClaimId = claim.id;
    } else {
      try {
        const loaded = await loadBiometricProof(body.biometric_proof_id, tenantId);
        assertProofScopeAndFreshness(loaded, {
          tenantId,
          reserveId: body.reserve_id,
          actorId,
          purpose: "return",
        });
        if (!loaded.proof.matched_user_id) return c.json({ error: "Prova biometrica sem usuario identificado" }, 401);
        profileId = loaded.proof.matched_user_id;
        biometricProofId = body.biometric_proof_id;
        authMode = "biometria";
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : "Prova biometrica invalida" }, 401);
      }
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, nome_completo, matricula, posto, foto_url")
      .eq("id", profileId)
      .eq("default_tenant_id", tenantId)
      .maybeSingle();
    if (profileError || !profile) return c.json({ error: "Usuario nao pertence ao tenant" }, 404);

    const { data: activeLendings, error: lendingError } = await supabase
      .from("lendings")
      .select("id, quantidade, issued_at, movement_id, material_type:material_types(nome, categoria)")
      .eq("military_id", profileId)
      .eq("tenant_id", tenantId)
      .eq("reserve_id", body.reserve_id)
      .eq("status_legacy", "ativo")
      .order("issued_at", { ascending: false });
    if (lendingError) return c.json({ error: "Nao foi possivel buscar pendencias" }, 500);

    const session = await getIronSession<SessionData>(c.req.raw, c.res, sessionOptions);
    session.pendingIdentity = {
      profile_id: profileId,
      tenant_id: tenantId,
      reserve_id: body.reserve_id,
      identified_at: Date.now(),
      auth_mode: authMode,
      ...(biometricProofId ? { biometric_proof_id: biometricProofId } : {}),
      ...(totpClaimId ? { totp_claim_id: totpClaimId } : {}),
    };
    await session.save();

    return c.json({ profile, active_lendings: activeLendings ?? [] });
  },
);

lendingRoutes.post(
  "/batch",
  roleGuard("admin_global", "armeiro", "admin_reserva"),
  zValidator("json", lendingBatchSchema),
  auditAction("lending.created", "lendings"),
  async (c) => {
    const body = c.req.valid("json");
    const masterId = c.get("userId");
    const tenantId = c.get("tenantId");
    const role = c.get("role");
    if (!tenantId || !masterId) return c.json({ error: "Sessao operacional invalida" }, 401);

    let activeShift: { reserve_id: string } | null = null;
    if (role === "armeiro") {
      const { data } = await supabase
        .from("service_shifts")
        .select("reserve_id")
        .eq("armeiro_id", masterId)
        .eq("status", "ativo")
        .maybeSingle();
      activeShift = data;
      if (!activeShift) {
        return c.json({ error: "SHIFT_REQUIRED", message: "Inicie um turno no Livro Digital antes de registrar movimentacoes." }, 403);
      }
      if (activeShift.reserve_id !== body.reserve_id) return c.json({ error: "Reserva do turno invalida" }, 403);
    }
    if (!(await assertActorReserveAccess(masterId, role, tenantId, body.reserve_id))) {
      return c.json({ error: "Reserva nao autorizada" }, 403);
    }
    if (!(await assertMilitaryBelongsToReserve(body.military_id, tenantId, body.reserve_id))) {
      return c.json({ error: "Militar nao pertence a reserva" }, 403);
    }

    const { data: militaryProfile } = await supabase
      .from("profiles")
      .select("registration_status, nome_completo, matricula, posto")
      .eq("id", body.military_id)
      .eq("default_tenant_id", tenantId)
      .maybeSingle();
    if (!militaryProfile) return c.json({ error: "Militar nao encontrado" }, 404);
    if (militaryProfile.registration_status === "impedimento_administrativo") {
      return c.json({ error: "Militar com impedimento administrativo" }, 403);
    }

    // Checagem no cookie é só fail-fast de UX (evita round-trip ao banco para
    // o caso comum de identidade ausente/expirada) — a garantia real de
    // consumo único é atômica dentro da RPC via totp_identity_claims
    // (session.pendingIdentity não é atômico entre requisições paralelas).
    const session = await getIronSession<SessionData>(c.req.raw, c.res, sessionOptions);
    let totpClaimId: string | undefined;
    if (body.auth_mode === "totp") {
      const identity = session.pendingIdentity;
      if (
        !identity
        || identity.tenant_id !== tenantId
        || identity.profile_id !== body.military_id
        || identity.reserve_id !== body.reserve_id
        || identity.auth_mode !== "totp"
        || !identity.totp_claim_id
        || Date.now() - identity.identified_at > IDENTITY_TTL_MS
      ) {
        return c.json({ error: "IDENTITY_VERIFICATION_REQUIRED", message: "Verifique o militar por TOTP antes de registrar a saida." }, 401);
      }
      totpClaimId = identity.totp_claim_id;
    }

    if (body.auth_mode === "biometria") {
      try {
        const loaded = await loadBiometricProof(body.biometric_proof_id!, tenantId);
        assertProofScopeAndFreshness(loaded, {
          tenantId,
          reserveId: body.reserve_id,
          actorId: masterId,
          purpose: "confirm_saida_militar",
          expectedUserId: body.military_id,
        });
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : "Prova biometrica invalida" }, 409);
      }
    }

    const { data, error } = await supabase.rpc("record_lending_batch", {
      p_tenant_id: tenantId,
      p_master_id: masterId,
      p_military_id: body.military_id,
      p_reserve_id: body.reserve_id,
      p_movement_id: body.movement_id,
      p_notes: body.notes ?? null,
      p_auth_mode: body.auth_mode,
      p_biometric_proof_id: body.biometric_proof_id ?? null,
      p_items: body.items,
      p_totp_claim_id: totpClaimId ?? null,
    });
    if (error?.code === "P0001" || error?.code === "23505") {
      return c.json({ error: error.message ?? "Movimento rejeitado" }, 409);
    }
    if (error || !data) {
      c.get("log").error({ code: error?.code, tenantId, masterId }, "lending.batch_create.persist_failure");
      return c.json({ error: "Nao foi possivel registrar a saida" }, 500);
    }

    const rows = (Array.isArray(data) ? data : [data]) as Array<{ lending_id: string }>;
    await supabase.from("notifications").insert({
      user_id: body.military_id,
      tenant_id: tenantId,
      type: "material_issued",
      title: "Material recebido",
      body: `Voce recebeu ${rows.length} material(is) da Reserva de Armamento.`,
      metadata: { lending_ids: rows.map((row) => row.lending_id), movement_id: body.movement_id },
    });

    // Livro Digital: registro automático — faltava nesta rota (/batch), que é
    // a rota real usada pela tela "Nova Saída" (ver apps/web .../saidas/nova/_form.tsx).
    // A rota singular abaixo (POST /) já tinha essa chamada, mas /batch nunca
    // teve — por isso saídas de armamento não apareciam na linha do tempo do
    // turno ativo do armeiro (achado de produção, matrícula 000003, 2026-07-21).
    // masterId já é garantido non-null pelo guard no topo do handler — sem "if"
    // redundante aqui (achado de code review).
    {
      const { data: materialTypesForLog } = await supabase
        .from("material_types")
        .select("id, nome")
        .eq("tenant_id", tenantId)
        .in("id", body.items.map((item) => item.material_type_id));
      const materialNameById = new Map((materialTypesForLog ?? []).map((mt) => [mt.id, mt.nome]));
      const itemsSummary = body.items
        .map((item) => `${item.quantidade}x ${materialNameById.get(item.material_type_id) ?? "material"}`)
        .join(", ");
      const militarLabel = [militaryProfile.posto, militaryProfile.nome_completo].filter(Boolean).join(" ");
      await logShiftEvent({
        actorId: masterId, tenantId,
        eventType: "saida_autorizada",
        description: `Saída autorizada — ${itemsSummary} para ${militarLabel} (mat. ${militaryProfile.matricula})`,
        subjectId: body.movement_id, subjectType: "lending_batch",
        metadata: { movement_id: body.movement_id, military_id: body.military_id, lending_ids: rows.map((row) => row.lending_id) },
      }).catch(() => {});
    }

    // Consumo único real acontece dentro da RPC (totp_identity_claims,
    // travado FOR UPDATE) — não limpamos o cookie aqui de propósito: um
    // retry legítimo do MESMO movement_id (rede caiu, duplo-clique) precisa
    // continuar batendo no atalho idempotente da RPC, que não exige claim
    // válido para devolver um resultado já persistido. Tentar consumir o
    // claim para um movement_id DIFERENTE é rejeitado pela RPC
    // (LENDING_TOTP_CLAIM_ALREADY_CONSUMED) mesmo com o cookie intacto.

    return c.json({ lendings: rows }, 201);
  },
);

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
      auth_mode: z.enum(["biometria", "totp"]).default("totp"),
      biometric_proof_id: z.string().uuid().optional(),
      reserve_id: z.string().uuid().optional(),
      material_request_id: z.string().uuid().optional(),
      movement_id: z.string().uuid().optional(),
    }).refine(
      (body) => body.auth_mode !== "biometria" || (!!body.biometric_proof_id && !!body.movement_id),
      { message: "biometric_proof_id e movement_id obrigatorios para biometria" },
    )
  ),
  auditAction("lending.created", "lendings"),
  async (c) => {
    const body = c.req.valid("json");
    const masterId = c.get("userId");
    const tenantId = c.get("tenantId");
    const role = c.get("role");
    if (!tenantId) return c.json({ error: "Tenant não identificado na sessão" }, 400);

    // Armeiro deve ter turno ativo para registrar movimentações
    let activeShift: { id: string; reserve_id: string } | null = null;
    if (role === "armeiro" && masterId) {
      const { data } = await supabase
        .from("service_shifts")
        .select("id, reserve_id")
        .eq("armeiro_id", masterId)
        .eq("status", "ativo")
        .maybeSingle();
      activeShift = data;
      if (!activeShift) {
        return c.json({ error: "SHIFT_REQUIRED", message: "Inicie um turno no Livro Digital antes de registrar movimentações." }, 403);
      }
    }

    const operationReserveId = body.reserve_id ?? activeShift?.reserve_id ?? c.get("reserveId");
    if (!operationReserveId) return c.json({ error: "Reserva obrigatoria" }, 400);
    if (!(await assertActorReserveAccess(masterId, role, tenantId, operationReserveId))) {
      return c.json({ error: "Reserva nao autorizada" }, 403);
    }
    if (!(await assertMilitaryBelongsToReserve(body.military_id, tenantId, operationReserveId))) {
      return c.json({ error: "Militar nao pertence a reserva" }, 403);
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

    if (role === "armeiro" && activeShift && operationReserveId !== activeShift.reserve_id) {
      return c.json({ error: "Reserva do turno invalida" }, 403);
    }

    // Checagem no cookie é só fail-fast de UX — a garantia real de consumo
    // único é atômica dentro da RPC via totp_identity_claims. Não limpamos o
    // cookie após sucesso de propósito: um retry legítimo do mesmo
    // movement_id precisa continuar batendo no atalho idempotente da RPC.
    const session = await getIronSession<SessionData>(c.req.raw, c.res, sessionOptions);
    let totpClaimId: string | undefined;
    if (body.auth_mode === "totp") {
      const identity = session.pendingIdentity;
      if (
        !identity
        || identity.tenant_id !== tenantId
        || identity.profile_id !== body.military_id
        || identity.reserve_id !== operationReserveId
        || identity.auth_mode !== "totp"
        || !identity.totp_claim_id
        || Date.now() - identity.identified_at > IDENTITY_TTL_MS
      ) {
        return c.json({ error: "IDENTITY_VERIFICATION_REQUIRED", message: "Verifique o militar por TOTP antes de registrar a saida." }, 401);
      }
      totpClaimId = identity.totp_claim_id;
    }

    let biometricProofId: string | null = null;
    if (body.auth_mode === "biometria") {
      if (!body.biometric_proof_id || !operationReserveId || !body.movement_id) {
        return c.json({ error: "Prova biometrica ou reserva ausente" }, 400);
      }
      try {
        const loadedBiometricProof = await loadBiometricProof(body.biometric_proof_id, tenantId);
        assertProofScopeAndFreshness(loadedBiometricProof, {
          tenantId,
          reserveId: operationReserveId,
          actorId: masterId,
          purpose: "confirm_saida_militar",
          expectedUserId: body.military_id,
        });
        biometricProofId = body.biometric_proof_id;
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : "Prova biometrica invalida" }, 409);
      }
    }

    // Idempotência de movement_id é responsabilidade única da RPC (mesma
    // checagem que o BFF fazia aqui antes, duplicada — achado de code review:
    // duas checagens de idempotência em lugares diferentes podiam divergir
    // na ordem em que rodavam relativo à validação de identidade/prova).
    const { data: batchData, error } = await supabase.rpc("record_lending_batch", {
      p_tenant_id: tenantId,
      p_master_id: masterId,
      p_military_id: body.military_id,
      p_reserve_id: operationReserveId,
      p_movement_id: body.movement_id ?? randomUUID(),
      p_notes: body.notes ?? null,
      p_auth_mode: body.auth_mode,
      p_biometric_proof_id: biometricProofId,
      p_items: [{ material_type_id: body.material_type_id, quantidade: body.quantidade }],
      p_totp_claim_id: totpClaimId ?? null,
    });

    if (error?.code === "23505" || error?.code === "P0001") {
      return c.json({ error: error.message ?? "Movimento rejeitado" }, 409);
    }
    if (error || !batchData) return c.json({ error: error?.message ?? "Erro ao criar saida" }, 500);
    const createdRow = (Array.isArray(batchData) ? batchData[0] : batchData) as { lending_id?: string };
    const data = { id: createdRow.lending_id };
    if (!data.id) return c.json({ error: "Saida criada sem identificador" }, 500);

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
        eventType: "saida_autorizada",
        description: `Saída autorizada — ${body.quantidade}x ${material.nome ?? "material"} para ${militarLabel} (mat. ${militaryProfile.matricula})`,
        subjectId: data.id, subjectType: "lending",
        metadata: { material_type_id: body.material_type_id, military_id: body.military_id, quantidade: body.quantidade },
      }).catch(() => {});
    }

    if (body.auth_mode === "totp") {
      session.pendingIdentity = undefined;
      await session.save();
    }

    return c.json(data, 201);
  }
);

lendingRoutes.post(
  "/bulk-return",
  roleGuard("admin_global", "armeiro", "admin_reserva"),
  zValidator("json", lendingBulkReturnSchema),
  auditAction("lending.returned", "lendings"),
  async (c) => {
    const actorId = c.get("userId");
    const tenantId = c.get("tenantId");
    const role = c.get("role");
    const body = c.req.valid("json");
    if (!tenantId || !actorId) return c.json({ error: "Sessao operacional invalida" }, 401);

    const session = await getIronSession<SessionData>(c.req.raw, c.res, sessionOptions);
    const identity = session.pendingIdentity;
    if (
      !identity
      || identity.tenant_id !== tenantId
      || !identity.reserve_id
      || identity.auth_mode === "manual"
      || Date.now() - identity.identified_at > IDENTITY_TTL_MS
    ) {
      return c.json({ error: "IDENTITY_VERIFICATION_REQUIRED", message: "Identifique o militar antes de registrar a devolucao." }, 401);
    }

    // Armeiro deve ter turno ativo para registrar movimentações — mesmo guard
    // já aplicado em /batch e POST / (achado de code review: bulk-return era
    // a única rota de custódia sem essa checagem, permitindo devoluções sem
    // turno aberto e, por consequência, sem chance de aparecer no Livro
    // Digital já que logShiftEvent não encontra turno ativo para anexar).
    if (role === "armeiro") {
      const { data: activeShift } = await supabase
        .from("service_shifts")
        .select("id, reserve_id")
        .eq("armeiro_id", actorId)
        .eq("status", "ativo")
        .maybeSingle();
      if (!activeShift) {
        return c.json({ error: "SHIFT_REQUIRED", message: "Inicie um turno no Livro Digital antes de registrar movimentações." }, 403);
      }
      if (activeShift.reserve_id !== identity.reserve_id) return c.json({ error: "Reserva do turno invalida" }, 403);
    }

    const uniqueLendingIds = [...new Set(body.lending_ids)];
    const operationId = body.operation_id ?? randomUUID();
    const biometricProofId = identity.auth_mode === "biometria" ? identity.biometric_proof_id ?? null : null;
    if (identity.auth_mode === "biometria" && !biometricProofId) {
      return c.json({ error: "BIOMETRIC_PROOF_REQUIRED" }, 401);
    }
    const totpClaimId = identity.auth_mode === "totp" ? identity.totp_claim_id ?? null : null;
    if (identity.auth_mode === "totp" && !totpClaimId) {
      return c.json({ error: "IDENTITY_VERIFICATION_REQUIRED", message: "Verifique o militar por TOTP antes de registrar a devolucao." }, 401);
    }

    const { data, error } = await supabase.rpc("record_lending_returns", {
      p_tenant_id: tenantId,
      p_actor_id: actorId,
      p_military_id: identity.profile_id,
      p_reserve_id: identity.reserve_id,
      p_lending_ids: uniqueLendingIds,
      p_notes: body.notes ?? null,
      p_biometric_proof_id: biometricProofId,
      p_operation_id: operationId,
      p_totp_claim_id: totpClaimId,
    }).single();
    if (error?.code === "P0001" || error?.code === "23505") {
      return c.json({ error: error.message ?? "Operacao de devolucao rejeitada" }, 409);
    }
    if (error || !data) {
      c.get("log").error({ code: error?.code, tenantId, actorId }, "lending.bulk_return.persist_failure");
      return c.json({ error: "Nao foi possivel registrar a devolucao" }, 500);
    }

    const returnResult = data as { returned_count: number };

    // Livro Digital: registro automático — mesmo gap de /batch (ver acima),
    // esta rota (bulk-return) é a real usada pela tela de devolução
    // (_desarmamento-modal.tsx) e nunca chamou logShiftEvent.
    if (returnResult.returned_count > 0) {
      // status_legacy = 'devolvido' restringe a apenas os itens que este
      // request de fato devolveu — sem esse filtro, numa corrida rara em que
      // a RPC devolve menos itens do que os solicitados (returned_count <
      // uniqueLendingIds.length), a descrição citaria itens que não foram
      // realmente devolvidos nesta operação (achado de code review).
      const [{ data: militaryProfile }, { data: returnedLendings }] = await Promise.all([
        supabase.from("profiles").select("nome_completo, matricula, posto").eq("id", identity.profile_id).eq("default_tenant_id", tenantId).maybeSingle(),
        supabase.from("lendings").select("quantidade, material_type:material_types(nome)")
          .eq("tenant_id", tenantId)
          .eq("status_legacy", "devolvido")
          .in("id", uniqueLendingIds),
      ]);
      const militarLabel = militaryProfile ? [militaryProfile.posto, militaryProfile.nome_completo].filter(Boolean).join(" ") : null;
      const itemsSummary = (returnedLendings ?? [])
        .map((row) => {
          const materialType = Array.isArray(row.material_type) ? row.material_type[0] : row.material_type;
          return `${row.quantidade}x ${materialType?.nome ?? "material"}`;
        })
        .join(", ");
      await logShiftEvent({
        actorId, tenantId,
        eventType: "saida_devolvida",
        description: `Devolução registrada — ${returnResult.returned_count} item(ns)${itemsSummary ? ` (${itemsSummary})` : ""}${militarLabel ? ` de ${militarLabel}` : ""}${militaryProfile?.matricula ? ` (mat. ${militaryProfile.matricula})` : ""}`,
        subjectId: operationId, subjectType: "lending_return",
        metadata: { operation_id: operationId, military_id: identity.profile_id, lending_ids: uniqueLendingIds, returned_count: returnResult.returned_count },
      }).catch(() => {});
    }

    return c.json({ returned: returnResult.returned_count, skipped: uniqueLendingIds.length - returnResult.returned_count });
  },
);

lendingRoutes.patch(
  "/:id/return",
  roleGuard("admin_global", "armeiro", "admin_reserva"),
  auditAction("lending.returned", "lendings"),
  async (c) => {
    if (!c.get("tenantId")) return c.json({ error: "Tenant nao identificado na sessao" }, 400);
    return c.json({
      error: "LEGACY_RETURN_FLOW_RETIRED",
      message: "Use a devolucao por identificacao e /api/lendings/bulk-return.",
    }, 501);
  },
);
