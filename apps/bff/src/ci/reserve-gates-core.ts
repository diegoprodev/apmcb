// SP3 do isolamento por reserva — lógica pura (sem I/O) do harness de CI.
// Extraído de scripts/ci-reserve-gates.ts pra ser testável com node --test
// (o script em scripts/ fica fora do tsconfig "include" e não tem suíte).
// Ver docs/superpowers/specs/2026-09-09-isolamento-reserva-design.md §7/§8.

export type PolicyRow = {
  schema: string;
  table: string;
  policy: string;
  cmd: string;
  permissive: string;
  roles: string[];
  qual: string | null;
  with_check: string | null;
};

export type RlsRow = { table: string; rowsecurity: boolean; forcerowsecurity: boolean };
export type GrantRow = { routine: string; grantee: string };
export type SecDefRow = {
  name: string;
  args: string;
  has_p_reserve_id: boolean;
  has_search_path: boolean;
  body_mentions_assert_actor: boolean;
  body_mentions_assert_device: boolean;
};

export function policyKey(p: PolicyRow): string {
  return `${p.schema}.${p.table}.${p.policy}`;
}

export function policyBody(p: PolicyRow): string {
  // cmd|roles|permissive|qual|with_check — mesma composição da spec §7.
  return [p.cmd, [...p.roles].sort().join(","), p.permissive, p.qual ?? "", p.with_check ?? ""].join("|");
}

export type PolicyDiff = { added: string[]; removed: string[]; changed: string[] };

export function diffPolicies(baseline: PolicyRow[], live: PolicyRow[]): PolicyDiff {
  const baselineMap = new Map(baseline.map((p) => [policyKey(p), policyBody(p)]));
  const liveMap = new Map(live.map((p) => [policyKey(p), policyBody(p)]));
  const added = [...liveMap.keys()].filter((k) => !baselineMap.has(k));
  const removed = [...baselineMap.keys()].filter((k) => !liveMap.has(k));
  const changed = [...liveMap.keys()].filter((k) => baselineMap.has(k) && baselineMap.get(k) !== liveMap.get(k));
  return { added, removed, changed };
}

/** Gate 1: toda function SECURITY DEFINER com grant anon/authenticated/PUBLIC tem que estar na allowlist. */
export function findGrantOffenders(grants: GrantRow[], allowlist: ReadonlySet<string>): GrantRow[] {
  return grants.filter((g) => !allowlist.has(g.routine));
}

/** Gate 2: toda tabela do schema public precisa ter RLS habilitada. */
export function findTablesWithoutRls(rows: RlsRow[]): RlsRow[] {
  return rows.filter((r) => !r.rowsecurity);
}

export type ChildNotNullResult = {
  /** Tabela esperada mas ausente na resposta da RPC — falha fechado, nunca assume "ok". */
  missing: string[];
  /** Tabela presente mas com attnotnull = false (constraint removida). */
  violating: string[];
};

/** Gate 3: reserve_id NOT NULL ativo nas 7 tabelas-filho do SP4 (não é count — é a constraint). */
export function evaluateChildNotNull(status: Record<string, boolean>, expectedTables: readonly string[]): ChildNotNullResult {
  const missing = expectedTables.filter((t) => !(t in status));
  const violating = expectedTables.filter((t) => t in status && status[t] === false);
  return { missing, violating };
}

/** Gate 5: function SECURITY DEFINER com p_reserve_id precisa referenciar assert_actor/assert_device (prepara SP8). */
export function findUnguardedReserveFunctions(fns: SecDefRow[]): SecDefRow[] {
  return fns.filter((f) => f.has_p_reserve_id && !f.body_mentions_assert_actor && !f.body_mentions_assert_device);
}

export type UnguardedPartition = {
  /** Desguardada e NÃO está na allowlist de débito conhecido — falha o gate. */
  newViolations: SecDefRow[];
  /** Desguardada mas já catalogada como débito pré-SP8 — informativo, não falha o build. */
  knownDebt: SecDefRow[];
};

/**
 * Separa o achado bruto de findUnguardedReserveFunctions em "débito já
 * catalogado" (não bloqueia — SP8 ainda não existe) vs. "violação nova"
 * (bloqueia sempre — ninguém pode introduzir mais uma function desguardada
 * enquanto o débito das outras 11 não é pago). knownDebtNames casa por
 * `proname` (não por assinatura completa) — cobre todos os overloads de uma
 * function de uma vez, já que overload não muda a questão de autorização.
 */
export function partitionUnguarded(unguarded: SecDefRow[], knownDebtNames: ReadonlySet<string>): UnguardedPartition {
  const newViolations = unguarded.filter((f) => !knownDebtNames.has(f.name));
  const knownDebt = unguarded.filter((f) => knownDebtNames.has(f.name));
  return { newViolations, knownDebt };
}
