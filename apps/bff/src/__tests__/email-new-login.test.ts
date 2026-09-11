import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderTemplate, templateCategory, validateTemplateData } from "../lib/email-templates/index.ts";

const CTX = { baseUrl: "https://apmcb.pmpb.online", logoDataUri: "" };
const REC = { nome: "Ana Souza", orgao: "APMCB" };

describe("template new_login (Fase 3)", () => {
  it("categoria security (nunca silenciado sob throttle)", () => {
    assert.equal(templateCategory("new_login"), "security");
  });

  it("schema .strict — quando obrigatório; dispositivo/ip_regiao opcionais", () => {
    assert.equal(validateTemplateData("new_login", { quando: "10/09/2026 08:00" }).ok, true);
    assert.equal(
      validateTemplateData("new_login", { quando: "x", dispositivo: "Chrome em Windows", ip_regiao: "191.0.0.x" }).ok,
      true,
    );
    assert.equal(validateTemplateData("new_login", {}).ok, false); // quando obrigatório
    assert.equal(validateTemplateData("new_login", { quando: "x", extra: 1 }).ok, false);
    assert.equal(validateTemplateData("new_login", { quando: "x", url: "https://mal.com" }).ok, false);
  });

  it("corpo tem quando + dispositivo + região, e a orientação de trocar senha", () => {
    const out = renderTemplate("new_login", { quando: "10/09/2026 08:00", dispositivo: "Chrome em Windows", ip_regiao: "191.0.0.x" }, CTX, REC);
    assert.match(out.html, /Ana/);
    assert.match(out.html, /10\/09\/2026 08:00/);
    assert.match(out.html, /Chrome em Windows/);
    assert.match(out.html, /191\.0\.0\.x/);
    assert.match(out.html, /troque a senha/i);
    assert.match(out.subject, /novo acesso/i);
  });

  it("sem dispositivo/região: não quebra, não deixa frase pela metade", () => {
    const out = renderTemplate("new_login", { quando: "10/09/2026 08:00" }, CTX, REC);
    assert.match(out.html, /10\/09\/2026 08:00/);
    assert.doesNotMatch(out.html, /a partir de\s*<\/p>/i);
    assert.doesNotMatch(out.html, /região de rede\s*\./i);
  });

  it("NUNCA imprime IP completo — só o prefixo com x (a rota já passa mascarado)", () => {
    const out = renderTemplate("new_login", { quando: "x", ip_regiao: "191.0.0.x" }, CTX, REC);
    assert.doesNotMatch(out.text, /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
  });

  it("escapa nome/dispositivo/região maliciosos no HTML", () => {
    const out = renderTemplate("new_login", {
      quando: "x",
      dispositivo: "<script>alert(1)</script>",
      ip_regiao: "<img src=x onerror=1>",
    }, CTX, { nome: "<b>x</b>", orgao: null });
    assert.doesNotMatch(out.html, /<script>alert\(1\)<\/script>/);
    assert.doesNotMatch(out.html, /<img src=x onerror/);
    assert.match(out.html, /&lt;script&gt;/);
  });

  it("sem link externo (todo href aponta pro baseUrl / mailto / #)", () => {
    const out = renderTemplate("new_login", { quando: "x" }, CTX, REC);
    for (const m of out.html.matchAll(/href="([^"]+)"/g)) {
      assert.ok(
        m[1].startsWith("https://apmcb.pmpb.online") || m[1].startsWith("mailto:") || m[1].startsWith("#"),
        `href externo: ${m[1]}`,
      );
    }
  });
});
