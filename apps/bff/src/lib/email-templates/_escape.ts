// Load-bearing: campos livres do usuário (nome_completo, nome do órgão) entram
// no corpo HTML do e-mail. Sem escape, um nome com "<script>" ou aspas quebra a
// marcação / abre XSS no cliente de e-mail que renderiza HTML.
//
// Ordem importa: "&" primeiro, senão as entidades geradas nas linhas seguintes
// (&lt; etc.) seriam re-escapadas.
const MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => MAP[ch]);
}

// Remove CR/LF e caracteres de controle C0/C1 (exceto tab) e limita
// comprimento. Aplicado a TODO valor de string vindo do caller antes de
// interpolar em subject/corpo — defesa contra header/content injection via
// `data` (plano §3.6 D4).
export function sanitizeField(value: unknown, maxLen = 200): string {
  if (typeof value !== "string") return "";
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    const isControl = (code <= 0x1f && code !== 0x09) || (code >= 0x7f && code <= 0x9f);
    out += isControl ? " " : ch;
  }
  return out.trim().slice(0, maxLen);
}
