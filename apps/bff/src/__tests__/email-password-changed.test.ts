import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  renderTemplate,
  templateCategory,
  validateTemplateData,
} from "../lib/email-templates/index.ts";

const CTX = { baseUrl: "https://apmcb.pmpb.online", logoDataUri: "" };
const REC = { nome: "Ana", orgao: null };

describe("template password_changed", () => {
  it("é registrado com categoria security", () => {
    assert.equal(templateCategory("password_changed"), "security");
  });

  it("schema exige `quando` e rejeita chave extra (.strict)", () => {
    assert.equal(validateTemplateData("password_changed", { quando: "hoje" }).ok, true);
    assert.equal(validateTemplateData("password_changed", {}).ok, false);
    assert.equal(validateTemplateData("password_changed", { quando: "x", foo: 1 }).ok, false);
  });

  it("renderiza com o primeiro nome do destinatário e o `quando`", () => {
    const out = renderTemplate("password_changed", { quando: "08/09/2026 19:40" }, CTX, REC);
    assert.match(out.subject, /senha/i);
    assert.match(out.html, /Ana/);
    assert.match(out.html, /08\/09\/2026 19:40/);
    assert.match(out.text, /08\/09\/2026 19:40/);
  });

  it("NÃO contém link, href, token nem senha", () => {
    const out = renderTemplate("password_changed", { quando: "hoje" }, CTX, REC);
    assert.doesNotMatch(out.html, /<a\s+href/i);
    assert.doesNotMatch(out.html, /\{\{|token|senha atual/i);
  });

  it("orienta o usuário a procurar o administrador se não reconhecer", () => {
    const out = renderTemplate("password_changed", { quando: "hoje" }, CTX, REC);
    assert.match(out.text, /administrador/i);
  });

  it("escapa nome malicioso do destinatário", () => {
    const out = renderTemplate("password_changed", { quando: "hoje" }, CTX, {
      nome: `<script>alert(1)</script>`,
      orgao: null,
    });
    assert.doesNotMatch(out.html, /<script>alert/);
  });

  it("remove CRLF de `quando` (anti header injection)", () => {
    const out = renderTemplate("password_changed", { quando: "a\r\nx" }, CTX, REC);
    assert.doesNotMatch(out.subject, /[\r\n]/);
    // O \r\n vira espaço no corpo — o vetor de injeção (quebra de linha) some.
    assert.doesNotMatch(out.html, /a\r\nx/);
    assert.match(out.html, /a\s+x/);
  });
});
