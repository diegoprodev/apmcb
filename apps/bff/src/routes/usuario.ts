import { Hono } from "hono";
import { roleGuard } from "../middleware/role-guard";
import { supabase } from "../services/supabase";
import type { HonoVariables } from "../types/hono";
import { generateHistoricoPdf } from "../lib/pdf/historico-pdf";
import type { HistoricoLending } from "../lib/pdf/historico-pdf";
import { logger } from "../lib/logger";

export const usuarioRoutes = new Hono<{ Variables: HonoVariables }>();

// Supabase retorna joins como objetos únicos, mas o tipo inferido pode variar.
// Usamos unknown → cast explícito para evitar erros de overlapping types.
type RawRow = Record<string, unknown>;

const MATERIAL_PHOTOS_BUCKET = "material-photos";
const OCORRENCIA_STATUS_LABEL: Record<string, string> = {
  avariado: "Avariado",
  extraviado: "Extraviado",
  furtado: "Furtado",
  em_pericia: "Em perícia",
  bloqueado: "Bloqueado",
  em_transito: "Em trânsito",
};

interface HistoricoOcorrencia {
  id: string;
  identificador_principal: string;
  status_operacional: string;
  status_label: string;
  descricao_adicional: string | null;
  foto_display_url: string | null;
  registrada_em: string | null;
  material_type: { nome: string; categoria: string } | null;
  reserve: { nome: string } | null;
  registrado_por: { nome_completo: string; posto: string | null } | null;
}

// Ocorrências de material (ver PATCH /api/arsenal/items/:id/ocorrencia em
// arsenal.ts) associadas a ESTE usuário — "página de histórico" (report do
// dono do produto: usuário associado a uma ocorrência deve ver o registro no
// próprio histórico, com detalhe real: material, tipo, quando, por quem).
// ocorrencia_usuario_associado_id/ocorrencia_registrada_por/etc. refletem só
// a ocorrência MAIS RECENTE de cada item (ver migration
// 20260816120100_add_material_items_ocorrencia_columns.sql) — mas como cada
// item físico é sua própria linha, filtrar por usuário ainda cobre
// corretamente ocorrências em itens DIFERENTES ao longo do tempo.
async function loadOcorrenciasAssociadas(userId: string): Promise<HistoricoOcorrencia[]> {
  const { data, error } = await supabase
    .from("material_items")
    .select(`
      id, identificador_principal, status_operacional, descricao_adicional,
      ocorrencia_foto_url, ocorrencia_registrada_em, ocorrencia_registrada_por,
      material_type:material_types(nome, categoria),
      reserve:reserves(nome)
    `)
    .eq("ocorrencia_usuario_associado_id", userId)
    .not("ocorrencia_registrada_em", "is", null)
    .order("ocorrencia_registrada_em", { ascending: false })
    .limit(100);

  if (error) {
    // Coluna pode não existir ainda neste ambiente (migration
    // 20260816120100 pendente de aplicação manual) — degrada para "sem
    // ocorrências" em vez de derrubar o histórico de saídas inteiro.
    logger.error("usuario.historico.ocorrencias_load_failure", { userId, error: error.message, code: error.code });
    return [];
  }

  const rows = (data as unknown as RawRow[]) ?? [];
  const actorIds = [...new Set(rows.map((r) => r.ocorrencia_registrada_por as string | null).filter(Boolean))] as string[];

  let actorMap = new Map<string, { nome_completo: string; posto: string | null }>();
  if (actorIds.length > 0) {
    const { data: actors } = await supabase
      .from("profiles")
      .select("id, nome_completo, posto")
      .in("id", actorIds);
    actorMap = new Map((actors ?? []).map((a) => [a.id as string, { nome_completo: a.nome_completo as string, posto: (a.posto as string) ?? null }]));
  }

  const fotoPaths = [...new Set(rows.map((r) => r.ocorrencia_foto_url as string | null).filter(Boolean))] as string[];
  const fotoUrlMap = await resolveMaterialPhotoUrls(fotoPaths);

  return rows.map((row) => {
    const mt  = row.material_type as { nome?: string; categoria?: string } | { nome?: string; categoria?: string }[] | null;
    const rsv = row.reserve        as { nome?: string } | { nome?: string }[] | null;
    const mtRow  = Array.isArray(mt) ? (mt[0] ?? null) : mt;
    const rsvRow = Array.isArray(rsv) ? (rsv[0] ?? null) : rsv;
    const actorId = row.ocorrencia_registrada_por as string | null;
    const fotoPath = row.ocorrencia_foto_url as string | null;
    const status = String(row.status_operacional ?? "");

    return {
      id: String(row.id),
      identificador_principal: String(row.identificador_principal ?? ""),
      status_operacional: status,
      status_label: OCORRENCIA_STATUS_LABEL[status] ?? status,
      descricao_adicional: (row.descricao_adicional as string | null) ?? null,
      foto_display_url: fotoPath ? (fotoUrlMap.get(fotoPath) ?? null) : null,
      registrada_em: (row.ocorrencia_registrada_em as string | null) ?? null,
      material_type: mtRow ? { nome: mtRow.nome ?? "", categoria: mtRow.categoria ?? "" } : null,
      reserve: rsvRow ? { nome: rsvRow.nome ?? "" } : null,
      registrado_por: actorId ? actorMap.get(actorId) ?? null : null,
    };
  });
}

// material-photos é um bucket privado (20260629000001_fix_rls_security_audit.sql)
// — igual ao padrão já usado em profiles.ts (createSignedUrl inline via
// service role, já que o BFF não tem o helper client-side de apps/web/src/lib/storage.ts,
// apps separados sem pacote @apmcb/shared em uso por nenhum dos dois hoje).
//
// createSignedUrls (plural, em lote) numa chamada só — achado de code review:
// a versão anterior chamava createSignedUrl (singular) uma vez por linha
// dentro de um Promise.all, gerando até .limit(100) round-trips concorrentes
// ao Storage por carregamento da página de histórico. E, criticamente, sem
// try/catch: createSignedUrl (e createSignedUrls) PODE LANÇAR em falha de
// rede/fetch do Storage (não só retornar `{error}}` — mesmo motivo já
// documentado em apps/bff/src/domain/profile-photo/resolve-profile-photo-url.ts
// para a mesma chamada). Sem o try/catch, um hiccup transitório do Storage
// derrubava a rota inteira (GET /api/usuario/historico), incluindo os
// `lendings` já buscados com sucesso — contradizendo o próprio propósito
// desta função (degradar pra "sem ocorrências", não pra 500 geral).
async function resolveMaterialPhotoUrls(paths: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (paths.length === 0) return map;
  try {
    const { data, error } = await supabase.storage.from(MATERIAL_PHOTOS_BUCKET).createSignedUrls(paths, 3600);
    if (error) {
      logger.error("usuario.historico.foto_signed_urls_failure", { count: paths.length, error: error.message });
      return map;
    }
    for (const entry of data ?? []) {
      if (entry.signedUrl && !entry.error) map.set(entry.path ?? "", entry.signedUrl);
    }
  } catch (err) {
    logger.error("usuario.historico.foto_signed_urls_exception", {
      count: paths.length,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return map;
}

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

    // try/catch na chamada em si (além do try/catch interno em
    // resolveMaterialPhotoUrls) — defesa em profundidade: uma exceção
    // inesperada em QUALQUER ponto de loadOcorrenciasAssociadas (ex: futura
    // mudança que adicione uma chamada que lança) não pode derrubar a rota
    // inteira e descartar os `lendings` já buscados com sucesso acima.
    let ocorrencias: Awaited<ReturnType<typeof loadOcorrenciasAssociadas>> = [];
    try {
      ocorrencias = await loadOcorrenciasAssociadas(userId);
    } catch (err) {
      logger.error("usuario.historico.ocorrencias_load_exception", {
        userId, error: err instanceof Error ? err.message : String(err),
      });
    }

    return c.json({
      lendings,
      reservas:   [...reservasMap.values()],
      categorias: [...categoriasSet],
      materiais:  [...materiaisMap.values()],
      ocorrencias,
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
      // Achado de code review: "from"/"to" chegam como data civil
      // (YYYY-MM-DD) exibida em America/Recife no PDF, mas issued_at é
      // TIMESTAMPTZ interpretado pelo Postgres em UTC — sem o offset
      // explícito, "Até 24/08" excluía saídas entre 21h-23:59 do dia 24 em
      // Recife (= já 25/08 em UTC) e incluía indevidamente as de
      // 21h-23:59 do dia 23. Mesma classe de bug que a consolidação de
      // fmtDate/fmtDateTime corrigiu na exibição — aqui é no filtro.
      if (reserve_id) query = query.eq("reserve_id", reserve_id);
      if (from)       query = query.gte("issued_at", `${from}T00:00:00-03:00`);
      if (to)         query = query.lte("issued_at", `${to}T23:59:59.999-03:00`);
      if (status)     query = query.eq("status_legacy", status);
    }

    const { data, error } = await query;
    if (error) return c.json({ error: error.message }, 500);

    let lendings: HistoricoLending[] = (data as unknown as RawRow[] ?? []).map(toHistoricoLending);
    if (!ids && categoria) {
      lendings = lendings.filter((l) => l.material_type?.categoria === categoria);
    }

    // Nome do tenant pro subtítulo do cabeçalho — logo/cor agora vêm de
    // loadTenantBranding(tenantId) dentro de generateHistoricoPdf (mesmo
    // padrão dos outros 4 geradores), não mais buscados aqui.
    let tenantName: string | null = null;
    if (tenantId) {
      const { data: tenantRow } = await supabase.from("tenants").select("nome").eq("id", tenantId).maybeSingle();
      tenantName = tenantRow?.nome ?? null;
    }

    // Nome legível da reserva para o cabeçalho do PDF. Achado de code
    // review: sem escopo de tenant, um reserve_id de OUTRO tenant (client
    // Supabase aqui usa service-role, RLS não se aplica) devolvia o nome
    // real dessa reserva impresso no PDF — os registros de lendings
    // continuam escopados por military_id (sem vazamento de dados), mas o
    // nome da reserva de outro tenant não deveria aparecer de jeito nenhum.
    // Fallback trocado de reserve_id (UUID cru) pra um rótulo genérico
    // quando não encontrado — um UUID no cabeçalho do PDF não ajuda
    // ninguém a ler. Achado de code review (2ª rodada): o fallback
    // original caía pra `null`, indistinguível de "nenhum filtro de
    // reserva foi pedido" — se reserve_id era o ÚNICO filtro aplicado, o
    // PDF imprimia "Sem filtros — todos os registros" (falso: o filtro FOI
    // aplicado na query, só o nome não resolveu) num documento de
    // custódia. Usa um rótulo distinguível em vez de null pra preservar a
    // correção de segurança (nome de outro tenant não vaza) sem afirmar
    // algo falso sobre o próprio documento.
    let reservaNome: string | null = null;
    if (reserve_id) {
      if (tenantId) {
        const { data: reserveRow } = await supabase
          .from("reserves")
          .select("nome")
          .eq("id", reserve_id)
          .eq("tenant_id", tenantId)
          .maybeSingle();
        reservaNome = reserveRow?.nome ?? "(não identificada)";
      } else {
        reservaNome = "(não identificada)";
      }
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
      tenantId,
      tenantName,
    });

    // Achado de code review: data do nome do arquivo em UTC enquanto o
    // conteúdo ("Gerado em: ...") usa America/Recife — entre 21h-23:59 em
    // Recife o arquivo já teria a data de amanhã, divergindo do que está
    // escrito dentro do próprio PDF. en-CA formata como YYYY-MM-DD direto.
    const filenameDate = new Date().toLocaleDateString("en-CA", { timeZone: "America/Recife" });
    return new Response(bytes.buffer as ArrayBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="historico-saidas-${filenameDate}.pdf"`,
      },
    });
  }
);
