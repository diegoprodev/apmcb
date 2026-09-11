# SP2 — Bugs pré-requisito do isolamento por reserva — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development para
> executar este plano tarefa-a-tarefa. Steps usam checkbox (`- [ ]`).

**Goal:** Fechar os 7 bugs que a spec §4.7/§6 marca como pré-requisito antes de ligar RLS por
reserva (SP4+), sem tocar em nenhuma policy — tudo continua com a flag
`tenants.reserve_isolation_enabled = false`.

**Architecture:** Mudanças de fiação no BFF (Hono/Bun) e em 2 telas web (Next server components +
client). Nenhuma migração de RLS. Uma migração pequena: RPC `bump_reserve_preference`. O modelo
`reserve_memberships` passa a carregar linhas `role='usuario'` (militar comum) — a premissa
"linha ⇒ staff" morre e todos os leitores precisam ser auditados.

**Tech Stack:** Hono, supabase-js (service role), Postgres RPC, Next 16, Vitest/`node --test`.

**Spec:** `docs/superpowers/specs/2026-09-09-isolamento-reserva-design.md` (v7) — §4.7 (modelo
militar↔reserva), §4.6 (switch/matriz), §6 (bugs correlatos), §8 SP2.

## Global Constraints

- **Flag OFF durante todo o SP2.** Nenhuma policy RLS é criada, alterada ou dropada. Se uma
  tarefa "precisar" mexer em `pg_policies`, ela está fora de escopo → vira ruling no ledger.
- **`reserve_memberships.role`** aceita `'usuario' | 'armeiro' | 'admin_reserva' | 'auditor_reserva'`
  (enum já existe no banco — confirmado no dump de prod). Militar comum = `'usuario'`.
- **"Staff de uma reserva"** = existe `reserve_memberships` com `role IN
  ('armeiro','admin_reserva','auditor_reserva')` para aquele `(user_id, reserve_id)`. `'usuario'`
  **não** é staff.
- **Toda negação/falha loga no BFF** com evento nomeado (`c.get("log")`), regra canônica do
  CLAUDE.md. Nenhum fluxo de erro responde ao cliente sem rastro.
- **Todo `.ts`/`.tsx`/`.sql` de produção passa pelo code-review canônico antes do commit**
  (CLAUDE.md). Bloqueador: CRÍTICO/ALTO aberto.
- **Migração**: bloco de rollback comentado; testada no staging (`vfkdycqkddgoqnujwbvl`) antes de
  prod. Aplicar em prod via MCP `apply_migration` (project `jepitcrkicwmvzrmllpn`), depois
  `git mv` do arquivo local pro timestamp que o ledger de prod gravar (drift conhecido).
- **BFF tests:** `node --experimental-strip-types --test`, imports relativos com `.ts` explícito,
  env dummy `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`.
- **pt-BR** em toda copy visível e mensagem de erro de API.

---

## File Structure

**BFF — criar:**
- `apps/bff/src/lib/reserve-staff.ts` — helpers puros: `STAFF_RESERVE_ROLES` (const),
  `isStaffReserveRole(role: string): boolean`, `resolveCreationReserveId(input): { reserveId: string | null; needsSelector: boolean }`.

**BFF — editar:**
- `apps/bff/src/routes/admin.ts` — `POST /militares` (linha ~54): grava `reserve_memberships`
  `role='usuario'`; `DELETE /reserves/:id` (linha ~672): `status='deleting'` primeiro, pre-check
  só de **staff**, checa o `error` do delete final.
- `apps/bff/src/routes/profiles.ts` — `PATCH /:id` (linha ~172): quando `role` muda e o novo papel
  torna `active_reserve_id` inválido → nula no mesmo UPDATE; eligibilidade do `reserve_ids`
  (linha ~310) por membership-do-alvo, não por `profiles.role`.
- `apps/bff/src/routes/nexus.ts` — `POST /reserves/:id/members` (linha ~655): checa o `error` do
  audit insert (já existe) — ok; sem mudança funcional além de alinhar o enum.
- `apps/bff/src/routes/reserves.ts` — `POST /switch/:id` (linha ~146): troca o upsert hardcoded
  `selection_count: 1` por `.rpc("bump_reserve_preference", …)`.
- `apps/web/src/app/api/admin/users/route.ts` — se cria militar (magic_link/password), grava
  `reserve_memberships` `role='usuario'` (mesma regra do `POST /militares`).

**Web — editar:**
- `apps/web/src/app/(dashboard)/admin/estrutura/page.tsx` — `searchProfilesAny` (linha ~35):
  eligibilidade por membership-do-alvo-na-reserva, não `p.role`.
- `apps/web/src/app/(dashboard)/reserva/militares/page.tsx` +
  `apps/web/src/app/(dashboard)/admin/usuarios/_cadastrar-militar-dialog.tsx` — seletor de reserva
  obrigatório quando o criador está em matriz (`active_reserve_id` NULL).
- `apps/web/src/app/api/admin/search-profiles/route.ts` — novo param opcional
  `exclude_reserve_staff=<reserveId>` para o autocomplete de promoção.

**Migração:**
- `supabase/migrations/<ts>_bump_reserve_preference_rpc.sql`

**Auditoria (Task 1, entregável = doc):**
- `docs/superpowers/specs/sp2-reserve-memberships-readers-audit.md` — tabela de cada leitor, o que
  assume, veredito (seguro / corrigir), fix aplicado ou tracked.

---

## Task 1: Auditoria dos leitores de `reserve_memberships`

**Files:**
- Create: `docs/superpowers/specs/sp2-reserve-memberships-readers-audit.md`

**Interfaces:**
- Produces: a lista canônica de leitores + veredito, consumida pelas Tasks 2–9 (cada uma
  confirma que não regride um leitor "seguro").

- [ ] **Step 1: Enumerar todos os leitores**

Rodar e colar a saída no doc:
```bash
grep -rn "reserve_memberships" apps/bff/src apps/web/src --include=*.ts --include=*.tsx
```
Mais os leitores SQL (policies + funções) do dump `scripts/spike-reserva/` /
`pg_policies WHERE qual LIKE '%reserve_memberships%'` no staging.

- [ ] **Step 2: Para cada leitor, uma linha na tabela**

Colunas: `arquivo:linha` | o que a query faz | **assume "linha ⇒ staff"?** | veredito
(`SEGURO` / `CORRIGIR`) | ação.

Leitores já conhecidos (spec §4.7) e o que checar:
- `apps/bff/src/middleware/auth.ts` (Bearer, ~:132) — lê a coluna `active_reserve_id` agora
  (SP1), não mais membership. Confirmar que não voltou a ler membership.
- `apps/bff/src/routes/reserves.ts` `/mine`, `/switch` — lista as reservas do user; com
  `role='usuario'` incluído, `/mine` passa a devolver as reservas onde o militar é efetivo
  (correto — ele ganha o chevron). Confirmar que `/switch/:id` valida membership de QUALQUER
  role (usuario pode trocar pra reserva dele) — **já é o comportamento pós-SP1** (`roleGuard`
  inclui `usuario`), confirmar.
- `auth_admin_reserve_ids()` (função SQL) — filtra `role='admin_reserva'`? Confirmar no corpo
  (dump). Se filtra, SEGURO.
- `apps/web/src/app/(dashboard)/admin/estrutura/page.tsx` — elegibilidade (Task 4).
- RLS `reserve_memberships_select` — quem pode ler a tabela. Com `usuario` dentro, um militar
  não-staff pode passar a ver a lista de membros da reserva? Verificar o `qual` no staging;
  se sim e for indesejado → **CORRIGIR vira item bloqueante** (mas provavelmente já escopa por
  `user_id = auth.uid() OR <staff>` — confirmar).
- policies `category_requests` / `material_validity_alert_events` — usam `reserve_id IN (SELECT
  reserve_id FROM reserve_memberships WHERE user_id = auth.uid())`. Com `usuario` dentro, um
  efetivo passa a "ver" category_requests / alertas de validade da reserva dele. Veredito de
  produto: aceitável? (provável que sim — read-only, escopo da reserva dele). Anotar.
- Todos os `routes/*.ts` da lista do grep (shifts, handovers, inventory, lendings, biometric,
  categories, arsenal, ssa) — a maioria usa membership pra "resolver a reserva do armeiro". Com
  a coluna `active_reserve_id` como fonte (SP1), muitos desses são candidatos a trocar pra
  coluna, mas **isso é SP5** (quando o valor vira load-bearing). Aqui só anotar
  `SEGURO (flag OFF) / migrar no SP5`.

- [ ] **Step 3: Consolidar vereditos**

Qualquer `CORRIGIR` que seja vazamento de dado com a flag OFF → vira tarefa nova neste plano
(ruling no ledger). `CORRIGIR` que só morde com a flag ON → tracked pro SP5.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/sp2-reserve-memberships-readers-audit.md
git commit -m "docs(reserva): SP2 Task 1 — auditoria dos leitores de reserve_memberships"
```

---

## Task 2: `lib/reserve-staff.ts` — helpers puros

**Files:**
- Create: `apps/bff/src/lib/reserve-staff.ts`
- Test: `apps/bff/src/__tests__/reserve-staff.test.ts`

**Interfaces:**
- Produces:
  - `export const STAFF_RESERVE_ROLES = ["armeiro", "admin_reserva", "auditor_reserva"] as const;`
  - `export function isStaffReserveRole(role: string | null | undefined): boolean`
  - `export function resolveCreationReserveId(input: { creatorRole: string; creatorActiveReserveId: string | null; explicitReserveId: string | null }): { reserveId: string | null; needsSelector: boolean }`
    - `admin_global`/`auditor` com `creatorActiveReserveId === null` e sem `explicitReserveId` →
      `{ reserveId: null, needsSelector: true }`
    - `explicitReserveId` presente → `{ reserveId: explicitReserveId, needsSelector: false }`
    - senão → `{ reserveId: creatorActiveReserveId, needsSelector: creatorActiveReserveId === null }`

- [ ] **Step 1: Teste que falha**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { isStaffReserveRole, resolveCreationReserveId } from "../lib/reserve-staff.ts";

test("isStaffReserveRole: usuario não é staff", () => {
  assert.equal(isStaffReserveRole("usuario"), false);
  assert.equal(isStaffReserveRole("armeiro"), true);
  assert.equal(isStaffReserveRole("admin_reserva"), true);
  assert.equal(isStaffReserveRole(null), false);
});

test("resolveCreationReserveId: criador com reserva ativa usa ela", () => {
  assert.deepEqual(
    resolveCreationReserveId({ creatorRole: "armeiro", creatorActiveReserveId: "r1", explicitReserveId: null }),
    { reserveId: "r1", needsSelector: false },
  );
});

test("resolveCreationReserveId: admin_global em matriz sem seletor exige seletor", () => {
  assert.deepEqual(
    resolveCreationReserveId({ creatorRole: "admin_global", creatorActiveReserveId: null, explicitReserveId: null }),
    { reserveId: null, needsSelector: true },
  );
});

test("resolveCreationReserveId: explicitReserveId vence", () => {
  assert.deepEqual(
    resolveCreationReserveId({ creatorRole: "admin_global", creatorActiveReserveId: null, explicitReserveId: "r2" }),
    { reserveId: "r2", needsSelector: false },
  );
});
```

- [ ] **Step 2: Rodar — falha** (`node --experimental-strip-types --test apps/bff/src/__tests__/reserve-staff.test.ts`), esperado: módulo não existe.

- [ ] **Step 3: Implementar** `apps/bff/src/lib/reserve-staff.ts` com as 3 exportações acima. Zero I/O.

- [ ] **Step 4: Rodar — passa.**

- [ ] **Step 5: Commit**

```bash
git add apps/bff/src/lib/reserve-staff.ts apps/bff/src/__tests__/reserve-staff.test.ts
git commit -m "feat(reserva): SP2 Task 2 — helpers reserve-staff (isStaffReserveRole, resolveCreationReserveId)"
```

---

## Task 3: `POST /api/admin/militares` grava `reserve_memberships`

**Files:**
- Modify: `apps/bff/src/routes/admin.ts` (~:54–229)
- Test: `apps/bff/src/__tests__/admin-militares-reserve-membership.test.ts` (source-assertion,
  padrão `idor-write-scope.test.ts`)

**Interfaces:**
- Consumes: `resolveCreationReserveId`, `isStaffReserveRole` de `lib/reserve-staff.ts`.

**Contexto:** hoje o handler cria `auth.users` + `profiles` + `tenant_memberships` mas **nunca**
`reserve_memberships`. A sessão do BFF tem `c.get("reserveId")` (SP1, espelha
`profiles.active_reserve_id`). O zValidator do body ganha `reserve_id: z.string().uuid().optional()`.

- [ ] **Step 1: Teste que falha** — asserts sobre o texto de `admin.ts`:
  - contém `reserve_memberships` dentro do handler de `/militares`
  - contém `resolveCreationReserveId` **ou** usa `c.get("reserveId")` para o `reserve_id` do insert
  - o insert usa `role: "usuario"` fixo (nunca `body.role`) para a linha de `reserve_memberships`
    do militar recém-criado
  - retorna 400 com evento logado quando `needsSelector` é true e `body.reserve_id` ausente

- [ ] **Step 2: Rodar — falha.**

- [ ] **Step 3: Implementar:**
  - body += `reserve_id: z.string().uuid().nullable().optional()`
  - após o `profiles.upsert` ok e antes/junto do `Promise.allSettled` de tenant_membership:
    ```ts
    const { reserveId: creationReserveId, needsSelector } = resolveCreationReserveId({
      creatorRole: callerRole,
      creatorActiveReserveId: c.get("reserveId") ?? null,
      explicitReserveId: body.reserve_id ?? null,
    });
    if (needsSelector) {
      // rollback do auth user + profile já criados
      log.warn({ callerRole }, "admin.militares.reserve_selector_required");
      return c.json({ error: "Selecione a reserva do militar." }, 400);
    }
    ```
    ⚠️ **ordem**: fazer essa checagem **antes** de criar o auth user (fail-fast, sem rollback) —
    mover o bloco pra logo depois do `if (!tenantId)`.
  - adicionar ao `Promise.allSettled`:
    ```ts
    supabase.from("reserve_memberships").upsert(
      { reserve_id: creationReserveId, user_id: userId, role: "usuario" },
      { onConflict: "user_id,reserve_id" },
    ),
    ```
    e checar `settledDbError` → `log.error(..., "admin.militar.reserve_membership_failure")`.
  - **Se `body.role` é staff** (`isStaffReserveRole`): a linha de `reserve_memberships` usa
    `body.role` em vez de `'usuario'` (armeiro criado já entra como staff da reserva). Um
    `admin_global` criando um `armeiro` fora do fluxo `/estrutura` é raro mas válido.

- [ ] **Step 4: Rodar — passa** + suíte BFF verde.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(reserva): SP2 Task 3 — POST /militares cria reserve_membership do militar"
```

---

## Task 4: `POST /api/admin/users` (web) — mesma regra de membership

**Files:**
- Modify: `apps/web/src/app/api/admin/users/route.ts`
- Test: `apps/web/src/app/api/admin/users/__tests__/*` se existir; senão source-assertion novo.

**Interfaces:**
- Consumes: a mesma semântica da Task 3 (reserve_id do criador ou seletor).

- [ ] **Step 1: Ler a rota inteira**, identificar os branches que criam profile (`magic_link`,
  `password`/createUser). Ver como o role do caller e o tenant chegam aqui (cookies SSR / BFF).

- [ ] **Step 2: Teste que falha** — a rota grava `reserve_memberships` `role='usuario'` no
  branch de criação, com `reserve_id` do criador; 400 quando o criador está em matriz e o form
  não mandou `reserve_id`.

- [ ] **Step 3: Implementar.** Se a rota já delega ao BFF (`POST /api/admin/militares`),
  **só repassar `reserve_id`** do form e deixar a Task 3 fazer o trabalho (preferível —
  SSOT). Se cria direto via service role, replicar o `reserve_memberships.upsert`.

- [ ] **Step 4: Rodar — passa.**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(reserva): SP2 Task 4 — /api/admin/users cria reserve_membership"
```

---

## Task 5: Seletor de reserva obrigatório no form quando criador em matriz

**Files:**
- Modify: `apps/web/src/app/(dashboard)/admin/usuarios/_cadastrar-militar-dialog.tsx`
- Modify: `apps/web/src/app/(dashboard)/reserva/militares/page.tsx` (passa `activeReserveId` +
  lista de reservas do criador pro dialog)
- Modify: `apps/web/src/app/(dashboard)/reserva/criar-armeiro/_criar-armeiro-client.tsx` (idem)

**Interfaces:**
- Consumes: `profile.active_reserve_id` (server) + `POST /api/reserves/mine` ou a lista já
  carregada no `layout.tsx`.

- [ ] **Step 1: Ler os 3 forms**, achar onde `role`/dados são montados pro submit.

- [ ] **Step 2: Teste que falha** (client component test, Vitest): quando `activeReserveId` é
  `null` e `reserves.length > 1`, o form renderiza um `<select>` de reserva obrigatório e
  desabilita o submit até escolher; quando `activeReserveId` está setado, nenhum seletor
  aparece e o submit manda `reserve_id: activeReserveId` implícito (ou omite e o BFF resolve).

- [ ] **Step 3: Implementar** o seletor condicional. Copy: "Reserva do militar *".

- [ ] **Step 4: Rodar — passa** + `pnpm typecheck` no web.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(reserva): SP2 Task 5 — seletor de reserva no cadastro quando criador em matriz"
```

---

## Task 6: Elegibilidade de admin/armeiro por membership, não por `profiles.role`

**Files:**
- Modify: `apps/web/src/app/api/admin/search-profiles/route.ts` (novo param
  `exclude_reserve_staff=<reserveId>`)
- Modify: `apps/web/src/app/(dashboard)/admin/estrutura/page.tsx` (`searchProfilesAny` → passa
  a reserva-alvo; remove o filtro `p.role !== "admin_reserva"`)
- Test: `apps/web/src/app/api/admin/search-profiles/__tests__/*` (novo) + estrutura page test se existir

**Contexto / bug (spec §6):** `searchProfilesAny` filtra `p.role !== "admin_reserva"` **global**.
Um `admin_reserva` da reserva A **não aparece** quando você quer torná-lo admin da reserva B.
A elegibilidade certa: excluir quem **já é staff daquela reserva** (`reserve_memberships` com
`role` staff e `reserve_id` = alvo), não quem tem o papel globalmente. `admin_global`/`superadmin`
seguem excluídos (rebaixamento silencioso — o comentário no código está certo nesse ponto).

- [ ] **Step 1: Teste que falha** (`search-profiles` route):
  - `?role=any&q=…&exclude_reserve_staff=<rid>` não retorna profiles que têm
    `reserve_memberships(role IN staff, reserve_id = rid)`
  - retorna normalmente um `admin_reserva` que é staff de **outra** reserva
  - sem o param, comportamento idêntico ao de hoje (não quebra os outros callers)

- [ ] **Step 2: Rodar — falha.**

- [ ] **Step 3: Implementar:**
  - na route: se `exclude_reserve_staff` presente e válido (uuid), após a busca de profiles,
    fazer um `.from("reserve_memberships").select("user_id").eq("reserve_id", rid).in("role",
    STAFF_ROLES)` e filtrar os hits. (STAFF_ROLES inline — a route é edge, não importa do BFF.)
  - em `estrutura/page.tsx`: `searchProfilesAny(query, reserveId)` passa
    `&exclude_reserve_staff=${reserveId}`; o filtro client vira só
    `p.role !== "admin_global" && p.role !== "superadmin"`.

- [ ] **Step 4: Rodar — passa** + typecheck web.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(reserva): SP2 Task 6 — elegibilidade de staff por membership da reserva-alvo"
```

---

## Task 7: Role-change corrige `active_reserve_id` inválido

**Files:**
- Modify: `apps/bff/src/routes/profiles.ts` (`PATCH /:id`, ~:172–460)
- Test: `apps/bff/src/__tests__/profiles-role-change-active-reserve.test.ts` (source-assertion)

**Contexto (spec §4.7):** `PATCH /api/profiles/:id` muda `role`. Se o novo papel é
`admin_global`/`auditor`/`superadmin` (papéis de matriz) **ou** remove a última membership que
dava direito ao `active_reserve_id` atual, o `profiles.active_reserve_id` do alvo pode virar
inválido (o trigger `profiles_validate_active_reserve` só roda em `UPDATE OF active_reserve_id`,
não em `UPDATE OF role`). Resultado: sessão do alvo com reserva ativa que ele não pode mais usar.

- [ ] **Step 1: Teste que falha** — asserts sobre `profiles.ts`:
  - quando `body.role` está presente e o `updatePayload` de `profiles` inclui `role`, o mesmo
    `.update()` também seta `active_reserve_id: null` **se** o novo papel ∈
    `('admin_global','auditor','superadmin')`
  - quando `reserve_ids` remove reservas E o `active_reserve_id` do alvo aponta pra uma delas →
    já coberto (linha ~520, `clrErr`), confirmar que o teste ainda passa
  - evento logado: `profiles.role_change.active_reserve_cleared`

- [ ] **Step 2: Rodar — falha.**

- [ ] **Step 3: Implementar:**
  - onde `updatePayload.role` é setado, adicionar:
    ```ts
    const MATRIX_ROLES = new Set(["admin_global", "auditor", "superadmin"]);
    if (body.role && MATRIX_ROLES.has(body.role)) {
      updatePayload.active_reserve_id = null;
    }
    ```
  - **caso mais fino** (novo papel é `armeiro`/`usuario`/`admin_reserva` mas o alvo perde a
    membership da reserva ativa): após a escrita de `reserve_memberships` (linha ~497), um
    `SELECT active_reserve_id` do alvo + `EXISTS reserve_memberships(alvo, essa_reserva)` →
    se não existe e o papel não é de matriz → `UPDATE profiles SET active_reserve_id = null`.
    Logar `profiles.role_change.active_reserve_cleared`.
  - o trigger de freeze (`profiles_freeze_privileged_columns`) **bloqueia** `authenticated`
    mudando `active_reserve_id` — mas aqui é `service_role` (BFF), que o trigger deixa passar
    (`current_user NOT IN ('authenticated','anon') THEN RETURN NEW`). Confirmar no corpo da
    função (dump) antes de assumir.

- [ ] **Step 4: Rodar — passa** + suíte BFF.

- [ ] **Step 5: Commit**

```bash
git commit -am "fix(reserva): SP2 Task 7 — role-change nula active_reserve_id inválido"
```

---

## Task 8: `DELETE /api/admin/reserves/:id` — MÉDIO-3

**Files:**
- Modify: `apps/bff/src/routes/admin.ts` (`DELETE /reserves/:id`, ~:672–692)
- Test: `apps/bff/src/__tests__/admin-delete-reserve.test.ts` (source-assertion)

**Contexto (spec §4.7 + review SP1 MÉDIO-3):**
1. o `await supabase.from("reserves").delete()` final **não checa `error`** → 200 mentiroso.
2. o pre-check conta **todas** as `reserve_memberships` — inclui `role='usuario'`. A spec diz:
   bloquear só se houver **staff**; efetivo comum a gente limpa junto.
3. sem `status='deleting'` antes → race: militar entra na reserva entre o pre-check e o delete
   (`profiles_validate_active_reserve` passa a rejeitar entrada em reserva `status != 'ativa'`).

- [ ] **Step 1: Teste que falha** — asserts sobre `admin.ts`:
  - o handler faz `UPDATE reserves SET status = 'deleting'` (ou `'inativa'`) antes do pre-check
  - o pre-check de membros usa `.in("role", STAFF_ROLES)` (não conta `usuario`)
  - limpa `active_reserve_id` de quem está na reserva + deleta as `reserve_memberships`
    `role='usuario'` antes do `DELETE FROM reserves`
  - o `error` do `DELETE FROM reserves` é checado → 500 + `admin.reserve.delete_failure` no log
  - se o pre-check acha staff → volta o `status` pra `'ativa'` (não deixa meio-deletada) e 409

- [ ] **Step 2: Rodar — falha.**

- [ ] **Step 3: Implementar** a sequência: `status='deleting'` → pre-check staff (409 + reverte
  status se achar) → pre-check material_types (409 + reverte) → limpar `active_reserve_id` →
  `DELETE reserve_memberships WHERE reserve_id = id` → `DELETE reserves` (checa error) → 200.
  Cada passo com log no erro.
  ⚠️ confirmar no enum de `reserves.status` (dump) se `'deleting'` existe; se não, usar
  `'inativa'` + comentar. O zValidator do `PATCH /reserves/:id` só aceita `ativa|inativa` —
  não expandir aqui.

- [ ] **Step 4: Rodar — passa** + suíte BFF.

- [ ] **Step 5: Commit**

```bash
git commit -am "fix(reserva): SP2 Task 8 — DELETE reserve checa erro, bloqueia só staff, status deleting"
```

---

## Task 9: RPC `bump_reserve_preference` (incremento real)

**Files:**
- Create: `supabase/migrations/<ts>_bump_reserve_preference_rpc.sql`
- Modify: `apps/bff/src/routes/reserves.ts` (~:146)
- Test: `apps/bff/src/__tests__/reserves-switch.test.ts` (source-assertion — ajustar o
  slice/regex se o texto crescer)

**Contexto (spec §4.6 / SP1 MENOR):** o upsert em `user_reserve_preferences` grava
`selection_count: 1` fixo — nunca incrementa. O resolvedor `resolveDefaultActiveReserve`
(`lib/active-reserve.ts`) ordena por `selection_count` depois `last_selected_at`; sem incremento
degrada pra MRU puro.

- [ ] **Step 1: Migração**

```sql
-- bump_reserve_preference: upsert que INCREMENTA selection_count (o upsert do
-- BFF gravava 1 fixo — o ranking do resolvedor de reserva ativa degradava pra MRU).
-- ROLLBACK: DROP FUNCTION public.bump_reserve_preference(uuid, uuid);
CREATE OR REPLACE FUNCTION public.bump_reserve_preference(p_user_id uuid, p_reserve_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO public.user_reserve_preferences (user_id, reserve_id, selection_count, last_selected_at)
  VALUES (p_user_id, p_reserve_id, 1, now())
  ON CONFLICT (user_id, reserve_id)
  DO UPDATE SET selection_count = public.user_reserve_preferences.selection_count + 1,
                last_selected_at = now();
$$;
REVOKE EXECUTE ON FUNCTION public.bump_reserve_preference(uuid, uuid) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.bump_reserve_preference(uuid, uuid) TO service_role;
```
Confirmar no dump: nome real da tabela (`user_reserve_preferences`), colunas, unique
`(user_id, reserve_id)`.

- [ ] **Step 2: Aplicar no staging** (`vfkdycqkddgoqnujwbvl`) via psql, testar:
```sql
SELECT bump_reserve_preference('aaaa0000-0000-0000-0000-000000000004','9b83b932-5d16-422c-aeb7-512074127154');
SELECT bump_reserve_preference('aaaa0000-0000-0000-0000-000000000004','9b83b932-5d16-422c-aeb7-512074127154');
SELECT selection_count FROM user_reserve_preferences WHERE user_id='aaaa0000-0000-0000-0000-000000000004'; -- 2
```

- [ ] **Step 3: Teste que falha** — `reserves.ts` chama `.rpc("bump_reserve_preference", { p_user_id, p_reserve_id })` no lugar do `.upsert({... selection_count: 1 ...})`.

- [ ] **Step 4: Implementar** a troca no `POST /switch/:id`. Manter best-effort (`.then`/`.catch`
  → `log.warn("reserve.preference.bump_failed")`), não bloqueia o switch.

- [ ] **Step 5: Rodar — passa** + suíte BFF (ajustar o `file.slice()` do teste se necessário).

- [ ] **Step 6: Aplicar em prod** via MCP `apply_migration` (project `jepitcrkicwmvzrmllpn`),
  `git mv` o arquivo local pro timestamp do ledger.

- [ ] **Step 7: Commit**

```bash
git commit -am "feat(reserva): SP2 Task 9 — RPC bump_reserve_preference (incremento real)"
```

---

## Self-Review (executor: rode antes de fechar)

1. **Spec coverage:** §4.7 bullets — militar com membership nos 4 caminhos (T3/T4), seletor
   obrigatório (T5), multi-reserva por membership (T6), role-change corrige active (T7), delete
   reserve (T8). §6 bugs: admin de N reservas (T6), autocomplete (T6). SP1 MENOR: bump (T9).
   Auditoria (T1). **Chevron do usuario** — já entregue no SP1; T1 só confirma que `/mine`
   inclui as reservas `role='usuario'`.
2. **Fora de escopo (não fazer aqui):** qualquer policy RLS; migrar os ~20 leitores de
   membership pra coluna `active_reserve_id` (SP5); busca de matrícula lenta e campo de e-mail
   condicional (PRs independentes, §6).
3. **Ordem:** T1 primeiro (informa as outras). T2 antes de T3–T8 (helpers). T9 independente.
4. **Risco de regressão:** `reserve_memberships` ganhando linhas `role='usuario'` muda o que
   `/mine`, RLS `reserve_memberships_select` e as policies `category_requests`/
   `material_validity_alert_events` enxergam — T1 tem que dar veredito explícito em cada um
   antes de T3 mergear.
