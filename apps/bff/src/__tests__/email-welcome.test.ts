import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderTemplate, templateCategory, validateTemplateData } from "../lib/email-templates/index.ts";

const CTX = { baseUrl: "https://apmcb.pmpb.online", logoDataUri: "" };
const REC = { nome: "Ana Souza", orgao: "APMCB" };

describe("template welcome (Fase 2)", () => {
  it("categoria lifecycle", () => {
    assert.equal(templateCategory("welcome"), "lifecycle");
  });

  it("schema .strict — não aceita nenhum campo em data", () => {
    assert.equal(validateTemplateData("welcome", {}).ok, true);
    assert.equal(validateTemplateData("welcome", { qualquer: 1 }).ok, false);
  });

  it("renderiza saudação, órgão e CTA para /login (montado do baseUrl, não do data)", () => {
    const out = renderTemplate("welcome", {}, CTX, REC);
    assert.match(out.html, /Ana/);
    assert.match(out.html, /APMCB/);
    assert.match(out.html, /class="btn"[^>]*href="https:\/\/apmcb\.pmpb\.online\/login"/);
    assert.match(out.text, /https:\/\/apmcb\.pmpb\.online\/login/);
    assert.match(out.subject, /bem-?vindo/i);
  });

  it("menciona código dinâmico + biometria (orientação do fluxo)", () => {
    const out = renderTemplate("welcome", {}, CTX, REC);
    assert.match(out.html, /din[âa]mico/i);
    assert.match(out.html, /biom[eé]tri/i);
  });

  it("sem órgão: não quebra nem deixa <strong></strong> vazio", () => {
    const out = renderTemplate("welcome", {}, CTX, { nome: "Léo", orgao: null });
    assert.match(out.html, /Léo/);
    assert.doesNotMatch(out.html, /<strong><\/strong>/);
  });

  it("nome vazio: cai no fallback 'militar' em html e text", () => {
    const out = renderTemplate("welcome", {}, CTX, { nome: "", orgao: null });
    assert.match(out.html, /Olá, militar\./);
    assert.match(out.text, /Olá, militar\./);
  });

  it("escapa nome/órgão maliciosos no HTML (o text/plain é literal, convenção do projeto)", () => {
    const out = renderTemplate("welcome", {}, CTX, {
      nome: `<script>alert(1)</script>`,
      orgao: `<img src=x onerror=1>`,
    });
    assert.doesNotMatch(out.html, /<script>alert\(1\)<\/script>/);
    assert.doesNotMatch(out.html, /<img src=x onerror/);
    assert.match(out.html, /&lt;script&gt;/);
  });

  it("todo href aponta para o baseUrl (sem link externo)", () => {
    const out = renderTemplate("welcome", {}, CTX, REC);
    const hrefs = [...out.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    for (const h of hrefs) {
      assert.ok(
        h.startsWith("https://apmcb.pmpb.online") || h.startsWith("mailto:") || h.startsWith("#"),
        `href externo: ${h}`,
      );
    }
  });
});
