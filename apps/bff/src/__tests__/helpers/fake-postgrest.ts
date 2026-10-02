// Emulador mínimo do query builder do supabase-js para testes de ISOLAMENTO.
//
// Diferente dos mocks que devolvem um valor fixo, este aplica de fato os
// filtros (eq/in/lt/gte/is/or) sobre linhas em memória — então um filtro de
// tenant/reserva ausente na rota aparece como dado de outro escopo na
// resposta. Coluna fora do schema declarado devolve `error` (como o
// PostgREST), para que query com coluna inexistente não passe despercebida.
//
// Suporta só o que as rotas testadas usam: select (com { count, head }),
// eq, in, lt, gte, is(null), or("a.is.null,a.lt.X"), order, limit,
// maybeSingle/single, e filtros embutidos `<alias>.<col>` de joins
// `<alias>:<tabela>!<fk>!inner(...)` / `<tabela>!inner(...)`:
//  - direto (N→1): resolvido pela coluna `<alias>_id` da linha pai;
//  - reverso (1→N): tabela listada em `reverseFk` (coluna que aponta pro pai).
// Como no PostgREST, filtro embutido só descarta a linha PAI quando o join é
// `!inner`; sem `!inner` a linha pai sempre volta (só o embutido é filtrado).

export type Row = Record<string, unknown>;
export type Tables = Record<string, { columns: string[]; rows: Row[] }>;

type Pred = (row: Row) => boolean;
export interface RecordedQuery { table: string; select: string; filters: string[] }

export function createFakePostgrest(tables: Tables, opts: { reverseFk?: Record<string, string> } = {}) {
  const calls: RecordedQuery[] = [];

  function from(table: string) {
    const def = tables[table];
    const preds: Pred[] = [];
    const filters: string[] = [];
    let error: { message: string } | null = def ? null : { message: `relation "${table}" does not exist` };
    let selectStr = "*";
    let countMode = false;
    let head = false;
    let limitN: number | null = null;
    let updateValues: Row | null = null;
    let offsetN = 0;
    let joins: Record<string, { table: string; inner: boolean }> = {};

    // Valores do campo na linha (array: join reverso pode ter N linhas).
    const values = (row: Row, key: string): unknown[] => {
      if (!key.includes(".")) return [row[key]];
      const [alias, col] = key.split(".");
      const j = joins[alias];
      const target = j ? tables[j.table] : undefined;
      if (!target) return [];
      const rev = opts.reverseFk?.[j.table];
      const hits = rev
        ? target.rows.filter((r) => r[rev] === row.id)
        : target.rows.filter((r) => r.id != null && r.id === row[`${alias}_id`]);
      return hits.map((h) => h[col]);
    };
    const test = (key: string, ok: (v: unknown) => boolean): Pred => (row) => {
      if (key.includes(".") && !joins[key.split(".")[0]]?.inner) return true;
      return values(row, key).some(ok);
    };
    const checkCol = (key: string) => {
      if (error || !def) return;
      if (key.includes(".")) {
        const [alias, col] = key.split(".");
        const t = joins[alias] ? tables[joins[alias].table] : undefined;
        if (!t || !t.columns.includes(col)) error = { message: `column ${key} does not exist` };
      } else if (!def.columns.includes(key)) {
        error = { message: `column ${table}.${key} does not exist` };
      }
    };
    const add = (key: string, desc: string, p: Pred) => { checkCol(key); filters.push(desc); preds.push(p); };

    const run = () => {
      calls.push({ table, select: selectStr, filters: [...filters] });
      if (error) return { data: null, count: null, error };
      const innerAliases = Object.entries(joins).filter(([, j]) => j.inner).map(([a]) => a);
      let rows = def.rows.filter((r) =>
        innerAliases.every((a) => values(r, `${a}.id`).length > 0) && preds.every((p) => p(r)));
      if (offsetN > 0) rows = rows.slice(offsetN);
      if (limitN != null) rows = rows.slice(0, limitN);
      // update: aplica aos mesmos filtros, devolve as linhas afetadas (como PostgREST com .select()).
      if (updateValues) for (const r of rows) Object.assign(r, updateValues);
      // Cópias rasas: o PostgREST devolve o resultado serializado, nunca referências vivas às linhas (uma mutação concorrente posterior não pode alterar o que o handler já leu).
      return { data: head ? null : rows.map((r) => ({ ...r })), count: countMode ? rows.length : null, error: null };
    };

    const b: Record<string, unknown> = {
      select(cols = "*", o?: { count?: string; head?: boolean }) {
        selectStr = cols;
        countMode = o?.count === "exact";
        head = o?.head === true;
        for (const m of cols.matchAll(/(?:(\w+):)?(\w+)((?:!\w+)*)\(/g)) {
          if (!tables[m[2]]) continue;
          joins = { ...joins, [m[1] ?? m[2]]: { table: m[2], inner: m[3].includes("!inner") } };
        }
        return b;
      },
      eq(k: string, v: unknown) { add(k, `${k}=eq.${String(v)}`, test(k, (x) => x === v && v != null)); return b; },
      in(k: string, vs: unknown[]) { add(k, `${k}=in.(${vs.join(",")})`, test(k, (x) => vs.includes(x))); return b; },
      lt(k: string, v: string) { add(k, `${k}=lt.${v}`, test(k, (x) => x != null && String(x) < v)); return b; },
      gte(k: string, v: string) { add(k, `${k}=gte.${v}`, test(k, (x) => x != null && String(x) >= v)); return b; },
      // ilike com %trecho% (sem escapes), como o uso do BFF: contém, sem diferenciar caixa.
      ilike(k: string, pattern: string) {
        const needle = pattern.replace(/^%|%$/g, "").toLowerCase();
        add(k, `${k}=ilike.${pattern}`, test(k, (x) => typeof x === "string" && x.toLowerCase().includes(needle)));
        return b;
      },
      is(k: string, v: null) { add(k, `${k}=is.${v}`, test(k, (x) => x == null)); return b; },
      or(expr: string) {
        const parts = expr.split(",").map((p) => {
          const [k, op, ...rest] = p.split(".");
          const v = rest.join(".");
          checkCol(k);
          if (op === "is" && v === "null") return test(k, (x) => x == null);
          if (op === "lt") return test(k, (x) => x != null && String(x) < v);
          if (op === "eq") return test(k, (x) => x != null && String(x) === v);
          throw new Error(`fake-postgrest: or() não suportado: ${p}`);
        });
        filters.push(`or=(${expr})`);
        preds.push((r) => parts.some((p) => p(r)));
        return b;
      },
      // insert: grava na tabela em memória; `.select(...).single()` devolve a
      // 1ª linha inserida (id gerado se ausente).
      insert(values: Row | Row[]) {
        const list = (Array.isArray(values) ? values : [values]).map((v) => ({ ...v, id: v.id ?? `fake-${def?.rows.length ?? 0}-${Math.random().toString(16).slice(2)}` }));
        for (const v of list) for (const k of Object.keys(v)) checkCol(k);
        if (!error && def) def.rows.push(...list);
        calls.push({ table, select: "insert", filters: [] });
        const result = { data: error ? null : list, count: null, error };
        const ins: Record<string, unknown> = {
          select() { return ins; },
          single: async () => ({ ...result, data: result.data?.[0] ?? null }),
          then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(result).then(res, rej); },
        };
        return ins;
      },
      // upsert: substitui/mescla a linha com as mesmas colunas de onConflict (default id) ou insere.
      upsert(values: Row | Row[], opts?: { onConflict?: string }) {
        const keys = (opts?.onConflict ?? "id").split(",").map((k) => k.trim());
        const list = (Array.isArray(values) ? values : [values]).map((v) => ({ ...v }));
        for (const v of list) for (const k of Object.keys(v)) checkCol(k);
        if (!error && def) {
          for (const v of list) {
            const found = def.rows.find((r) => keys.every((k) => r[k] === v[k]));
            if (found) Object.assign(found, v);
            else def.rows.push({ ...v, id: v.id ?? `fake-${def.rows.length}-${Math.random().toString(16).slice(2)}` });
          }
        }
        calls.push({ table, select: "upsert", filters: [] });
        const result = { data: error ? null : list, count: null, error };
        const ups: Record<string, unknown> = {
          select() { return ups; },
          single: async () => ({ ...result, data: result.data?.[0] ?? null }),
          then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(result).then(res, rej); },
        };
        return ups;
      },
      update(values: Row) {
        for (const k of Object.keys(values)) checkCol(k);
        updateValues = values;
        calls.push({ table, select: "update", filters: [] });
        return b;
      },
      // range(from, to) inclusivo, como PostgREST: pula `from` e devolve até to-from+1 linhas.
      range(from: number, to: number) { offsetN = from; limitN = to - from + 1; return b; },
      order() { return b; },
      limit(n: number) { limitN = n; return b; },
      maybeSingle: async () => { const r = run(); return { ...r, data: (r.data as Row[] | null)?.[0] ?? null }; },
      single: async () => { const r = run(); return { ...r, data: (r.data as Row[] | null)?.[0] ?? null }; },
      then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
        try { return Promise.resolve(run()).then(res, rej); } catch (e) { return Promise.reject(e).then(res, rej); }
      },
    };
    return b;
  }

  return { from, calls };
}
