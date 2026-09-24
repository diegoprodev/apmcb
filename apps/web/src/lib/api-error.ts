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
 *
 * Achado MÉDIO de code review: quando o status é 401/403 E a mensagem cai no
 * fallback (vazia ou bloqueada — ex: exatamente as mensagens cruas da lista
 * acima, "Authentication required"/"Forbidden"/"Nexus session expired"), o
 * fallback usado era sempre o texto genérico do CALL SITE (ex: "Erro ao
 * carregar solicitações") — o usuário nunca ficava sabendo que o motivo real
 * era sessão expirada ou falta de permissão, então não sabia que a ação
 * certa era relogar. Isto NÃO afeta nenhum 401/403 que já carregue uma
 * mensagem de negócio legítima em pt-BR (ex: "Credenciais inválidas" do
 * login) — essas passam direto pelo último `return apiError`, sem nunca
 * alcançar este fallback especial.
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

const SESSION_EXPIRED_MESSAGE = "Sessão expirada. Faça login novamente.";
const NO_PERMISSION_MESSAGE = "Você não tem permissão para realizar esta ação.";

function statusFallback(status: number | undefined, fallback: string): string {
  if (status === 401) return SESSION_EXPIRED_MESSAGE;
  if (status === 403) return NO_PERMISSION_MESSAGE;
  return fallback;
}

export const GENERIC_ERROR_MESSAGE = "Não foi possível concluir a ação. Tente novamente em instantes.";

// Códigos internos do BFF/banco (LENDING_..., BIOMETRIC_..., CAUTELA_...) nunca
// chegam ao usuário — viram uma orientação genérica por família.
const CODE_FAMILY_MESSAGES: Array<[RegExp, string]> = [
  [/^SHIFT_REQUIRED$/, "É preciso ter um turno de serviço aberto para continuar."],
  [
    /^(LENDING_BIOMETRIC_|LENDING_TOTP_|BIOMETRIC_RETURN_(PROOF|IDENTITY)|IDENTITY_VERIFICATION_|BIOMETRIC_PROOF_)/,
    "Não foi possível confirmar a identidade. Refaça a verificação e tente novamente.",
  ],
  [/^BIOMETRIC_/, "Não foi possível concluir a operação biométrica. Tente novamente."],
  [/^(LENDING_|CAUTELA_|MATERIAL_|SHIFT_|RESERVE_)/, "Não foi possível concluir o registro. Confira os dados e tente novamente."],
];

const ERROR_CODE_RE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/;
const TECHNICAL_RE =
  /(exception|typeerror|referenceerror|syntaxerror|undefined|\bnull\b|\bNaN\b|failed to|fetch failed|networkerror|econn|etimedout|sqlstate|pgrst|violates|constraint|duplicate key|relation ".*"|column ".*"|\bjwt\b|unexpected token|stack trace|cannot read|is not a function|invalid input syntax|\bzod\b|internal server|bad request|not found|unauthorized|forbidden)/i;
const ENGLISH_START_RE =
  /^(failed|error:|invalid|missing|unable|cannot|could not|unexpected|request failed|too many|something went wrong|network error)/i;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i;

/** true quando o texto parece código interno, erro de banco, stack ou inglês técnico. */
export function isTechnicalMessage(message: string): boolean {
  const m = message.trim();
  if (m.length === 0) return false;
  return (
    ERROR_CODE_RE.test(m) ||
    TECHNICAL_RE.test(m) ||
    ENGLISH_START_RE.test(m) ||
    UUID_RE.test(m) ||
    m.startsWith("{") ||
    m.startsWith("[") ||
    m.includes('":')
  );
}

/**
 * Garante que só texto amigável em pt-BR chega ao usuário: código conhecido vira
 * a orientação da família, qualquer outro texto técnico vira a mensagem genérica.
 * Texto de negócio legítimo passa intacto.
 */
export function userSafeMessage(message: string, fallback: string = GENERIC_ERROR_MESSAGE): string {
  const trimmed = message.trim();
  const code = trimmed.match(ERROR_CODE_RE)?.[0];
  if (code) {
    for (const [family, friendly] of CODE_FAMILY_MESSAGES) {
      if (family.test(code)) return friendly;
    }
    return fallback;
  }
  return isTechnicalMessage(trimmed) ? fallback : message;
}

export function friendlyApiError(
  status: number | undefined,
  apiError: unknown,
  fallback: string,
): string {
  if (typeof status === "number" && status >= 500) return fallback;
  if (typeof apiError !== "string" || apiError.trim().length === 0) return statusFallback(status, fallback);
  if (KNOWN_RAW_BFF_MESSAGES.has(apiError)) return statusFallback(status, fallback);
  return userSafeMessage(apiError, statusFallback(status, fallback));
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
