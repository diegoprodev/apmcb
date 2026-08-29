/**
 * Formatação canônica de data/hora — SSOT do timezone da aplicação.
 *
 * Por que existe: `toLocaleDateString`/`toLocaleTimeString`/`toLocaleString`
 * sem `timeZone` explícito usam o timezone do AMBIENTE DE EXECUÇÃO. Em
 * componentes "use client" renderizados via SSR, o servidor (CF Pages edge
 * runtime, UTC) e o browser do usuário (America/Recife) produzem strings
 * diferentes para a mesma data — hydration mismatch (React error #418).
 *
 * Regra: todo componente client-side que formata data/hora deve usar estas
 * funções (ou passar `{ timeZone: APP_TIMEZONE }` explicitamente), nunca
 * chamar `toLocale*` sem timeZone diretamente.
 */

export const APP_TIMEZONE = "America/Recife";

export function formatDate(iso: string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  if (!iso) return "—";
  // timeZone por último — nunca sobrescrevível por opts (mesma trava de
  // formatTime/formatDateTime abaixo; é o contrato central deste módulo).
  return new Date(iso).toLocaleDateString("pt-BR", { ...opts, timeZone: APP_TIMEZONE });
}

// Achado de code review (2026-08-29, badge de snooze do AVU): colunas
// `date` do Postgres ("yyyy-mm-dd", sem hora) NÃO devem passar por
// `formatDate` — `new Date("yyyy-mm-dd")` é interpretado como meia-noite
// UTC, e convertido para APP_TIMEZONE (America/Recife, UTC-3) cai no dia
// ANTERIOR (ex.: `formatDate("2026-09-05")` retorna "04/09/2026", um dia a
// menos). Bug pré-existente, afetava toda exibição de
// `prazo_devolucao_data`/`prazo_proxima_conferencia` antes desta correção —
// ver docs/enterprise/specs/alertas-vencimento-unificado-enterprise.md.
// Aqui não há timezone a aplicar: a string já representa um dia civil fixo,
// sem componente de hora — só reformatar os componentes, nunca rotear por
// `Date`.
export function formatDateOnly(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return "—";
  const [, y, mo, d] = m;
  return `${d}/${mo}/${y}`;
}

export function formatTime(iso: string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit", minute: "2-digit",
    ...opts,
    timeZone: APP_TIMEZONE,
  });
}

export function formatDateTime(iso: string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
    ...opts,
    timeZone: APP_TIMEZONE,
  });
}
