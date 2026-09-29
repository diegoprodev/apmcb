import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isLivenessRejected } from "../lib/biometric-policy.ts";

// Gate de liveness na entrada da prova. O leitor NITGEN Hamster DX não tem
// detector de dedo falso e envia `null`; o dono autorizou aceitar `null`
// (armeiro sempre supervisiona a captura). `false` = dedo falso detectado,
// recusado sempre. A exigência estrita (BIOMETRIC_REQUIRE_LIVENESS=true)
// continua a um flag de distância.
describe("isLivenessRejected — regra única de liveness", () => {
  const cases: Array<[boolean | null, boolean, boolean]> = [
    // [liveness, requireLiveness, recusado]
    [true, false, false],
    [null, false, false],
    [false, false, true],
    [true, true, false],
    [null, true, true],
    [false, true, true],
  ];
  for (const [liveness, requireLiveness, rejected] of cases) {
    it(`liveness=${liveness}, exigência estrita=${requireLiveness} → ${rejected ? "recusa" : "aceita"}`, () => {
      assert.equal(isLivenessRejected(liveness, requireLiveness), rejected);
    });
  }
});

// Guarda de fiação: as três rotas que recebem prova usam a mesma regra —
// o simulador não aplicava nenhuma (achado da revisão de 2026-09-24).
describe("fiação — toda entrada de prova usa isLivenessRejected", () => {
  for (const file of ["biometric-bridge.ts", "biometric.ts", "biometric-simulator.ts"]) {
    it(file, () => {
      const src = readFileSync(resolve(process.cwd(), "src/routes", file), "utf8");
      assert.match(src, /isLivenessRejected\(/, `${file} não aplica o gate de liveness`);
      assert.doesNotMatch(src, /liveness_passed === false \|\|/, `${file} ainda tem cópia manual da regra`);
    });
  }
});
