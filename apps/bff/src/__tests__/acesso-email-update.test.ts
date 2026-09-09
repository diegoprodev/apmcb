import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyEmailUpdateOutcome } from "../lib/acesso-email-update.ts";

// POST /api/admin/users/enviar-acesso, passo 1 (trocar o e-mail sintético pelo
// real via GoTrue updateUserById). O GoTrue devolve a violação do índice único
// `users_email_partial_key` como um **500 "Error updating user"** — nem sempre
// 422 — então a classificação NÃO pode se basear só no status. A verdade está
// na re-conferência do dono: se depois do erro o e-mail do militar É o alvo,
// foi corrida e deu certo; se NÃO é, o alvo pertence a outra conta.

const TARGET = "novo@exemplo.com";

describe("classifyEmailUpdateOutcome", () => {
  it("sem erro no update → ok", () => {
    const r = classifyEmailUpdateOutcome({ updateErrorStatus: undefined, recheckEmail: null, targetEmail: TARGET });
    assert.equal(r.ok, true);
  });

  it("erro 500 'Error updating user' + recheck mostra e-mail de OUTRA conta → 409 amigável", () => {
    const r = classifyEmailUpdateOutcome({
      updateErrorStatus: 500,
      recheckEmail: "526690.interno@apmcb.sistema",
      targetEmail: TARGET,
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, 409);
    assert.match(r.error!, /já está em uso/i);
  });

  it("erro 422 idem → 409 (não confia no status, confia no recheck)", () => {
    const r = classifyEmailUpdateOutcome({ updateErrorStatus: 422, recheckEmail: "outro@x.com", targetEmail: TARGET });
    assert.equal(r.status, 409);
  });

  it("erro no update MAS recheck mostra que o e-mail já é o alvo → corrida, ok", () => {
    const r = classifyEmailUpdateOutcome({ updateErrorStatus: 500, recheckEmail: TARGET, targetEmail: TARGET });
    assert.equal(r.ok, true);
  });

  it("recheck é case-insensitive", () => {
    const r = classifyEmailUpdateOutcome({ updateErrorStatus: 500, recheckEmail: "NOVO@Exemplo.com", targetEmail: TARGET });
    assert.equal(r.ok, true);
  });

  it("erro 429 (rate limit do GoTrue) → 429, nunca 409 (senão acusaria 'e-mail em uso' por engano)", () => {
    const r = classifyEmailUpdateOutcome({ updateErrorStatus: 429, recheckEmail: "526690.interno@apmcb.sistema", targetEmail: TARGET });
    assert.equal(r.ok, false);
    assert.equal(r.status, 429);
    assert.match(r.error!, /aguarde|tentativas/i);
  });

  it("erro no update E recheck também falhou (recheckEmail null) → 502, não 409", () => {
    const r = classifyEmailUpdateOutcome({ updateErrorStatus: 503, recheckEmail: null, targetEmail: TARGET });
    assert.equal(r.ok, false);
    assert.equal(r.status, 502);
  });

  it("recheck retornou string vazia (user sem e-mail) → 502, não 409 por engano", () => {
    const r = classifyEmailUpdateOutcome({ updateErrorStatus: 500, recheckEmail: "   ", targetEmail: TARGET });
    assert.equal(r.status, 502);
  });

  it("targetEmail é comparado normalizado (o caller já passa lowercased, mas o helper não confia)", () => {
    const r = classifyEmailUpdateOutcome({ updateErrorStatus: 500, recheckEmail: "a@b.com", targetEmail: "A@B.com" });
    assert.equal(r.ok, true);
  });
});
