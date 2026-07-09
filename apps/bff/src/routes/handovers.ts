import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { createHash } from "node:crypto";
import { supabase } from "../services/supabase";
import { roleGuard } from "../middleware/role-guard";
import { auditLog } from "../middleware/audit";
import type { HonoVariables } from "../types/hono";
import { generateTurnSnapshot } from "../lib/snapshot";
import { generateHandoverPdf } from "../lib/pdf/handover-pdf";
import { checkTotpGuard } from "../lib/totp-guard";
import { readSecret } from "./totp";

export const handoversRoutes = new Hono<{ Variables: HonoVariables }>();

function makeDocHash(fields: Record<string, unknown>): string {
  return createHash("sha256")
    .update(JSON.stringify(fields))
    .digest("hex")
    .slice(0, 32);
}

async function validateTotp(
  userId: string,
  token: string
): Promise<{ ok: boolean; error?: string; status?: number }> {
  const { data: row } = await supabase
    .from("totp_secrets")
    .select("id, secret, failure_count, last_failure_at, last_used_token")
    .eq("user_id", userId)
    .maybeSingle();

  if (!row) return { ok: false, error: "TOTP não configurado", status: 404 };

  let plainSecret: string;
  try {
    plainSecret = await readSecret(row.secret);
  } catch {
    return { ok: false, error: "TOTP secret inválido. Reconfigure o autenticador em 'Meu Perfil'.", status: 400 };
  }

  const result = checkTotpGuard({ ...row, secret: plainSecret }, token);

  if (!result.ok) {
    if (result.status === 400 && result.error === "TOTP inválido") {
      await supabase
        .from("totp_secrets")
        .update({ failure_count: (row.failure_count ?? 0) + 1, last_failure_at: new Date().toISOString() })
        .eq("id", row.id);
    }
    return result;
  }

  await supabase
    .from("totp_secrets")
    .update({ failure_count: 0, last_used_token: token })
    .eq("id", row.id);

  return { ok: true };
}

// ── Schema ──────────────────────────────────────────────────────────────────

const createSchema = z.object({
  reserve_id:        z.string().uuid(),
  observacao_saindo: z.string().max(500).optional(),
  prazo_assumcao:    z.string().datetime().optional(),
});

const signSchema = z.object({
  totp_token: z.string().min(6).max(8),
});

const assignSchema = z.object({
  entrando_id: z.string().uuid(),
});

const divergenceSchema = z.object({
  descricao: z.string().min(10).max(1000),
});

// ── POST /api/handovers — Criar passagem + snapshot ──────────────────────────

handoversRoutes.post(
  "/",
  roleGuard("armeiro", "admin_reserva", "admin_global", "superadmin"),
  zValidator("json", createSchema),
  async (c) => {
    const body     = c.req.valid("json");
    const tenantId = c.get("tenantId");
    const saidoId  = c.get("userId")!;

    // Verificar que o armeiro pertence à reserva
    const { data: membership } = await supabase
      .from("reserve_memberships")
      .select("id")
      .eq("user_id", saidoId)
      .eq("reserve_id", body.reserve_id)
      .maybeSingle();

    const role = c.get("role");
    if (!membership && !["admin_global", "superadmin"].includes(role ?? "")) {
      return c.json({ error: "Você não pertence a esta reserva" }, 403);
    }

    // Snapshot automático do turno
    const snapshot = await generateTurnSnapshot(body.reserve_id, tenantId ?? "");

    const docHash = makeDocHash({
      reserve_id: body.reserve_id,
      saindo_id: saidoId,
      data_emissao: new Date().toISOString(),
    });

    const { data: handover, error } = await supabase
      .from("service_handovers")
      .insert({
        tenant_id:        tenantId,
        reserve_id:       body.reserve_id,
        saindo_id:        saidoId,
        observacao_saindo: body.observacao_saindo,
        prazo_assumcao:   body.prazo_assumcao,
        report_snapshot:  snapshot,
        document_hash:    docHash,
        status:           "aguardando_assinatura_saida",
      })
      .select("id, status, document_hash, created_at")
      .single();

    if (error || !handover) {
      return c.json({ error: "Erro ao criar passagem" }, 500);
    }

    auditLog(c, {
      action: "handover.created",
      resource_type: "service_handover",
      resource_id: handover.id,
      metadata: { reserve_id: body.reserve_id, saindo_id: saidoId },
    });

    return c.json({ ok: true, handover_id: handover.id, document_hash: docHash }, 201);
  }
);

// ── GET /api/handovers — Listar passagens ────────────────────────────────────

handoversRoutes.get(
  "/",
  roleGuard("armeiro", "admin_reserva", "admin_global", "superadmin", "auditor"),
  async (c) => {
    const tenantId  = c.get("tenantId");
    const userId    = c.get("userId")!;
    const role      = c.get("role");
    const reserveId = c.req.query("reserve_id");
    const status    = c.req.query("status");

    let query = supabase
      .from("service_handovers")
      .select(`
        id, status, created_at, updated_at, prazo_assumcao,
        saindo:profiles!service_handovers_saindo_id_fkey(nome_completo, matricula),
        entrando:profiles!service_handovers_entrando_id_fkey(nome_completo, matricula),
        reserve:reserves(nome, acronym)
      `)
      .order("created_at", { ascending: false })
      .limit(50);

    if (tenantId) query = query.eq("tenant_id", tenantId);
    if (reserveId) query = query.eq("reserve_id", reserveId);
    if (status)   query = query.eq("status", status);

    // Armeiro só vê passagens onde participa
    if (role === "armeiro") {
      query = query.or(`saindo_id.eq.${userId},entrando_id.eq.${userId}`);
    }

    const { data, error } = await query;
    if (error) return c.json({ error: "Erro ao buscar passagens" }, 500);

    return c.json({ handovers: data ?? [] });
  }
);

// ── GET /api/handovers/:id — Detalhar passagem ───────────────────────────────

handoversRoutes.get(
  "/:id",
  roleGuard("armeiro", "admin_reserva", "admin_global", "superadmin", "auditor"),
  async (c) => {
    const id       = c.req.param("id");
    const tenantId = c.get("tenantId");
    const userId   = c.get("userId")!;
    const role     = c.get("role");

    const { data, error } = await supabase
      .from("service_handovers")
      .select(`
        id, tenant_id, status, document_hash, created_at, updated_at, prazo_assumcao,
        observacao_saindo, observacao_entrada, divergencia_descricao, pdf_storage_path,
        report_snapshot,
        saindo:profiles!service_handovers_saindo_id_fkey(id, nome_completo, matricula),
        entrando:profiles!service_handovers_entrando_id_fkey(id, nome_completo, matricula),
        reserve:reserves(id, nome, acronym),
        saindo_sig:document_signatures!service_handovers_saindo_signature_id_fkey(id, signed_at),
        entrada_sig:document_signatures!service_handovers_entrada_signature_id_fkey(id, signed_at)
      `)
      .eq("id", id)
      .single();

    if (error || !data) return c.json({ error: "Passagem não encontrada" }, 404);
    if (tenantId && (data as { tenant_id?: string }).tenant_id !== tenantId)
      return c.json({ error: "Passagem não encontrada" }, 404);

    // Armeiro só acessa se participa
    if (role === "armeiro") {
      const saindo   = (Array.isArray(data.saindo) ? data.saindo[0] : data.saindo) as { id: string } | null;
      const entrando = (Array.isArray(data.entrando) ? data.entrando[0] : data.entrando) as { id: string } | null;
      if (saindo?.id !== userId && entrando?.id !== userId) {
        return c.json({ error: "Acesso negado" }, 403);
      }
    }

    return c.json({ handover: data });
  }
);

// ── POST /api/handovers/:id/sign-exit — Armeiro saindo assina ───────────────

handoversRoutes.post(
  "/:id/sign-exit",
  roleGuard("armeiro", "admin_reserva", "admin_global", "superadmin"),
  zValidator("json", signSchema),
  async (c) => {
    const id       = c.req.param("id");
    const body     = c.req.valid("json");
    const tenantId = c.get("tenantId");
    const userId   = c.get("userId")!;

    const { data: handover } = await supabase
      .from("service_handovers")
      .select("id, status, saindo_id, document_hash, saindo_signature_id, tenant_id")
      .eq("id", id)
      .single();

    if (!handover) return c.json({ error: "Passagem não encontrada" }, 404);
    if (tenantId && (handover as { tenant_id?: string }).tenant_id !== tenantId)
      return c.json({ error: "Passagem não encontrada" }, 404);
    if ((handover as { saindo_id: string }).saindo_id !== userId)
      return c.json({ error: "Apenas o armeiro saindo pode assinar esta etapa" }, 403);
    if (handover.status !== "aguardando_assinatura_saida")
      return c.json({ error: `Status inválido: ${handover.status}` }, 422);
    if ((handover as { saindo_signature_id?: string | null }).saindo_signature_id)
      return c.json({ error: "Já assinado" }, 422);

    const totpResult = await validateTotp(userId, body.totp_token);
    if (!totpResult.ok)
      return c.json({ error: totpResult.error }, (totpResult.status ?? 400) as 400 | 404 | 429);

    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "127.0.0.1";
    const { data: sig } = await supabase
      .from("document_signatures")
      .insert({
        tenant_id:       tenantId,
        document_id:     id,
        document_type:   "handover",
        signer_id:       userId,
        signer_role:     "saindo",
        signed_at:       new Date().toISOString(),
        document_hash:   (handover as { document_hash?: string | null }).document_hash ?? "",
        signature_proof: `${(handover as { document_hash?: string | null }).document_hash}:${userId}:saindo`,
        ip,
        totp_verified:   true,
        biometric_verified: false,
      })
      .select("id")
      .single();

    if (!sig) return c.json({ error: "Erro ao criar assinatura" }, 500);

    await supabase
      .from("service_handovers")
      .update({ saindo_signature_id: sig.id, status: "aguardando_atribuicao" })
      .eq("id", id);

    auditLog(c, {
      action: "handover.signed",
      resource_type: "service_handover",
      resource_id: id,
      metadata: { role: "saindo", signature_id: sig.id },
    });

    return c.json({ ok: true, signature_id: sig.id });
  }
);

// ── POST /api/handovers/:id/assign-entry — Atribuir armeiro entrante ─────────

handoversRoutes.post(
  "/:id/assign-entry",
  roleGuard("admin_reserva", "admin_global", "superadmin"),
  zValidator("json", assignSchema),
  async (c) => {
    const id         = c.req.param("id");
    const body       = c.req.valid("json");
    const tenantId   = c.get("tenantId");

    const { data: handover } = await supabase
      .from("service_handovers")
      .select("id, status, saindo_id, tenant_id, reserve_id")
      .eq("id", id)
      .single();

    if (!handover) return c.json({ error: "Passagem não encontrada" }, 404);
    if (tenantId && (handover as { tenant_id?: string }).tenant_id !== tenantId)
      return c.json({ error: "Passagem não encontrada" }, 404);
    if (handover.status !== "aguardando_atribuicao")
      return c.json({ error: `Status inválido: ${handover.status}` }, 422);

    // Armeiro entrante não pode ser o mesmo que saindo
    if ((handover as { saindo_id: string }).saindo_id === body.entrando_id)
      return c.json({ error: "O mesmo armeiro não pode assinar como saindo e entrante" }, 422);

    const prazo = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(); // +2h

    await supabase
      .from("service_handovers")
      .update({
        entrando_id: body.entrando_id,
        status: "aguardando_assinatura_entrada",
        prazo_assumcao: prazo,
      })
      .eq("id", id);

    auditLog(c, {
      action: "handover.entry_assigned",
      resource_type: "service_handover",
      resource_id: id,
      metadata: { entrando_id: body.entrando_id },
    });

    return c.json({ ok: true, prazo_assumcao: prazo });
  }
);

// ── POST /api/handovers/:id/sign-entry — Armeiro entrante assina ─────────────

handoversRoutes.post(
  "/:id/sign-entry",
  roleGuard("armeiro", "admin_reserva", "admin_global", "superadmin"),
  zValidator("json", signSchema),
  async (c) => {
    const id       = c.req.param("id");
    const body     = c.req.valid("json");
    const tenantId = c.get("tenantId");
    const userId   = c.get("userId")!;

    const { data: handover } = await supabase
      .from("service_handovers")
      .select("id, status, saindo_id, entrando_id, document_hash, entrada_signature_id, tenant_id")
      .eq("id", id)
      .single();

    if (!handover) return c.json({ error: "Passagem não encontrada" }, 404);
    const hw = handover as unknown as {
      tenant_id?: string; saindo_id: string; entrando_id?: string | null;
      status: string; document_hash?: string | null;
      entrada_signature_id?: string | null;
    };
    if (tenantId && hw.tenant_id !== tenantId)
      return c.json({ error: "Passagem não encontrada" }, 404);

    const h = hw;

    if (h.entrando_id !== userId)
      return c.json({ error: "Apenas o armeiro entrante pode assinar esta etapa" }, 403);
    if (h.saindo_id === userId)
      return c.json({ error: "O mesmo armeiro não pode assinar os dois lados" }, 422);
    if (h.status !== "aguardando_assinatura_entrada")
      return c.json({ error: `Status inválido: ${h.status}` }, 422);
    if (h.entrada_signature_id)
      return c.json({ error: "Já assinado" }, 422);

    const totpResult = await validateTotp(userId, body.totp_token);
    if (!totpResult.ok)
      return c.json({ error: totpResult.error }, (totpResult.status ?? 400) as 400 | 404 | 429);

    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "127.0.0.1";
    const { data: sig } = await supabase
      .from("document_signatures")
      .insert({
        tenant_id:       tenantId,
        document_id:     id,
        document_type:   "handover",
        signer_id:       userId,
        signer_role:     "entrante",
        signed_at:       new Date().toISOString(),
        document_hash:   h.document_hash ?? "",
        signature_proof: `${h.document_hash}:${userId}:entrante`,
        ip,
        totp_verified:   true,
        biometric_verified: false,
      })
      .select("id")
      .single();

    if (!sig) return c.json({ error: "Erro ao criar assinatura" }, 500);

    await supabase
      .from("service_handovers")
      .update({ entrada_signature_id: sig.id, status: "concluido" })
      .eq("id", id);

    auditLog(c, {
      action: "handover.signed",
      resource_type: "service_handover",
      resource_id: id,
      metadata: { role: "entrante", signature_id: sig.id },
    });

    return c.json({ ok: true, signature_id: sig.id });
  }
);

// ── POST /api/handovers/:id/report-divergence — Registrar divergência ────────

handoversRoutes.post(
  "/:id/report-divergence",
  roleGuard("armeiro", "admin_reserva", "admin_global", "superadmin"),
  zValidator("json", divergenceSchema),
  async (c) => {
    const id       = c.req.param("id");
    const body     = c.req.valid("json");
    const tenantId = c.get("tenantId");
    const userId   = c.get("userId")!;

    const { data: handover } = await supabase
      .from("service_handovers")
      .select("id, status, entrando_id, tenant_id")
      .eq("id", id)
      .single();

    if (!handover) return c.json({ error: "Passagem não encontrada" }, 404);
    if (tenantId && (handover as { tenant_id?: string }).tenant_id !== tenantId)
      return c.json({ error: "Passagem não encontrada" }, 404);

    const h = handover as { status: string; entrando_id?: string | null };

    if (h.entrando_id !== userId && !["admin_reserva", "admin_global", "superadmin"].includes(c.get("role") ?? ""))
      return c.json({ error: "Apenas o armeiro entrante pode reportar divergência" }, 403);
    if (h.status !== "aguardando_assinatura_entrada")
      return c.json({ error: `Status inválido: ${h.status}` }, 422);

    await supabase
      .from("service_handovers")
      .update({ status: "divergencia", divergencia_descricao: body.descricao })
      .eq("id", id);

    auditLog(c, {
      action: "handover.divergence",
      resource_type: "service_handover",
      resource_id: id,
      metadata: { descricao: body.descricao.slice(0, 100) },
    });

    return c.json({ ok: true });
  }
);

// ── GET /api/handovers/:id/pdf — Gerar PDF ───────────────────────────────────

handoversRoutes.get(
  "/:id/pdf",
  roleGuard("armeiro", "admin_reserva", "admin_global", "superadmin", "auditor"),
  async (c) => {
    const id       = c.req.param("id");
    const tenantId = c.get("tenantId");

    const { data } = await supabase
      .from("service_handovers")
      .select(`
        id, tenant_id, status, document_hash, created_at, divergencia_descricao,
        observacao_saindo, observacao_entrada, report_snapshot,
        saindo:profiles!service_handovers_saindo_id_fkey(nome_completo, matricula),
        entrando:profiles!service_handovers_entrando_id_fkey(nome_completo, matricula),
        reserve:reserves(nome, acronym),
        saindo_sig:document_signatures!service_handovers_saindo_signature_id_fkey(signed_at),
        entrada_sig:document_signatures!service_handovers_entrada_signature_id_fkey(signed_at)
      `)
      .eq("id", id)
      .single();

    if (!data) return c.json({ error: "Passagem não encontrada" }, 404);
    const raw = data as unknown as Record<string, unknown>;
    if (tenantId && raw["tenant_id"] !== tenantId)
      return c.json({ error: "Passagem não encontrada" }, 404);

    const pick1 = <T>(v: unknown): T | null => {
      if (!v) return null;
      return (Array.isArray(v) ? v[0] : v) as T ?? null;
    };

    const pdfBytes = await generateHandoverPdf({
      id: raw["id"] as string,
      document_hash: raw["document_hash"] as string ?? "",
      created_at: raw["created_at"] as string,
      reserve: pick1<{ nome: string; acronym: string }>(raw["reserve"]) ?? { nome: "Reserva", acronym: "RES" },
      saindo: pick1<{ nome_completo: string; matricula: string }>(raw["saindo"]) ?? { nome_completo: "—", matricula: "—" },
      entrando: pick1<{ nome_completo: string; matricula: string }>(raw["entrando"]),
      observacao_saindo: raw["observacao_saindo"] as string | null,
      observacao_entrada: raw["observacao_entrada"] as string | null,
      divergencia_descricao: raw["divergencia_descricao"] as string | null,
      status: raw["status"] as string,
      snapshot: raw["report_snapshot"] as Parameters<typeof generateHandoverPdf>[0]["snapshot"],
      saindo_assinatura_at: (pick1<{ signed_at: string }>(raw["saindo_sig"]))?.signed_at,
      entrada_assinatura_at: (pick1<{ signed_at: string }>(raw["entrada_sig"]))?.signed_at,
    });

    return new Response(pdfBytes.buffer as ArrayBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="passagem-${id.slice(0, 8)}.pdf"`,
      },
    });
  }
);

// ── GET /api/handovers/:id/verify — Verificação pública (sem auth) ────────────
// Endpoint público para scan de QR code: qualquer pessoa com o PDF pode verificar.

handoversRoutes.get("/:id/verify", async (c) => {
  const id = c.req.param("id");

  const { data } = await supabase
    .from("service_handovers")
    .select("id, document_hash, status, created_at, reserve:reserves(nome, acronym)")
    .eq("id", id)
    .single();

  if (!data) return c.json({ verified: false, error: "not_found" }, 404);

  const raw = data as unknown as Record<string, unknown>;
  const reserve = Array.isArray(raw["reserve"]) ? raw["reserve"][0] : raw["reserve"];

  return c.json({
    verified: true,
    id: raw["id"],
    document_hash: raw["document_hash"],
    status: raw["status"],
    created_at: raw["created_at"],
    reserve: reserve ?? null,
  });
});
