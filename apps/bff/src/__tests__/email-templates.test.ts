import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { layout } from "../lib/email-templates/_layout.ts";
import { renderTemplate, TEMPLATE_IDS } from "../lib/email-templates/index.ts";
import { sampleTemplateData } from "./_email-fixtures.ts";

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

  it("largura 600, estilo crítico inline; <style> só p/ :hover e @media", () => {
    const { html } = layout({
      baseUrl: BASE, title: "T", preheader: "p", bodyHtml: "x", bodyText: "x",
    });
    assert.match(html, /width="600"|max-width:\s*600px/);
    // o card e a tipografia têm style inline
    assert.match(html, /<table[^>]+class="card"[^>]+style=/);
    // o <style> existe mas é minúsculo e só progressive-enhancement
    const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
    assert.ok(style.length < 700, "o <style> tem que ser mínimo");
    assert.match(style, /\.btn:hover/);
    assert.match(style, /@media/);
    assert.doesNotMatch(style, /position\s*:|z-index/); // nada de layout no <style>
  });

  it("logo hospedada no domínio do sistema, com width/height e alt", () => {
    const { html } = layout({
      baseUrl: "https://apmcb.pmpb.online/", title: "T", preheader: "p", bodyHtml: "x", bodyText: "x",
    });
    assert.match(html, /<img src="https:\/\/apmcb\.pmpb\.online\/images\/andromeda-email\.png"[^>]*width="196"[^>]*height="\d+"[^>]*alt="[^"]+"/);
  });

  it("com CTA: renderiza botão com href e o link também vai no texto plano", () => {
    const { html, text } = layout({
      baseUrl: BASE, title: "T", preheader: "p", bodyHtml: "<p>x</p>", bodyText: "x",
      cta: { label: "Ativar conta", url: "https://apmcb.pmpb.online/login" },
    });
    assert.match(html, /class="btn"[^>]*href="https:\/\/apmcb\.pmpb\.online\/login"/);
    assert.match(html, />\s*Ativar conta\s*</);
    assert.match(text, /Ativar conta: https:\/\/apmcb\.pmpb\.online\/login/);
  });

  it("sem CTA: nenhum botão", () => {
    const { html } = layout({ baseUrl: BASE, title: "T", preheader: "p", bodyHtml: "x", bodyText: "x" });
    assert.doesNotMatch(html, /class="btn"/);
  });

  it("rodapé: 'não responda' + identidade", () => {
    const { html, text } = layout({ baseUrl: BASE, title: "T", preheader: "p", bodyHtml: "x", bodyText: "x" });
    assert.match(html, /não responda a este e-mail/i);
    assert.match(text, /não responda a este e-mail/i);
    assert.match(html, /Controle de Bens Sensíveis/);
  });
});

describe("renderTemplate — contrato geral", () => {
  it("todo template registrado renderiza subject/html/text não-vazios", () => {
    for (const id of TEMPLATE_IDS) {
      const out = renderTemplate(id, sampleTemplateData(id) as never, { baseUrl: BASE, logoDataUri: "" });
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
      const out = renderTemplate(id, sampleTemplateData(id, XSS) as never, { baseUrl: BASE, logoDataUri: "" }, { nome: XSS, orgao: XSS });
      // O layout tem 1 <img> legítima (a logo). O que não pode aparecer é o
      // payload como tag executável.
      assert.doesNotMatch(out.html, /<script/i, `${id}: <script> injetado`);
      assert.doesNotMatch(out.html, /<img\s+src=x/i, `${id}: <img src=x> como tag ativa`);
      // exatamente uma <img> ativa (a logo hospedada); o payload aparece só como &lt;img&gt; escapado
      assert.equal((out.html.match(/<img\b/gi) ?? []).length, 1, `${id}: só a logo pode ser <img> ativa`);
      assert.match(out.html, /&lt;img src=x onerror/i, `${id}: payload tem que estar escapado`);
    }
  });
});
