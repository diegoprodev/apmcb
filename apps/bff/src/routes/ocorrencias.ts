import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { roleGuard } from "../middleware/role-guard";
import { supabase } from "../services/supabase";
import type { HonoVariables } from "../types/hono";

export const ocorrenciasRoutes = new Hono<{ Variables: HonoVariables }>();

// ── POST /api/ocorrencias ─────────────────────────────────────
// Military reports a problem with a material.

ocorrenciasRoutes.post(
  "/",
  roleGuard("usuario"),
  zValidator(
    "json",
    z.object({
      lending_id:            z.string().uuid().optional(),
      material_type_id:      z.string().uuid().optional(),
      material_nome_snapshot: z.string().max(200).optional(),
      titulo:   z.string().min(5, "Título deve ter ao menos 5 caracteres.").max(150),
      descricao: z.string().min(10, "Descreva o problema com ao menos 10 caracteres.").max(2000),
    })
  ),
  async (c) => {
    const militaryId = c.get("userId");
    const body = c.req.valid("json");

    const { data, error } = await supabase
      .from("ocorrencias")
      .insert({
        military_id: militaryId,
        lending_id: body.lending_id ?? null,
        material_type_id: body.material_type_id ?? null,
        material_nome_snapshot: body.material_nome_snapshot ?? null,
        titulo: body.titulo,
        descricao: body.descricao,
      })
      .select("id")
      .single();

    if (error) return c.json({ error: error.message }, 500);

    // Notify all staff about new occurrence
    const { data: staff } = await supabase
      .from("profiles")
      .select("id")
      .in("role", ["master", "admin"])
      .eq("registration_status", "complete");

    if (staff?.length) {
      await supabase.from("notifications").insert(
        staff.map((s) => ({
          user_id: s.id,
          type: "ocorrencia_aberta",
          title: "Nova Ocorrência Reportada",
          body: `${body.material_nome_snapshot ? body.material_nome_snapshot + ": " : ""}${body.titulo}`,
          metadata: { ocorrencia_id: data.id, military_id: militaryId },
        }))
      );
    }

    return c.json({ ok: true, id: data.id }, 201);
  }
);

// ── GET /api/ocorrencias ──────────────────────────────────────
// Military: own. Staff: all open/in_analise.

ocorrenciasRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const role = c.get("role");

  let query = supabase
    .from("ocorrencias")
    .select(`
      id, titulo, descricao, status, material_nome_snapshot,
      created_at, updated_at, resolvida_em, resolucao,
      military:profiles!ocorrencias_military_id_fkey(nome_completo, posto, matricula),
      resolvida_por_profile:profiles!ocorrencias_resolvida_por_fkey(nome_completo)
    `)
    .order("created_at", { ascending: false });

  if (role === "usuario") {
    query = query.eq("military_id", userId).limit(20);
  } else {
    query = query.in("status", ["aberta", "em_analise"]).limit(100);
  }

  const { data, error } = await query;
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data ?? []);
});

// ── PATCH /api/ocorrencias/:id ────────────────────────────────
// Staff resolves or updates status.

ocorrenciasRoutes.patch(
  "/:id",
  roleGuard("master", "admin"),
  zValidator(
    "json",
    z.object({
      status: z.enum(["em_analise", "resolvida", "improcedente"]),
      resolucao: z.string().max(2000).optional(),
    })
  ),
  async (c) => {
    const staffId = c.get("userId");
    const ocorrenciaId = c.req.param("id");
    const { status, resolucao } = c.req.valid("json");

    const { data: occ } = await supabase
      .from("ocorrencias")
      .select("id, military_id, titulo, status")
      .eq("id", ocorrenciaId)
      .maybeSingle();

    if (!occ) return c.json({ error: "Ocorrência não encontrada." }, 404);
    if (occ.status === "resolvida" || occ.status === "improcedente") {
      return c.json({ error: "Ocorrência já encerrada." }, 409);
    }

    const now = new Date().toISOString();
    const updateData: Record<string, unknown> = { status };
    if (status === "resolvida" || status === "improcedente") {
      updateData.resolvida_por = staffId;
      updateData.resolvida_em = now;
      updateData.resolucao = resolucao ?? null;
    }

    const { error } = await supabase
      .from("ocorrencias")
      .update(updateData)
      .eq("id", ocorrenciaId);

    if (error) return c.json({ error: error.message }, 500);

    // Notify military if resolved/improcedente
    if (status === "resolvida" || status === "improcedente") {
      await supabase.from("notifications").insert({
        user_id: occ.military_id,
        type: "ocorrencia_resolvida",
        title: status === "resolvida" ? "Ocorrência Resolvida ✓" : "Ocorrência Encerrada",
        body: resolucao
          ? `Sua ocorrência foi ${status === "resolvida" ? "resolvida" : "encerrada"}: ${resolucao}`
          : `Sua ocorrência "${occ.titulo}" foi ${status === "resolvida" ? "resolvida" : "encerrada"}.`,
        metadata: { ocorrencia_id: ocorrenciaId },
      });
    }

    return c.json({ ok: true });
  }
);
