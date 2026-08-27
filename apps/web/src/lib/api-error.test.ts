// Achado MÉDIO de code review (revisão UX Fases 6-8): 401/403 caíam no
// fallback genérico do CALL SITE em vez de avisar "sessão expirada"/"sem
// permissão" — o usuário não descobria que precisava relogar. Cobre a nova
// regra de statusFallback() e confirma que ela NUNCA intercepta uma mensagem
// de negócio legítima já em pt-BR (ex: "Credenciais inválidas").
import { describe, expect, it } from "vitest";
import { ApiError, friendlyApiError } from "./api-error";

describe("friendlyApiError", () => {
  it("status >= 500 sempre usa o fallback do call site, mesmo com mensagem presente", () => {
    expect(friendlyApiError(500, "duplicate key value violates unique constraint", "Erro ao salvar")).toBe("Erro ao salvar");
    expect(friendlyApiError(503, "", "Erro ao salvar")).toBe("Erro ao salvar");
  });

  it("mensagem de negócio legítima em pt-BR passa verbatim, mesmo em 401/403", () => {
    // Não deve ser interceptada pelo novo statusFallback — só mensagens
    // vazias ou bloqueadas por KNOWN_RAW_BFF_MESSAGES caem nele.
    expect(friendlyApiError(401, "Credenciais inválidas", "Erro ao entrar")).toBe("Credenciais inválidas");
    expect(friendlyApiError(403, "Apenas administradores podem aplicar impedimento administrativo", "Erro")).toBe(
      "Apenas administradores podem aplicar impedimento administrativo",
    );
  });

  it("401 sem mensagem útil (vazia ou bloqueada) vira 'sessão expirada', não o fallback genérico do call site", () => {
    expect(friendlyApiError(401, "", "Erro ao carregar solicitações")).toBe("Sessão expirada. Faça login novamente.");
    expect(friendlyApiError(401, "Authentication required", "Erro ao carregar solicitações")).toBe(
      "Sessão expirada. Faça login novamente.",
    );
    expect(friendlyApiError(401, "Nexus session expired", "Erro ao carregar dados")).toBe(
      "Sessão expirada. Faça login novamente.",
    );
  });

  it("403 sem mensagem útil (vazia ou bloqueada) vira 'sem permissão', não o fallback genérico do call site", () => {
    expect(friendlyApiError(403, "", "Erro ao salvar")).toBe("Você não tem permissão para realizar esta ação.");
    expect(friendlyApiError(403, "Forbidden", "Erro ao salvar")).toBe("Você não tem permissão para realizar esta ação.");
    expect(friendlyApiError(403, "Insufficient permissions", "Erro ao aprovar")).toBe(
      "Você não tem permissão para realizar esta ação.",
    );
  });

  it("4xx que não seja 401/403, sem mensagem útil, ainda usa o fallback do call site (comportamento inalterado)", () => {
    expect(friendlyApiError(404, "Material not found", "Material não encontrado")).toBe("Material não encontrado");
    expect(friendlyApiError(409, "", "Conflito ao salvar")).toBe("Conflito ao salvar");
  });

  it("status undefined (ex: erro de rede sem resposta) não aciona statusFallback — usa o fallback normal", () => {
    expect(friendlyApiError(undefined, "", "Erro de conexão")).toBe("Erro de conexão");
  });
});

describe("ApiError", () => {
  it("carrega message e status, e é instanceof Error", () => {
    const err = new ApiError("Sessão expirada. Faça login novamente.", 401);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Sessão expirada. Faça login novamente.");
    expect(err.status).toBe(401);
    expect(err.name).toBe("ApiError");
  });
});
