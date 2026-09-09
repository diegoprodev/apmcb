// Bugs no PDF do Termo de Cautela:
//  (2) as linhas de assinatura não informavam a MODALIDADE de cada
//      assinatura (código dinâmico ou biometria) — ficavam em branco;
//  (3) a seção de itens acautelados não mostrava a quantidade.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  signatureMethodLabel,
  buildCautelaItemRows,
  resolveSignatureMethods,
} from "../lib/pdf/cautela-pdf-content.ts";

describe("signatureMethodLabel — modalidade da assinatura (bug 2)", () => {
  it("biometria verificada → 'Assinado via Biometria'", () => {
    assert.equal(
      signatureMethodLabel({ biometric_verified: true, totp_verified: false }),
      "Assinado via Biometria",
    );
  });

  it("TOTP verificado → 'Assinado via Código Dinâmico'", () => {
    assert.equal(
      signatureMethodLabel({ biometric_verified: false, totp_verified: true }),
      "Assinado via Código Dinâmico",
    );
  });

  it("nunca fica em branco, e NÃO afirma uma modalidade quando nenhuma flag é conhecida", () => {
    for (const sig of [null, undefined, {}, { biometric_verified: false, totp_verified: false }]) {
      const label = signatureMethodLabel(sig);
      assert.ok(label.length > 0, `label vazio para ${JSON.stringify(sig)}`);
      assert.equal(label, "Assinatura eletrônica verificada");
    }
  });
});

describe("resolveSignatureMethods — pareia cada signature_id à sua modalidade", () => {
  const rows = [
    { id: "sig-arm", totp_verified: true, biometric_verified: false },
    { id: "sig-mil", totp_verified: false, biometric_verified: true },
    { id: "sig-outra", totp_verified: true, biometric_verified: false },
  ];

  it("resolve as duas assinaturas pelo id (ignorando linhas alheias)", () => {
    const r = resolveSignatureMethods(rows, "sig-arm", "sig-mil");
    assert.equal(r.ok, true);
    assert.equal(r.ok && signatureMethodLabel(r.signatures.armeiro), "Assinado via Código Dinâmico");
    assert.equal(r.ok && signatureMethodLabel(r.signatures.militar), "Assinado via Biometria");
  });

  it("falha (ok:false) quando falta a linha de uma das assinaturas", () => {
    assert.equal(resolveSignatureMethods([rows[0]], "sig-arm", "sig-mil").ok, false);
  });

  it("falha (ok:false) quando a query voltou nula/indefinida", () => {
    assert.equal(resolveSignatureMethods(null, "sig-arm", "sig-mil").ok, false);
    assert.equal(resolveSignatureMethods(undefined, "sig-arm", "sig-mil").ok, false);
  });
});

describe("buildCautelaItemRows — quantidade do item acautelado (bug 3)", () => {
  const item = { numero_serie: "SN-123", validade_item: "2026-01-05", material_type: { nome: "Colete", categoria: "protecao" } };

  it("inclui a linha 'Quantidade' com valor '1'", () => {
    const rows = buildCautelaItemRows(item, "bom");
    assert.deepEqual(rows.find((r) => r.label === "Quantidade"), { label: "Quantidade", value: "1" });
  });

  it("mostra '—' quando não há número de série", () => {
    const rows = buildCautelaItemRows({ ...item, numero_serie: null }, "bom");
    assert.equal(rows.find((r) => r.label === "Número de série")?.value, "—");
  });

  it("formata a validade como data civil (sem deslocar 1 dia por fuso)", () => {
    const rows = buildCautelaItemRows(item, "bom");
    assert.equal(rows.find((r) => r.label === "Validade do item")?.value, "05/01/2026");
  });
});
