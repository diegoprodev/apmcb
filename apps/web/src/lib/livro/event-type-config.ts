import {
  Play, ClipboardList, CheckCircle2, ArrowUpRight, Undo2,
  AlertTriangle, XCircle, CircleAlert, Square, PencilLine,
  FileSignature, Ban, FileEdit,
  type LucideIcon,
} from "lucide-react";

export type EventType =
  | "turno_assumido" | "cautela_emitida" | "cautela_devolvida"
  | "saida_autorizada" | "saida_devolvida" | "ocorrencia_registrada"
  | "solicitacao_aprovada" | "solicitacao_negada" | "inventario_divergencia"
  | "turno_encerrado" | "evento_manual"
  // Ciclo de vida da cautela (docs/enterprise/specs/cautela-lifecycle-enterprise.md,
  // CAULC-06/12) — achado durante a implementação: este é o 4º lugar
  // fechado por tipo de evento que precisava de extensão (os outros 3 eram
  // ShiftEventType em shift-events.ts, o Record em livro-pdf.ts, e o CHECK
  // constraint de service_log_events no banco).
  | "cautela_assinada" | "cautela_cancelada" | "cautela_editada";

export interface EventTypeConfig {
  label: string;
  colorClass: string;
  Icon: LucideIcon;
}

// Fonte única de verdade para label/cor/ícone de evento do Livro Digital —
// achado de code review (2026-07-21): existiam 3 cópias divergentes deste
// mapa (armeiro, histórico, admin), uma já com labels abreviados diferentes
// das outras ("Sol. Aprovada" vs "Solicitação Aprovada"). Ícones lucide-react
// em vez de emoji — guia de design system, seção 19: "nunca usar emojis em
// texto de UI".
export const EVENT_TYPE_CONFIG: Record<EventType, EventTypeConfig> = {
  turno_assumido:          { label: "Turno Assumido",        colorClass: "text-blue-600 bg-blue-500/10 border-blue-500/30",       Icon: Play },
  cautela_emitida:         { label: "Cautela Emitida",        colorClass: "text-emerald-600 bg-emerald-500/10 border-emerald-500/30", Icon: ClipboardList },
  cautela_devolvida:       { label: "Cautela Devolvida",      colorClass: "text-teal-600 bg-teal-500/10 border-teal-500/30",       Icon: CheckCircle2 },
  saida_autorizada:        { label: "Saída Autorizada",       colorClass: "text-indigo-600 bg-indigo-500/10 border-indigo-500/30", Icon: ArrowUpRight },
  saida_devolvida:         { label: "Saída Devolvida",        colorClass: "text-violet-600 bg-violet-500/10 border-violet-500/30", Icon: Undo2 },
  ocorrencia_registrada:   { label: "Ocorrência",             colorClass: "text-orange-600 bg-orange-500/10 border-orange-500/30", Icon: AlertTriangle },
  solicitacao_aprovada:    { label: "Solicitação Aprovada",   colorClass: "text-emerald-600 bg-emerald-500/10 border-emerald-500/30", Icon: CheckCircle2 },
  solicitacao_negada:      { label: "Solicitação Negada",     colorClass: "text-red-600 bg-red-500/10 border-red-500/30",          Icon: XCircle },
  inventario_divergencia:  { label: "Divergência Inventário", colorClass: "text-red-600 bg-red-500/10 border-red-500/30",          Icon: CircleAlert },
  turno_encerrado:         { label: "Turno Encerrado",        colorClass: "text-gray-600 bg-gray-500/10 border-gray-500/30",       Icon: Square },
  evento_manual:           { label: "Registro Manual",        colorClass: "text-yellow-600 bg-yellow-500/10 border-yellow-500/30", Icon: PencilLine },
  cautela_assinada:        { label: "Cautela Assinada",       colorClass: "text-sky-600 bg-sky-500/10 border-sky-500/30",          Icon: FileSignature },
  cautela_cancelada:       { label: "Cautela Cancelada",      colorClass: "text-red-600 bg-red-500/10 border-red-500/30",          Icon: Ban },
  cautela_editada:         { label: "Cautela Editada",        colorClass: "text-amber-600 bg-amber-500/10 border-amber-500/30",    Icon: FileEdit },
};

// Congelado — é um singleton compartilhado por vários componentes (achado
// MÉDIO de code review, 2026-07-21): sem isso, uma mutação acidental num
// consumidor futuro corromperia a config pra toda a UI simultaneamente.
Object.freeze(EVENT_TYPE_CONFIG);

// Ordem de prevalência para EventTypeFilterChips (4-5 tipos mais frequentes
// como chips diretos, o resto atrás de "Mais tipos" — guia de design
// system, seção 15: "nunca mais de 4 filtros visíveis ao mesmo tempo").
export const EVENT_TYPE_PRIMARY_ORDER: EventType[] = [
  "cautela_emitida", "cautela_devolvida", "saida_autorizada", "ocorrencia_registrada",
];
