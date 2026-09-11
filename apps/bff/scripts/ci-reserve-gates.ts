// SP3 do isolamento por reserva — harness de CI que roda contra PROD
// (pós-deploy, no smoke) via RPCs SECURITY DEFINER só-leitura
// (supabase/migrations/20260911131947_sp3_ci_gate_rpcs.sql). Ver
// docs/superpowers/specs/2026-09-09-isolamento-reserva-design.md §7/§8.
//
// Uso: cd apps/bff && node --experimental-strip-types scripts/ci-reserve-gates.ts
//      cd apps/bff && node --experimental-strip-types scripts/ci-reserve-gates.ts --write-baseline
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
//
// Este arquivo é casca de I/O (fetch das RPCs, leitura/escrita de arquivo,
// print, exit code). A lógica de decisão pass/fail é pura e mora em
// src/ci/reserve-gates-core.ts (testada em src/__tests__/reserve-gates-core.test.ts)
// — este script fica fora do tsconfig "include" e não tem suíte própria.
//
// Gates (todos avaliados antes de decidir o exit code — nenhum para no
// primeiro erro, todos os achados aparecem juntos):
//   1. role_routine_grants: nenhuma SECURITY DEFINER function tem grant
//      anon/authenticated/PUBLIC fora da allowlist abaixo.
//   2. rls_status: toda tabela do schema public tem relrowsecurity = true.
//   3. child_reserve_id_not_null: as 7 tabelas-filho do SP4 ainda têm a
//      constraint NOT NULL em reserve_id (não conta linhas — a coluna é
//      NOT NULL desde o SP4, contar violação seria tautologia sempre-zero).
//   4. policy_snapshot: diff estrutural contra supabase/ci/policy-snapshot.json.
//      Mudança de policy intencional → rode com --write-baseline e revise o
//      diff do JSON no PR.
//   5. security_definer p_reserve_id: toda function SECURITY DEFINER cujo
//      argumento inclui p_reserve_id referencia assert_actor_in_reserve OU
//      assert_device_in_reserve no corpo (prepara o SP8).

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  diffPolicies,
  evaluateChildNotNull,
  findGrantOffenders,
  findTablesWithoutRls,
  findUnguardedReserveFunctions,
  partitionUnguarded,
  policyKey,
  type GrantRow,
  type PolicyRow,
  type RlsRow,
  type SecDefRow,
} from "../src/ci/reserve-gates-core.ts";

// Allowlist real, confirmada contra PROD em 2026-09-11 (ver ledger SP3) —
// chaveada por ASSINATURA completa (oid::regprocedure), não só nome: um
// overload não listado aqui falha o gate mesmo se o nome nu já aparecer.
// Deliberadamente NÃO inclui as trigger functions (audit_approval_request,
// audit_material_request, audit_push_subscription, handle_user_first_login)
// — a RPC já as exclui (RETURNS trigger não é invocável via PostgREST).
const ALLOWED_ROUTINES = new Set([
  "auth_admin_reserve_ids()",
  "auth_role()",
  "auth_tenant_id()",
  "can_read_material_photo(text)",
  "get_email_by_matricula(text)",
  "has_totp()",
  "my_active_reserve_id()",
  "my_tenant_id()",
  "my_tenant_isolation_enabled()",
  "user_in_reserve(uuid,uuid)",
]);

// Débito conhecido, pré-SP8 (2026-09-11) — confirmado contra PROD: 9 nomes
// (11 assinaturas contando overloads) de function SECURITY DEFINER com
// p_reserve_id que ainda não chamam assert_actor_in_reserve/
// assert_device_in_reserve porque essas duas ainda não existem (SP8 não
// implementado). NÃO adicionar nome novo aqui — o objetivo é o gate travar
// qualquer function NOVA desguardada; à medida que o SP8 guardar cada uma
// destas, remova o nome daqui (nunca adicione).
const KNOWN_UNGUARDED_RESERVE_FUNCTIONS = new Set([
  "bump_reserve_preference",
  "check_material_validade_vencimento",
  "record_biometric_enrollment",
  "record_biometric_proof",
  "record_cautelamento_batch",
  "record_lending_batch",
  "record_lending_returns",
  "set_material_cautela_eligibility",
]);

const CHILD_TABLES = [
  "material_request_items",
  "service_log_events",
  "handover_attachments",
  "inventory_item_checks",
  "material_items",
  "cautela_vencimento_alert_events",
  "document_signatures",
] as const;

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("ERRO: SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY ausentes no ambiente.");
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const [grantsRes, rlsRes, notNullRes, snapshotRes, secDefRes] = await Promise.all([
    supabase.rpc("ci_role_routine_grants"),
    supabase.rpc("ci_rls_status"),
    supabase.rpc("ci_child_null_reserve_id_counts"),
    supabase.rpc("ci_policy_snapshot"),
    supabase.rpc("ci_security_definer_functions"),
  ]);

  // Acumula erro de RPC como mais um "failure" em vez de sair no primeiro —
  // se 2 RPCs falharem, o operador vê as 2 de uma vez, não uma por execução.
  const rpcErrors: string[] = [];
  for (const [label, res] of [
    ["ci_role_routine_grants", grantsRes],
    ["ci_rls_status", rlsRes],
    ["ci_child_null_reserve_id_counts", notNullRes],
    ["ci_policy_snapshot", snapshotRes],
    ["ci_security_definer_functions", secDefRes],
  ] as const) {
    if (res.error) rpcErrors.push(`[rpc] ${label}: ${res.error.message}`);
  }
  if (rpcErrors.length > 0) {
    console.error("\n=== RESERVE ISOLATION CI GATES: FALHOU (erro ao chamar RPC) ===\n");
    for (const e of rpcErrors) console.error(e);
    console.error("\nNenhum gate foi avaliado — as RPCs precisam responder antes de qualquer decisão pass/fail.");
    process.exit(1);
  }

  const live = (snapshotRes.data ?? []) as PolicyRow[];

  // --write-baseline é um modo utilitário ortogonal aos gates: grava o
  // snapshot atual e sai, sem avaliar pass/fail. Roda ANTES de qualquer
  // gate (não depois) — não deve herdar nem mascarar falhas de outros gates.
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const baselinePath = path.resolve(__dirname, "..", "..", "..", "supabase", "ci", "policy-snapshot.json");
  if (process.argv.includes("--write-baseline")) {
    const sorted = [...live].sort((a, b) => (policyKey(a) < policyKey(b) ? -1 : policyKey(a) > policyKey(b) ? 1 : 0));
    const out = {
      _readme:
        "Baseline de pg_policies (schema public), gerado via 'node --experimental-strip-types scripts/ci-reserve-gates.ts --write-baseline' " +
        `em ${new Date().toISOString()}. Ver docs/superpowers/specs/2026-09-09-isolamento-reserva-design.md §7/§8 (SP3). ` +
        "Mudança de policy intencional: regenere este arquivo e revise o diff no PR — não é auto-aplicado silenciosamente.",
      policies: sorted,
    };
    writeFileSync(baselinePath, JSON.stringify(out, null, 2) + "\n", "utf-8");
    console.log(`Baseline regenerado: ${baselinePath} (${sorted.length} policy(ies)). Revise o diff e commite.`);
    return;
  }

  const failures: string[] = [];

  // ── Gate 1: role_routine_grants allowlist ───────────────────────────────
  const grants = (grantsRes.data ?? []) as GrantRow[];
  const grantOffenders = findGrantOffenders(grants, ALLOWED_ROUTINES);
  if (grantOffenders.length > 0) {
    const list = grantOffenders.map((g) => `  - ${g.routine} (grantee: ${g.grantee})`).join("\n");
    failures.push(
      `[grants] SECURITY DEFINER function(s) fora da allowlist com grant anon/authenticated/PUBLIC:\n${list}\n` +
        `  → REVOKE EXECUTE ... FROM anon, authenticated, PUBLIC; ou adicione à allowlist em ci-reserve-gates.ts com justificativa no PR.`,
    );
  } else {
    console.log(`OK [grants] ${grants.length} grant(s) anon/authenticated/PUBLIC, todos na allowlist (${ALLOWED_ROUTINES.size} assinaturas).`);
  }

  // ── Gate 2: RLS habilitada em toda tabela public ────────────────────────
  const rlsRows = (rlsRes.data ?? []) as RlsRow[];
  const rlsOffenders = findTablesWithoutRls(rlsRows);
  if (rlsOffenders.length > 0) {
    const list = rlsOffenders.map((r) => `  - ${r.table}`).join("\n");
    failures.push(`[rls] Tabela(s) do schema public sem RLS habilitada:\n${list}\n  → ALTER TABLE ... ENABLE ROW LEVEL SECURITY;`);
  } else {
    console.log(`OK [rls] ${rlsRows.length} tabela(s), todas com relrowsecurity = true.`);
  }

  // ── Gate 3: reserve_id NOT NULL nas 7 filhas do SP4 ─────────────────────
  const notNullStatus = (notNullRes.data ?? {}) as Record<string, boolean>;
  const { missing, violating } = evaluateChildNotNull(notNullStatus, CHILD_TABLES);
  if (missing.length > 0 || violating.length > 0) {
    const lines: string[] = [];
    if (missing.length > 0) lines.push(`  Ausente(s) na resposta da RPC (possível rename/drop): ${missing.join(", ")}`);
    if (violating.length > 0) lines.push(`  Sem NOT NULL ativo: ${violating.join(", ")}`);
    failures.push(
      `[reserve_id] Tabela(s)-filho do dispatcher (SP4) com problema na constraint reserve_id NOT NULL:\n${lines.join("\n")}\n` +
        `  → investigar antes de seguir; a constraint não deveria ter sido removida após o SP4.`,
    );
  } else {
    console.log(`OK [reserve_id] ${CHILD_TABLES.length} tabela(s)-filho, NOT NULL ativo em todas.`);
  }

  // ── Gate 4: diff estrutural contra o baseline versionado ────────────────
  const baseline = JSON.parse(readFileSync(baselinePath, "utf-8")) as { policies: PolicyRow[] };
  const { added, removed, changed } = diffPolicies(baseline.policies, live);
  if (added.length > 0 || removed.length > 0 || changed.length > 0) {
    const lines: string[] = [];
    if (added.length > 0) lines.push(`  Nova(s): ${added.join(", ")}`);
    if (removed.length > 0) lines.push(`  Removida(s): ${removed.join(", ")}`);
    if (changed.length > 0) lines.push(`  Alterada(s) (cmd/roles/permissive/qual/with_check): ${changed.join(", ")}`);
    failures.push(
      `[policy-snapshot] Drift entre pg_policies live e supabase/ci/policy-snapshot.json:\n${lines.join("\n")}\n` +
        `  → se intencional: rode 'cd apps/bff && node --experimental-strip-types scripts/ci-reserve-gates.ts --write-baseline' e revise o diff do JSON no PR.`,
    );
  } else {
    console.log(`OK [policy-snapshot] ${live.length} policy(ies), idêntico ao baseline.`);
  }

  // ── Gate 5: p_reserve_id sem assert_actor/assert_device (prepara SP8) ───
  const secDefFns = (secDefRes.data ?? []) as SecDefRow[];
  const unguarded = findUnguardedReserveFunctions(secDefFns);
  const { newViolations, knownDebt } = partitionUnguarded(unguarded, KNOWN_UNGUARDED_RESERVE_FUNCTIONS);
  if (knownDebt.length > 0) {
    const list = [...new Set(knownDebt.map((f) => f.name))].map((n) => `  - ${n}`).join("\n");
    console.log(`INFO [assert-reserve] ${knownDebt.length} assinatura(s) de débito conhecido, pré-SP8 (não bloqueia):\n${list}`);
  }
  if (newViolations.length > 0) {
    const list = newViolations.map((f) => `  - ${f.name}(${f.args})`).join("\n");
    failures.push(
      `[assert-reserve] Function(s) SECURITY DEFINER NOVA(S) com p_reserve_id sem chamar assert_actor_in_reserve/assert_device_in_reserve:\n${list}\n` +
        `  → risco de IDOR entre reservas. Se é débito pré-SP8 legítimo, adicione o nome a KNOWN_UNGUARDED_RESERVE_FUNCTIONS em ci-reserve-gates.ts com justificativa no PR.`,
    );
  } else {
    console.log(`OK [assert-reserve] nenhuma function NOVA com p_reserve_id desguardada (${secDefFns.length} SECURITY DEFINER no total).`);
  }

  if (failures.length > 0) {
    console.error("\n=== RESERVE ISOLATION CI GATES: FALHOU ===\n");
    for (const f of failures) console.error(f + "\n");
    process.exit(1);
  }

  console.log("\n=== RESERVE ISOLATION CI GATES: OK ===");
}

main().catch((err) => {
  console.error("ERRO inesperado no gate:", err);
  process.exit(1);
});
