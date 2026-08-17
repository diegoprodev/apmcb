// Tipos compartilhados do fluxo de Solicitação de Armamento (SSA) —
// "material_requests" e seus itens. Extraído porque a mesma definição de
// `Status` estava duplicada (copy-paste) em
// _solicitacoes-efetivo-client.tsx, _solicitacoes-client.tsx (reserva),
// solicitacao-detail-sheet.tsx e solicitacao-status-card.tsx.
//
// NÃO confundir com o `Status` de _aprovacao-client.tsx (admin/arsenal): lá
// é o status de um fluxo de aprovação DIFERENTE (admin_approval_requests /
// category_requests — "pendente" | "aprovado" | "rejeitado"), sem os estados
// terminais retirado/expirado/cancelado, que só existem no ciclo de vida de
// uma material_request (retirada física do material, expiração do prazo de
// retirada, cancelamento pelo efetivo/armeiro). Como esses dois status nunca
// tiveram estados em comum além do subconjunto pendente/aprovado/rejeitado,
// forçar o mesmo tipo lá criaria um acoplamento artificial entre dois
// domínios distintos — mantido separado de propósito.
export type Status =
  | "pendente"
  | "aprovado"
  | "rejeitado"
  | "retirado"
  | "expirado"
  | "cancelado";

// Formato mínimo de um item de material_request_items usado pelas telas de
// status/detalhe do efetivo. `_solicitacoes-client.tsx` (reserva) precisa de
// campos extras (id, categoria, delivered_quantity) para sua própria UI de
// aprovação/entrega — mantém seu próprio tipo `Item`, mais amplo, em vez de
// forçar esse formato mais estreito.
export interface RequestItem {
  material_nome_snapshot: string;
  requested_quantity: number;
}
