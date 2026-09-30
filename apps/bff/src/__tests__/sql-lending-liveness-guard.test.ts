import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractFunctionDefs, readMigrations } from "./helpers/sql-function-defs.ts";

// Achado ALTO de code review (2026-09-24, migration
// 20260924001500_lending_rpcs_liveness_null_allowed.sql): o leitor NITGEN
// Hamster DX não tem detector de dedo falso e envia liveness_passed = NULL.
// record_lending_batch/record_lending_returns exigiam `= true` e a saída por
// digital falhava com LENDING_BIOMETRIC_PROOF_INVALID. A correção reescreveu
// as sobrecargas vivas via DO + replace — então a ÚLTIMA definição completa
// no repositório (20260923023207) ainda carrega a condição antiga. O padrão da
// base é criar sobrecarga nova copiando o corpo anterior (4 vezes em 2 meses):
// a próxima cópia traria a condição de volta sem nenhum teste falhar.
// Esta guarda falha se qualquer definição dessas RPCs criada DEPOIS da
// correção voltar a recusar liveness desconhecido.

const FIX_MIGRATION = "20260924001500_lending_rpcs_liveness_null_allowed.sql";
const GUARDED = new Set(["record_lending_batch", "record_lending_returns"]);
// Pega a cópia literal e as variações que também recusam NULL, com ou sem
// alias: `is distinct from true`, `is not true`, `<> true`, `= true` (inclusive
// dentro de `not (...)`), `not coalesce(x, false)` e `coalesce(x, false) = false`.
// Não pega a forma correta, `is not distinct from false`.
const LIVENESS = String.raw`(?:\b\w+\.)?liveness_passed`;
const OLD_CONDITION = new RegExp(
  [
    String.raw`${LIVENESS}\s+(?:is\s+distinct\s+from\s+true|is\s+not\s+true|<>\s*true)`,
    String.raw`${LIVENESS}\s*=\s*true`,
    String.raw`not\s+coalesce\(\s*${LIVENESS}\s*,\s*false\s*\)`,
    String.raw`coalesce\(\s*${LIVENESS}\s*,\s*false\s*\)\s*=\s*false`,
  ].join("|"),
  "i",
);

function findLivenessRegressions(migrations: Array<{ file: string; sql: string }>): string[] {
  const violations: string[] = [];
  for (const { file, sql } of migrations) {
    if (file <= FIX_MIGRATION) continue;
    for (const def of extractFunctionDefs(sql)) {
      if (GUARDED.has(def.name) && OLD_CONDITION.test(def.body)) {
        violations.push(
          `${def.name} em ${file}: recusa liveness_passed NULL ("is distinct from true"). ` +
          `Leitores sem detector de dedo falso (Hamster DX) voltam a falhar na saída/devolução. ` +
          `Use "v_proof.liveness_passed is not distinct from false".`,
        );
      }
    }
  }
  return violations;
}

describe("guarda estática — saída/devolução aceitam liveness desconhecido (NULL)", () => {
  it("a migration de correção existe e troca exatamente a condição antiga pela nova", () => {
    const fix = readMigrations().find((m) => m.file === FIX_MIGRATION);
    assert.ok(fix, `migration ${FIX_MIGRATION} não encontrada`);
    assert.match(fix.sql, /'v_proof\.liveness_passed is distinct from true'/);
    assert.match(fix.sql, /'v_proof\.liveness_passed is not distinct from false'/);
  });

  it("o parser enxerga as definições reais dessas RPCs (sanity: a guarda não passa vazia)", () => {
    const names = new Set<string>();
    for (const { sql } of readMigrations()) {
      for (const def of extractFunctionDefs(sql)) if (GUARDED.has(def.name)) names.add(def.name);
    }
    assert.deepEqual([...names].sort(), [...GUARDED].sort());
  });

  it("detecta uma sobrecarga futura que copie a condição antiga (fixture sintética)", () => {
    const copied = `create or replace function public.record_lending_batch(p_x uuid)
returns jsonb language plpgsql as $$
begin
  if v_proof.liveness_passed is distinct from true then
    raise exception 'LENDING_BIOMETRIC_PROOF_INVALID';
  end if;
end;
$$;`;
    const antes = { file: "20260101000000_antiga.sql", sql: copied };
    const depois = { file: "20261001000000_nova_sobrecarga.sql", sql: copied };
    assert.deepEqual(findLivenessRegressions([antes]), [], "definições anteriores à correção são reescritas por ela");
    assert.equal(findLivenessRegressions([depois]).length, 1);
    assert.deepEqual(
      findLivenessRegressions([{ file: depois.file, sql: copied.replace("is distinct from true", "is not distinct from false") }]),
      [],
    );
    for (const variant of [
      "v_prova.liveness_passed is not true",
      "v_proof.liveness_passed <> true",
      "not coalesce(v_proof.liveness_passed, false)",
      "liveness_passed is distinct from true",
      "not (v_proof.liveness_passed = true)",
      "coalesce(bp.liveness_passed, false) = false",
    ]) {
      const sql = copied.replace("v_proof.liveness_passed is distinct from true", variant);
      assert.equal(findLivenessRegressions([{ file: depois.file, sql }]).length, 1, `variante não detectada: ${variant}`);
    }
  });

  it("nenhuma migration posterior à correção recusa liveness NULL nessas RPCs", () => {
    const violations = findLivenessRegressions(readMigrations());
    assert.deepEqual(violations, [], `\n${violations.join("\n")}`);
  });
});
