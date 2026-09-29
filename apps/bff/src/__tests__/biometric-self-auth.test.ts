import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  biometricPurposeIsSelfAuth,
  biometricPurposeRequiresExpectedUser,
  biometricSelfAuthTargetsOther,
} from "../lib/biometric-proof.ts";

// Achado da revisão (2026-09-29): abrir/fechar turno e as assinaturas do
// armeiro são autoautenticação — a digital tem de ser do PRÓPRIO ator. O
// servidor aceitava criar esses desafios sem usuário esperado (null) e o
// bridge então fazia identificação 1:N no tenant inteiro: o dedo de outro
// armeiro virava "Identidade confirmada" com nome/matrícula dele antes do 401.
// A única barreira era o cliente desabilitar a captura. A regra mora no
// servidor.
const SELF_AUTH = ["open_shift", "close_shift", "sign_cautela_armeiro", "sign_saida_armeiro"];
const ACTOR = "11111111-1111-1111-1111-111111111111";
const OTHER = "44444444-4444-4444-4444-444444444444";

describe("finalidades de autoautenticação", () => {
  it("exigem usuário esperado", () => {
    for (const purpose of SELF_AUTH) {
      assert.equal(biometricPurposeRequiresExpectedUser(purpose), true, purpose);
    }
  });

  it("são exatamente as do próprio ator (terceiros e 1:N ficam de fora)", () => {
    for (const purpose of SELF_AUTH) assert.equal(biometricPurposeIsSelfAuth(purpose), true, purpose);
    for (const purpose of ["identify", "return", "enroll", "confirm_saida_militar", "sign_cautela_militar", "handover_sign_exit"]) {
      assert.equal(biometricPurposeIsSelfAuth(purpose), false, purpose);
    }
  });

  it("mirar outra pessoa ou ninguém é recusado; mirar o próprio ator passa", () => {
    for (const purpose of SELF_AUTH) {
      assert.equal(biometricSelfAuthTargetsOther(purpose, OTHER, ACTOR), true, `${purpose}/outro`);
      assert.equal(biometricSelfAuthTargetsOther(purpose, null, ACTOR), true, `${purpose}/null`);
      assert.equal(biometricSelfAuthTargetsOther(purpose, ACTOR, ACTOR), false, `${purpose}/próprio`);
    }
    // Finalidades de terceiros não são afetadas.
    assert.equal(biometricSelfAuthTargetsOther("confirm_saida_militar", OTHER, ACTOR), false);
    assert.equal(biometricSelfAuthTargetsOther("identify", null, ACTOR), false);
  });

  // Guarda de fiação: biometric-authorization.ts não é importável em
  // node --test (imports sem extensão), então a correção vem dos testes
  // acima e esta guarda só prova que a checagem está ligada e vem primeiro.
  it("actorCanAccessChallenge aplica a regra antes de qualquer consulta, para todo papel", () => {
    const src = readFileSync(resolve(process.cwd(), "src/lib/biometric-authorization.ts"), "utf8");
    const fn = src.slice(src.indexOf("export async function actorCanAccessChallenge"));
    const check = fn.indexOf("biometricSelfAuthTargetsOther(purpose, expectedUserId, userId)");
    assert.ok(check > 0, "actorCanAccessChallenge não chama biometricSelfAuthTargetsOther");
    assert.ok(check < fn.indexOf('if (role === "admin_global")'), "a regra precisa vir antes dos ramos por papel");
  });
});
