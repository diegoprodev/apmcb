import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml } from "../lib/email-templates/_escape.ts";

describe("escapeHtml", () => {
  it("escapa os cinco caracteres perigosos em HTML", () => {
    assert.equal(
      escapeHtml(`<script>alert("x") & 'y'</script>`),
      "&lt;script&gt;alert(&quot;x&quot;) &amp; &#39;y&#39;&lt;/script&gt;",
    );
  });

  it("string sem caractere especial passa inalterada", () => {
    assert.equal(escapeHtml("João da Silva 123"), "João da Silva 123");
  });

  it("string vazia retorna vazia", () => {
    assert.equal(escapeHtml(""), "");
  });

  it("escapa & antes de outras entidades (sem dupla codificação invertida)", () => {
    assert.equal(escapeHtml("a & <b>"), "a &amp; &lt;b&gt;");
  });
});
