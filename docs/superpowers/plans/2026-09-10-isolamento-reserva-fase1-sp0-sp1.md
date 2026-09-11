# Isolamento por reserva — Fase 1: SP0.25 + SP1 + SP0.5 (mecanismo + spike)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir o mecanismo de "reserva ativa" (coluna `profiles.active_reserve_id` +
trigger + funções STABLE + fiação BFF/web), **dormente atrás da flag `reserve_isolation_enabled`
(default false)**, e rodar o spike que valida as premissas de RLS antes dos grupos SP5–SP9.

**Architecture:** A reserva ativa vive em `profiles.active_reserve_id` (onde o RLS do Postgres
lê, igual a `my_tenant_id()`). É **imutável via PostgREST** (trigger de freeze estendido) → 100%
dos switches passam pelo BFF. Funções `STABLE SECURITY DEFINER` (`my_active_reserve_id`,
`my_tenant_isolation_enabled`, `user_in_reserve`) — avaliadas 1×/statement. Enquanto a flag do
tenant é `false`, nada muda: as policies só serão reescritas em SP5–SP9. O spike (SP0.5) roda
EXPLAIN dessas funções em volume e confirma que o proxy SSE do BFF continua entregando eventos.

**Tech Stack:** Postgres/Supabase (RLS, triggers, `pg_cron`), Hono/Bun BFF, Next.js 16 web
(App Router, edge), iron-session, `node --test` (BFF), Playwright (web E2E), Supabase CLI local
(Docker).

**Spec:** `docs/superpowers/specs/2026-09-09-isolamento-reserva-design.md` (v6). Este plano
implementa **SP0.25, SP1 e SP0.5** de §8. Os grupos de RLS (SP5–SP9), os guards de RPC (SP8) e
a desnormalização das filhas (SP4) são planos separados, **re-especificados depois do SP0.5**
com os números do EXPLAIN na mão.

## Global Constraints

- **Branch por sub-plano.** Nunca commitar em `main`. Branch: `feat/reserva-sp1-mecanismo`.
- **Flag `tenants.reserve_isolation_enabled` nasce `NOT NULL DEFAULT false`.** Nenhuma policy
  de negócio é reescrita neste plano — o mecanismo fica dormente.
- **`node --test` do BFF não resolve import relativo sem extensão** — todo import relativo em
  arquivo novo/teste com `.ts` explícito.
- **Migrações via MCP `mcp__claude_ai_Supabase__apply_migration`** (não há Supabase branch no
  plano free/pro) — cada uma testada primeiro em `supabase start` local (Task 1).
- **Código de produção (`.ts`/`.tsx`/`.sql`) → antes de cada commit, invocar o sub-agente de
  code review** (mandato CLAUDE.md). Bloqueador: CRÍTICO/ALTO não endereçado.
- **Exceção R8 (por escrito, entregar ao code-review):** RLS-deny em SELECT é silenciosa por
  natureza do Postgres. Neste plano não há reescrita de policy de SELECT, então não se aplica
  ainda — mas os testes de switch/middleware devem logar toda negação de fluxo.
- **Pré-requisito de merge:** PRs **#27** (`profiles_freeze_privileged_columns`) e **#28**
  (`tenants` lockdown) mergeados em `main` antes da Task 2 — a Task 3 edita o corpo do trigger
  do #27.
- **Nomes canônicos** (usados em tasks posteriores — copiar exato):
  - coluna: `profiles.active_reserve_id uuid` (nullable, `REFERENCES reserves(id) ON DELETE RESTRICT`)
  - coluna: `tenants.reserve_isolation_enabled boolean NOT NULL DEFAULT false`
  - trigger de validação: `profiles_validate_active_reserve` (BEFORE UPDATE OF `active_reserve_id`)
  - funções: `my_active_reserve_id() → uuid`, `my_tenant_isolation_enabled() → boolean`,
    `user_in_reserve(p_uid uuid, p_rid uuid) → boolean` — todas `STABLE SECURITY DEFINER SET search_path = public, pg_temp`
  - BFF: `POST /api/reserves/switch/:id`, `POST /api/reserves/switch/matriz`
  - eventos de log: `reserve.switch.ok`, `reserve.switch.denied`, `reserve.matriz.entered`,
    `reserve.matriz.left`, `reserve.active.none_for_staff`, `reserve.active.revoked_midsession`

---

## File Structure

**Criar:**
- `supabase/migrations/20260911100000_reserve_active_column.sql` — as 2 colunas + índice
- `supabase/migrations/20260911100100_reserve_freeze_and_validate.sql` — edita o freeze + trigger de validação
- `supabase/migrations/20260911100200_reserve_stable_functions.sql` — as 3 funções STABLE
- `supabase/migrations/20260911100300_reserve_backfill_seed_accounts.sql` — backfill das 3 contas
- `apps/bff/src/lib/active-reserve.ts` — resolução do default de `active_reserve_id` (pura, testável)
- `apps/bff/src/__tests__/active-reserve.test.ts`
- `apps/bff/src/__tests__/reserves-switch.test.ts`
- `scripts/seed-volume.mjs` — gerador de volume para o EXPLAIN do SP0.5
- `scripts/ci/no-authed-realtime.sh` — invariante de CI (grep)
- `docs/superpowers/spikes/2026-09-XX-reserve-rls-spike.md` — achados do SP0.5

**Modificar:**
- `apps/bff/src/routes/reserves.ts` — `switch/:id` grava a coluna + `usuario` no roleGuard + log; nova rota `switch/matriz`
- `apps/bff/src/routes/auth.ts` — resolve `active_reserve_id` no login e no exchange
- `apps/bff/src/middleware/auth.ts` — `reserveId` da coluna (iron-session E Bearer) + re-valida membership
- `apps/web/src/app/(dashboard)/layout.tsx` — `currentReserveId` da coluna
- `apps/web/src/components/layout/sidebar.tsx` — chevron para `usuario` + item "Ver todas as reservas"
- `.github/workflows/ci-cd.yml` — roda `scripts/ci/no-authed-realtime.sh`
- `docs/superpowers/specs/2026-09-09-isolamento-reserva-design.md` — §8: reordenar SP0.5 depois de SP1; anexar link do spike

---

## Task 0: Merge dos hotfixes pré-requisito

**Files:** nenhum (operação de git/GitHub).

- [ ] **Step 1: Revisar e mergear #27 e #28**

```bash
gh pr view 27 --json mergeable,reviewDecision
gh pr view 28 --json mergeable,reviewDecision
# Se limpos e o dono aprovou:
gh pr merge 27 --squash --delete-branch=false
gh pr merge 28 --squash --delete-branch=false
git checkout main && git pull
```

- [ ] **Step 2: Confirmar que os triggers seguem vivos em prod após o merge**

```
mcp__claude_ai_Supabase__execute_sql:
  select
    (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid
       where c.relname='profiles' and t.tgname='profiles_freeze_privileged_columns') as freeze,
    (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid
       where c.relname='tenants' and t.tgname='tenants_block_enduser_writes') as tenants_block;
```
Expected: `freeze=1, tenants_block=1`. (Merge não altera prod — as migrações já foram
aplicadas via MCP; isto só documenta a linha de base.)

- [ ] **Step 3: Branch de trabalho**

```bash
git checkout -b feat/reserva-sp1-mecanismo
```

---

## Task 1: SP0.25 — Supabase local + gerador de volume

**Files:**
- Create: `scripts/seed-volume.mjs`

**Interfaces:**
- Produces: um Supabase local rodando (porta 54322 por padrão) com o schema de prod
  replicado (via `supabase db reset`), populável com `node scripts/seed-volume.mjs`.

- [ ] **Step 1: Verificar Docker**

Run: `docker info`
Expected: sai sem erro. **Se falhar:** parar, avisar o dono — "SP0.25 precisa de Docker
Desktop; sem ele o EXPLAIN do SP0.5 não roda contra um Postgres real e o épico não avança
com segurança. Instalar Docker Desktop e reabrir."

- [ ] **Step 2: Subir o Supabase local**

```bash
cd C:/projetos/apmcb
npx supabase start
npx supabase db reset   # aplica todas as migrations de supabase/migrations/ num Postgres limpo
```
Expected: `supabase start` imprime `API URL`, `DB URL`, `anon key`, `service_role key`.
`db reset` termina sem erro (todas as migrations aplicam limpo — se alguma falhar, é um
achado: migration não-idempotente, corrigir antes de seguir).

- [ ] **Step 3: Escrever o gerador de volume**

`scripts/seed-volume.mjs`:
```js
// Popula o Postgres LOCAL (supabase start) com volume representativo para o
// EXPLAIN do SP0.5. NUNCA rodar contra prod (checa a URL).
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL.includes("127.0.0.1") && !URL.includes("localhost")) {
  throw new Error("seed-volume.mjs só roda contra Supabase LOCAL");
}
if (!KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY (do supabase status) é obrigatória");

const db = createClient(URL, KEY, { auth: { persistSession: false } });

const TENANT = randomUUID();
const RES_A = randomUUID();
const RES_B = randomUUID();
const ORG = randomUUID();

async function main() {
  await db.from("tenants").insert({ id: TENANT, nome: "SEED Tenant", slug: `seed-${Date.now()}`, status: "ativo" });
  await db.from("org_units").insert({ id: ORG, tenant_id: TENANT, nome: "SEED Org", acronym: "SEED" });
  await db.from("reserves").insert([
    { id: RES_A, tenant_id: TENANT, org_unit_id: ORG, nome: "SEED A", acronym: "SDA" },
    { id: RES_B, tenant_id: TENANT, org_unit_id: ORG, nome: "SEED B", acronym: "SDB" },
  ]);

  // ~1000 material_types por reserva (2000 total)
  for (const rid of [RES_A, RES_B]) {
    const rows = Array.from({ length: 1000 }, (_, i) => ({
      id: randomUUID(), tenant_id: TENANT, reserve_id: rid,
      nome: `SEED mat ${i}`, categoria: "arma", quantidade_total: 5, ativo: true,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db.from("material_types").insert(rows.slice(i, i + 500));
      if (error) throw error;
    }
  }
  console.log(JSON.stringify({ TENANT, RES_A, RES_B, ORG }, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: Rodar e guardar os IDs**

```bash
export SUPABASE_URL=http://127.0.0.1:54321
export SUPABASE_SERVICE_ROLE_KEY=$(npx supabase status --output json | node -e "process.stdin.once('data',d=>console.log(JSON.parse(d).SERVICE_ROLE_KEY))")
node scripts/seed-volume.mjs
```
Expected: imprime `{ TENANT, RES_A, RES_B, ORG }`. Anotar num scratchpad — a Task 16 usa.

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-volume.mjs
git commit -m "chore(reserva): gerador de volume p/ o EXPLAIN do spike (SP0.25)"
```

---

## Task 2: SP1 — colunas `active_reserve_id` e `reserve_isolation_enabled`

**Files:**
- Create: `supabase/migrations/20260911100000_reserve_active_column.sql`

**Interfaces:**
- Produces: `profiles.active_reserve_id uuid` (nullable, FK `reserves(id) ON DELETE RESTRICT`),
  índice `idx_profiles_active_reserve`; `tenants.reserve_isolation_enabled boolean NOT NULL
  DEFAULT false`.

- [ ] **Step 1: Escrever a migração**

```sql
-- SP1 — colunas do mecanismo de reserva ativa. Dormentes: nenhuma policy usa ainda.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS active_reserve_id uuid REFERENCES public.reserves(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_profiles_active_reserve
  ON public.profiles(active_reserve_id) WHERE active_reserve_id IS NOT NULL;

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS reserve_isolation_enabled boolean NOT NULL DEFAULT false;

-- ROLLBACK:
--   ALTER TABLE public.profiles DROP COLUMN IF EXISTS active_reserve_id;
--   ALTER TABLE public.tenants DROP COLUMN IF EXISTS reserve_isolation_enabled;
```

- [ ] **Step 2: Aplicar no local e verificar**

```bash
npx supabase migration up   # ou db reset
```
```sql
select column_name, is_nullable, column_default
from information_schema.columns
where table_schema='public'
  and ((table_name='profiles' and column_name='active_reserve_id')
    or (table_name='tenants' and column_name='reserve_isolation_enabled'));
```
Expected: 2 linhas; `reserve_isolation_enabled` com `is_nullable='NO'` e `column_default='false'`.

- [ ] **Step 3: Aplicar em prod via MCP**

```
mcp__claude_ai_Supabase__apply_migration
  name: reserve_active_column
  query: <o SQL do Step 1, sem os comentários de ROLLBACK>
```
Expected: `{"success": true}`. Re-rodar a query de verificação contra prod.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260911100000_reserve_active_column.sql
git commit -m "feat(reserva): colunas active_reserve_id + reserve_isolation_enabled (SP1)"
```

---

## Task 3: SP1 — estende o trigger de freeze para congelar `active_reserve_id`

**Files:**
- Create: `supabase/migrations/20260911100100_reserve_freeze_and_validate.sql`

**Interfaces:**
- Consumes: `profiles_freeze_privileged_columns()` (do PR #27, já em prod).
- Produces: o mesmo trigger, agora também barrando mudança de `active_reserve_id` por
  `current_user IN ('authenticated','anon')`; + trigger `profiles_validate_active_reserve`.

- [ ] **Step 1: Ler o corpo atual do trigger de #27**

```sql
select pg_get_functiondef(oid) from pg_proc
where proname='profiles_freeze_privileged_columns';
```
Copiar o corpo exato — o Step 2 é um `CREATE OR REPLACE` que **acrescenta** uma condição.

- [ ] **Step 2: Escrever a migração**

```sql
-- SP1 — congela active_reserve_id (todo switch tem que passar pelo BFF) + valida a entrada.

CREATE OR REPLACE FUNCTION public.profiles_freeze_privileged_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.default_tenant_id IS DISTINCT FROM OLD.default_tenant_id
     OR NEW.registration_status IS DISTINCT FROM OLD.registration_status
     OR NEW.account_activated_at IS DISTINCT FROM OLD.account_activated_at
     OR NEW.active_reserve_id IS DISTINCT FROM OLD.active_reserve_id THEN
    RAISE EXCEPTION
      'profiles: role, default_tenant_id, registration_status, account_activated_at e active_reserve_id so podem ser alterados pelo backend'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.profiles_validate_active_reserve()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'active_reserve_id so via BFF' USING ERRCODE = '42501';
  END IF;
  IF NEW.active_reserve_id IS NOT NULL THEN
    IF NEW.default_tenant_id IS NULL THEN
      RAISE EXCEPTION 'usuario sem tenant nao entra em reserva' USING ERRCODE = '42501';
    END IF;
    PERFORM 1 FROM public.reserves r
      WHERE r.id = NEW.active_reserve_id AND r.status = 'ativa' AND r.tenant_id = NEW.default_tenant_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'reserva invalida/inativa/outro tenant' USING ERRCODE = '42501';
    END IF;
    IF NEW.role NOT IN ('admin_global', 'auditor')
       AND NOT EXISTS (SELECT 1 FROM public.reserve_memberships m
                       WHERE m.user_id = NEW.id AND m.reserve_id = NEW.active_reserve_id) THEN
      RAISE EXCEPTION 'sem vinculo com a reserva' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_validate_active_reserve ON public.profiles;
CREATE TRIGGER profiles_validate_active_reserve
  BEFORE UPDATE OF active_reserve_id ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_validate_active_reserve();

-- ROLLBACK: DROP TRIGGER + restaurar o corpo de profiles_freeze_privileged_columns sem a
--   linha de active_reserve_id + DROP FUNCTION profiles_validate_active_reserve.
```

- [ ] **Step 3: Testar no local (transações revertidas)**

```sql
BEGIN;
CREATE TEMP TABLE _r(t text, o text) ON COMMIT DROP;
GRANT INSERT ON _r TO authenticated, service_role;
-- authenticated tenta trocar a própria active_reserve_id
SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"<um profile id do seed>","role":"authenticated"}';
DO $$ BEGIN UPDATE public.profiles SET active_reserve_id='<RES_A do seed>' WHERE id='<profile id>';
  INSERT INTO _r VALUES('authed switch','VAZOU'); EXCEPTION WHEN others THEN INSERT INTO _r VALUES('authed switch','BLOQUEADO '||SQLSTATE); END $$;
RESET role;
SET LOCAL role service_role;
DO $$ BEGIN UPDATE public.profiles SET active_reserve_id='<RES_A>' WHERE id='<profile membro de A>';
  INSERT INTO _r VALUES('service switch (membro)','OK'); EXCEPTION WHEN others THEN INSERT INTO _r VALUES('service switch (membro)','QUEBROU '||SQLSTATE); END $$;
DO $$ BEGIN UPDATE public.profiles SET active_reserve_id='<RES_B>' WHERE id='<profile NÃO membro de B, role usuario>';
  INSERT INTO _r VALUES('service switch (não-membro)','VAZOU'); EXCEPTION WHEN others THEN INSERT INTO _r VALUES('service switch (não-membro)','BLOQUEADO '||SQLSTATE); END $$;
RESET role;
SELECT * FROM _r ORDER BY t;
ROLLBACK;
```
Expected: `authed switch → BLOQUEADO 42501`; `service switch (membro) → OK`; `service switch
(não-membro) → BLOQUEADO 42501`.

- [ ] **Step 4: Testar que mudança de papel na estrutura ainda funciona**

```sql
BEGIN;
SET LOCAL role service_role;
-- simula PATCH /api/profiles/:id trocando role (sem tocar active_reserve_id)
UPDATE public.profiles SET role='armeiro' WHERE id='<profile usuario com active_reserve_id setado>';
SELECT role, active_reserve_id FROM public.profiles WHERE id='<profile>';
ROLLBACK;
```
Expected: `role='armeiro'`, `active_reserve_id` intacto — o trigger `BEFORE UPDATE OF
active_reserve_id` **não dispara** numa UPDATE que não toca a coluna.

- [ ] **Step 5: Aplicar em prod via MCP + re-verificar**

```
mcp__claude_ai_Supabase__apply_migration name: reserve_freeze_and_validate query: <SQL do Step 2>
```
Repetir o teste do Step 3 contra prod (transação revertida, conta de teste que sobrou do
clean-slate... na verdade só há 3 contas — usar `devdiegopro@gmail.com` id
`1fd2cf3d-fd85-47b0-a921-e91afb909691`).

- [ ] **Step 6: Code review + commit**

Invocar o sub-agente de code review sobre a migração (mandato CLAUDE.md). Endereçar
CRÍTICO/ALTO. Depois:
```bash
git add supabase/migrations/20260911100100_reserve_freeze_and_validate.sql
git commit -m "feat(reserva): congela active_reserve_id + trigger de validação (SP1)"
```

---

## Task 4: SP1 — funções STABLE

**Files:**
- Create: `supabase/migrations/20260911100200_reserve_stable_functions.sql`

**Interfaces:**
- Produces: `my_active_reserve_id() → uuid`, `my_tenant_isolation_enabled() → boolean`,
  `user_in_reserve(p_uid uuid, p_rid uuid) → boolean`. Todas `STABLE SECURITY DEFINER
  SET search_path = public, pg_temp`. **Consumidas por SP5–SP9** (fora deste plano).

- [ ] **Step 1: Escrever a migração**

```sql
-- SP1 — funções STABLE do isolamento de reserva. Dormentes até SP5.

CREATE OR REPLACE FUNCTION public.my_active_reserve_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT active_reserve_id FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.my_tenant_isolation_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(
    (SELECT t.reserve_isolation_enabled
     FROM public.tenants t
     JOIN public.profiles p ON p.default_tenant_id = t.id
     WHERE p.id = auth.uid()),
    false)
$$;

CREATE OR REPLACE FUNCTION public.user_in_reserve(p_uid uuid, p_rid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.reserve_memberships
    WHERE user_id = p_uid AND reserve_id = p_rid
  )
$$;

-- EXECUTE: as 3 podem ser chamadas por authenticated (entram na allowlist do CI gate do SP3).
GRANT EXECUTE ON FUNCTION public.my_active_reserve_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_tenant_isolation_enabled() TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_in_reserve(uuid, uuid) TO authenticated;

-- ROLLBACK: DROP FUNCTION das 3.
```

- [ ] **Step 2: Aplicar no local + smoke**

```sql
-- como um profile do seed que é membro de RES_A:
BEGIN;
SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"<profile membro de A, com active_reserve_id=A>","role":"authenticated"}';
SELECT public.my_active_reserve_id() as active,
       public.my_tenant_isolation_enabled() as flag,
       public.user_in_reserve('<mesmo profile>', '<RES_A>') as in_a,
       public.user_in_reserve('<mesmo profile>', '<RES_B>') as in_b;
ROLLBACK;
```
Expected: `active = <RES_A>`, `flag = false` (seed tenant sem a flag), `in_a = true`,
`in_b = false`.

- [ ] **Step 3: Testar recursão — `my_active_reserve_id()` num SELECT de `profiles`**

```sql
BEGIN;
SET LOCAL statement_timeout = '2s';
SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"<profile>","role":"authenticated"}';
SELECT count(*) FROM public.profiles WHERE active_reserve_id = public.my_active_reserve_id();
ROLLBACK;
```
Expected: retorna rápido (a função é SECURITY DEFINER → bypassa a RLS de `profiles`, sem
recursão). Se estourar `57014` → achado: registrar no spike e não seguir para SP9 sem
resolver.

- [ ] **Step 4: Aplicar em prod via MCP + commit**

```
mcp__claude_ai_Supabase__apply_migration name: reserve_stable_functions query: <SQL do Step 1>
```
```bash
git add supabase/migrations/20260911100200_reserve_stable_functions.sql
git commit -m "feat(reserva): funções STABLE my_active_reserve_id / isolation_enabled / user_in_reserve (SP1)"
```

---

## Task 5: SP1 — backfill das 3 contas de sistema

**Files:**
- Create: `supabase/migrations/20260911100300_reserve_backfill_seed_accounts.sql`

**Interfaces:**
- Consumes: as 3 contas do clean-slate (`superadmin@apmcb.dev`
  `3485f5ca-7c70-4439-aeba-404e273c4e24`, `admin@apmcb.dev`
  `8ceb6522-a5a9-4e3d-a9b5-9afb04dec072`, `devdiegopro@gmail.com`
  `1fd2cf3d-fd85-47b0-a921-e91afb909691`).
- Produces: as 3 com `active_reserve_id` resolvido (todas admin_global/superadmin → NULL/matriz).

- [ ] **Step 1: Escrever a migração**

```sql
-- SP1 — backfill: as 3 contas são superadmin/admin_global → active_reserve_id NULL (matriz).
-- Nada a fazer além de garantir que NULL não trava o login (o resolvedor de auth.ts
-- trata NULL para admin_global como "matriz", não como "none_for_staff"). Esta migração
-- existe para documentar a decisão e falhar cedo se surgir uma 4ª conta staff sem membership.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.profiles p
  WHERE p.role IN ('admin_reserva', 'armeiro', 'usuario')
    AND p.active_reserve_id IS NULL
    AND EXISTS (SELECT 1 FROM public.reserve_memberships m WHERE m.user_id = p.id);
  IF n > 0 THEN
    RAISE WARNING 'reserva backfill: % conta(s) staff com membership e sem active_reserve_id — o login vai resolver o default, mas confira', n;
  END IF;
END $$;
```

- [ ] **Step 2: Aplicar (local + prod) + commit**

```
mcp__claude_ai_Supabase__apply_migration name: reserve_backfill_seed_accounts query: <SQL>
```
```bash
git add supabase/migrations/20260911100300_reserve_backfill_seed_accounts.sql
git commit -m "chore(reserva): backfill/guard das contas de sistema (SP1)"
```

---

## Task 6: SP1 — resolvedor puro do default de `active_reserve_id`

**Files:**
- Create: `apps/bff/src/lib/active-reserve.ts`
- Test: `apps/bff/src/__tests__/active-reserve.test.ts`

**Interfaces:**
- Produces: `resolveDefaultActiveReserve(input: { role: string; current: string | null;
  memberships: { reserve_id: string; created_at: string }[]; preferences: { reserve_id: string;
  selection_count: number; last_selected_at: string | null }[] }) → { active: string | null;
  reason: "kept" | "matriz" | "preference" | "oldest_membership" | "none" }`.

- [ ] **Step 1: Escrever o teste**

`apps/bff/src/__tests__/active-reserve.test.ts`:
```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveDefaultActiveReserve } from "../lib/active-reserve.ts";

const M = (id: string, created: string) => ({ reserve_id: id, created_at: created });

describe("resolveDefaultActiveReserve", () => {
  it("admin_global sem valor salvo → matriz (NULL)", () => {
    const r = resolveDefaultActiveReserve({ role: "admin_global", current: null, memberships: [], preferences: [] });
    assert.deepEqual(r, { active: null, reason: "matriz" });
  });

  it("admin_global com valor salvo → mantém", () => {
    const r = resolveDefaultActiveReserve({ role: "admin_global", current: "res-1", memberships: [], preferences: [] });
    assert.deepEqual(r, { active: "res-1", reason: "kept" });
  });

  it("armeiro com valor salvo AINDA membro → mantém", () => {
    const r = resolveDefaultActiveReserve({
      role: "armeiro", current: "res-1",
      memberships: [M("res-1", "2026-01-01"), M("res-2", "2026-02-01")], preferences: [],
    });
    assert.deepEqual(r, { active: "res-1", reason: "kept" });
  });

  it("armeiro com valor salvo que NÃO é mais membership → cai no fallback", () => {
    const r = resolveDefaultActiveReserve({
      role: "armeiro", current: "res-9",
      memberships: [M("res-2", "2026-02-01"), M("res-1", "2026-01-01")], preferences: [],
    });
    assert.equal(r.active, "res-1"); // membership mais antiga
    assert.equal(r.reason, "oldest_membership");
  });

  it("armeiro sem valor salvo, com preferência → a mais usada", () => {
    const r = resolveDefaultActiveReserve({
      role: "armeiro", current: null,
      memberships: [M("res-1", "2026-01-01"), M("res-2", "2026-02-01")],
      preferences: [
        { reserve_id: "res-2", selection_count: 10, last_selected_at: "2026-03-01" },
        { reserve_id: "res-1", selection_count: 2, last_selected_at: "2026-02-01" },
      ],
    });
    assert.deepEqual(r, { active: "res-2", reason: "preference" });
  });

  it("armeiro sem valor, sem preferência → membership mais antiga", () => {
    const r = resolveDefaultActiveReserve({
      role: "armeiro", current: null,
      memberships: [M("res-2", "2026-02-01"), M("res-1", "2026-01-01")], preferences: [],
    });
    assert.deepEqual(r, { active: "res-1", reason: "oldest_membership" });
  });

  it("armeiro sem membership nenhuma → none (NULL)", () => {
    const r = resolveDefaultActiveReserve({ role: "armeiro", current: null, memberships: [], preferences: [] });
    assert.deepEqual(r, { active: null, reason: "none" });
  });
});
```

- [ ] **Step 2: Rodar — falha (módulo não existe)**

Run: `cd apps/bff && node --experimental-strip-types --test "src/__tests__/active-reserve.test.ts"`
Expected: FAIL — `Cannot find module '../lib/active-reserve.ts'`.

- [ ] **Step 3: Implementar**

`apps/bff/src/lib/active-reserve.ts`:
```ts
export interface ResolveInput {
  role: string;
  current: string | null;
  memberships: { reserve_id: string; created_at: string }[];
  preferences: { reserve_id: string; selection_count: number; last_selected_at: string | null }[];
}
export type ResolveReason = "kept" | "matriz" | "preference" | "oldest_membership" | "none";

const MATRIX_ROLES = new Set(["admin_global", "auditor", "superadmin"]);

export function resolveDefaultActiveReserve(
  input: ResolveInput,
): { active: string | null; reason: ResolveReason } {
  const memberIds = new Set(input.memberships.map((m) => m.reserve_id));

  // valor salvo ainda válido?
  if (input.current) {
    if (MATRIX_ROLES.has(input.role) || memberIds.has(input.current)) {
      return { active: input.current, reason: "kept" };
    }
  }

  if (MATRIX_ROLES.has(input.role)) return { active: null, reason: "matriz" };

  // preferência mais usada, restrita às memberships atuais
  const prefRanked = input.preferences
    .filter((p) => memberIds.has(p.reserve_id))
    .sort((a, b) =>
      b.selection_count - a.selection_count ||
      (b.last_selected_at ?? "").localeCompare(a.last_selected_at ?? ""));
  if (prefRanked.length > 0) return { active: prefRanked[0].reserve_id, reason: "preference" };

  // membership mais antiga
  const oldest = [...input.memberships].sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  if (oldest) return { active: oldest.reserve_id, reason: "oldest_membership" };

  return { active: null, reason: "none" };
}
```

- [ ] **Step 4: Rodar — passa**

Run: `node --experimental-strip-types --test "src/__tests__/active-reserve.test.ts"`
Expected: PASS (7 testes).

- [ ] **Step 5: Commit**

```bash
git add apps/bff/src/lib/active-reserve.ts apps/bff/src/__tests__/active-reserve.test.ts
git commit -m "feat(reserva): resolvedor puro do default de active_reserve_id (SP1)"
```

---

## Task 7: SP1 — `POST /api/reserves/switch/:id` grava a coluna + `usuario` + log

**Files:**
- Modify: `apps/bff/src/routes/reserves.ts:66-105`
- Test: `apps/bff/src/__tests__/reserves-switch.test.ts`

**Interfaces:**
- Consumes: `supabase` (service_role singleton), `structuredLogger`, `roleGuard`.
- Produces: o handler grava `profiles.active_reserve_id` **e** `session.reserveId`; loga
  `reserve.switch.ok` / `reserve.switch.denied {reason}`.

- [ ] **Step 1: Escrever o teste**

`apps/bff/src/__tests__/reserves-switch.test.ts` — monta o handler num app Hono, monkey-patch
do `supabase` singleton (molde: `internal-email-handler.test.ts`). Casos:
```ts
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
// ... setup igual aos outros *-handler.test.ts: fake supabase builder, app Hono ...

describe("POST /api/reserves/switch/:id", () => {
  it("armeiro membro da reserva → 200, grava profiles.active_reserve_id + session.reserveId", async () => {
    // fake: reserves.select → { id, tenant_id: T, status: 'ativa' }; reserve_memberships → { id }
    // assert: profiles.update chamado com { active_reserve_id: <targetId> } .eq('id', userId)
    // assert: resposta { ok: true }
  });
  it("armeiro SEM membership → 403, NÃO grava, loga reserve.switch.denied reason=not_member", async () => {});
  it("usuario membro → 200 (roleGuard agora inclui usuario)", async () => {});
  it("reserva de outro tenant → 404", async () => {});
  it("reserva inativa → 404", async () => {});
  it("falha do profiles.update → 500, não altera a sessão", async () => {});
});
```
(Escrever os corpos com o mesmo padrão de fake-supabase dos testes existentes do BFF —
`apps/bff/src/__tests__/internal-email-handler.test.ts` é o molde de `fakeTable`.)

- [ ] **Step 2: Rodar — falha**

Run: `node --experimental-strip-types --test "src/__tests__/reserves-switch.test.ts"`
Expected: FAIL.

- [ ] **Step 3: Implementar — editar `reserves.ts`**

`switch/:id` — trocar o `roleGuard` e o corpo:
```ts
reservesRoutes.post(
  "/switch/:id",
  roleGuard("admin_global", "armeiro", "admin_reserva", "usuario"),
  async (c) => {
    const targetId = c.req.param("id");
    const tenantId = c.get("tenantId");
    const userId   = c.get("userId");
    const role     = c.get("role");
    const log      = c.get("log");
    if (!tenantId || !userId) return c.json({ error: "tenant não identificado" }, 403);

    const { data: reserve } = await supabase
      .from("reserves")
      .select("id, nome, acronym")
      .eq("id", targetId).eq("tenant_id", tenantId).eq("status", "ativa")
      .single();
    if (!reserve) {
      log.warn({ userId, targetId, reason: "not_found" }, "reserve.switch.denied");
      return c.json({ error: "Reserva não encontrada" }, 404);
    }

    if (role !== "admin_global") {
      const { data: membership } = await supabase
        .from("reserve_memberships")
        .select("id").eq("user_id", userId).eq("reserve_id", targetId).maybeSingle();
      if (!membership) {
        log.warn({ userId, targetId, reason: "not_member" }, "reserve.switch.denied");
        return c.json({ error: "Sem permissão para esta reserva" }, 403);
      }
    }

    // fonte de verdade do RLS: a coluna. service_role → passa pelo profiles_validate_active_reserve (belt).
    const { error: updErr } = await supabase
      .from("profiles").update({ active_reserve_id: reserve.id }).eq("id", userId);
    if (updErr) {
      log.error({ userId, targetId, err: updErr.message }, "reserve.switch.failed");
      return c.json({ error: "Não foi possível trocar de reserva" }, 500);
    }

    // bump de preferência (best-effort)
    void supabase.rpc("bump_reserve_preference", { p_user: userId, p_reserve: reserve.id }).then(() => {}, () => {});

    const session = await getIronSession<SessionData>(c.req.raw, c.res, sessionOptions);
    session.reserveId = reserve.id;
    await session.save();

    log.info({ userId, targetId }, "reserve.switch.ok");
    return c.json({ ok: true, reserve });
  }
);
```
(Se `c.get("log")` não existir no contexto Hono deste router, usar `structuredLogger` importado
— checar `apps/bff/src/middleware/auth.ts` para o padrão. `bump_reserve_preference` é uma RPC
trivial — criar numa migração menor OU inline o `upsert` em `user_reserve_preferences`; se
inline, fazer `void`.)

- [ ] **Step 4: Rodar — passa**

Run: `node --experimental-strip-types --test "src/__tests__/reserves-switch.test.ts"`
Expected: PASS.

- [ ] **Step 5: Suíte BFF + typecheck**

```bash
SUPABASE_URL=https://dummy.supabase.co SUPABASE_SERVICE_ROLE_KEY=dummy npm test
npm run typecheck
bash scripts/check-no-console.sh
```
Expected: verde.

- [ ] **Step 6: Code review + commit**

```bash
git add apps/bff/src/routes/reserves.ts apps/bff/src/__tests__/reserves-switch.test.ts
git commit -m "feat(reserva): switch grava profiles.active_reserve_id + usuario no roleGuard + log (SP1)"
```

---

## Task 8: SP1 — `POST /api/reserves/switch/matriz`

**Files:**
- Modify: `apps/bff/src/routes/reserves.ts` (nova rota)
- Test: `apps/bff/src/__tests__/reserves-switch.test.ts` (novos casos)

**Interfaces:**
- Produces: `POST /api/reserves/switch/matriz` — só `admin_global`/`auditor` → `active_reserve_id
  = NULL`, `session.reserveId = null`; loga `reserve.matriz.entered`.

- [ ] **Step 1: Teste**

```ts
describe("POST /api/reserves/switch/matriz", () => {
  it("admin_global → 200, active_reserve_id = NULL, session.reserveId = null", async () => {});
  it("auditor → 200", async () => {});
  it("armeiro → 403 (roleGuard)", async () => {});
});
```

- [ ] **Step 2: Rodar — falha. Step 3: Implementar**

```ts
reservesRoutes.post(
  "/switch/matriz",
  roleGuard("admin_global", "auditor"),
  async (c) => {
    const userId = c.get("userId");
    const log = c.get("log");
    if (!userId) return c.json({ error: "não autenticado" }, 401);
    const { error } = await supabase.from("profiles").update({ active_reserve_id: null }).eq("id", userId);
    if (error) return c.json({ error: "Falha ao voltar à matriz" }, 500);
    const session = await getIronSession<SessionData>(c.req.raw, c.res, sessionOptions);
    session.reserveId = null;
    await session.save();
    log.info({ userId }, "reserve.matriz.entered");
    return c.json({ ok: true });
  }
);
```

- [ ] **Step 4: Rodar — passa. Step 5: suíte + typecheck. Step 6: commit**

```bash
git add apps/bff/src/routes/reserves.ts apps/bff/src/__tests__/reserves-switch.test.ts
git commit -m "feat(reserva): rota switch/matriz (admin_global/auditor voltam à visão de tenant) (SP1)"
```

---

## Task 9: SP1 — `auth.ts` resolve `active_reserve_id` no login e exchange

**Files:**
- Modify: `apps/bff/src/routes/auth.ts` (login handler ~:145, exchange ~:257)
- Test: `apps/bff/src/__tests__/auth-active-reserve.test.ts` (novo)

**Interfaces:**
- Consumes: `resolveDefaultActiveReserve` (Task 6).
- Produces: no login/exchange, após o lookup de profile, chama o resolvedor com
  `{ role, current: profile.active_reserve_id, memberships, preferences }`, e se o resultado
  difere de `profile.active_reserve_id` faz `supabase.from("profiles").update({ active_reserve_id })`.
  `session.reserveId` = o resultado. Emite `reserve.active.none_for_staff` quando `reason==="none"`.

- [ ] **Step 1: Teste** (unidade da função de fiação — extrair `applyActiveReserveOnLogin(deps)`
  para testar sem HTTP, molde `auth-me-real-handler.test.ts`). Casos: admin_global → NULL sem
  update; armeiro com membership → resolve + update + session.reserveId; armeiro sem membership
  → NULL + log `none_for_staff`.

- [ ] **Step 2: falha. Step 3: implementar** — adicionar ao `Promise.all` do lookup de profile
  as queries de `reserve_memberships` (`reserve_id, created_at`) e `user_reserve_preferences`
  (`reserve_id, selection_count, last_selected_at`) do usuário; chamar `resolveDefaultActiveReserve`;
  aplicar. Fazer nos **dois** handlers (login e exchange). `session.reserveId = resolved.active`.

- [ ] **Step 4: passa. Step 5: suíte. Step 6: code review + commit**

```bash
git add apps/bff/src/routes/auth.ts apps/bff/src/__tests__/auth-active-reserve.test.ts
git commit -m "feat(reserva): login/exchange resolvem o default de active_reserve_id (SP1)"
```

---

## Task 10: SP1 — `middleware/auth.ts` lê a coluna + re-valida membership

**Files:**
- Modify: `apps/bff/src/middleware/auth.ts` (iron-session path ~:57-58; Bearer path ~:143-160)
- Test: `apps/bff/src/__tests__/auth-middleware-reserve.test.ts` (novo)

**Interfaces:**
- Produces: `c.get("reserveId")` vem de `profiles.active_reserve_id` (não mais só
  `session.reserveId`), nos **dois** caminhos. Se o usuário é staff (`admin_reserva`/`armeiro`/
  `usuario`) e `active_reserve_id` não-NULL mas **não há** `reserve_memberships` correspondente
  → emite `reserve.active.revoked_midsession`, seta `c.set("reserveId", null)` e devolve
  `X-Reserve-Revoked: 1` (o client trata).

- [ ] **Step 1: Teste** — extrair `resolveRequestReserve({ userId, role, sessionReserveId, db })`
  → `{ reserveId: string | null; revoked: boolean }`. Casos: coluna preenchida + membership ok
  → devolve a coluna; coluna preenchida + membership sumiu (staff) → `{ null, revoked: true }`;
  admin_global com coluna NULL → `{ null, false }`.

- [ ] **Step 2: falha. Step 3: implementar** — no iron-session path, trocar
  `c.set("reserveId", session.reserveId ?? null)` por uma chamada a `resolveRequestReserve`
  (1 SELECT de `profiles.active_reserve_id` + 1 EXISTS em `reserve_memberships` — usar
  `supabase` service_role). Cachear no `session` para não repetir a query desnecessariamente é
  otimização de SP posterior; aqui, correção primeiro. No Bearer path idem, sem `.single()` que
  lança (usar `maybeSingle`).

- [ ] **Step 4: passa. Step 5: suíte + typecheck. Step 6: code review + commit**

```bash
git add apps/bff/src/middleware/auth.ts apps/bff/src/__tests__/auth-middleware-reserve.test.ts
git commit -m "feat(reserva): middleware resolve reserveId da coluna + detecta membership revogada (SP1)"
```

---

## Task 11: SP1 — `layout.tsx` usa `active_reserve_id`

**Files:**
- Modify: `apps/web/src/app/(dashboard)/layout.tsx` (cálculo de `currentReserveId`, ~:184-255)

**Interfaces:**
- Consumes: `profile.active_reserve_id` (a coluna agora existe).
- Produces: `currentReserveId = profile.active_reserve_id` (fonte única). Remove a lógica de
  "primeira `reserve_membership` sem `.order()`".

- [ ] **Step 1: Ler o trecho atual** (`sed -n '180,260p'`). Localizar onde `currentReserveId`
  é derivado.

- [ ] **Step 2: Implementar** — `const currentReserveId = profile?.active_reserve_id ?? null;`
  Ajustar as queries condicionais (`isUsuario ? tenants : currentReserveId ? reserves.eq(id) :
  reserves.first_ativa`) para usar `currentReserveId`. Se `currentReserveId` é NULL e o papel é
  staff não-admin_global → renderizar o aviso "peça a um admin p/ te vincular a uma reserva"
  em vez da 1ª reserva do tenant.

- [ ] **Step 3: typecheck web**

```bash
cd apps/web && npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(dashboard)/layout.tsx"
git commit -m "feat(reserva): layout usa profiles.active_reserve_id como fonte única (SP1)"
```

---

## Task 12: SP1 — sidebar: chevron para `usuario` + "Ver todas as reservas"

**Files:**
- Modify: `apps/web/src/components/layout/sidebar.tsx` (~:99-240)

**Interfaces:**
- Consumes: props `reserves`, `currentReserveId`, `role`.
- Produces: o `<select>`/menu do chevron aparece para `role === "usuario"` também (hoje
  `canSwitch = reserves.length > 1` — manter, mas o layout tem que passar as reservas do
  usuário); item extra "Ver todas as reservas" (chama `POST /api/reserves/switch/matriz`) só
  para `admin_global`/`auditor`; `switchReserve` chama a rota e faz `router.refresh()`.

- [ ] **Step 1: Ler `sidebar.tsx:95-250`** (props, `switchReserve`, o bloco do chevron).

- [ ] **Step 2: Implementar** —
  - o layout já deve estar passando `reserves` (Task 11 garante que para `usuario` venham as
    reservas dele — se não, adicionar a query lá);
  - no menu, quando `role === "admin_global" || role === "auditor"`, adicionar
    `<button onClick={switchToMatriz}>Ver todas as reservas</button>` no topo, com check quando
    `currentReserveId === null`;
  - `switchToMatriz`: `await fetch(\`${BFF_URL}/api/reserves/switch/matriz\`, { method: "POST",
    credentials: "include" })` → `router.refresh()`.
  - `switchReserve` (já existe): após 200, além do `router.refresh()` atual, nada mais (o SSE
    re-subscribe é SP9).

- [ ] **Step 3: typecheck + lint web**

```bash
cd apps/web && npm run typecheck && npm run lint
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/layout/sidebar.tsx
git commit -m "feat(reserva): chevron p/ usuario + 'Ver todas as reservas' (matriz) (SP1)"
```

---

## Task 13: SP1 — invariante de CI "sem Realtime autenticado no web"

**Files:**
- Create: `scripts/ci/no-authed-realtime.sh`
- Modify: `.github/workflows/ci-cd.yml`

**Interfaces:**
- Produces: um passo de CI que **falha** se `apps/web/src` passar a assinar Realtime direto.

- [ ] **Step 1: Escrever o script**

`scripts/ci/no-authed-realtime.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
# A segurança de usar funções STABLE nas policies de reserva (§4.2 do design)
# depende de NÃO haver assinante Realtime autenticado — todo Realtime passa pelo
# proxy SSE do BFF (service_role). Se isto mudar, as policies STABLE quebram a
# entrega de eventos (RT-04). Trava a invariante.
if grep -rnE "\.channel\(|postgres_changes" apps/web/src --include="*.ts" --include="*.tsx" \
   | grep -v "// realtime-ok:" ; then
  echo "ERRO: assinatura Realtime direta em apps/web/src — ver docs/superpowers/specs/2026-09-09-isolamento-reserva-design.md F2/RT-04"
  exit 1
fi
echo "OK: nenhum assinante Realtime autenticado em apps/web/src"
```
```bash
chmod +x scripts/ci/no-authed-realtime.sh
```

- [ ] **Step 2: Rodar local**

Run: `bash scripts/ci/no-authed-realtime.sh`
Expected: `OK: nenhum assinante Realtime autenticado`.

- [ ] **Step 3: Adicionar ao CI** — no job `typecheck` (ou `lint`) de `.github/workflows/ci-cd.yml`,
  um step `- run: bash scripts/ci/no-authed-realtime.sh`.

- [ ] **Step 4: Commit**

```bash
git add scripts/ci/no-authed-realtime.sh .github/workflows/ci-cd.yml
git commit -m "ci(reserva): invariante — sem assinante Realtime autenticado no web (SP1)"
```

---

## Task 14: SP0.5 spike — recursão + Realtime pelo SSE real + EXPLAIN em volume

**Files:**
- Create: `docs/superpowers/spikes/2026-09-XX-reserve-rls-spike.md`

**Interfaces:**
- Produces: um documento com verdicts (PASS/FAIL + números) para: (a) recursão de `profiles`
  com policy §4.2-profiles de brinquedo; (b) entrega de evento pelo proxy SSE do BFF após uma
  policy STABLE; (c) `EXPLAIN (ANALYZE, BUFFERS)` do padrão §4.2 em `material_types` com 2000
  linhas, por papel, comparado com o plano atual.

- [ ] **Step 1: Recursão** — no Postgres local (Task 1), aplicar uma policy de brinquedo em
  `profiles` usando o padrão §4.2-profiles (com `user_in_reserve` + `my_active_reserve_id`),
  `SET statement_timeout='2s'`, `SELECT * FROM profiles` como cada papel simulado. Registrar
  PASS/FAIL + tempo.

- [ ] **Step 2: Realtime pelo SSE** — subir o BFF local apontando pro Supabase local; abrir
  `EventSource` em `/api/realtime/stream` (canal `armeiro-sync`); aplicar a policy STABLE de
  brinquedo em `cautelamentos`; `INSERT` em `cautelamentos` via service_role; confirmar que o
  evento chega no `EventSource`. Registrar PASS/FAIL. (Se FAIL: achado grave — o design de 10
  tabelas publicadas não fecha; documentar e escalar antes de SP5.)

- [ ] **Step 3: EXPLAIN em volume** — no local com o seed (2000 `material_types`):
```sql
-- baseline: policy atual (tenant_id = my_tenant_id())
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM material_types;  -- como armeiro simulado
-- candidata: padrão §4.2 (my_tenant_id + auth_role + my_tenant_isolation_enabled + my_active_reserve_id)
--   (aplicar a policy candidata numa cópia/tx e re-rodar)
```
Registrar: tempo baseline vs candidato, nº de InitPlans, se algum vira per-row.
Alvo: candidato dentro de ~1.5× do baseline, p95 < 400ms, zero `statement_timeout`.

- [ ] **Step 4: Escrever o doc do spike** com os 3 verdicts + recomendação
  (seguir para SP5 / redesenhar / condição).

- [ ] **Step 5: Atualizar a spec** — §8: nota de que SP0.5 roda **depois** de SP1 (precisa das
  funções); linkar o doc do spike; se algum verdict for FAIL, marcar o bloco correspondente da
  §4.2 como "revisar — ver spike".

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/spikes/2026-09-XX-reserve-rls-spike.md docs/superpowers/specs/2026-09-09-isolamento-reserva-design.md
git commit -m "spike(reserva): recursão + Realtime SSE + EXPLAIN em volume (SP0.5) — verdicts"
```

---

## Task 15: PR + validação com o dono

**Files:** nenhum.

- [ ] **Step 1: Push + PR**

```bash
git push -u origin feat/reserva-sp1-mecanismo
gh pr create --title "feat(reserva): SP1 — mecanismo de reserva ativa (dormente) + SP0.5 spike" --body "<resumo: colunas, triggers, funções STABLE, switch/matriz, middleware, layout, sidebar, CI invariant, achados do spike. Flag reserve_isolation_enabled=false → nada muda em prod. Fecha o bug 'chevron não faz nada'.>"
```

- [ ] **Step 2: Validação visual (Playwright / manual) com o dono** — logar como `admin@apmcb.dev`
  (admin_global), abrir o chevron, entrar na reserva APMCB, confirmar que o header muda e que
  `POST /api/reserves/switch/APMCB` gravou `profiles.active_reserve_id` (checar via MCP).
  Voltar à matriz. **Medir a fricção do fluxo** (ARCH-v4 MÉD-8) e registrar no PR se
  admin_global "entrar na reserva pra escrever" é aceitável ou se precisa de ajuste antes de
  SP5–SP9.

- [ ] **Step 3: Merge** após code-review + aprovação do dono.

---

## Self-Review

**1. Spec coverage (SP0.25 + SP1 + SP0.5):**
- SP0.25 (Docker + seed) → Task 1. ✓
- SP1 colunas → Task 2; freeze estendido + validate → Task 3; funções STABLE → Task 4;
  backfill 3 contas → Task 5; login default → Task 9; switch grava coluna + usuario → Task 7;
  switch/matriz → Task 8; middleware 3 caminhos + re-valida membership → Task 10; layout →
  Task 11; sidebar chevron+matriz → Task 12; CI invariante → Task 13; validar UX admin_global
  com dono → Task 15 Step 2. ✓
- SP0.5 recursão + Realtime SSE + EXPLAIN → Task 14. ✓
- **Gap consciente:** o "bump de `user_reserve_preferences`" (Task 7 Step 3) menciona uma RPC
  `bump_reserve_preference` que não é criada por nenhuma task — o executor deve **ou** criar
  uma migração trivial `CREATE FUNCTION bump_reserve_preference` **ou** inline o `upsert`
  `void`. Deixado como decisão do executor (é best-effort, não bloqueante).
- **Fora de escopo deste plano (planos próprios, pós-SP0.5):** SP2 (bugs pré-requisito +
  auditoria de leitores de `reserve_memberships`), SP3 (CI gates de policy/grant), SP4
  (`reserve_id` nas 7 filhas + dispatcher), SP5–SP9 (grupos de RLS + `profiles` + DROP
  `auth_tenant_id`), SP8 (guards de RPC + `assert_actor_in_reserve` + `assert_resource_in_reserve`),
  SP9.5 (canário em prod), SP10 (flip PMPB + E2E), SP11 (`NOT NULL` filhas).

**2. Placeholder scan:** Tasks 7–10 usam "molde `internal-email-handler.test.ts`" para os
corpos de teste em vez de escrevê-los inteiros — é uma referência a um padrão real e estável
do repo, não um "TODO". O executor deve abrir esse arquivo e seguir o `fakeTable`. Aceitável
para tasks de teste de handler HTTP (o padrão é ~40 linhas de boilerplate idêntico).

**3. Type consistency:** `resolveDefaultActiveReserve` (Task 6) — assinatura e `reason` enum
usados em Task 9. `resolveRequestReserve` (Task 10) — assinatura definida na própria task.
Nomes de coluna/trigger/função batem com "Global Constraints".
