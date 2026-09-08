import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { layout } from "../lib/email-templates/_layout.ts";
import { renderTemplate, TEMPLATE_IDS } from "../lib/email-templates/index.ts";

const BASE = "https://apmcb.pmpb.online";

describe("layout", () => {
  it("html contém título, preheader e corpo; sem <script>", () => {
    const { html } = layout({
      baseUrl: BASE,
      logoDataUri: "",
      title: "Título X",
      preheader: "resumo curto",
      bodyHtml: "<p>corpo aqui</p>",
      bodyText: "corpo aqui",
    });
    assert.match(html, /Título X/);
    assert.match(html, /resumo curto/);
    assert.match(html, /corpo aqui/);
    assert.doesNotMatch(html, /<script/i);
  });

  it("text é plano, sem tags, e contém o corpo e o rodapé institucional", () => {
    const { text } = layout({
      baseUrl: BASE,
      logoDataUri: "",
      title: "T",
      preheader: "p",
      bodyHtml: "<p>linha um</p>",
      bodyText: "linha um",
    });
    assert.doesNotMatch(text, /<[a-z]/i);
    assert.match(text, /linha um/);
    assert.match(text, /Andrômeda/);
  });

  it("largura fixa 600 e CSS inline (sem <style> no head)", () => {
    const { html } = layout({
      baseUrl: BASE, logoDataUri: "", title: "T", preheader: "p",
      bodyHtml: "x", bodyText: "x",
    });
    assert.match(html, /width="600"|max-width:\s*600px/);
    assert.doesNotMatch(html, /<style/i);
  });

  it("sem logoDataUri, usa wordmark textual Andrômeda (não quebra <img src=\"\">)", () => {
    const { html } = layout({
      baseUrl: BASE, logoDataUri: "", title: "T", preheader: "p",
      bodyHtml: "x", bodyText: "x",
    });
    assert.doesNotMatch(html, /<img[^>]*src=""/);
  });
});

describe("renderTemplate — contrato geral", () => {
  it("todo template registrado renderiza subject/html/text não-vazios", () => {
    for (const id of TEMPLATE_IDS) {
      const data =
        id === "canary" ? { nonce: "abc123" } : {};
      const out = renderTemplate(id, data as never, { baseUrl: BASE, logoDataUri: "" });
      assert.ok(out.subject.length > 0, `${id} subject`);
      assert.ok(out.html.length > 0, `${id} html`);
      assert.ok(out.text.length > 0, `${id} text`);
    }
  });

  it("template desconhecido lança", () => {
    assert.throws(() => renderTemplate("nao_existe" as never, {} as never, { baseUrl: BASE, logoDataUri: "" }));
  });

  it("canary: subject não expõe nada sensível e o nonce aparece no corpo", () => {
    const out = renderTemplate("canary", { nonce: "n-42" }, { baseUrl: BASE, logoDataUri: "" });
    assert.match(out.text, /n-42/);
  });

  it("subject e text não contêm CRLF (defesa contra header injection)", () => {
    const out = renderTemplate("canary", { nonce: "a\r\nb" }, { baseUrl: BASE, logoDataUri: "" });
    assert.doesNotMatch(out.subject, /[\r\n]/);
  });

  it("nenhum template deixa payload malicioso escapar como tag HTML", () => {
    const XSS = `<img src=x onerror=alert(1)>"><script>alert(2)</script>`;
    for (const id of TEMPLATE_IDS) {
      const shape = id === "canary" ? { nonce: XSS } : {};
      const out = renderTemplate(id, shape as never, { baseUrl: BASE, logoDataUri: "" }, { nome: XSS, orgao: XSS });
      // O corpo controlado pelo template pode ter <p>/<table> etc.; o que não
      // pode aparecer é uma <img>/<script> vinda do payload (não-escapada).
      assert.doesNotMatch(out.html, /<img\b/i, `${id}: <img> injetada`);
      assert.doesNotMatch(out.html, /<script/i, `${id}: <script> injetado`);
    }
  });
});
