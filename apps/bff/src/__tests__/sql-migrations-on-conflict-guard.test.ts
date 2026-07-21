import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

// Achado ALTO de code review (2026-07-21, migration
// 20260721221152_biometric_bridge_phase1c_fix_finger_index_ambiguous.sql):
// este é o 3º incidente do MESMO padrão de bug nesta base —
// `ON CONFLICT (colunas)` dentro de uma função com `RETURNS TABLE(...)` é
// ambíguo sempre que uma coluna do conflict target tem o mesmo nome de um
// parâmetro OUT implícito (o parser trata a lista do conflict target como
// lista de expressões, sujeita à substituição de variável do PL/pgSQL).
// Já ocorreu em consume_biometric_pairing_code (reserve_id, depois
// tenant_id — migrations 20260720173000/20260720180000) e em
// record_biometric_enrollment (finger_index — 20260721221152). As duas
// vezes só foi pego depois de CI vermelho + investigação manual, porque
// nenhum teste estático guardava contra recorrência. Este teste fecha essa
// lacuna: falha se a definição MAIS RECENTE de qualquer função com
// RETURNS TABLE usar `ON CONFLICT (colunas)` em vez de
// `ON CONFLICT ON CONSTRAINT <nome>` (a forma estruturalmente seguraa,
// sem lista de expressões pro parser resolver — já validada 2x em
// produção).

const root = resolve(process.cwd(), "..", "..");
const migrationsDir = resolve(root, "supabase/migrations");

interface FunctionDef {
  file: string;
  signature: string;
  body: string;
}

function extractFunctionDefs(sql: string): Array<{ name: string; signature: string; body: string }> {
  const defs: Array<{ name: string; signature: string; body: string }> = [];
  const headerRe = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?(\w+)\s*\(/gi;
  let headerMatch: RegExpExecArray | null;
  while ((headerMatch = headerRe.exec(sql)) !== null) {
    const name = headerMatch[1];
    const headerStart = headerMatch.index;
    const dollarOpenRe = /\$([a-zA-Z_]*)\$/g;
    dollarOpenRe.lastIndex = headerRe.lastIndex;
    const openMatch = dollarOpenRe.exec(sql);
    if (!openMatch) continue;
    const tag = openMatch[0];
    const signature = sql.slice(headerStart, openMatch.index);
    const bodyStart = openMatch.index + tag.length;
    const closeIdx = sql.indexOf(tag, bodyStart);
    if (closeIdx === -1) continue;
    const body = sql.slice(bodyStart, closeIdx);
    defs.push({ name, signature, body });
    headerRe.lastIndex = closeIdx + tag.length;
  }
  return defs;
}

function currentFunctionDefs(): Map<string, FunctionDef> {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  const current = new Map<string, FunctionDef>();
  for (const file of files) {
    const sql = readFileSync(resolve(migrationsDir, file), "utf8");
    for (const def of extractFunctionDefs(sql)) {
      current.set(def.name, { file, signature: def.signature, body: def.body });
    }
  }
  return current;
}

describe("guarda estática — funções RETURNS TABLE nunca usam ON CONFLICT (colunas)", () => {
  it("o parser de definições encontra um número plausível de funções nas migrations reais (sanity do próprio guard)", () => {
    const current = currentFunctionDefs();
    assert.ok(
      current.size > 20,
      `esperava dezenas de funções distintas nas migrations reais, achou ${current.size} — o parser regex provavelmente quebrou e o guard abaixo estaria passando vazio, sem checar nada`,
    );
  });

  it("o parser de fato detecta a forma perigosa (fixture sintética — não é um no-op silencioso)", () => {
    const bogus = `create or replace function public.fake_fn(p_x uuid)
returns table(x uuid)
language plpgsql
as $$
begin
  insert into some_table (x) values (p_x)
  on conflict (x) do update set x = excluded.x;
end;
$$;`;
    const defs = extractFunctionDefs(bogus);
    assert.equal(defs.length, 1);
    assert.match(defs[0].signature, /returns\s+table\s*\(/i);
    assert.match(defs[0].body, /on\s+conflict\s*\(/i);
  });

  it("toda função SQL atual com RETURNS TABLE usa ON CONFLICT ON CONSTRAINT, nunca ON CONFLICT (colunas)", () => {
    const current = currentFunctionDefs();
    const violations: string[] = [];
    for (const [name, def] of current) {
      if (!/returns\s+table\s*\(/i.test(def.signature)) continue;
      if (/on\s+conflict\s*\(/i.test(def.body)) {
        violations.push(
          `${name} (definição atual em ${def.file}): usa ON CONFLICT (colunas) numa função RETURNS TABLE — ` +
          `risco de "column reference ... is ambiguous" se alguma coluna do conflict target colidir com um ` +
          `parâmetro OUT (3 incidentes reais nesta base: consume_biometric_pairing_code x2, ` +
          `record_biometric_enrollment x1). Use ON CONFLICT ON CONSTRAINT <nome_da_constraint>.`,
        );
      }
    }
    assert.deepEqual(violations, [], `\n${violations.join("\n")}`);
  });
});
