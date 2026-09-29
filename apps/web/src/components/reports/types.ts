export type RecordType = "saidas" | "cautelas" | "livro";

export interface MaterialOption {
  id: string;
  nome: string;
  categoria: string;
  categoria_slug?: string | null;
  calibre?: string | null;
}

export interface ProfileOption {
  id: string;
  nome_completo: string;
  matricula: string;
  posto?: string | null;
}

export interface SaidaRow {
  id: string;
  issued_at: string;
  returned_at: string | null;
  status: string;
  quantidade: number;
  notes: string | null;
  local?: string | null;
  military: { nome_completo: string; matricula: string; posto: string } | null;
  material_type: { id?: string; nome: string; categoria: string; categoria_slug?: string | null; calibre?: string | null } | null;
  // Rastreabilidade cross-turno (achado 2026-09-22): quem armou pode ser
  // diferente de quem devolveu, em outro turno, às vezes dias depois.
  armeiro?: { nome_completo: string; matricula: string; posto: string } | null;
  devolvido_por?: { nome_completo: string; matricula: string; posto: string } | null;
}

export interface CautelaRow {
  id: string;
  status: string;
  motivo_emissao: string;
  motivo_devolucao?: string | null;
  condicao_emissao: string;
  condicao_devolucao?: string | null;
  data_emissao: string;
  data_devolucao?: string | null;
  militar: { nome_completo: string; matricula: string; posto: string } | null;
  item: {
    identificador_principal?: string | null;
    material_type: { id?: string; nome: string; categoria: string; categoria_slug?: string | null; calibre?: string | null } | null;
  } | null;
  // Rastreabilidade cross-turno (achado 2026-09-22): quem emitiu (armeiro
  // emissor) pode ser diferente de quem processou a devolução.
  armeiro?: { nome_completo: string; matricula: string; posto: string } | null;
  devolvido_por?: { nome_completo: string; matricula: string; posto: string } | null;
}

// Faixas de alerta de "tempo em aberto" — EXCLUSIVO do relatório de Saídas
// (curto prazo, material rotativo — precisa alerta pra não ficar preso).
// Cautela é médio/longo prazo por natureza; não usa esse filtro (achado
// 2026-09-22, correção explícita do dono do produto: "não misture as
// bolas"). Cumulativo: "48h" inclui o que já passou de 72h também — nada
// some do filtro quando envelhece mais.
export type AgingThreshold = "24h" | "48h" | "72h";
export const AGING_THRESHOLD_HOURS: Record<AgingThreshold, number> = {
  "24h": 24, "48h": 48, "72h": 72,
};

export interface LivroRow {
  id: string;
  happened_at: string;
  event_type: string;
  description: string;
  is_pending: boolean;
  resolved_at: string | null;
  subject_id: string | null;
  subject_type: string | null;
  actor: { id: string; nome_completo: string; matricula: string; posto: string; foto_url: string | null } | null;
  /** Resolvido server-side a partir de subject_type/subject_id (lendings/cautelamentos) quando aplicável. */
  material_nome: string | null;
}

export const CAUTELA_STATUS_LABELS: Record<string, string> = {
  ativa: "Ativa",
  devolvida: "Devolvida",
  substituida: "Substituída",
  em_revisao: "Em revisão",
  cancelada: "Cancelada",
};

export const EVENT_TYPE_LABELS: Record<string, string> = {
  turno_assumido: "Turno assumido",
  cautela_emitida: "Cautela emitida",
  cautela_devolvida: "Cautela devolvida",
  saida_autorizada: "Saída autorizada",
  saida_devolvida: "Saída devolvida",
  ocorrencia_registrada: "Ocorrência registrada",
  solicitacao_aprovada: "Solicitação aprovada",
  solicitacao_negada: "Solicitação negada",
  inventario_divergencia: "Divergência de inventário",
  turno_encerrado: "Turno encerrado",
  evento_manual: "Evento manual",
};
