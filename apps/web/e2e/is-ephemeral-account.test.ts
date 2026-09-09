import { describe, it, expect } from "vitest";
import { isEphemeralTestAccount, PERMANENT_FIXTURE_MATRICULAS } from "./is-ephemeral-account";

describe("isEphemeralTestAccount", () => {
  it("casa todos os prefixos de matrícula usados por specs", () => {
    for (const m of [
      "E2EMSV1JHZVR25S", "U7XRMAAK", "CMBXXODB", "LGPFHUTN", "PW2NEOAV",
      "MLT3LV6V", "MTABCDEF", "MSVXYZ", "CFAP123456", "NUPEX654321",
      "RBAC1788", "R15_PENDING_1783887495371", "R15-PENDING-9", "HACK001",
      "999998", "999000", "999123", "X001", "X9",
    ]) {
      expect(isEphemeralTestAccount({ matricula: m }), m).toBe(true);
    }
  });

  it("casa por domínio de e-mail de teste mesmo com matrícula numérica", () => {
    for (const email of [
      "sd.foo@e2e.test", "x@apmcb.test", "y@example.com",
      "e2e.abc.novo@e2e.test", "z+e2e@gmail.com", "w+test@gmail.com",
      "delivered@resend.dev", "deleted-abc-123@apmcb.invalid",
    ]) {
      expect(isEphemeralTestAccount({ matricula: "700123", email }), email).toBe(true);
    }
  });

  it("casa por frase de nome de fixture", () => {
    for (const nome of [
      "Test auditor", "Temp armeiro", "Teste RBAC",
      "Sd E2E EmailChange msv1", "Militar Teste RBAC JV06",
      "R15 Pending Biometric", "Nome Editado Teste", "Cap Login pfhutn",
      "Sgt Cadastro bxxodb", "Hacker", "Admin CFAP E2E", "Test CT05c",
    ]) {
      expect(isEphemeralTestAccount({ nome_completo: nome, matricula: "ZZZ" }), nome).toBe(true);
    }
  });

  it("NÃO casa as contas fixture permanentes / reais (whitelist)", () => {
    for (const m of PERMANENT_FIXTURE_MATRICULAS) {
      expect(
        isEphemeralTestAccount({ matricula: m, email: "cadete@apmcb.dev", nome_completo: "Cadete Teste" }),
        m,
      ).toBe(false);
    }
  });

  it("NÃO casa militar real: matrícula numérica + e-mail sintético/real + nome de roster", () => {
    expect(isEphemeralTestAccount({
      matricula: "526690-1", email: "5266901.interno@apmcb.sistema", nome_completo: "ALBUQUERQUE MIRANDA",
    })).toBe(false);
    expect(isEphemeralTestAccount({
      matricula: "987654", email: "joao.silva@pmpb.pb.gov.br", nome_completo: "SILVA SANTOS Joao Pedro",
    })).toBe(false);
    expect(isEphemeralTestAccount({
      matricula: "540221", email: null, nome_completo: "Cel PM Ricardo Nunes",
    })).toBe(false);
  });

  it("entrada vazia/nula → false", () => {
    expect(isEphemeralTestAccount({})).toBe(false);
    expect(isEphemeralTestAccount({ matricula: null, email: null, nome_completo: null })).toBe(false);
    expect(isEphemeralTestAccount({ matricula: "  ", email: "  ", nome_completo: "  " })).toBe(false);
  });
});
