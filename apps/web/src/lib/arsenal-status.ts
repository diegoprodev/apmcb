import type { MaterialItem } from "@/components/arsenal/material-detail-sheet";

/**
 * SSOT do cálculo de status de estoque de um material — antes só existia
 * como `getStatus()` local em _arsenal-client.tsx. Extraído para que
 * page.tsx (Server Component, calcula a contagem exata dos KpiCards) e
 * _arsenal-client.tsx (filtra a lista pelo mesmo critério) nunca divirjam:
 * clicar num KpiCard e cair no filtro correspondente precisa mostrar
 * exatamente a mesma contagem que o card anunciou.
 */
export type StockStatus = "ok" | "baixo" | "esgotado";

export function getMaterialStockStatus(m: {
  quantidade_disponivel: number;
  quantidade_total: number;
}): StockStatus {
  const pct = m.quantidade_total > 0 ? (m.quantidade_disponivel / m.quantidade_total) * 100 : 0;
  if (m.quantidade_disponivel === 0) return "esgotado";
  if (pct <= 20) return "baixo";
  return "ok";
}

/**
 * Estende o MaterialItem base (agregado de material_type) com os campos que
 * /reserva/arsenal precisa para: (1) bloquear/avisar antes de desativar um
 * material com unidades físicas em uso — mesma contagem que faz
 * DELETE /api/arsenal/:id no BFF responder 409 — e (2) sinalizar quando a
 * categoria do material foi desativada enquanto o material_type continua
 * ativo (estado que não deveria surgir do fluxo normal — DELETE
 * /api/categories/:id bloqueia com 409 se houver material_types ativos
 * usando a categoria — mas pode existir por dado legado ou edição direta no
 * banco; o indicador é defensivo).
 *
 * Definido uma única vez aqui (não em page.tsx nem em _arsenal-client.tsx)
 * para os dois arquivos nunca divergirem sobre o shape dos dados.
 */
export type ArsenalMaterialItem = MaterialItem & {
  category_id: string | null;
  /** Itens físicos (material_items) referenciando este material_type com
   *  status_operacional em uso ativo (em_saida | cautelado). */
  quantidade_em_uso_fisico: number;
  /** false quando material_categories.active=false para a categoria deste
   *  material, mesmo com o material_type ainda ativo. */
  categoria_ativa: boolean;
};
