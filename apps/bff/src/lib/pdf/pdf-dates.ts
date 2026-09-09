// SSOT de formatação de datas para os geradores de PDF. Extraído de
// pdf-theme.ts (que agora só re-exporta) para permitir teste unitário via
// `node --test` — pdf-theme.ts importa services/supabase e só carrega no
// runtime real (bun).
//
// Distinção crítica preservada (achado de code review anterior):
//  - fmtDate/fmtDateTime aplicam timeZone "America/Recife" — corretos para
//    TIMESTAMPTZ (instante real: created_at, data_emissao);
//  - fmtCivilDate faz parsing puramente textual — para colunas DATE puras
//    (validade_item, prazo_proxima_conferencia), onde passar por Date +
//    timezone desloca 1 dia pra trás de forma determinística.

export const fmtDate = (d?: string | null): string => {
  if (!d) return "—";
  const date = new Date(d);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("pt-BR", { timeZone: "America/Recife" });
};

export const fmtDateTime = (d?: string | null): string => {
  if (!d) return "—";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("pt-BR", {
    timeZone: "America/Recife",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
};

export const fmtCivilDate = (d?: string | null): string => {
  if (!d) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : fmtDate(d);
};
