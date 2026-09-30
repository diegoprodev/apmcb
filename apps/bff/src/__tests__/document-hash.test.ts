import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { hashDocument } from "../lib/document-hash.ts";
import { canonicalJson } from "../lib/canonical-json.ts";

// R-01A (docs/auditoria/REMEDIATION_LEDGER.md): hashDocument usava
// JSON.stringify(content, sortedKeys) — o array de replacer vira allowlist
// em TODOS os níveis, então tudo dentro de `data` era descartado.

const base = { document_type: "lending", document_id: "11111111-1111-1111-1111-111111111111" };

describe("canonicalJson", () => {
  it("ordena chaves em todos os níveis, preservando ordem de arrays", () => {
    assert.equal(
      canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: "x" } }),
      '{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}',
    );
  });

  it("omite propriedades undefined (mesma semântica do JSON)", () => {
    assert.equal(canonicalJson({ a: 1, b: undefined }), canonicalJson({ a: 1 }));
  });

  it("usa toJSON (Date vira string ISO, não {})", () => {
    assert.equal(canonicalJson({ d: new Date("2026-01-01T00:00:00.000Z") }), '{"d":"2026-01-01T00:00:00.000Z"}');
  });

  it("rejeita valores que o JSON colapsaria silenciosamente", () => {
    assert.throws(() => canonicalJson({ n: NaN }), /não finito/);
    assert.throws(() => canonicalJson({ n: Infinity }), /não finito/);
    assert.throws(() => canonicalJson([undefined]), /não serializável/);
    assert.throws(() => canonicalJson({ f: () => 1 }), /não serializável/);
    assert.throws(() => canonicalJson({ b: 10n }), /não serializável/);
    assert.throws(() => canonicalJson({ m: new Map([["a", 1]]) }), /objeto não-plano/);
  });

  it("rejeita referência circular", () => {
    const a: Record<string, unknown> = { x: 1 };
    a.self = a;
    assert.throws(() => canonicalJson(a), /circular/);
  });

  it("rejeita array esparso (JSON viraria null; map() geraria JSON inválido)", () => {
    // eslint-disable-next-line no-sparse-arrays
    assert.throws(() => canonicalJson([1, , 3]), /esparso/);
    assert.throws(() => canonicalJson({ a: new Array(2) }), /esparso/);
  });

  it("rejeita Date inválida (toJSON devolveria null)", () => {
    assert.throws(() => canonicalJson({ d: new Date(Number.NaN) }), /Date inválida/);
  });

  it("rejeita aninhamento acima do limite sem estourar a pilha", () => {
    let deep: unknown = 1;
    for (let i = 0; i < 20_000; i++) deep = [deep];
    assert.throws(() => canonicalJson(deep), /profundidade/);
    let ok: unknown = 1;
    for (let i = 0; i < 64; i++) ok = { k: ok };
    assert.doesNotThrow(() => canonicalJson(ok));
  });

  it("aceita o mesmo objeto repetido em ramos irmãos (não é ciclo)", () => {
    const shared = { k: 1 };
    assert.equal(canonicalJson({ a: shared, b: shared }), '{"a":{"k":1},"b":{"k":1}}');
  });
});

describe("hashDocument (content hash)", () => {
  it("CASO 1: data.nome diferente → hashes diferentes", () => {
    const a = hashDocument({ ...base, data: { nome: "A", valor: 1 } });
    const b = hashDocument({ ...base, data: { nome: "B", valor: 1 } });
    assert.notEqual(a, b);
  });

  it("CASO 2: mesma informação, ordem de inserção diferente → mesmo hash", () => {
    const a = hashDocument({ document_type: "lending", document_id: base.document_id, data: { x: 1, y: { p: 1, q: 2 } } });
    const b = hashDocument({ data: { y: { q: 2, p: 1 }, x: 1 }, document_id: base.document_id, document_type: "lending" });
    assert.equal(a, b);
  });

  it("CASO 3: alteração em propriedade aninhada profunda → hash diferente", () => {
    const deep = (v: string) => ({ ...base, data: { a: { b: { c: { d: { e: v } } } } } });
    assert.notEqual(hashDocument(deep("1")), hashDocument(deep("2")));
  });

  it("CASO 4: arrays em ordem diferente → hashes diferentes", () => {
    assert.notEqual(
      hashDocument({ ...base, data: { itens: [1, 2, 3] } }),
      hashDocument({ ...base, data: { itens: [3, 2, 1] } }),
    );
  });

  it("CASO 5: objetos dentro de arrays são canonicalizados", () => {
    const a = hashDocument({ ...base, data: { itens: [{ id: 1, qtd: 2 }, { id: 2, qtd: 5 }] } });
    const b = hashDocument({ ...base, data: { itens: [{ qtd: 2, id: 1 }, { qtd: 5, id: 2 }] } });
    const c = hashDocument({ ...base, data: { itens: [{ id: 1, qtd: 2 }, { id: 2, qtd: 6 }] } });
    assert.equal(a, b);
    assert.notEqual(a, c);
  });

  it("CASO 6 (regressão da auditoria): conteúdos distintos não colapsam no hash antigo", () => {
    // Entradas exatas da sonda P1 da baseline: o algoritmo antigo devolvia
    // d3a6ce85…204f para AMBAS.
    const OLD_COLLIDING_HASH = "d3a6ce85e791165efb7785b380dc4aa13e84d51b43760c230bde3e57a65b204f";
    const a = hashDocument({ ...base, data: { arma: "PT100 serial 123", militar: "A" } });
    const b = hashDocument({ ...base, data: { arma: "FUZIL serial 999", militar: "B", qualquer: [1, 2, 3] } });
    assert.notEqual(a, b);
    assert.notEqual(a, OLD_COLLIDING_HASH);
    assert.notEqual(b, OLD_COLLIDING_HASH);
  });

  it("CASO 6b (regressão da auditoria): cautela nova deixa de ter hash constante", () => {
    // makeDocHash de cautelamentos.ts: document_type "handover", document_id "new".
    // Hash antigo, idêntico para TODA cautela nova:
    const OLD_CONSTANT_CAUTELA_HASH = "1a7c0eabf0c652726c2110da9e096bfde70dbd5e580f2b9c0e9000f84cf0ced9";
    const cautela = (item: string) => hashDocument({
      document_type: "handover",
      document_id: "new",
      data: { item_id: item, militar_id: "m", armeiro_id: "a", motivo_emissao: "x", data_emissao: "2026-01-01T00:00:00.000Z" },
    });
    assert.notEqual(cautela("item-1"), cautela("item-2"));
    assert.notEqual(cautela("item-1"), OLD_CONSTANT_CAUTELA_HASH);
  });

  it("é SHA-256 hex do JSON canônico (UTF-8) — especificação verificável", () => {
    const content = { ...base, data: { nome: "Ação", n: 1 } };
    const expected = createHash("sha256").update(canonicalJson(content), "utf8").digest("hex");
    assert.equal(hashDocument(content), expected);
    assert.match(hashDocument(content), /^[0-9a-f]{64}$/);
  });
});
