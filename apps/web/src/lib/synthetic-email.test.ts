import { describe, expect, it } from "vitest";
import { isRealEmail, isValidEmailFormat } from "./synthetic-email";

describe("isRealEmail", () => {
  it("aceita e-mail real bem formado", () => {
    expect(isRealEmail("cadete@apmcb.dev")).toBe(true);
    expect(isRealEmail("  Fulano@Orgao.Gov.BR  ")).toBe(true);
  });

  it("rejeita nulo / vazio", () => {
    expect(isRealEmail(null)).toBe(false);
    expect(isRealEmail(undefined)).toBe(false);
    expect(isRealEmail("   ")).toBe(false);
  });

  it("rejeita e-mail sintético do BFF (@apmcb.sistema)", () => {
    expect(isRealEmail("20250003.interno@apmcb.sistema")).toBe(false);
    expect(isRealEmail("ABC.INTERNO@APMCB.SISTEMA")).toBe(false);
  });

  it("rejeita formato inválido", () => {
    expect(isRealEmail("sem-arroba")).toBe(false);
    expect(isRealEmail("a@b")).toBe(false);
  });
});

describe("isValidEmailFormat", () => {
  it("valida só o formato", () => {
    expect(isValidEmailFormat("a@b.co")).toBe(true);
    expect(isValidEmailFormat("x@y")).toBe(false);
  });
});
