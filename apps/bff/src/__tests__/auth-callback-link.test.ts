import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRecoveryCallbackLink } from "../lib/auth-callback-link.ts";

// Por que este módulo existe (bug real, produção 2026-09-09):
// O `action_link` devolvido por `generateLink` aponta para o endpoint GoTrue
// `/auth/v1/verify`, que sempre responde com os tokens no FRAGMENTO da URL
// (implicit flow — não há PKCE em link gerado no servidor). O Route Handler
// server-side `/auth/callback` não enxerga fragmento → cai em `/auth/error`.
// A correção: montar o link direto para `/auth/callback?token_hash=...&type=recovery`
// para que o próprio handler faça `verifyOtp` no servidor.
const HEX56 = "05c0a105654dfca2a7bc4a84cfbb7cee5f1cf7c3487b1d05662108e3";

describe("buildRecoveryCallbackLink", () => {
  it("monta /auth/callback com token_hash, type=recovery e next=/auth/update-password", () => {
    const parsed = new URL(
      buildRecoveryCallbackLink({ frontendUrl: "https://apmcb.pmpb.online", hashedToken: HEX56 }),
    );
    assert.equal(parsed.origin, "https://apmcb.pmpb.online");
    assert.equal(parsed.pathname, "/auth/callback");
    assert.equal(parsed.searchParams.get("token_hash"), HEX56);
    assert.equal(parsed.searchParams.get("type"), "recovery");
    assert.equal(parsed.searchParams.get("next"), "/auth/update-password");
    assert.equal(parsed.hash, "");
  });

  it("não gera link para o endpoint /auth/v1/verify do GoTrue", () => {
    const url = buildRecoveryCallbackLink({ frontendUrl: "https://apmcb.pmpb.online", hashedToken: HEX56 });
    assert.ok(!url.includes("/auth/v1/verify"), "link não deve rotear pelo /verify");
    assert.ok(!url.includes("supabase.co"), "link deve apontar para o frontend");
  });

  it("normaliza barra(s) final(is) do frontendUrl", () => {
    for (const base of ["https://apmcb.pmpb.online/", "https://apmcb.pmpb.online///"]) {
      const url = buildRecoveryCallbackLink({ frontendUrl: base, hashedToken: HEX56 });
      assert.equal(new URL(url).pathname, "/auth/callback");
      assert.ok(!url.includes("//auth/callback"));
    }
  });

  it("lança se hashedToken estiver ausente, vazio ou fora do formato hex", () => {
    for (const bad of ["", "   ", "não-hex!!", "abc", "ABCDEF0123456789abcdef0123456789abcdef01", "g".repeat(56), "a".repeat(200), undefined as unknown as string]) {
      assert.throws(
        () => buildRecoveryCallbackLink({ frontendUrl: "https://apmcb.pmpb.online", hashedToken: bad }),
        /hashedToken/,
        `deveria rejeitar ${JSON.stringify(bad)}`,
      );
    }
  });

  it("aceita hashedToken hex minúsculo de tamanhos plausíveis", () => {
    for (const len of [40, 56, 64, 128]) {
      assert.doesNotThrow(() =>
        buildRecoveryCallbackLink({ frontendUrl: "https://apmcb.pmpb.online", hashedToken: "a".repeat(len) }),
      );
    }
  });

  it("lança se frontendUrl não for http(s)", () => {
    for (const bad of ["", "apmcb.pmpb.online", "javascript:alert(1)", "ftp://x", undefined as unknown as string]) {
      assert.throws(
        () => buildRecoveryCallbackLink({ frontendUrl: bad, hashedToken: HEX56 }),
        /frontendUrl/,
      );
    }
  });

  it("o link final tem no máximo 500 chars (alinhado ao sanitizeField do renderTemplate)", () => {
    const url = buildRecoveryCallbackLink({ frontendUrl: "https://apmcb.pmpb.online", hashedToken: "f".repeat(128) });
    assert.ok(url.length <= 500, `link com ${url.length} chars`);
  });
});
