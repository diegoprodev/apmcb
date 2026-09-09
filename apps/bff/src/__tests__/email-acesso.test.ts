import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderTemplate, templateCategory, validateTemplateData } from "../lib/email-templates/index.ts";

const CTX = { baseUrl: "https://apmcb.pmpb.online", logoDataUri: "" };
const REC = { nome: "Ana Souza", orgao: "APMCB" };
const URL_OK = "https://apmcb.pmpb.online/auth/callback?next=/auth/update-password&token=xyz";

describe("template acesso", () => {
  it("categoria lifecycle", () => {
    assert.equal(templateCategory("acesso"), "lifecycle");
  });

  it("schema: papel + url obrigatórios, url tem que ser URL, .strict", () => {
    assert.equal(validateTemplateData("acesso", { papel: "Armeiro", url: URL_OK }).ok, true);
    assert.equal(validateTemplateData("acesso", { papel: "Armeiro" }).ok, false);
    assert.equal(validateTemplateData("acesso", { papel: "Armeiro", url: "não-é-url" }).ok, false);
    assert.equal(validateTemplateData("acesso", { papel: "x", url: URL_OK, extra: 1 }).ok, false);
  });

  it("renderiza com nome, órgão, papel e botão CTA apontando pra url", () => {
    const out = renderTemplate("acesso", { papel: "Armeiro", url: URL_OK }, CTX, REC);
    assert.match(out.html, /Ana/);
    assert.match(out.html, /APMCB/);
    assert.match(out.html, /Armeiro/);
    assert.match(out.html, /class="btn"[^>]*href="https:\/\/apmcb\.pmpb\.online\/auth\/callback/);
    assert.match(out.html, />\s*Definir minha senha\s*</);
    assert.match(out.text, /Definir minha senha: https:\/\/apmcb\.pmpb\.online\/auth\/callback/);
  });

  it("sem órgão: não quebra", () => {
    const out = renderTemplate("acesso", { papel: "Usuário", url: URL_OK }, CTX, { nome: "Léo", orgao: null });
    assert.match(out.html, /Léo/);
    assert.doesNotMatch(out.html, /da reserva <strong><\/strong>/);
  });

  it("escapa papel/nome/órgão maliciosos", () => {
    const out = renderTemplate("acesso", { papel: "<b>x</b>", url: URL_OK }, CTX, {
      nome: `<script>alert(1)</script>`, orgao: `<img src=x>`,
    });
    assert.doesNotMatch(out.html, /<script>alert/);
    assert.equal((out.html.match(/<img\b/gi) ?? []).length, 1); // só a logo
  });
});
