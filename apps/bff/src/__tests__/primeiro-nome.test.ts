import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { primeiroNome } from "../lib/primeiro-nome.ts";

describe("primeiroNome", () => {
  it("nome completo retorna só o primeiro token", () => {
    assert.equal(primeiroNome("João da Silva Sauro"), "João");
  });

  it("nome de uma palavra retorna a palavra", () => {
    assert.equal(primeiroNome("Madonna"), "Madonna");
  });

  it("espaços nas bordas são ignorados", () => {
    assert.equal(primeiroNome("  Ana  Maria  "), "Ana");
  });

  it("nulo/vazio cai no fallback", () => {
    assert.equal(primeiroNome(null, "militar"), "militar");
    assert.equal(primeiroNome("", "militar"), "militar");
    assert.equal(primeiroNome("   ", "militar"), "militar");
  });

  it("sem fallback, nulo retorna string vazia", () => {
    assert.equal(primeiroNome(null), "");
  });

  it("descarta um e-mail passado como nome (evita expor endereço no corpo)", () => {
    assert.equal(primeiroNome("fulano@exemplo.com", "militar"), "militar");
  });
});
