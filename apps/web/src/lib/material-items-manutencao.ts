// SSOT para a query de itens em triagem (material_items) — danificados,
// perdidos e em status administrativo. Usado por /reserva/arsenal/manutencao
// e /admin/arsenal/manutencao — mesma tabela, mesmos filtros de status; a
// única diferença entre as duas rotas é o escopo de reserva, resolvido no
// client (ver _manutencao-client.tsx).
import type { SupabaseClient } from "@supabase/supabase-js";
import { ALL_TRACKED_STATUSES, type ManutencaoStatus } from "./material-item-status";

export type { ManutencaoStatus };

export interface ManutencaoRow {
  id: string;
  status_operacional: ManutencaoStatus;
  identificador_principal: string;
  tipo_identificador: string;
  condicao: string;
  descricao_adicional: string | null;
  last_movement_at: string;
  material_nome: string;
  material_categoria: string;
  reserve_id: string | null;
  reserve_nome: string | null;
}

type Embedded<T> = T | T[] | null;

interface RawMaterialType {
  nome: string;
  categoria: string | null;
}

interface RawReserve {
  id: string;
  nome: string;
  acronym: string;
}

interface RawRow {
  id: string;
  status_operacional: string;
  identificador_principal: string;
  tipo_identificador: string;
  condicao: string;
  descricao_adicional: string | null;
  last_movement_at: string;
  current_unit_id: string | null;
  material_type: Embedded<RawMaterialType>;
  reserve: Embedded<RawReserve>;
}

// Supabase-js às vezes retorna relações embutidas como array mesmo quando a
// FK é 1:1 (depende de como o PostgREST detecta a relação) — normaliza para
// objeto único em ambos os casos, mesmo padrão já usado em _cautelas-client.tsx.
function firstOrSelf<T>(value: Embedded<T>): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

/**
 * Busca itens físicos com status_operacional em triagem (ver
 * ALL_TRACKED_STATUSES — danificados/perdidos/administrativo, exclui
 * em_saida/cautelado/disponivel/baixado/inapto) de um tenant inteiro (todas
 * as reservas — o filtro por reserva específica, quando aplicável, é feito
 * no client via dropdown, não aqui).
 */
export async function fetchManutencaoItems(
  supabase: SupabaseClient,
  tenantId: string
): Promise<ManutencaoRow[]> {
  const { data, error } = await supabase
    .from("material_items")
    .select(`
      id, status_operacional, identificador_principal, tipo_identificador, condicao,
      descricao_adicional, last_movement_at, current_unit_id,
      material_type:material_types(nome, categoria),
      reserve:reserves(id, nome, acronym)
    `)
    .eq("tenant_id", tenantId)
    .in("status_operacional", ALL_TRACKED_STATUSES)
    .order("last_movement_at", { ascending: false });

  if (error) {
    console.error("[material-items-manutencao] erro ao buscar material_items", error);
    return [];
  }

  return ((data ?? []) as unknown as RawRow[]).map((row) => {
    const materialType = firstOrSelf(row.material_type);
    const reserve = firstOrSelf(row.reserve);
    return {
      id: row.id,
      status_operacional: row.status_operacional as ManutencaoStatus,
      identificador_principal: row.identificador_principal,
      tipo_identificador: row.tipo_identificador,
      condicao: row.condicao,
      descricao_adicional: row.descricao_adicional,
      last_movement_at: row.last_movement_at,
      material_nome: materialType?.nome ?? "Material",
      material_categoria: materialType?.categoria ?? "outro",
      reserve_id: row.current_unit_id,
      reserve_nome: reserve?.nome ?? null,
    };
  });
}
