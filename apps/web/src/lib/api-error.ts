/**
 * Deriva uma mensagem segura para exibição em toast a partir de um payload de
 * erro retornado pelo BFF.
 *
 * Regra de produto (não negociável): nenhum toast pode expor mensagem técnica
 * crua — erro de Postgres/Supabase, stack trace, nome de tabela/coluna, código
 * SQLSTATE etc. O padrão predominante nas rotas do BFF (`apps/bff/src/routes/*.ts`)
 * é repassar `error.message` bruto do Supabase em respostas 5xx
 * (`c.json({ error: error.message }, 500)`), enquanto respostas 4xx carregam
 * mensagens de negócio já pensadas para o usuário (ex: "Categoria já existe").
 *
 * Por isso: em status >= 500 sempre usar o fallback amigável; em 4xx é seguro
 * exibir a mensagem vinda da API. O detalhe técnico original deve sempre ser
 * registrado via `console.error` (não descartado) para debug via F12.
 *
 * Além disso, algumas rotas/middlewares do BFF ainda retornam strings em
 * inglês mesmo em 4xx (levantado por auditoria em `apps/bff/src/middleware/*.ts`
 * e `routes/*.ts`) — essas são bloqueadas por nome via KNOWN_RAW_BFF_MESSAGES,
 * independentemente do status.
 */
const KNOWN_RAW_BFF_MESSAGES = new Set([
  "Authentication required",
  "Invalid token",
  "Profile not found",
  "Insufficient permissions",
  "Internal server error",
  "Forbidden",
  "Nexus session required",
  "Nexus session expired",
  "Nexus authorization required",
  "Failed to save template",
  "Material not found",
  "Insufficient stock",
  "Lending not found or already returned",
  "Failed to fetch events",
  "Failed to fetch errors",
  "Failed to configure TOTP",
  "Failed to provision TOTP",
]);

export function friendlyApiError(
  status: number | undefined,
  apiError: unknown,
  fallback: string,
): string {
  if (typeof apiError !== "string" || apiError.trim().length === 0) return fallback;
  if (typeof status === "number" && status >= 500) return fallback;
  if (KNOWN_RAW_BFF_MESSAGES.has(apiError)) return fallback;
  return apiError;
}

/**
 * Erro de API já sanitizado (mensagem segura para toast) — usar no lugar de
 * `Error` genérico ao propagar falhas de `fetch`/`bffFetch` via try/catch.
 *
 * Padrão de uso:
 * ```ts
 * if (!res.ok) throw new ApiError(friendlyApiError(res.status, data.error, "Erro ao salvar"), res.status);
 * ...
 * } catch (error) {
 *   console.error("[contexto] falha ao salvar", error);
 *   toast.error(error instanceof ApiError ? error.message : "Erro de conexão. Tente novamente.");
 * }
 * ```
 * Assim, exceções de rede/parse (que carregam mensagens técnicas em inglês,
 * como "Failed to fetch") nunca chegam ao usuário — apenas `ApiError`, cuja
 * mensagem já foi filtrada por `friendlyApiError`.
 */
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}
