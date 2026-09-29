// Cálculo puro de "tempo em aberto" — EXCLUSIVO de Saídas (curto prazo,
// material rotativo, precisa alertar pra não ficar preso). Cautela é
// médio/longo prazo por natureza e não usa isso (achado 2026-09-22, decisão
// confirmada com o dono do produto: "não misture as bolas"). Cumulativo:
// "48h" inclui o que já passou de 72h também — nada some do alerta quando
// envelhece mais. Compartilhado entre a tela operacional (/reserva/saidas)
// e o relatório (components/reports/relatorio-detail-table.tsx) — cada um
// renderiza o badge com o próprio estilo visual, só a regra de cálculo é
// comum (SSOT).
export type AgingLevel = "24h" | "48h" | "72h" | null;

export function agingLevel(issuedAt: string, isOpen: boolean): AgingLevel {
  if (!isOpen) return null;
  const hoursOpen = (Date.now() - new Date(issuedAt).getTime()) / 3_600_000;
  if (hoursOpen >= 72) return "72h";
  if (hoursOpen >= 48) return "48h";
  if (hoursOpen >= 24) return "24h";
  return null;
}

// ISO de "agora menos N horas" — usado tanto pelo corte fixo de 24h do card
// do dashboard/navbar quanto pelo corte variável (24/48/72) do filtro de
// aging dos relatórios. Empurrar isso pra um módulo puro, em vez de inline
// `new Date(Date.now() - ...)` em cada call site, também tira o
// `Date.now()` de dentro do corpo dos Server Components (achado de lint
// react-hooks/purity — mesma classe de falso-positivo já documentada em
// components/layout/header.tsx).
export function cutoffISOForHours(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

// Corte usado pelo card do dashboard e pelo indicador da navbar (achado
// MÉDIO de review, 2026-09-29: a mesma regra estava duplicada em
// reserva/page.tsx e em api/reserva/aging-count/route.ts — SSOT aqui evita
// as 2 cópias divergirem silenciosamente se o corte mudar).
export const AGING_ALERT_HOURS = 24;

export function agingAlertCutoffISO(): string {
  return cutoffISOForHours(AGING_ALERT_HOURS);
}

// Papéis que operam saídas (achado BAIXO de review, 2026-09-29: estava
// duplicado em api/reserva/aging-count/route.ts e em
// components/layout/aging-alert-indicator.tsx). O gate real é o da rota
// (server-side); o do componente client é só UX — não esconder o badge é,
// no pior caso, uma chamada a mais pra rota, que devolve count:0 mesmo
// assim.
export const RESERVE_STAFF_ROLES = ["armeiro", "admin_reserva", "admin_global"];
