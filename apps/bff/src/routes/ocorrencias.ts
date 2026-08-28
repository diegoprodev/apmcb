import { Hono } from "hono";
import { zValidator } from "../lib/validated-json";
import { z } from "zod";
import { roleGuard } from "../middleware/role-guard";
import { supabase } from "../services/supabase";
import { logShiftEvent } from "../lib/shift-events";
import { requireActiveShift } from "../lib/shift-guard";
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
      .in("role", ["armeiro", "admin_global", "admin_reserva"])
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

ocorrenciasRoutes.get("/", roleGuard("usuario", "armeiro", "admin_reserva", "admin_global"), async (c) => {
  const userId = c.get("userId");
  const role = c.get("role");
  const tenantId = c.get("tenantId");

  // Achado ALTO de code review (2026-08-28): staff sem tenantId na sessão
  // (ex: conta recém-criada sem tenant_membership vigente) faria o filtro de
  // tenant abaixo virar uma comparação com valor nulo — PostgREST/Postgres
  // não trata isso como IS NULL pra uma coluna uuid, gera erro de sintaxe e
  // a rota respondia 500 em vez de negar de forma limpa. Mesmo guard usado
  // em shifts.ts/biometric.ts/categories.ts pra toda rota tenant-scoped do
  // BFF.
  if (role !== "usuario" && !tenantId) {
    return c.json({ error: "Tenant não identificado na sessão" }, 403);
  }

  // Achado CRÍTICO de code review (2026-08-28, investigando por que uma
  // ocorrência reportada por um militar nunca foi vista por nenhum
  // armeiro): este endpoint usa a service role (bypassa RLS por completo),
  // e o branch de staff abaixo não tinha NENHUM filtro de tenant — qualquer
  // armeiro/admin_reserva/admin_global autenticado, de QUALQUER tenant,
  // recebia TODAS as ocorrências abertas da PLATAFORMA INTEIRA. Mesma
  // classe de vazamento já corrigida hoje em material-photos (RLS) e em
  // occ_staff (policy da tabela) — aqui é pior, porque nem RLS entra em
  // jogo (service role ignora). `!inner` no join com profiles é necessário
  // pra poder filtrar por `military.default_tenant_id` via dot-notation do
  // PostgREST (mesmo padrão já usado em shifts.ts:423) — usado só no branch
  // de staff: o próprio militar não precisa desse filtro, e `!inner` faria
  // sua ocorrência sumir silenciosamente da própria listagem se o profile
  // referenciado por military_id nunca batesse no join (achado BAIXO de
  // code review — sem motivo pra mudar essa semântica pra esse branch).
  const baseFields = `
    id, titulo, descricao, status, material_nome_snapshot,
    created_at, updated_at, resolvida_em, resolucao,
    resolvida_por_profile:profiles!ocorrencias_resolvida_por_fkey(nome_completo)
  `;

  let query;
  if (role === "usuario") {
    query = supabase
      .from("ocorrencias")
      .select(`${baseFields}, military:profiles!ocorrencias_military_id_fkey(nome_completo, posto, matricula)`)
      .eq("military_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);
  } else {
    query = supabase
      .from("ocorrencias")
      .select(`${baseFields}, military:profiles!ocorrencias_military_id_fkey!inner(nome_completo, posto, matricula, default_tenant_id)`)
      .eq("military.default_tenant_id", tenantId)
      .in("status", ["aberta", "em_analise"])
      .order("created_at", { ascending: false })
      .limit(100);
  }

  const { data, error } = await query;
  if (error) return c.json({ error: error.message }, 500);

  // default_tenant_id só existia no select acima pra viabilizar o filtro
  // `!inner` + `.eq("military.default_tenant_id", ...)` (PostgREST exige o
  // campo selecionado pra poder filtrar por ele) — não é usado pelo
  // frontend, removido antes de sair pro cliente (SRP: cada campo exposto
  // tem que ter um consumidor real).
  //
  // Normalização array/objeto: mesma relação (ocorrencias_military_id_fkey)
  // já é normalizada assim em reserva/ocorrencias/page.tsx (achado de code
  // review — supabase-js às vezes tipa/devolve o embed como array de 1 item
  // em vez de objeto único, dependendo de como infere a FK); sem isso, um
  // client que espere objeto quebraria silenciosamente se o formato variar.
  const rows = ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const rawMilitary = row.military as Record<string, unknown> | Record<string, unknown>[] | null;
    const military = Array.isArray(rawMilitary) ? rawMilitary[0] ?? null : rawMilitary ?? null;
    if (!military) return { ...row, military: null };
    const { default_tenant_id: _omit, ...militaryPublic } = military;
    return { ...row, military: militaryPublic };
  });

  return c.json(rows);
});

// ── PATCH /api/ocorrencias/:id ────────────────────────────────
// Staff resolves or updates status.

ocorrenciasRoutes.patch(
  "/:id",
  roleGuard("armeiro", "admin_global", "admin_reserva"),
  zValidator(
    "json",
    z.object({
      status: z.enum(["em_analise", "resolvida", "improcedente"]),
      resolucao: z.string().max(2000).optional(),
    })
  ),
  async (c) => {
    const staffId = c.get("userId");
    const role = c.get("role");
    const tenantId = c.get("tenantId");
    const ocorrenciaId = c.req.param("id");
    const { status, resolucao } = c.req.valid("json");

    // Achado CRÍTICO de code review (2026-08-28, mesma investigação do GET
    // acima): este endpoint usa a service role (bypassa RLS) e não tinha
    // NENHUM filtro de tenant — um armeiro do Tenant A, sabendo/enumerando
    // o UUID de uma ocorrência do Tenant B, conseguia marcá-la como
    // resolvida/improcedente (IDOR de escrita), disparar notificação pro
    // militar errado e gravar evento de Livro Digital cross-tenant. Mesmo
    // `!inner` + dot-notation já usado no GET pra filtrar pelo tenant do
    // MILITAR dono da ocorrência (ocorrencias não tem tenant_id próprio).
    // 404 (não 403) pra não vazar a existência da ocorrência de outro tenant.
    if (!tenantId) return c.json({ error: "Tenant não identificado na sessão" }, 403);

    const shiftCheck = await requireActiveShift(role, staffId);
    if (!shiftCheck.ok) return c.json(shiftCheck.body, 403);

    const { data: occ } = await supabase
      .from("ocorrencias")
      .select("id, military_id, titulo, status, military:profiles!ocorrencias_military_id_fkey!inner(default_tenant_id)")
      .eq("id", ocorrenciaId)
      .eq("military.default_tenant_id", tenantId)
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

    // Livro Digital: registrar no turno do armeiro que resolveu
    if (status === "resolvida" || status === "improcedente") {
      logShiftEvent({
        actorId: staffId!, tenantId: c.get("tenantId")!,
        eventType: "ocorrencia_registrada",
        description: `Ocorrência "${occ.titulo}" marcada como ${status}${resolucao ? `: ${resolucao}` : ""}`,
        subjectId: ocorrenciaId, subjectType: "ocorrencia",
        isPending: false,
        metadata: { status_anterior: occ.status, novo_status: status },
      }).catch(() => {});
    }

    return c.json({ ok: true });
  }
);
