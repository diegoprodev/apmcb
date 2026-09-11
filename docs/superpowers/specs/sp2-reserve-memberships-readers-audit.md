# SP2 Task 1 — Auditoria dos leitores de `reserve_memberships`

**Contexto:** o SP2 (Task 3/4) passa a inserir linhas `reserve_memberships(user_id, reserve_id,
role='usuario')` para todo militar comum. Até agora só existiam linhas de **staff** (`armeiro`,
`admin_reserva`, `auditor_reserva`), então muito código assume implicitamente **"tem linha ⇒ é
staff"**. Esta auditoria classifica cada leitor.

**Definição:** *staff de uma reserva* = `reserve_memberships` com
`role IN ('armeiro','admin_reserva','auditor_reserva')`. `'usuario'` **não** é staff.

**Flag `reserve_isolation_enabled` = false** durante todo o SP2 — nenhum vazamento de RLS está
em jogo aqui; o risco é **escalonamento funcional** (um `usuario` sendo tratado como staff por um
caminho de código) e **UI errada** (pré-marcar reservas onde a pessoa é só efetivo).

Levantamento: `grep -rn "reserve_memberships" apps/bff/src apps/web/src` (67 hits, ~40
não-teste, ~22 arquivos).

## Padrão dominante — SEGURO

A maioria dos leitores no BFF roda **depois** de um `roleGuard(...)` que já barra `usuario`, e a
query de membership é um check pontual **"o user X pertence à reserva Y?"**
(`.eq("user_id",X).eq("reserve_id",Y).maybeSingle()`), não **"X é staff?"**. Uma linha
`role='usuario'` é inócua nesses: o `usuario` nunca chega ao handler.

| arquivo:linha | o que faz | assume "linha⇒staff"? | veredito |
|---|---|---|---|
| `bff/routes/shifts.ts:75` | caller pertence à reserva do body | não (roleGuard `armeiro`) | SEGURO |
| `bff/routes/handovers.ts:95` | caller (saído) pertence à reserva | não (roleGuard `armeiro`/`admin_reserva`/`admin_global`) | SEGURO |
| `bff/routes/biometric.ts:140` | caller pertence à reserva | não (checa `role IN admin_reserva,armeiro` antes) | SEGURO |
| `bff/routes/biometric-simulator.ts:72` | idem simulador | não | SEGURO |
| `bff/routes/lendings.ts:66` | `assertReserveAccess` do ator | não (roleGuard + `role==='admin_global'` early-return) | SEGURO |
| `bff/routes/arsenal.ts:75` (`requestBelongsToScope`, ramo não-admin_global) | membership do requester na reserva | não | SEGURO |
| `bff/routes/categories.ts:270` | membros `role='admin_reserva'` da reserva | **filtra `role`** | SEGURO |
| `bff/routes/handovers.ts` / `shifts.ts` / `ssa.ts:291` demais checks pontuais | "pertence à reserva Y" | não | SEGURO |
| `web (dashboard)/admin/usuarios/page.tsx:48` | coluna "reserva de cada usuário" no filtro | não — mostrar a reserva do efetivo é **mais correto** | SEGURO (melhora) |
| `web (dashboard)/reserva/page.tsx:66`, `saidas/page.tsx:47`, `passagens/page.tsx:23`, `biometria/page.tsx:28`, `layout.tsx:231` | resolvem a reserva pra exibição | não (flag OFF; display) | SEGURO — migrar p/ `active_reserve_id` no **SP5** |

## SEGURO e DESEJADO (o `usuario` agora resolve reserva de propósito)

| arquivo:linha | o que faz | veredito |
|---|---|---|
| `bff/routes/profiles.ts:827` `GET /me/reserves` | reservas do próprio caller (sem filtro de role) | **DESEJADO** — alimenta o chevron; `usuario` ganha as reservas dele (§4.7). SEGURO |
| `bff/routes/reserves.ts:35` `/mine`, `:121` `/switch` | lista/valida as reservas do caller | **DESEJADO** — `usuario` troca entre as reservas dele (roleGuard do `/switch` já inclui `usuario` desde o SP1). SEGURO — confirmar em Task-audit que `/switch/:id` valida membership de qualquer role |
| `bff/routes/auth.ts:98`, `:245` | login/exchange resolvem `active_reserve_id` default | já filtra `reserves!inner(status='ativa')`; `resolveDefaultActiveReserve` ordena por preferência/idade — inclui reservas `usuario`, correto. SEGURO |

## CORRIGIR — trata como staff sem filtrar `role`

| # | arquivo:linha | problema | fix | onde |
|---|---|---|---|---|
| C1 | `bff/routes/inventory.ts:262` (`PATCH /reserve-checks/:id/assign`) | `armeiro_id` é validado só por `.eq("user_id",…).eq("reserve_id",…)` — **sem filtro de role**. Um `usuario` com linha de membership passaria e seria atribuído como "armeiro" de uma conferência de inventário. | `.in("role", STAFF_RESERVE_ROLES)` (ou `.eq("role","armeiro")`) | **nova subtask** — anexada à Task 8 (mesmo arquivo family) ou Task 2+ |
| C2 | `bff/routes/profiles.ts:377-395` (`GET /:id/reserves`) | retorna **todos** os `reserve_id` do alvo, incl. membership `role='usuario'`. O dialog de edição usa isso pra pré-marcar "onde a pessoa já é armeiro/admin_reserva" → marcaria reservas onde ela é só efetivo. | filtrar `.in("role", STAFF_RESERVE_ROLES)` na query de `memberships` | **Task 6** (mesmo tema: elegibilidade/estado de staff) |
| C3 | `bff/routes/profiles.ts:388` (validação do diff de `reserve_ids`) + `:530` (delete do `toRemove`) | o cálculo de `existingRows`/`toRemove` conta a membership `usuario` do alvo — remover "todas as reservas de staff" no PATCH apagaria também a linha `usuario` (o militar perde o chevron/vínculo) | as queries de `existingRows` e a de delete escopam `.in("role", STAFF_RESERVE_ROLES)`; a inserção de `toAdd` já usa `effectiveRole` (staff) — ok | **Task 6** |
| C4 | `bff/routes/arsenal.ts:40` `requestorBelongsToTenant(requestorId,…)` | usado no ramo `role==='admin_global'` de `requestBelongsToScope` com `requestorId` = quem fez a requisição SSA (pode ser `usuario`). Sem linha de membership antes → retornava `false`; com linha `usuario` → `true`. Muda o resultado de escopo pra requisições SSA feitas por efetivo. | avaliar: provavelmente **correto** (o efetivo É do tenant e fez a requisição) — mas confirmar que não afrouxa nenhuma checagem. Se afrouxar, filtrar staff. | **Task 6** — revisar + decidir |
| C5 | `bff/routes/lendings.ts:83` `assertMilitaryBelongsToReserve(militaryId,…)` | **antes do SP2** militares não tinham linha → esse check falhava pra todo lending legítimo (ou era contornado). Depois da Task 3 ele passa a funcionar de verdade. | não é bug — mas a Task 3 **tem que** rodar o teste E2E de lendings/saídas pra confirmar que o fluxo melhora (não quebra) | **Task 3** — verificação |

## Leitores SQL (policies + funções) — flag OFF, anotar p/ SP5

| objeto | usa | veredito |
|---|---|---|
| `auth_admin_reserve_ids()` | **CONFIRMADO** (staging): `SELECT rm.reserve_id FROM reserve_memberships rm WHERE rm.user_id = auth.uid() AND rm.role = 'admin_reserva'` | **SEGURO** — filtra `role` |
| RLS `reserve_memberships_select` | **CONFIRMADO** (staging): `(user_id = auth.uid()) OR (reserve_id IN (SELECT auth_admin_reserve_ids()))` | **SEGURO** — o `usuario` vê **só a própria linha**; a lista de membros da reserva só pra `admin_reserva`. Nada muda com linhas `usuario`. |
| policies `category_requests`, `material_validity_alert_events` | `reserve_id IN (SELECT reserve_id FROM reserve_memberships WHERE user_id = auth.uid())` | com `usuario` dentro, o efetivo passa a **ler** (não escrever) category_requests e alertas de validade da reserva dele. **Decisão de produto (spec §4.7): aceitável** — read-only, escopo da própria reserva. Anotado, sem ação. |
| ~20 checks de membership nos `routes/*.ts` que resolvem "a reserva do armeiro" | migrar p/ `profiles.active_reserve_id` (fonte única do SP1) | **SP5** — quando o valor vira load-bearing. Aqui: SEGURO (flag OFF). |

## Consolidação

- **Nenhum vazamento de dado com a flag OFF.** Os 5 `CORRIGIR` são escalonamento funcional / UI,
  todos endereçados dentro do SP2 (C1→Task 8, C2/C3/C4→Task 6, C5→verificação da Task 3).
- **Nenhum item bloqueante** que exija sair do escopo do SP2.
- **Follow-up SP5:** migrar os ~20 leitores de "reserva do armeiro" pra `active_reserve_id`;
  revisitar RLS `reserve_memberships_select` e as policies `category_requests`/
  `material_validity_alert_events` quando a flag ligar.
- **Confirmado no staging (2026-09-10):** `auth_admin_reserve_ids()` e `reserve_memberships_select`
  ambos filtram/escopam por `role='admin_reserva'` — SEGUROS com linhas `usuario`.
