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
