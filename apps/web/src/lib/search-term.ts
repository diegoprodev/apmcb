// Sanitiza um termo de busca livre antes de interpolá-lo num filtro
// PostgREST `.or("col.ilike.%<termo>%,...")`. O PostgREST separa os ramos do
// `.or()` por vírgula de nível superior e agrupa com parênteses — um termo
// com `,` ou `)` injetaria condições extras (baixa severidade: o resultado
// ainda é limitado por `.in("role", ...)`, mas é entrada de usuário chegando
// crua num parser). Remove só o que quebra o parser do `.or()` — `,` `(` `)`
// `\` — e mantém `.` `@` `_` `-` `+` etc., que são literais na posição de
// valor do `ilike` e essenciais para buscar por e-mail e matrícula.
const POSTGREST_OR_META = /[,()\\]/g;

export function sanitizeSearchTerm(raw: string, maxLen = 80): string {
  return raw.replace(POSTGREST_OR_META, " ").replace(/\s+/g, " ").trim().slice(0, maxLen);
}
