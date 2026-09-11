# Isolamento por reserva (silo) — design v7

> Status: proposto. **6 revisões adversariais** (v1 4.5 → v4 7.5) + SP0 spike (fatos do banco)
> + clean-slate 2026-09-10 + **SP0.5 spike EXECUTADO 2026-09-10** (staging = réplica de prod,
> volume real). `[v7]` aplica os achados do SP0.5: **helpers em `(SELECT ...)` cravado**
> (InitPlan, 100× — §4.2), split de todo `FOR ALL` confirmado obrigatório (leak real medido),
> recursão OK, staging Supabase no lugar do Docker (§7). Escopo: **completo** (dono). Prazo:
> **meados/fim de dezembro** (§11). Fase 1 de 2. Autor: Claude Sonnet 5.

---

## 1. Problema

A reserva não isola dados: RLS escopa por `tenant_id`; não há "reserva ativa" no Postgres;
as telas são server components que falam direto com o Supabase; `session.reserveId` do BFF
não afeta leitura. "Trocar de reserva não faz nada." ~27 tabelas carregam dado
reserve-scoped, RLS de nenhuma usa a reserva. Cruft acumulada: 3–4 mecanismos de tenant;
`material_types` SELECT sem checagem de papel; policies duplicadas; tabelas-filho só
tenant-scoped; `tenants` e `profiles` com buracos de RLS (2 corrigidos — §2 P1/P3).

## 2. Pré-requisitos e fatos do banco (SP0 spike + verificação) `[v4]`

| # | Item | Status |
|---|---|---|
| P1 | **priv-esc via `UPDATE profiles SET role`** — `authenticated` virava `admin_global` | ✅ **em prod** (ledger `20260910032235`; branch `fix/profiles-privilege-escalation` + **PR #27**). Trigger `profiles_freeze_privileged_columns` congela `role/default_tenant_id/registration_status/account_activated_at` p/ `current_user IN ('authenticated','anon')`. **SP1 depende do merge de #27.** |
| P2 | clean-slate — 3 contas, tenant PMPB, org_unit DEC, reservas APMCB/CFAP/NUPEX, 0 de tudo | ✅ executado (`scripts/clean-slate-2026-10-launch.sql`). Backfill = trivial. |
| P3 `[v4]` | **`tenants` gravável/legível por `anon`** — `DELETE FROM tenants` sem login cascateava tudo | ✅ **em prod** — `20260910130000`, **PR #28**. `REVOKE` de escrita + trigger `tenants_block_enduser_writes` + `tenants_select_own` (só o próprio). A coluna `reserve_isolation_enabled` (R7) nasce numa tabela já endurecida. |
| F1 | Publication `supabase_realtime` = **10 tabelas** | `audit_logs, cautelamentos, lendings, material_items, material_requests, material_types, notifications, profiles, service_log_events, service_shifts` |
| F2 `[v4]` | **O app NÃO tem assinante Realtime autenticado.** `apps/web` só usa `@supabase/ssr` p/ query (server components). **`apps/bff/src/routes/realtime.ts` é o único consumidor de Realtime — assina com `SUPABASE_SERVICE_ROLE_KEY`** (bypassa RLS/walrus). | **RT-04 não se aplica** ao app. §4.2 pode usar função `STABLE SECURITY DEFINER` (o padrão que o codebase convergiu — F3). |
| F3 `[v4]` | Em ago/2026 o codebase **removeu** `EXISTS` correlacionado de `material_types`/`lendings`/`material_requests` (`20260823000000`, `20260824010000`) por **`statement_timeout` 57014** (home do armeiro travando ~9s, view vazia) e **voltou** p/ `my_tenant_id()`/`auth_role()` (STABLE, 1×/statement). As policies `FOR ALL` (`*_write`) **votam no SELECT via OR** → têm que virar INSERT/UPDATE/DELETE explícitas, senão o timeout volta. | §4.2 v3 (EXISTS correlacionado) estava **errado**. v4 usa STABLE + split das `FOR ALL`. |
| F4 | `FORCE ROW LEVEL SECURITY` **desligado** em todas as tabelas reserve-scoped | RPC `SECURITY DEFINER` (dona `postgres`) bypassa RLS → isolamento de escrita **nas RPCs** (§4.4) + `FORCE RLS` nas 3 RPC-only. |
| F5 | RPCs `SECURITY DEFINER` reserve-scoped: `record_cautelamento_batch`, `record_lending_batch` (2 overloads), `record_lending_returns` (2), `record_biometric_enrollment`, `record_biometric_proof`, `set_material_cautela_eligibility`, `check_material_validade_vencimento` (**cron, sem ator humano**). Todas com `REVOKE EXECUTE FROM anon, authenticated`. | §4.4. `check_material_validade_vencimento` precisa de branch de system-caller. |
| F6 | 7 tabelas-filho **sem** `reserve_id` (só `tenant_id`): `material_request_items`, `service_log_events` (RT), `handover_attachments`, `inventory_item_checks`, `material_items` (RT), `document_signatures`, `cautela_vencimento_alert_events` | `ADD COLUMN reserve_id` + **trigger que deriva do pai** (padrão `biometric_devices_scope_guard`), não confiar no BFF (§4.5) |
| F7 | `auth_tenant_id()` em policy = **só `material_requests.ssa_staff_update`**. Path `auth.jwt()->app_metadata` = `document_signatures`, `service_log_events`, `service_shifts`. `profiles_select` usa `my_tenant_id()`. | DROP de `auth_tenant_id()` no fim (§4.10) é seguro. `document_signatures` **entra no escopo** (§4.3). |
| F8 | `material_availability` (view): `security_invoker = true` | RLS das bases governa — ok |
| F9 | `biometric_proofs`/`biometric_challenges`/`biometric_devices`/`totp_identity_claims`: RLS ligado, **0 policies** → já deny-all p/ `authenticated`; já `reserve_id NOT NULL` | §4.3: manter deny-all + `FORCE RLS` + escopo via RPC |
| F10 | Filtros de canal em `realtime.ts` são literais `tenant_id=eq.X` — os canais staff (`arsenal-sync`, `armeiro-sync`, `livro-sync`, `efetivo-sync`, `admin-profiles-grid`) precisam de `reserve_id=eq.Y` adicionado | entregável de SP5/SP9 `[v4]` |
| F11 `[v4]` | criação de militar: `POST /api/admin/militares` (`admin.ts:54`), `POST /api/admin/users` magic_link/password (`web .../users/route.ts`), Nexus `POST /reserves/:id/members` (`nexus.ts:655`), `PATCH /api/profiles/:id` (`profiles.ts:504` — **único writer atual de `reserve_memberships`**). **`activate-account` não cria nada.** | §4.7 corrigido |
| F12 `[v4]` | `admin_global` em `roleGuard` de escrita em **~14 arquivos de rota**, dezenas de endpoints | §4.8: **não** rota-por-caso — admin_global usa o chevron |

## 3. Requisitos

| # | Requisito | Critério de aceite |
|---|---|---|
| R1 | Silo total; reserva nova nasce vazia. | `reserve_id NOT NULL` (CHECK, pós-observação) em toda tabela em escopo. Criar reserva → toda lista vazia. |
| R2 | `admin_reserva`/`armeiro`/`usuario` só enxergam a reserva ativa. | Prova de RLS: cada papel, `active=A` → `count` de dados de B nas 24 tabelas RLS = **0**. |
| R3 | `admin_global`/`auditor` = matriz por padrão; entram numa reserva pelo chevron. | matriz → A e B; filial → só a ativa. |
| R4 | Militar pode ter vínculo em várias reservas; vê só a ativa; troca. | membership A+B, `active=A` → cautela dele de A sim, B não. |
| R5 | Trocar no chevron muda todas as telas + Realtime, sem novo login. | E2E: switch → `router.refresh()` + canal SSE re-filtra por `reserve_id`. |
| R6 `[v4]` | Isolamento **estrutural**: leitura via RLS (§4.2); escrita via helper `assert_actor_in_reserve` nas RPCs (§4.4) + `FORCE RLS` nas RPC-only; `WITH CHECK` = defesa-em-profundidade. **Prova mecânica** de que nenhuma RPC reserve-scoped escapou do helper (CI, §7). | Prova de RLS + teste por overload de RPC + CI `pg_proc` scan. |
| R7 | Rollout gradual por tenant via `tenants.reserve_isolation_enabled` (flag OFF = comportamento atual, **nada abre**). | Caso de teste: flag OFF, leitor tenant A → `count` de linhas do tenant B = 0. |
| R8 `[v4]` | Toda negação **de fluxo** (switch, RPC, guard de rota) deixa rastro no BFF. **Exceção documentada e a ser aprovada pelo dono:** RLS-deny em SELECT é **silenciosa por natureza do Postgres** — mitigações: login/switch forçam `active_reserve_id` válido; BFF é o único caminho de switch; middleware re-valida membership por request e emite `reserve.active.revoked_midsession`; UI mostra "reserva vazia" com CTA, não erro. | §5. O sub-agente de code review recebe esta exceção por escrito em cada SP. |
| R9 | `superadmin` fora do data-plane (Nexus/SaaS-only). | ausente da lista de papéis §4.2; `default_tenant_id` NULL. |

Não-objetivos: import/export (Fase 2); tabelas sem escopo de reserva; multi-tenant do zero.

---

## 4. Arquitetura

### 4.1 Mecanismo "reserva ativa" `[v4]`

`profiles.active_reserve_id uuid` (nullable, `REFERENCES reserves(id) ON DELETE RESTRICT`).

**Congelamento — SP1 EDITA O CORPO do trigger `profiles_freeze_privileged_columns`** (não
`REVOKE` de coluna — o cabeçalho do #27 documenta que `REVOKE` de coluna é inócuo contra o
`GRANT` de tabela): adiciona `OR NEW.active_reserve_id IS DISTINCT FROM OLD.active_reserve_id`
à condição de RAISE. → `active_reserve_id` **imutável via PostgREST** p/ `authenticated`/`anon`
→ 100% dos switches pelo BFF (service_role), onde toda negação loga. Nenhuma RPC
`SECURITY DEFINER` escreve `active_reserve_id` (SP8 confirma no grep dos corpos).

**Trigger `profiles_validate_active_reserve`** `[v5]` (ARCH-v4 BAIXO-10 — o trigger de #27
se chama `profiles_freeze_privileged_columns`; `f` < `v` alfabeticamente → freeze dispara
primeiro, que é a ordem desejada; nenhum dos dois muta `NEW`, então na prática é
indiferente). `BEFORE UPDATE OF active_reserve_id`. `SECURITY INVOKER`:
```
IF current_user IN ('authenticated','anon') THEN
  RAISE EXCEPTION 'active_reserve_id só via BFF' USING ERRCODE='42501';
END IF;
IF NEW.active_reserve_id IS NOT NULL THEN
  IF NEW.default_tenant_id IS NULL THEN
    RAISE EXCEPTION 'sem tenant nao entra em reserva' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM reserves r
    WHERE r.id = NEW.active_reserve_id AND r.status = 'ativa' AND r.tenant_id = NEW.default_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'reserva invalida/inativa/outro tenant' USING ERRCODE='42501'; END IF;
  IF NEW.role NOT IN ('admin_global','auditor')
     AND NOT EXISTS (SELECT 1 FROM reserve_memberships m
                     WHERE m.user_id = NEW.id AND m.reserve_id = NEW.active_reserve_id) THEN
    RAISE EXCEPTION 'sem vinculo com a reserva' USING ERRCODE='42501';
  END IF;
END IF;
```
O BFF **nunca** seta `role` e `active_reserve_id` no mesmo `UPDATE` (o check de membership
usaria o papel errado numa troca).

**Funções** (STABLE, SECURITY DEFINER, `SET search_path = public, pg_temp`) `[v4]`:
- `my_active_reserve_id() → uuid` : `SELECT active_reserve_id FROM profiles WHERE id = auth.uid()`
- `my_tenant_isolation_enabled() → bool` : `SELECT reserve_isolation_enabled FROM tenants t
  JOIN profiles p ON p.default_tenant_id = t.id WHERE p.id = auth.uid()` (default `false` se NULL)
- `user_in_reserve(p_uid uuid, p_rid uuid) → bool` : `EXISTS (SELECT 1 FROM
  reserve_memberships WHERE user_id = p_uid AND reserve_id = p_rid)` — bypassa a RLS de
  `reserve_memberships` (SEC-ALTO-3: senão o armeiro não vê o efetivo)
- (`my_tenant_id()`, `auth_role()` já existem)

**Por que STABLE é seguro aqui** (F2): não há assinante Realtime autenticado; RT-04 só
atingia esses. O padrão STABLE + `SET search_path` é o que o codebase convergiu depois de
5 incidentes de timeout (F3) — avaliado 1× por statement.

### 4.2 RLS — padrão STABLE `[v4]` / `[v7 — SP0.5]`

**`[v7]` CRAVADO — toda chamada de helper sem argumento é envelopada em `(SELECT helper())`.**
O SP0.5 (2026-09-10, staging = réplica de prod, 1k `material_types` / 5k `lendings` / 2k
`cautelamentos`) provou que a premissa da v4 ("todas as chamadas são STABLE → InitPlan,
1×/statement") é **FALSA** para chamada nua: o Postgres só faz o hoist pra InitPlan quando a
chamada está dentro de um subquery escalar `(SELECT ...)`. Nua = reavaliada **por linha**:

| query (armeiro, flag ON, volume) | helper nu | `(SELECT helper())` |
|---|---|---|
| `material_types` lista (1k linhas) | 112 ms, 5525 buffers | **1.5 ms, 37 buffers** |
| `cautelamentos` lista (2k linhas) | 279 ms, 13060 buffers | **1.7 ms, 73 buffers** |
| `material_types` admin matriz | 140 ms | **1.7 ms** |

Sem o wrap, o padrão **estoura o gate p95 < 400 ms** em volume de prod (é a mesma família dos
incidentes 57014). Com o wrap, cada `my_tenant_id()`/`auth_role()`/`my_tenant_isolation_enabled()`/
`my_active_reserve_id()` vira 1 InitPlan por statement.

**SELECT — staff** (tabela com `reserve_id`):
```sql
USING (
  tenant_id = (SELECT my_tenant_id())
  AND (SELECT auth_role()) IN ('admin_global','admin_reserva','armeiro','auditor')
  AND (
    NOT (SELECT my_tenant_isolation_enabled())                       -- flag OFF: só tenant (= hoje)
    OR reserve_id = (SELECT my_active_reserve_id())                   -- filial
    OR ((SELECT my_active_reserve_id()) IS NULL
        AND (SELECT auth_role()) IN ('admin_global','auditor'))       -- matriz
  )
)
```
flag OFF → `tenant_id = (SELECT my_tenant_id())` é o único constraint (idêntico ao atual — R7).

**SELECT — dono** (`lendings`, `cautelamentos`, `material_requests`, `material_request_items`):
```sql
USING (
  ( <owner_col> = (SELECT auth.uid())
    AND (NOT (SELECT my_tenant_isolation_enabled())
         OR <t>.reserve_id IN (SELECT reserve_id FROM reserve_memberships WHERE user_id = (SELECT auth.uid()))) )
         -- [v4] SEC-MÉD-3: o militar SEMPRE vê o que é dele nas reservas dele,
         --                 mesmo que a ativa seja outra (decisão de produto)
  OR ( <bloco staff acima> )
)
```

**`profiles`** `[v4]` (SEC-ALTO-3/4 resolvido — não empurrado):
```sql
USING (
  (SELECT auth.uid()) = id
  OR (
    (SELECT auth_role()) IN ('admin_global','admin_reserva','armeiro','auditor')
    AND default_tenant_id = (SELECT my_tenant_id())
    AND (
      NOT (SELECT my_tenant_isolation_enabled())
      OR ((SELECT my_active_reserve_id()) IS NULL AND (SELECT auth_role()) IN ('admin_global','auditor'))
      OR user_in_reserve(profiles.id, (SELECT my_active_reserve_id()))  -- SECURITY DEFINER; arg = profiles.id → per-row
    )
  )
)
```
`[v7]` `user_in_reserve(profiles.id, ...)` fica **per-row** (o arg muda por linha) — SP0.5 mediu
5 ms / 414 profiles no caminho armeiro (204 passam tenant+role). Aceitável até ~5k profiles/tenant;
acima disso, reescrever como `profiles.id IN (SELECT user_id FROM reserve_memberships WHERE
reserve_id = (SELECT my_active_reserve_id()))`. O caminho matriz (`admin_global`/`auditor`)
short-circuita antes do `user_in_reserve` → 1.3 ms.
Realtime de `profiles` (canal `admin-profiles-grid` / `efetivo-sync` no BFF, service_role) —
**não afetado** (F2). SP0.5 confirma entrega pelo proxy SSE (teste de 10 min).

**WRITE** `[v4]` / `[v7]` — as policies `FOR ALL` (`materials_write`, `lendings_staff_write`, etc.)
são **DROPADAS e recriadas como INSERT/UPDATE/DELETE explícitas** (F3 — `FOR ALL` vota no
SELECT via OR e ressuscita o timeout):
```sql
-- WITH CHECK (INSERT/UPDATE) + USING (DELETE):
(SELECT auth_role()) IN (<papéis de escrita>)
AND tenant_id = (SELECT my_tenant_id())
AND (NOT (SELECT my_tenant_isolation_enabled()) OR reserve_id = (SELECT my_active_reserve_id()))
```
(defesa-em-profundidade — o app escreve via RPC, §4.4.)

`[v7]` SP0.5 **confirmou o vazamento**: com `lendings_staff_write` (`FOR ALL`, sem check de
`reserve_id`) ainda no lugar, o armeiro da reserva A via **2500 lendings da reserva B** (a policy
`FOR ALL` vota SIM no SELECT via OR). Depois de dropar + split, o leak zera. **Não é opcional** —
todo `*_staff_write`/`*_write` `FOR ALL` das 27 tabelas tem que virar INSERT/UPDATE/DELETE.

### 4.3 Enumeração do escopo — 27 tabelas (a matemática fecha)

**SCOPE-reserva, RLS §4.2, já tem `reserve_id` — 14:** `material_types, material_categories,
lendings, cautelamentos, material_requests, category_requests, service_shifts,
service_handovers, inventory_reserve_checks, material_validity_alert_events, audit_events,
biometric_devices, biometric_challenges, biometric_pairing_codes`.

**SCOPE-reserva via `ADD COLUMN reserve_id` (§4.5) — 7:** `material_items` (RT),
`material_request_items`, `service_log_events` (RT), `handover_attachments`,
`inventory_item_checks`, `document_signatures`, `cautela_vencimento_alert_events`.

**RPC-only — deny-all p/ `authenticated` + `FORCE ROW LEVEL SECURITY` + escopo via helper
§4.4 — 3:** `biometric_proofs`, `biometric_proof_consumptions`, `totp_identity_claims`.

**KEEP tenant-wide — 3:** `profiles` (multi-reserva → §4.2-profiles), `tenant_memberships`,
`user_reserve_preferences` (`user_id = auth.uid()`).

### 4.4 Escrita — helper único nas RPCs `[v4]` (ARCH-CRÍT-C, SEC-ALTO-5, MÉD-7)

```sql
CREATE FUNCTION assert_actor_in_reserve(p_actor_id uuid, p_reserve_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tenant uuid; v_status text; v_role role_enum; v_actor_tenant uuid; v_active uuid; v_flag bool;
BEGIN
  IF p_actor_id IS NULL AND current_user = 'postgres' THEN RETURN; END IF;   -- system/cron caller
  SELECT tenant_id, status INTO v_tenant, v_status FROM reserves WHERE id = p_reserve_id;
  IF v_tenant IS NULL OR v_status <> 'ativa' THEN
    RAISE EXCEPTION 'reserva % inexistente/inativa', p_reserve_id USING ERRCODE='42501'; END IF;
  SELECT role, default_tenant_id, active_reserve_id INTO v_role, v_actor_tenant, v_active
    FROM profiles WHERE id = p_actor_id;
  IF v_actor_tenant IS DISTINCT FROM v_tenant THEN
    RAISE EXCEPTION 'ator de outro tenant' USING ERRCODE='42501'; END IF;
  SELECT reserve_isolation_enabled INTO v_flag FROM tenants WHERE id = v_tenant;
  IF NOT v_flag THEN RETURN; END IF;
  IF v_active = p_reserve_id THEN RETURN; END IF;
  IF v_role IN ('admin_global','auditor') THEN
    -- [v4] SEC-ALTO-5: mesmo admin_global tem que ter "entrado" na reserva OU
    --      passar por auditoria explícita — aqui exigimos a reserva ativa.
    RAISE EXCEPTION 'admin_global precisa entrar na reserva (chevron) para escrever' USING ERRCODE='42501';
  END IF;
  RAISE EXCEPTION 'ator % nao autorizado na reserva %', p_actor_id, p_reserve_id USING ERRCODE='42501';
END $$;
```
Variante `assert_device_in_reserve(p_device_id, p_reserve_id)` p/ o biometric-bridge
(ator = device, valida contra `biometric_devices.reserve_id`).

Cada RPC de F5 chama `assert_actor_in_reserve(p_actor_id, p_reserve_id)` no topo.
`check_material_validade_vencimento` (cron) → `p_actor_id` NULL + `current_user='postgres'`
→ `RETURN` (já roda scoped pelo cron).

**Recurso do payload pertence à reserva declarada `[v6]` (SEC-v5 Q1):** o helper
`assert_actor_in_reserve` só prova "ator autorizado na reserva X". Cada RPC **também** valida
que **todo FK de recurso no payload** (`p_material_type_id`, `p_militar_id`,
`p_material_item_id`, `p_cautelamento_id`, …) resolve para uma linha com `reserve_id =
p_reserve_id` (ou, p/ `profiles`, `EXISTS reserve_memberships(militar, p_reserve_id)`). Sem
isso, um cliente stale-mas-válido passa o check de ator com `p_reserve_id = <sua reserva A>`
mas referencia um material da reserva B → cautela em A apontando material de B. A RPC roda
como `postgres` (bypassa RLS), então esse cross-check é **obrigatório no corpo** — padrão
`assert_biometric_bridge_scope` (que já faz cross-check de challenge↔reserva). Helper
auxiliar `assert_resource_in_reserve(p_table regclass, p_id uuid, p_reserve_id uuid)`.

**Proveniência de `p_reserve_id` — CRAVADO `[v5]` (ARCH-v4 ALTO-1):** `p_reserve_id` é
**sempre o valor asseverado pelo cliente** — o `reserve_id` que estava no contexto de
render da página que originou a escrita — propagado no **payload validado** (campo
`rendered_reserve_id uuid`, `.strict()` no zValidator) **e** repetido no header
`X-Rendered-Reserve`. **Nunca** re-derivado de `active_reserve_id` no BFF. Fluxo:
1. BFF handler lê `rendered_reserve_id` (cliente) **e** `SELECT active_reserve_id` (banco).
   Divergem → **409 `reserve_context_stale`** + evento `reserve.write.stale_context`, antes
   de chamar a RPC. UI: "sua reserva mudou noutra aba — recarregue".
2. BFF chama a RPC com `p_reserve_id = rendered_reserve_id` (o do cliente).
3. Helper `assert_actor_in_reserve`: `v_active` (banco) `≠ p_reserve_id` (cliente stale) →
   **42501** (backstop — se o check do passo 1 for burlado/esquecido).
Assim o check do helper **tem dentes**: compara valor externo (cliente) com verdade do
banco. O `IF v_active = p_reserve_id THEN RETURN` só é atalho legítimo quando o cliente
renderizou a reserva certa.
Teste obrigatório: "cliente renderiza reserva A → `active_reserve_id` vira B noutra aba →
escrita com `rendered_reserve_id=A` → **409** (ou 42501 se pular o passo 1); a linha NÃO
cai em B".

**Auditoria dos corpos** `[v4]` (SEC-ALTO-3): SP8 confere que nenhuma RPC faz
`UPDATE profiles SET` fora de `registration_status`.

### 4.5 Desnormalização `reserve_id` nas 7 filhas + 1 trigger dispatcher `[v5]` (SEC-MÉD-1, ARCH-v4 MÉD-3/4/5)

`ADD COLUMN reserve_id uuid REFERENCES reserves(id)`.

**Decisão: DERIVE, não ASSERT.** O precedente do repo (`assert_biometric_bridge_scope`,
`20260714000001`) **valida e levanta exceção** no mismatch — não deriva. Aqui vamos além:
**1 função dispatcher `derive_child_reserve_id()`** (`CASE TG_TABLE_NAME`) + 7 triggers
finos `BEFORE INSERT OR UPDATE`. A função faz `NEW.reserve_id := (SELECT reserve_id FROM
<pai> WHERE id = NEW.<fk>)` — **sobrescreve** o que o caller mandou; o BFF nem passa
`reserve_id`. Um lugar só para auditar (segue o padrão-dispatcher do
`assert_biometric_bridge_scope`, sem confiar no caller).

| filha | pai | coluna de ref (nomes reais — SP0 confirmou) |
|---|---|---|
| `material_request_items` | `material_requests` | `request_id` |
| `service_log_events` | `service_shifts` | `shift_id` |
| `handover_attachments` | `service_handovers` | `handover_id` |
| `inventory_item_checks` | `inventory_reserve_checks` | `reserve_check_id` |
| `material_items` | `material_types` | `material_type_id` (obs: `material_items` já tem `current_unit_id → reserves` — no modelo silo os dois coincidem; derivar de `material_type_id`) |
| `cautela_vencimento_alert_events` | `cautelamentos` | **`cautela_id`** (não `cautelamento_id`) |

**`document_signatures` (polimórfico) `[v6]`:** o discriminador é **`document_type` (text) +
`document_id` (uuid)** — não colunas `lending_id`/`cautelamento_id`. O dispatcher faz
`CASE NEW.document_type WHEN 'lending' THEN SELECT reserve_id FROM lendings WHERE id =
NEW.document_id WHEN 'cautelamento' THEN ... END`. SP4 enumera os valores reais de
`document_type` (grep + `SELECT DISTINCT`) e trata cada um; valor desconhecido → `RAISE`.

**`[v6]` Nenhuma das 7 filhas tem FK para o pai hoje** (SP0: `pg_constraint` vazio) — acoplamento
só a nível de app. Consequências: (a) o dispatcher pode receber `NEW.<ref>` apontando p/ id
inexistente → `SELECT ... WHERE id = NEW.<ref>` retorna NULL → `RAISE` (não deixa `reserve_id`
NULL); (b) SP4 **adiciona a FK `... REFERENCES <pai>(id)`** onde não quebrar dado (tabelas
vazias — trivial), fechando a lacuna de integridade na origem.

**`[v6]` Perf do dispatcher em bulk insert:** `material_request_items` insere N linhas por
solicitação → N `SELECT reserve_id FROM material_requests`. Aceitável (lookup por PK,
`request_id` é o mesmo p/ todas as linhas do batch — o planner cacheia). Se o EXPLAIN do
SP0.5 mostrar custo → trigger `STATEMENT`-level em vez de `ROW`, ou o BFF passa `reserve_id`
e o trigger só **valida** (volta pro padrão assert). Decisão no SP4 com número na mão.

`CHECK (reserve_id IS NOT NULL) NOT VALID` no SP4 (pega INSERT novo sem bloquear backfill);
`VALIDATE` + `SET NOT NULL` numa migração posterior, **gateada** por `SELECT count(*) WHERE
reserve_id IS NULL = 0`. Índice `(reserve_id)`.

**Entregável SP4** `[v4]` (SEC/ARCH-MÉD-2): lista **grep-provada** de todo `INSERT INTO
<7 tabelas>` / `.from(t).insert(` em `apps/bff` + `apps/web` + **corpos de RPC** + **jobs
`pg_cron`**; + monitoração `SELECT count(*) ... WHERE reserve_id IS NULL` alarmada em `>0`.

### 4.6 Fluxo de reserva ativa

**Login/exchange** (`routes/auth.ts`, service_role): resolve `active_reserve_id` —
`admin_global`/`auditor` → salvo ou NULL; outros → salvo se válido, senão
`user_reserve_preferences` / `reserve_memberships` mais antiga; **0 memberships** → NULL +
`reserve.active.none_for_staff {userId}` + UI "peça a um admin".

**Chevron** `POST /api/reserves/switch/:id` `[v4]`: `roleGuard` **inclui `usuario`**; valida
tenant + (não-admin_global) membership; `UPDATE profiles SET active_reserve_id` (service_role,
passa pelo `profiles_10_validate` como belt); bump `user_reserve_preferences`;
`session.reserveId`; `revalidatePath('/', 'layout')`. 200 → client `router.refresh()` +
SSE re-subscribe. Negação → `reserve.switch.denied {reason}`.

**Matriz** `POST /api/reserves/switch/matriz` — só `admin_global`/`auditor`.

**`middleware/auth.ts`** `[v4]` — **os 3 caminhos** (iron-session ~:58; Bearer ~:150 —
biometric-bridge, escreve cautelas; e o resolve de tenant/reserve): leem
`profiles.active_reserve_id` como fonte única, com o mesmo tratamento `none_for_staff`.
**Re-valida membership de `active_reserve_id` por request** (SEC/ARCH-MÉD-6) — mismatch (staff
removido da reserva mid-sessão) → `reserve.active.revoked_midsession` + força matriz/NULL +
mensagem clara. `layout.tsx` idem (fonte única).

### 4.7 Modelo militar ↔ reserva `[v4]` (F11 — inventário corrigido)

`reserve_memberships.role` aceita `'usuario'`. **Auditar TODOS os leitores de
`reserve_memberships`** (entregável SP2 — a premissa "linha ⇒ staff" regride): lista =
`middleware/auth.ts:150`, `routes/reserves.ts` (`/mine`, `switch`), `auth_admin_reserve_ids()`
(ok, filtra `admin_reserva`), tela de estrutura (elegibilidade), RLS
`reserve_memberships_select`, policies `category_requests`/`material_validity_alert_events`.

- Militar criado **já com** `reserve_memberships(user_id, reserve_id, 'usuario')` — nos **4**
  caminhos de F11. Reserva = `active_reserve_id` do criador; **se o criador é `admin_global`
  em matriz (NULL) → seletor de reserva OBRIGATÓRIO no form** (`/militares`, `/admin/users`).
- Multi-reserva: tela de estrutura (controle "vincular a outra reserva").
- `usuario` ganha o chevron (só as reservas dele).
- Deletar reserva: `UPDATE reserves SET status='deleting'` primeiro (o
  `profiles_10_validate` passa a rejeitar entrada nova → fecha a race MÉD-K), depois limpa
  `active_reserve_id` de quem está nela, depois bloqueia se houver membership **de staff**
  (não de `usuario`), depois DELETE.
- Role-change no BFF (`PATCH /api/profiles/:id`): se o novo papel torna o `active_reserve_id`
  inválido → nula/corrige no mesmo fluxo (SP2 + teste).

### 4.8 Escrita do `admin_global` — sem rota genérica `[v4]` (F12, ARCH-ALTO-F)

`admin_global` tem escrita em ~14 arquivos de rota / dezenas de endpoints — rota-por-caso
ou `withTargetReserve` em todos = inviável. **Decisão:** `admin_global` que quer escrever
numa reserva **entra nela pelo chevron** (§4.6, 1 clique). O `assert_actor_in_reserve`
(§4.4) exige `active_reserve_id = p_reserve_id` inclusive p/ `admin_global` (SEC-ALTO-5).
Escrita cross-reserve genuína só no **provisionamento** (criar reserva/usuário) — que já
carrega `reserve_id` explícito no payload validado server-side, e o BFF já faz auto-switch
do criador ao **criar uma reserva**.

### 4.9 Consistência de sessão

`ON DELETE RESTRICT` em `active_reserve_id` + fluxo de deleção §4.7. Multi-aba: aceito — a
proteção real contra "escrita na reserva errada" é `assert_actor_in_reserve` (§4.4), que
compara com o banco, não com o cliente. Header mostra a reserva ativa em destaque. Next
cache: `revalidatePath` no switch + `router.refresh()`. Realtime: SSE re-subscribe + os
canais staff em `realtime.ts` ganham filtro `reserve_id=eq.Y` (F10 — SP5/SP9). Alternativas
(claim JWT / tabela dedicada) descartadas — claim exige refresh de token que o app não
controla.

### 4.10 Consolidação `auth_tenant_id()` (F7)

DROP no **SP9** (depois dos grupos), com `SELECT` prévio confirmando 0 consumidores
(hoje: 1, `material_requests.ssa_staff_update`, reescrita no SP6). Path
`auth.jwt()->app_metadata` (`document_signatures`, `service_log_events`, `service_shifts`)
→ substituído pelo padrão §4.2 no grupo de cada tabela. `profiles_select` (usa
`my_tenant_id()`) **não é afetado**.

### 4.11 `superadmin` (R9)

Fora do data-plane. `default_tenant_id` NULL → o `tenant_id = my_tenant_id()` de §4.2 é
sempre falso → não lê dado de negócio. Consistente com `20260711000004`. Documentado.

---

## 5. Observabilidade (R8)

`audit_events` (durável) + `logger` BFF com `requestId`: `reserve.switch.ok`/`.denied
{reason}`, `reserve.matriz.entered`/`left`, `reserve.active.none_for_staff {userId}`,
`reserve.active.revoked_midsession {userId, reserve_id}`, `reserve.rpc.denied {rpc, actor,
reserve_id}`, `reserve.write_provisioning {reserve_id, tables, ids}`.
**Exceção R8 (a ser aprovada pelo dono, por escrito, entregue ao code-review de cada SP):**
RLS-deny em SELECT é silenciosa (natureza do Postgres). Mitigações listadas em R8. O
`RAISE` do trigger aborta a transação (nenhum audit sobrevive) — por isso `active_reserve_id`
é congelado p/ `authenticated` e todo switch vem pelo BFF, que loga.

---

## 6. Bugs correlatos

| Bug | Classe |
|---|---|
| Chevron "não faz nada" | raiz do épico (§4.6) |
| Admin de N reservas some da busca (elegibilidade por `profiles.role`) | pré-requisito SP2 |
| Autocomplete "promover a armeiro" lista holders | pré-requisito leve SP2 |
| Busca de matrícula lenta | PR independente (índice `20260910000000` — confirmar `matricula`) |
| Campo de e-mail no cadastro condicional | PR independente (puro UI) |

---

## 7. Harness / validação (portão ≥ 9.5)

**SP0.25 — infra local** `[v4]` / `[v7]`: Docker Desktop **não liga no PC do dono** (falta
virtualização no BIOS). Solução adotada: **projeto Supabase `andromeda-staging`
(`vfkdycqkddgoqnujwbvl`)** — réplica de prod via `pg_dump --schema-only --schema=public` +
`--data-only` (replay das migrações não funciona: drift). Binários PostgreSQL 17 standalone
(`C:\pgsql\pgsql\bin`) rodam `psql`/`pg_dump` sem Docker. `seed-volume.mjs` virou
`scratchpad/seed-volume.sql` (`generate_series`, `session_replication_role=replica`).
Detalhes de conexão em memória `acesso-vps-supabase`. **Iterar RLS em prod segue proibido** —
staging é o ambiente.

**SP0.5 — spike** `[v7 — EXECUTADO 2026-09-10, staging]`:
1. **Recursão — PASSA.** §4.2-profiles, `SELECT` por papel, `statement_timeout=2s` → não
   estoura. `user_in_reserve` SECURITY DEFINER + helpers em `(SELECT ...)` não recursam.
   armeiro A vê 204 profiles (self + membros reserva A); admin_global/auditor matriz veem todos.
2. **Realtime pelo SSE — PENDENTE (manual).** Precisa do BFF apontado pro staging; é teste de
   10 min, **não gate**. Fica como verificação manual no SP5 (o proxy usa `service_role` que
   bypassa RLS, risco baixo).
3. **EXPLAIN — PASSA com correção CRAVADA (§4.2 `[v7]`).** Helper nu = per-row = 112–279 ms /
   1–2k linhas (estoura o gate em volume de prod). Helper em `(SELECT helper())` = InitPlan
   1×/statement = **1.5–1.7 ms**. Todas as policies têm que envelopar. Índice
   `(reserve_id, <ordenação>)` ajuda o caminho staff scoped.
4. **Isolamento — PASSA, e achou 1 leak previsto.** flag ON, armeiro A scoped: `material_types`
   B = 0, `cautelamentos` B = 0. **`lendings` B = 2500** enquanto `lendings_staff_write`
   (`FOR ALL`) existia → zerou após drop+split. Confirma que o split de TODO `FOR ALL` é
   obrigatório (§4.2 `[v7]`).
5. **Concorrência (`assert_actor_in_reserve`) — SEGURO POR CONSTRUÇÃO, teste real no SP5.** A
   função não existe ainda; o design §4.4 é imune a race porque a RPC opera sobre o
   `p_reserve_id` que recebeu (do BFF) e só checa membership + cross-check de recurso — **nunca
   relê `my_active_reserve_id()` no corpo**. Um switch concorrente não muda `p_reserve_id`. O
   teste 2-switches-1-RPC entra no harness do SP5 quando as RPCs existirem.

**Prova de RLS** (`supabase/tests/reserve_isolation.sql`, CI): tenant T, reservas A/B, 1
conta/papel. Casos:
- cada papel scoped, `active=A` → `count` de dados de B nas 24 tabelas = **0**
- `admin_global` matriz → A e B; filial A → só A
- militar membership A+B, `active=A` → cautela dele de A sim, B não
- `[v4]` **dono com `active` NULL** → vê as próprias cautelas nas reservas dele (§4.2-dono)
- `[v4]` **dono com cautela em reserva ≠ ativa** → vê (decisão de produto §4.2-dono)
- `usuario` → **0** em `service_shifts`/`service_log_events`/`inventory_*`/`biometric_*`
- `active` NULL p/ `armeiro` → **0** em tudo (fail-closed)
- **flag OFF, leitor tenant A → `count` de linhas do tenant B = 0** nas 24 (R7)
- `[v4]` **membership revogada mid-sessão** → middleware força matriz + evento
- `[v4]` `PATCH tenants SET reserve_isolation_enabled` por `authenticated` → **negado** (#28)
- `[v4]` flip da flag nos **dois sentidos** — instantâneo, sem migração
- adversarial: `PATCH profiles SET role/default_tenant_id/active_reserve_id` → 42501

**Por RPC** (`apps/bff/src/__tests__/rpc-reserve-guard.test.ts`): **cada overload** das RPCs
de F5 com `p_reserve_id` de reserva não-autorizada → `RAISE`; variante device; branch cron.

**CI gates** `[v4]` / `[v5]`:
- hash de `cmd|roles|permissive|qual|with_check` por policy (não só o nome); `relrowsecurity
  = true` nas 24; **roda contra prod no smoke pós-deploy** (prod tem drift — migrações via MCP)
- `role_routine_grants` **allowlist explícita** `[v5]`: a allowlist lista **por nome** cada
  função `SECURITY DEFINER` em `public` que PODE ter `EXECUTE` p/ `authenticated`
  (`auth_role`, `my_tenant_id`, `my_active_reserve_id`, `my_tenant_isolation_enabled`,
  `user_in_reserve`, `has_totp`, …). **Toda outra** função `SECURITY DEFINER` (as RPCs
  `record_*`, os helpers `assert_*`) → `EXECUTE` **tem que estar revogado** de
  `anon`/`authenticated`. O gate falha se aparecer `EXECUTE` fora da allowlist. (Projeto
  mordido 3× por `CREATE OR REPLACE` re-concedendo — `20260714000007/008`, `20260829060000`.)
- `pg_proc` scan: toda função `SECURITY DEFINER` com arg `p_reserve_id` **referencia**
  `assert_actor_in_reserve`/`assert_device_in_reserve` no corpo
- `count(*) WHERE reserve_id IS NULL` = 0 nas 7 filhas — bloqueia a migração `NOT NULL`
- `[v5]` **invariante Realtime**: grep no CI — **zero** ocorrência de `.channel(` +
  `postgres_changes` em `apps/web/src`. A segurança de usar STABLE na §4.2 depende de não
  haver assinante Realtime autenticado (F2); hoje é fato circunstancial, o gate o trava.

**Realtime** (`realtime-suite.spec.ts` estendido): entrega pós-policy + filtro `reserve_id`
nos canais staff.

**E2E — inventário 1ª passada** (definitivo = SP10): dos 83 specs —
- **reescrever reserva-scoped:** `admin-arsenal`, `crud-arsenal`, `admin-saidas`,
  `crud-saidas`, `armeiro-saidas`, `cautelamentos`, `cautelamentos-batch`, `cautelas-ui`,
  `efetivo-cautelas`, `admin-inventario`, `inventory`, `painel-materiais`, `fluxo-ssa`,
  `fluxo-receber`, `desarmamento-receber`, `armeiro-flow`, `handovers`, `livro-digital`,
  `category-requests`, `cautela-eligibility`, `avu-alertas-vencimento`, `item-integrity`,
  `journey-validation`, `realtime-suite`, `navigation-perf-isolation` (~25)
- **ajuste de fixture (reserva ativa):** `admin-usuarios`, `crud-usuarios*`, `admin-estrutura`,
  `admin-dec-estrutura`, `rbac`, `multitenant`, `historico-usuario`, `audit-events`,
  `arsenal-manutencao` (~10)
- **provável neutro:** `auth-*`, `login-*`, `invite-*`, `onboarding`, `acesso-militar`,
  `nexus*`, `branding`, `pwa-manifest`, `mobile-nav`, `rate-limit`, `biometric-*`,
  `notifications-enhanced`, `profile-photo-network` (~45)

**Revisão:** `spec-to-code-compliance` (R1–R9); `differential-review` do diff RLS+RPC;
sub-agente code review (CLAUDE.md, **com a exceção R8 por escrito**); `insecure-defaults`;
`static-analysis` semgrep no diff; re-rodar 2 revisões adversariais (esperado ≥ 9).

**Rollback** (C4): cada migração com `down` executável **testado** (Docker local: aplica →
prova → reverte → prova estado exato). Runbook: gatilhos (`p95 lista > 1s`, `prova RLS falha
no smoke prod`, `429 no switch > 5%`, `reserve_id NULL > 0 em filha`, `evento realtime não
entregue`), dono da decisão, **flip da flag de volta = instantâneo (sem migração)**.

**Snapshot:** `pg_policies` (corpo) + `pg_publication_tables` + `relrowsecurity/forcerowsecurity`
+ `role_routine_grants` → arquivo versionado, antes do SP1.

---

## 8. Decomposição

| # | Sub-plano | RLS? | Nota |
|---|---|---|---|
| **SP0.25** | Infra: Docker local + `seed-volume.mjs` | não | blocker se não houver Docker |
| **SP0.5** | Spike: recursão profiles, Realtime pelo SSE real, EXPLAIN STABLE em volume, concorrência do helper | não | gate antes de SP5 |
| **SP1** | `active_reserve_id` (col + **edita corpo do freeze** + `profiles_validate_active_reserve`) + `tenants.reserve_isolation_enabled` (default **false**, `NOT NULL`) + funções STABLE + BFF `switch`/`switch/matriz` + `middleware/auth.ts` (3 caminhos + re-valida membership) + `layout.tsx` + sidebar (chevron p/ usuario + matriz) + login default + **`[v5]` backfill das 3 contas** (superadmin → NULL; admin@apmcb.dev + devdiegopro → NULL/matriz; se algum precisar testar filial, criar `reserve_memberships` explícito) + **`[v5]` validar o fluxo do chevron do admin_global com o dono** (chevron já funciona aqui — medir a fricção antes de comprometer SP5-9) | **não** | **depende do merge de #27**; testar que mudança de papel na estrutura ainda funciona |
| **SP2** | Auditoria completa dos leitores de `reserve_memberships`; elegibilidade de admin por membership; autocomplete de candidatos; militar criado já com membership nos **4** caminhos + seletor obrigatório quando criador sem reserva; role-change corrige `active_reserve_id` | não | |
| **SP3** | Inventário fechado de `pg_policies` (corpo+hash) + CI gates (hash, `relrowsecurity`, `role_routine_grants` allowlist, roda em prod no smoke) | não | |
| **SP4** | `reserve_id` nas 7 filhas (ADD COLUMN + **trigger deriva do pai** + `CHECK NOT VALID` + índice) + lista grep-provada dos pontos de INSERT + monitoração de NULL | não (schema) | |
| **SP5** | RLS **grupo A** (materiais): `material_types`, `material_categories`, `material_items` + **split das `FOR ALL`** + `material_availability` (verificar) + filtro `reserve_id` nos canais `arsenal-sync` | **sim** | smoke em prod entre grupos |
| **SP6** | RLS **grupo B** (movimento): `lendings`, `cautelamentos`, `material_requests`, `material_request_items`, `category_requests`, `document_signatures`, `cautela_vencimento_alert_events` + split `FOR ALL` + `ssa_staff_update` (tira `auth_tenant_id()`) | **sim** | |
| **SP7** | RLS **grupo C** (serviço/inventário/auditoria/biometria): `service_shifts`, `service_log_events`, `service_handovers`, `handover_attachments`, `inventory_reserve_checks`, `inventory_item_checks`, `material_validity_alert_events`, `audit_events`, `biometric_devices`/`_challenges`/`_pairing_codes` + `FORCE RLS` nas 3 RPC-only | **sim** | |
| **SP8** | `assert_actor_in_reserve` + `assert_device_in_reserve` + branch cron; **cada overload** das RPCs de F5 chama o helper; auditoria dos corpos (nenhum `UPDATE profiles` indevido); cliente re-busca `active_reserve_id`; testes por overload | não (RPC) | o isolamento de escrita |
| **SP9** | RLS `profiles` (§4.2-profiles) + `user_in_reserve()` + camada de query `.eq` + estado vazio + `revalidatePath` + `reserve_id` nos canais `efetivo-sync`/`admin-profiles-grid` + `DROP FUNCTION auth_tenant_id()` | **sim** | o mais delicado |
| **SP9.5** `[v5]` | **Canário em prod** (ARCH-v4 MÉD-6): tenant descartável `__ISO_CANARY__` + 2 reservas + linhas-canário em cada tabela; `reserve_isolation_enabled=true` **só nesse tenant**; roda a prova de RLS §7 contra a **infra real** (Realtime real via SSE, PostgREST real). Desacopla "risco do isolamento ligado" de "PMPB go-live". Deletar o tenant canário ao fim. | — | isolamento exercido em prod **antes** do PMPB |
| **SP10** | Ligar a flag no PMPB + inventário E2E definitivo + Playwright + re-review adversarial 2× + 48h de observação (dono nomeado) | — | go-live |
| **SP11** | Migração `NOT NULL` + `VALIDATE CHECK` das 7 filhas (pós-observação) | schema | |

---

## 9. Componentes tocados

**Migrações:** `..._reserve_active_mechanism.sql` (SP1), `..._reserve_isolation_flag.sql`
(SP1), `..._child_reserve_id.sql` + **1 função `derive_child_reserve_id()` dispatcher + 7
triggers finos** `[v5]` (SP4), `..._reserve_rls_group_a/b/c.sql` (SP5-7),
`..._rpc_reserve_guards.sql` (SP8), `..._profiles_reserve_rls.sql` +
`..._drop_auth_tenant_id.sql` (SP9), `..._child_reserve_id_notnull.sql` (SP11). Idempotentes,
transação declarada, re-entrantes.

**BFF:** `routes/reserves.ts`, `routes/auth.ts`, `middleware/auth.ts` (3 caminhos),
`routes/realtime.ts` (filtros `reserve_id`), rotas de INSERT das filhas (só se o trigger não
cobrir), rota criar-militar (membership + seletor), rota deletar-reserva, as 8 RPCs +
helpers.

**Web:** `sidebar.tsx`, `layout.tsx`, server components de lista (`.eq` + estado vazio),
`admin/estrutura/**` (elegibilidade + multi-reserva + seletor de reserva no cadastro),
`search-profiles/route.ts` (candidatos), cliente das telas de escrita (re-busca).

**Testes:** `supabase/tests/reserve_isolation.sql`, `apps/bff/src/__tests__/
{reserves-switch,rpc-reserve-guard}.test.ts`, `apps/web/e2e/reserve-isolation.spec.ts`,
`realtime-suite.spec.ts` estendido, `scripts/seed-volume.mjs`, inventário + ajuste de ~35 E2E.

---

## 10. Riscos

| Risco | Mitigação |
|---|---|
| §4.2 STABLE estoura timeout (F3) | é o padrão que o codebase convergiu; **split das `FOR ALL`** (F3); `EXPLAIN` em volume no SP0.5 antes de qualquer grupo |
| Timeout nas filhas | `reserve_id` local + trigger (SP4), zero `EXISTS` no pai |
| Recursão `profiles` | ramo `auth.uid()=id` short-circuita; `user_in_reserve` SECURITY DEFINER; SP0.5 com `statement_timeout` curto |
| flag-off abre cross-tenant | §4.2: `tenant_id = my_tenant_id()` sempre; caso de teste obrigatório |
| RPC sem guard / EXECUTE re-concedido | helper único + CI `pg_proc` scan + `role_routine_grants` allowlist |
| `reserve_id` NULL em filha some da tela no flip | `CHECK NOT VALID` (SP4) + gate `count NULL = 0` pré-flip (SP10) + gatilho de rollback |
| `usuario` em `reserve_memberships` regride "membership ⇒ staff" | SP2: auditoria completa dos leitores, entregável |
| Iterar RLS em prod | só pré-launch; pós-PMPB → Docker obrigatório (SP0.25) |
| ~35 E2E quebram | flag `false` mantém tudo até SP10; inventário 1ª passada no §7, definitivo SP10 |
| #27 não mergeado | SP1 declara como pré-condição de merge |
| Cronograma > outubro | aceito (§11); caminho de corte documentado se estourar novembro |

---

## 11. Cronograma `[v5]` (recalibrado — a revisão v4 mostrou que novembro era otimista)

- SP0.25 + SP0.5 + SP1–SP4: ~3-4 semanas
- SP5–SP9: 5 migrações RLS/RPC, smoke em prod entre cada + observação: ~5-6 semanas
- **Reescrita de E2E como item de 1ª classe** (fixtures com 2 reservas, seed por reserva,
  switch no meio do teste): **~2-3 semanas próprias** (não é 1 linha numa tabela)
- SP9.5 (canário) + SP10 + re-review adversarial 2× (**premissa: pelo menos 1 devolve
  trabalho** — o histórico v1→v5 confirma) + `spec-to-code-compliance` + `differential-review`
  + code-review CLAUDE.md por SP: ~2-3 semanas

**Total realista: ~14-16 semanas → meados/fim de dezembro.** O "aceito novembro" foi sobre um
número otimista; o realista é dezembro.

**Caminho de corte** (se dezembro também apertar): SP1 (chevron funciona) + SP2 + SP4 + SP8
(guards de RPC — impede "arma na reserva errada") + **as partes `role_routine_grants` +
`pg_proc` scan de SP3** (ARCH-v4 ALTO-2 — não mandar SP8 sem o gate que prova que os guards
estão todos lá) + SP6 (RLS só no grupo de movimento, atrás da flag, PMPB). Adia SP5/SP7/SP9
pós-launch. ~1/3 da superfície, com isolamento de escrita real + leitura nos dados de maior
risco. Documentado aqui para não re-decidir sob pressão.
