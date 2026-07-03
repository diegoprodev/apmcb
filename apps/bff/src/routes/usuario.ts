import { Hono } from "hono";
import { roleGuard } from "../middleware/role-guard";
import { supabase } from "../services/supabase";
import type { HonoVariables } from "../types/hono";
import { generateHistoricoPdf } from "../lib/pdf/historico-pdf";
import type { HistoricoLending } from "../lib/pdf/historico-pdf";

export const usuarioRoutes = new Hono<{ Variables: HonoVariables }>();

// Supabase retorna joins como objetos únicos, mas o tipo inferido pode variar.
// Usamos unknown → cast explícito para evitar erros de overlapping types.
type RawRow = Record<string, unknown>;

function toHistoricoLending(row: RawRow): HistoricoLending {
  const mt  = row.material_type as { id?: string; nome?: string; categoria?: string } | null ?? null;
  const mst = row.master        as { nome_completo?: string; posto?: string | null } | null ?? null;
  const rsv = row.reserve       as { id?: string; nome?: string } | null ?? null;
  return {
    id:            String(row.id ?? ""),
    status_legacy: String(row.status_legacy ?? ""),
    issued_at:     (row.issued_at as string | null) ?? null,
    returned_at:   (row.returned_at as string | null) ?? null,
    quantidade:    (row.quantidade as number | null) ?? null,
    movement_id:   (row.movement_id as string | null) ?? null,
    material_type: mt ? { id: mt.id, nome: mt.nome ?? "", categoria: mt.categoria ?? "" } : null,
    master:        mst ? { nome_completo: mst.nome_completo ?? "", posto: mst.posto ?? null } : null,
    reserve:       rsv ? { id: rsv.id ?? "", nome: rsv.nome ?? "" } : null,
  };
}

// ── GET /api/usuario/historico — Histórico de saídas do próprio militar ──────
// Filtros: categoria, reserve_id, from (issued_at >=), to (issued_at <=), status

usuarioRoutes.get(
  "/historico",
  roleGuard("usuario"),
  async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Não autenticado" }, 401);

    const { categoria, reserve_id, from, to, status, limit: limitParam } = c.req.query();
    const limit = Math.min(parseInt(limitParam ?? "500") || 500, 500);

    let query = supabase
      .from("lendings")
      .select(`
        id, status_legacy, issued_at, returned_at, quantidade, movement_id,
        material_type:material_types(id, nome, categoria),
        master:profiles!lendings_master_id_fkey(nome_completo, posto),
        reserve:reserves(id, nome)
      `)
      .eq("military_id", userId)
      .order("issued_at", { ascending: false })
      .limit(limit);

    if (reserve_id) query = query.eq("reserve_id", reserve_id);
    if (from)       query = query.gte("issued_at", from);
    if (to)         query = query.lte("issued_at", to + "T23:59:59");
    if (status)     query = query.eq("status_legacy", status);

    const { data, error } = await query;
    if (error) return c.json({ error: error.message }, 500);

    let lendings: HistoricoLending[] = (data as unknown as RawRow[] ?? []).map(toHistoricoLending);

    // Filtro de categoria em JS (PostgREST não suporta filter em nested many-to-one confiável)
    if (categoria) {
      lendings = lendings.filter((l) => l.material_type?.categoria === categoria);
    }

    // Derivar listas únicas para dropdowns de filtro
    const reservasMap   = new Map<string, { id: string; nome: string }>();
    const materiaisMap  = new Map<string, { id: string; nome: string }>();
    const categoriasSet = new Set<string>();

    for (const l of lendings) {
      if (l.reserve?.id)           reservasMap.set(l.reserve.id, { id: l.reserve.id, nome: l.reserve.nome });
      if (l.material_type?.id)     materiaisMap.set(l.material_type.id, { id: l.material_type.id, nome: l.material_type.nome });
      if (l.material_type?.categoria) categoriasSet.add(l.material_type.categoria);
    }

    return c.json({
      lendings,
      reservas:   [...reservasMap.values()],
      categorias: [...categoriasSet],
      materiais:  [...materiaisMap.values()],
    });
  }
);

// ── GET /api/usuario/historico/pdf — PDF do histórico filtrado ───────────────

usuarioRoutes.get(
  "/historico/pdf",
  roleGuard("usuario"),
  async (c) => {
    const userId = c.get("userId");
    const tenantId = c.get("tenantId");
    if (!userId) return c.json({ error: "Não autenticado" }, 401);

    const { categoria, reserve_id, from, to, status, ids } = c.req.query();

    // Buscar perfil do militar
    const { data: profile } = await supabase
      .from("profiles")
      .select("nome_completo, matricula, posto")
      .eq("id", userId)
      .single();

    if (!profile) return c.json({ error: "Perfil não encontrado" }, 404);

    // Buscar lendings — se `ids` fornecido, filtra apenas pelos IDs selecionados
    let query = supabase
      .from("lendings")
      .select(`
        id, status_legacy, issued_at, returned_at, quantidade,
        material_type:material_types(id, nome, categoria),
        master:profiles!lendings_master_id_fkey(nome_completo, posto),
        reserve:reserves(id, nome)
      `)
      .eq("military_id", userId)
      .order("issued_at", { ascending: false })
      .limit(500);

    if (ids) {
      const idList = ids.split(",").map((s) => s.trim()).filter(Boolean);
      if (idList.length > 0) query = query.in("id", idList);
    } else {
      if (reserve_id) query = query.eq("reserve_id", reserve_id);
      if (from)       query = query.gte("issued_at", from);
      if (to)         query = query.lte("issued_at", to + "T23:59:59");
      if (status)     query = query.eq("status_legacy", status);
    }

    const { data, error } = await query;
    if (error) return c.json({ error: error.message }, 500);

    let lendings: HistoricoLending[] = (data as unknown as RawRow[] ?? []).map(toHistoricoLending);
    if (!ids && categoria) {
      lendings = lendings.filter((l) => l.material_type?.categoria === categoria);
    }

    // Buscar branding do tenant para logo
    let tenantLogoUrl: string | null = null;
    let tenantName:    string | null = null;
    if (tenantId) {
      const [brandingRes, tenantRes] = await Promise.all([
        supabase.from("tenant_branding").select("tenant_logo_url").eq("tenant_id", tenantId).maybeSingle(),
        supabase.from("tenants").select("nome").eq("id", tenantId).maybeSingle(),
      ]);
      tenantLogoUrl = brandingRes.data?.tenant_logo_url ?? null;
      tenantName    = tenantRes.data?.nome ?? null;
    }

    // Nome legível da reserva para o cabeçalho do PDF
    let reservaNome: string | null = null;
    if (reserve_id) {
      const { data: reserveRow } = await supabase
        .from("reserves")
        .select("nome")
        .eq("id", reserve_id)
        .maybeSingle();
      reservaNome = reserveRow?.nome ?? reserve_id;
    }

    const bytes = await generateHistoricoPdf({
      military: {
        nome_completo: profile.nome_completo ?? "—",
        matricula:     profile.matricula     ?? "—",
        posto:         profile.posto         ?? null,
      },
      lendings,
      filters: {
        reserva:   reservaNome,
        categoria: categoria ?? null,
        status:    status    ?? null,
        from:      from      ?? null,
        to:        to        ?? null,
      },
      generatedAt:   new Date().toISOString(),
      tenantLogoUrl,
      tenantName,
    });

    return new Response(bytes.buffer as ArrayBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="historico-saidas-${new Date().toISOString().slice(0, 10)}.pdf"`,
      },
    });
  }
);
