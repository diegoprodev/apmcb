// Regra de produto (não negociável): NENHUM toast (erro/aviso/info) exibe texto
// técnico — código interno do BFF/banco, mensagem de banco, stack, inglês cru.
// Caso real: "LENDING_BIOMETRIC_PROOF_INVALID" apareceu num toast ao registrar
// uma saída. O filtro fica no `toast` compartilhado, então cobre todos os
// call sites de uma vez.
import { afterEach, describe, expect, it, vi } from "vitest";
import { GENERIC_ERROR_MESSAGE, isTechnicalMessage, userSafeMessage } from "./api-error";

const spies = vi.hoisted(() => ({
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  message: vi.fn(),
  success: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: spies }));

// installSafeToast troca os métodos do próprio objeto; guarda os mocks originais.
const originals = { ...spies };

import { toast } from "sonner";
import { installSafeToast } from "./safe-toast";

afterEach(() => vi.clearAllMocks());

describe("userSafeMessage / isTechnicalMessage", () => {
  it("código interno vira orientação amigável da família, nunca o código", () => {
    expect(userSafeMessage("LENDING_BIOMETRIC_PROOF_INVALID")).toBe(
      "Não foi possível confirmar a identidade. Refaça a verificação e tente novamente.",
    );
    expect(userSafeMessage("BIOMETRIC_PAIRING_CODE_EXPIRED")).toBe(
      "Não foi possível concluir a operação biométrica. Tente novamente.",
    );
    expect(userSafeMessage("CAUTELA_ITEM_NOT_AVAILABLE")).toBe(
      "Não foi possível concluir o registro. Confira os dados e tente novamente.",
    );
    expect(userSafeMessage("SHIFT_REQUIRED")).toBe("É preciso ter um turno de serviço aberto para continuar.");
  });

  it("texto técnico (banco, stack, inglês cru, JSON, uuid) vira a mensagem genérica", () => {
    for (const raw of [
      'duplicate key value violates unique constraint "profiles_pkey"',
      "TypeError: Cannot read properties of undefined",
      "Failed to fetch",
      "Invalid token",
      '{"error":"x"}',
      "Erro no desafio 838b7c3d-6277-40f4-9375-022d02e466be",
      "PGRST116: JSON object requested",
    ]) {
      expect(isTechnicalMessage(raw), raw).toBe(true);
      expect(userSafeMessage(raw), raw).toBe(GENERIC_ERROR_MESSAGE);
    }
  });

  it("mensagem de negócio legítima em pt-BR passa intacta (sem falso positivo)", () => {
    for (const ok of [
      "Cautela criada com sucesso",
      "Credenciais inválidas",
      "Apenas administradores podem aplicar impedimento administrativo",
      "O código dinâmico já foi utilizado. Aguarde o próximo.",
      "Nenhum leitor biométrico ativo nesta reserva.",
      "Sessão expirada. Faça login novamente.",
      "A matrícula 000003 já está cadastrada.",
    ]) {
      expect(isTechnicalMessage(ok), ok).toBe(false);
      expect(userSafeMessage(ok), ok).toBe(ok);
    }
  });
});

describe("installSafeToast", () => {
  it("toast.error/warning/info/message sanitizam texto técnico; success não é tocado", () => {
    installSafeToast();

    toast.error("LENDING_BIOMETRIC_PROOF_INVALID");
    toast.warning("Failed to fetch");
    toast.info("Erro 500: internal server error");
    toast.message("BIOMETRIC_DEVICE_NOT_ACTIVE");
    toast.success("Saída registrada");

    expect(originals.error).toHaveBeenCalledWith(
      "Não foi possível confirmar a identidade. Refaça a verificação e tente novamente.",
      undefined,
    );
    expect(originals.warning).toHaveBeenCalledWith(GENERIC_ERROR_MESSAGE, undefined);
    expect(originals.info).toHaveBeenCalledWith(GENERIC_ERROR_MESSAGE, undefined);
    expect(originals.message).toHaveBeenCalledWith(
      "Não foi possível concluir a operação biométrica. Tente novamente.",
      undefined,
    );
    expect(originals.success).toHaveBeenCalledWith("Saída registrada");
  });

  it("descrição do toast também é sanitizada e texto amigável passa igual", () => {
    installSafeToast();
    toast.error("Não foi possível salvar", { description: "PGRST116 relation \"x\" does not exist" });
    expect(originals.error).toHaveBeenCalledWith("Não foi possível salvar", { description: GENERIC_ERROR_MESSAGE });
  });

  it("é idempotente: instalar de novo não empilha filtros", () => {
    installSafeToast();
    installSafeToast();
    toast.error("Sessão expirada. Faça login novamente.");
    expect(originals.error).toHaveBeenCalledTimes(1);
  });
});
