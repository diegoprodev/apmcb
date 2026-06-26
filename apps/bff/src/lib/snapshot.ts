import { supabase } from "../services/supabase";

export interface TurnSnapshot {
  data_referencia: string;
  reserve: { id: string; nome: string; acronym: string };
  carga_total: {
    por_tipo: Record<string, number>;
    total: number;
  };
  cautelas_ativas: Array<{
    id: string;
    material_descricao: string;
    militar_nome: string;
    data_emissao: string;
    prazo: string | null;
  }>;
  saidas_ativas: Array<{
    id: string;
    material_descricao: string;
    militar_nome: string;
    data_emissao: string;
  }>;
  solicitacoes_pendentes: number;
  ocorrencias_abertas: number;
}

export async function generateTurnSnapshot(
  reserveId: string,
  tenantId: string
): Promise<TurnSnapshot> {
  const now = new Date().toISOString();

  const [reserveRes, itemsRes, cautelasRes, saidasRes, ssaRes, ocRes] = await Promise.allSettled([
    supabase
      .from("reserves")
      .select("id, nome, acronym")
      .eq("id", reserveId)
      .single(),
    supabase
      .from("material_items")
      .select("id, status_operacional, material_type:material_types(nome)")
      .eq("tenant_id", tenantId)
      .eq("current_unit_id", reserveId),
    supabase
      .from("cautelamentos")
      .select(`
        id, data_emissao, prazo_proxima_conferencia,
        item:material_items(material_type:material_types(nome)),
        militar:profiles!cautelamentos_militar_id_fkey(nome_completo)
      `)
      .eq("tenant_id", tenantId)
      .eq("reserve_id", reserveId)
      .eq("status", "ativa"),
    supabase
      .from("lendings")
      .select(`
        id, data_emissao,
        item:material_items(material_type:material_types(nome)),
        militar:profiles!lendings_militar_id_fkey(nome_completo)
      `)
      .eq("tenant_id", tenantId)
      .eq("reserve_id", reserveId)
      .eq("status", "ativa"),
    supabase
      .from("material_requests")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("reserve_id", reserveId)
      .eq("status", "pendente"),
    supabase
      .from("ocorrencias")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("reserve_id", reserveId)
      .in("status", ["aberta", "em_analise"]),
  ]);

  const reserveData = reserveRes.status === "fulfilled" ? reserveRes.value.data : null;
  const reserve = reserveData
    ? (reserveData as unknown as { id: string; nome: string; acronym: string })
    : { id: reserveId, nome: "Reserva", acronym: "RES" };

  type RowAny = Record<string, unknown>;
  const arr1 = (v: unknown): RowAny | null =>
    Array.isArray(v) ? (v[0] as RowAny ?? null) : (v as RowAny | null);

  // Carga por tipo
  const items = (
    itemsRes.status === "fulfilled" && itemsRes.value.data
      ? itemsRes.value.data
      : []
  ) as RowAny[];
  const porTipo: Record<string, number> = {};
  for (const item of items) {
    const mt = arr1(item["material_type"]);
    const tipo = (mt?.["nome"] as string | null) ?? "Outros";
    porTipo[tipo] = (porTipo[tipo] ?? 0) + 1;
  }

  // Cautelas ativas
  const cautelaRows = (
    cautelasRes.status === "fulfilled" && cautelasRes.value.data
      ? cautelasRes.value.data
      : []
  ) as RowAny[];
  const cautelas_ativas = cautelaRows.map((c) => {
    const item     = arr1(c["item"]);
    const mt       = arr1(item?.["material_type"]);
    const militar  = arr1(c["militar"]);
    return {
      id:                  c["id"] as string,
      material_descricao:  (mt?.["nome"] as string | null) ?? "—",
      militar_nome:        (militar?.["nome_completo"] as string | null) ?? "—",
      data_emissao:        c["data_emissao"] as string,
      prazo:               (c["prazo_proxima_conferencia"] as string | null) ?? null,
    };
  });

  // Saídas ativas
  const saidaRows = (
    saidasRes.status === "fulfilled" && saidasRes.value.data
      ? saidasRes.value.data
      : []
  ) as RowAny[];
  const saidas_ativas = saidaRows.map((s) => {
    const item    = arr1(s["item"]);
    const mt      = arr1(item?.["material_type"]);
    const militar = arr1(s["militar"]);
    return {
      id:                 s["id"] as string,
      material_descricao: (mt?.["nome"] as string | null) ?? "—",
      militar_nome:       (militar?.["nome_completo"] as string | null) ?? "—",
      data_emissao:       s["data_emissao"] as string,
    };
  });

  return {
    data_referencia: now,
    reserve,
    carga_total: { por_tipo: porTipo, total: items.length },
    cautelas_ativas,
    saidas_ativas,
    solicitacoes_pendentes:
      ssaRes.status === "fulfilled" ? (ssaRes.value.count ?? 0) : 0,
    ocorrencias_abertas:
      ocRes.status === "fulfilled" ? (ocRes.value.count ?? 0) : 0,
  };
}
