/**
 * /api/saidas — Saída Diária Enterprise (item-based, Fase 5)
 *
 * Usa a tabela `lendings` com campos Fase 5: item_id, status, armeiro_signature_id, militar_signature_id.
 * O endpoint legacy /api/lendings continua funcionando para compatibilidade (material_type_id).
 */

import { Hono } from "hono";
import { zValidator } from "../lib/validated-json";
import { z } from "zod";
import { roleGuard } from "../middleware/role-guard";
import { supabase } from "../services/supabase";
import type { HonoVariables } from "../types/hono";
import { scopedReserveIds } from "../lib/reserve-scope";

export const saidasRoutes = new Hono<{ Variables: HonoVariables }>();

const LEGACY_CUSTODY_FLOW_RETIRED = {
  error: "LEGACY_CUSTODY_FLOW_RETIRED",
  message: "Use /api/lendings com verificacao TOTP ou challenge/proof biometrico.",
};

// ─── GET /api/saidas ──────────────────────────────────────────────────────────

saidasRoutes.get(
  "/",
  roleGuard("armeiro", "admin_reserva", "admin_global", "auditor"),
  async (c) => {
    const tenantId  = c.get("tenantId");
    const role      = c.get("role");
    const reserveId = c.get("reserveId");
    const { status, militar_id } = c.req.query();
    if (!tenantId) return c.json({ error: "Tenant nao identificado na sessao" }, 400);

    // Achado real (SP9.5, 2026-09-18): faltava confinamento por reserva —
    // BFF usa service role (bypassa RLS), então sem este filtro qualquer
    // staff via saídas do TENANT INTEIRO. Ver lib/reserve-scope.ts.
    const reserveIds = await scopedReserveIds(role, reserveId, tenantId);
    if (reserveIds.length === 0) return c.json({ saidas: [] });

    let query = supabase
      .from("lendings")
      .select(`
        *,
        item:material_items(id, numero_serie, status_operacional, material_type:material_types(nome, categoria)),
        militar:profiles!lendings_military_id_fkey(id, nome_completo, matricula, posto),
        armeiro:profiles!lendings_master_id_fkey(id, nome_completo, matricula)
      `)
      .not("item_id", "is", null)
      .in("reserve_id", reserveIds)
      .order("issued_at", { ascending: false });

    query = query.eq("tenant_id", tenantId);
    if (status)     query = query.eq("status", status);
    if (militar_id) query = query.eq("military_id", militar_id);

    const { data, error } = await query;
    if (error) return c.json({ error: error.message }, 500);
    return c.json({ saidas: data ?? [] });
  }
);

// ─── POST /api/saidas ─────────────────────────────────────────────────────────

saidasRoutes.post(
  "/",
  roleGuard("armeiro", "admin_reserva", "admin_global"),
  zValidator("json", z.object({
    item_id: z.string().uuid(),
    militar_id: z.string().uuid(),
    reserve_id: z.string().uuid().optional(),
    observacao: z.string().optional(),
  })),
  async (c) => {
    if (!c.get("tenantId")) return c.json({ error: "Tenant nao identificado na sessao" }, 400);
    return c.json(LEGACY_CUSTODY_FLOW_RETIRED, 501);
  },
);

// ─── PATCH /api/saidas/:id/return ────────────────────────────────────────────

saidasRoutes.patch(
  "/:id/return",
  roleGuard("armeiro", "admin_reserva", "admin_global"),
  zValidator("json", z.object({
    observacao: z.string().optional(),
    condicao_devolucao: z.enum(["bom", "regular", "ruim", "inapto"]).optional(),
  })),
  async (c) => {
    if (!c.get("tenantId")) return c.json({ error: "Tenant nao identificado na sessao" }, 400);
    return c.json(LEGACY_CUSTODY_FLOW_RETIRED, 501);
  },
);
