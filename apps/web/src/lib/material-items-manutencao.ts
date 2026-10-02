// Tipos das linhas de itens em triagem (danificados, perdidos, administrativo).
// A consulta mora no BFF (GET /api/arsenal/items/manutencao e
// /items/manutencao-admin — R-37 lotes 6 e 7); o helper de leitura direta do
// Supabase (fetchManutencaoItems, R-47: embed ambíguo + erro engolido como [])
// foi removido por não ter mais consumidores.
import type { ManutencaoStatus } from "./material-item-status";

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
