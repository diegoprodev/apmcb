import { test } from "node:test";
import assert from "node:assert/strict";
import {
  policyKey,
  policyBody,
  diffPolicies,
  findGrantOffenders,
  findTablesWithoutRls,
  evaluateChildNotNull,
  findUnguardedReserveFunctions,
  partitionUnguarded,
  type PolicyRow,
} from "../ci/reserve-gates-core.ts";

function policy(overrides: Partial<PolicyRow> = {}): PolicyRow {
  return {
    schema: "public",
    table: "profiles",
    policy: "profiles_select",
    cmd: "SELECT",
    permissive: "PERMISSIVE",
    roles: ["public"],
    qual: "(user_id = auth.uid())",
    with_check: null,
    ...overrides,
  };
}

test("policyKey identifica schema.table.policy de forma estável", () => {
  assert.equal(policyKey(policy()), "public.profiles.profiles_select");
});

test("policyBody ordena roles antes de compor a chave — [b,a] e [a,b] não são drift", () => {
  const p1 = policy({ roles: ["b", "a"] });
  const p2 = policy({ roles: ["a", "b"] });
  assert.equal(policyBody(p1), policyBody(p2));
});

test("policyBody distingue qual/with_check null de string vazia — sem colisão espúria", () => {
  const withNullQual = policy({ qual: null });
  const withEmptyQual = policy({ qual: "" });
  // Não devem colidir com um with_check preenchido igual ao qual de outro
  assert.notEqual(policyBody(withNullQual), policyBody(policy({ qual: "(true)" })));
  assert.equal(policyBody(withNullQual), policyBody(withEmptyQual)); // limitação conhecida, documentada
});

test("diffPolicies: nenhuma mudança → tudo vazio", () => {
  const baseline = [policy()];
  const live = [policy()];
  assert.deepEqual(diffPolicies(baseline, live), { added: [], removed: [], changed: [] });
});

test("diffPolicies: policy nova aparece em 'added'", () => {
  const baseline: PolicyRow[] = [];
  const live = [policy()];
  const diff = diffPolicies(baseline, live);
  assert.deepEqual(diff.added, ["public.profiles.profiles_select"]);
  assert.deepEqual(diff.removed, []);
  assert.deepEqual(diff.changed, []);
});

test("diffPolicies: policy removida aparece em 'removed'", () => {
  const baseline = [policy()];
  const live: PolicyRow[] = [];
  const diff = diffPolicies(baseline, live);
  assert.deepEqual(diff.removed, ["public.profiles.profiles_select"]);
});

test("diffPolicies: mesmo nome, qual diferente → 'changed', não 'added'+'removed'", () => {
  const baseline = [policy({ qual: "(user_id = auth.uid())" })];
  const live = [policy({ qual: "(true)" })]; // ex.: alguém afrouxou a policy
  const diff = diffPolicies(baseline, live);
  assert.deepEqual(diff, { added: [], removed: [], changed: ["public.profiles.profiles_select"] });
});

test("diffPolicies: array vazio (RPC sem dado) contra baseline não-vazio → tudo 'removed', nunca silencioso", () => {
  // Regressão do achado C3 do review: jsonb_agg de conjunto vazio virava
  // NULL e o script tratava como sucesso. Este teste trava esse contrato:
  // um array vazio TEM que aparecer como drift, nunca como "sem mudança".
  const baseline = [policy(), policy({ policy: "profiles_update", cmd: "UPDATE" })];
  const live: PolicyRow[] = [];
  const diff = diffPolicies(baseline, live);
  assert.equal(diff.removed.length, 2);
});

test("findGrantOffenders: rotina fora da allowlist é reportada", () => {
  const grants = [
    { routine: "auth_role()", grantee: "authenticated" },
    { routine: "record_lending_batch(uuid,uuid,uuid,uuid,uuid,text,text,uuid,jsonb)", grantee: "anon" },
  ];
  const allowlist = new Set(["auth_role()"]);
  const offenders = findGrantOffenders(grants, allowlist);
  assert.equal(offenders.length, 1);
  assert.equal(offenders[0]?.routine, "record_lending_batch(uuid,uuid,uuid,uuid,uuid,text,text,uuid,jsonb)");
});

test("findGrantOffenders: grant a PUBLIC de rotina fora da allowlist é reportado (não só anon/authenticated)", () => {
  const grants = [{ routine: "nova_rpc_perigosa()", grantee: "PUBLIC" }];
  const offenders = findGrantOffenders(grants, new Set(["auth_role()"]));
  assert.equal(offenders.length, 1);
});

test("findGrantOffenders: allowlist chaveada por assinatura completa não deixa overload colar no nome nu", () => {
  // auth_role() está na allowlist; auth_role(text) (overload hipotético) não.
  const grants = [{ routine: "auth_role(text)", grantee: "anon" }];
  const offenders = findGrantOffenders(grants, new Set(["auth_role()"]));
  assert.equal(offenders.length, 1);
});

test("findGrantOffenders: lista vazia → nenhum ofensor", () => {
  assert.deepEqual(findGrantOffenders([], new Set(["auth_role()"])), []);
});

test("findTablesWithoutRls: reporta só as tabelas com rowsecurity=false", () => {
  const rows = [
    { table: "profiles", rowsecurity: true, forcerowsecurity: false },
    { table: "leaky_table", rowsecurity: false, forcerowsecurity: false },
  ];
  const offenders = findTablesWithoutRls(rows);
  assert.deepEqual(offenders.map((r) => r.table), ["leaky_table"]);
});

test("evaluateChildNotNull: todas presentes e true → sem missing nem violating", () => {
  const status = { material_items: true, lendings_extra: true };
  const result = evaluateChildNotNull(status, ["material_items"]);
  assert.deepEqual(result, { missing: [], violating: [] });
});

test("evaluateChildNotNull: tabela esperada ausente na resposta → 'missing', nunca assumida ok", () => {
  // Regressão do achado M2: RPC que droppa uma tabela do resultado não pode
  // ser tratada como "0 violações" por default de valor ausente.
  const status = {};
  const result = evaluateChildNotNull(status, ["material_items", "document_signatures"]);
  assert.deepEqual(result.missing, ["material_items", "document_signatures"]);
  assert.deepEqual(result.violating, []);
});

test("evaluateChildNotNull: constraint removida (attnotnull=false) → 'violating'", () => {
  const status = { material_items: false };
  const result = evaluateChildNotNull(status, ["material_items"]);
  assert.deepEqual(result.violating, ["material_items"]);
});

test("findUnguardedReserveFunctions: function com p_reserve_id sem nenhuma guarda é reportada", () => {
  const fns = [
    {
      name: "record_lending_batch",
      args: "p_reserve_id uuid",
      has_p_reserve_id: true,
      has_search_path: true,
      body_mentions_assert_actor: false,
      body_mentions_assert_device: false,
    },
  ];
  assert.equal(findUnguardedReserveFunctions(fns).length, 1);
});

test("findUnguardedReserveFunctions: guarda por assert_device basta (não exige os dois)", () => {
  const fns = [
    {
      name: "record_biometric_proof",
      args: "p_reserve_id uuid",
      has_p_reserve_id: true,
      has_search_path: true,
      body_mentions_assert_actor: false,
      body_mentions_assert_device: true,
    },
  ];
  assert.equal(findUnguardedReserveFunctions(fns).length, 0);
});

test("findUnguardedReserveFunctions: function sem p_reserve_id nunca é reportada, guardada ou não", () => {
  const fns = [
    {
      name: "auth_role",
      args: "",
      has_p_reserve_id: false,
      has_search_path: true,
      body_mentions_assert_actor: false,
      body_mentions_assert_device: false,
    },
  ];
  assert.equal(findUnguardedReserveFunctions(fns).length, 0);
});

test("partitionUnguarded: débito conhecido não vira newViolations", () => {
  const unguarded = [
    { name: "record_lending_batch", args: "p_reserve_id uuid", has_p_reserve_id: true, has_search_path: true, body_mentions_assert_actor: false, body_mentions_assert_device: false },
  ];
  const result = partitionUnguarded(unguarded, new Set(["record_lending_batch"]));
  assert.deepEqual(result.newViolations, []);
  assert.equal(result.knownDebt.length, 1);
});

test("partitionUnguarded: function nova (fora da allowlist de débito) vira newViolations — bloqueia", () => {
  const unguarded = [
    { name: "record_totally_new_rpc", args: "p_reserve_id uuid", has_p_reserve_id: true, has_search_path: true, body_mentions_assert_actor: false, body_mentions_assert_device: false },
  ];
  const result = partitionUnguarded(unguarded, new Set(["record_lending_batch"]));
  assert.equal(result.newViolations.length, 1);
  assert.deepEqual(result.knownDebt, []);
});

test("partitionUnguarded: overload do mesmo nome cai no mesmo grupo (débito cobre todos os overloads)", () => {
  const unguarded = [
    { name: "record_lending_returns", args: "a", has_p_reserve_id: true, has_search_path: true, body_mentions_assert_actor: false, body_mentions_assert_device: false },
    { name: "record_lending_returns", args: "b", has_p_reserve_id: true, has_search_path: true, body_mentions_assert_actor: false, body_mentions_assert_device: false },
  ];
  const result = partitionUnguarded(unguarded, new Set(["record_lending_returns"]));
  assert.equal(result.knownDebt.length, 2);
  assert.deepEqual(result.newViolations, []);
});
