# SP4 — auditoria grep-provada de todo INSERT nas 7 tabelas-filho + `document_signatures`

Entregável exigido pela spec §4.5: lista de todo `INSERT INTO <7 tabelas>` / `.from(t).insert(`
em `apps/bff` + `apps/web` + corpos de RPC + jobs `pg_cron`, confirmando que o trigger
dispatcher (`derive_child_reserve_id()`, migração `20260911122934`) intercepta todos eles.
Como a trigger é `BEFORE INSERT`, o caller **nunca precisa mudar** — ela sobrescreve
`NEW.reserve_id` sempre, independente do que (ou se algo) foi passado.

## `material_request_items` (pai: `material_requests` via `request_id`)

| origem | arquivo:linha |
|---|---|
| app (BFF) | `apps/bff/src/routes/ssa.ts:1055` — `POST /api/ssa/modo-a` |

**Achado real corrigido (fora do escopo estrito do SP4, mas exposto por ele):** o pai
`material_requests` tem coluna `reserve_id` própria (não é uma das 7 filhas — é um recurso
top-level), mas **só 1 dos 2 insert sites a preenchia** (`ssa.ts` `POST /requests` ~:429, fix
`BUG-RR-04` anterior). O 2º site (`POST /modo-a` ~:1024) deixava `reserve_id` NULL — o que
faria o dispatcher de `material_request_items` falhar com `RAISE` opaco assim que alguém usasse
o fluxo "saída presencial via código de acesso". Corrigido no mesmo commit do SP4:
`ssa.ts` agora lê `c.get("reserveId")`, recusa com 403 claro se ausente, e grava no insert.

## `service_log_events` (pai: `service_shifts` via `shift_id`)

| origem | arquivo:linha |
|---|---|
| RPC (DB) | `log_shift_event_atomic()` — `supabase/migrations/20260708000001_log_shift_event_atomic_fn.sql` + `20260721194127_log_shift_event_atomic_subject_dedup.sql` |

Sem insert direto em app code — só via essa RPC `SECURITY DEFINER`, chamada pelo BFF
(`shifts.ts`, `cautelamentos.ts`). A trigger dispara igual (roda no nível da tabela, não importa
quem faz o INSERT).

## `handover_attachments` (pai: `service_handovers` via `handover_id`)

**Nenhum insert encontrado** — nem app code, nem migração/RPC. Tabela existe (feature de anexo
de passagem de serviço) mas não está conectada em nenhum fluxo hoje. A trigger fica pronta pra
quando a feature for implementada; nada a corrigir agora.

## `inventory_item_checks` (pai: `inventory_reserve_checks` via `reserve_check_id`)

| origem | arquivo:linha |
|---|---|
| app (BFF) | `apps/bff/src/routes/inventory.ts:214` — criação em lote ao abrir uma conferência de inventário |

## `material_items` (pai: `material_types` via `material_type_id`)

| origem | arquivo:linha |
|---|---|
| app (BFF) | `apps/bff/src/routes/arsenal.ts:627` — cadastro de item físico |
| app (web) | `apps/web/src/app/api/admin/almoxarifado/route.ts:269` — idem, via rota edge |

## `cautela_vencimento_alert_events` (pai: `cautelamentos` via `cautela_id`)

| origem | arquivo:linha |
|---|---|
| cron (DB) | `check_cautelas_vencimento()` / job `pg_cron` — `supabase/migrations/20260828080000_cautela_vencimento_cron.sql`, `20260829000000_cautela_vencimento_dedup_por_dia.sql`, `20260829040000_cautela_vencimento_configuravel.sql` |

## `document_signatures` (polimórfico: `document_type` + `document_id`)

| `document_type` real | origem | arquivo:linha | mapeado no dispatcher? |
|---|---|---|---|
| `"lending"` | app (BFF) | `saidas.ts:164,240` | sim → `lendings.reserve_id` |
| `"handover"` | app (BFF) | `cautelamentos.ts:694,792`; `handovers.ts:270,402` | sim → `service_handovers.reserve_id` |
| `"inventory_reserve_check"` | app (BFF) | `inventory.ts:442` | sim → `inventory_reserve_checks.reserve_id` |

**Achado (não corrigido — fora de escopo, documentado):** `POST /api/signatures`
(`apps/bff/src/routes/signatures.ts:17`, endpoint genérico, **montado** em `index.ts:186` mas
sem nenhum caller no `apps/web` atual) aceita `document_type ∈ {"lending","handover","inventory",
"inventory_campaign"}` via zod — um vocabulário **divergente** dos valores reais usados pelos
endpoints específicos (`"inventory"` ≠ `"inventory_reserve_check"`). Se esse endpoint genérico
for algum dia chamado com `"inventory"` ou `"inventory_campaign"`, o dispatcher **RAISE**
(fail-closed, não deriva errado nem deixa `reserve_id` NULL). `inventory_campaigns` é
multi-reserva por design (`reserve_ids` array) — não tem um `reserve_id` único pra derivar,
então mesmo que o vocabulário fosse alinhado, esse valor específico precisaria de uma decisão de
produto (não suportar assinatura de campanha via este mecanismo, ou assinatura por-reserva
dentro da campanha). Recomendação: alinhar `signSchema` de `signatures.ts` aos 3 valores reais
(`lending`/`handover`/`inventory_reserve_check`) ou remover o endpoint se for código morto —
fica como follow-up, não é bloqueante (o RAISE já protege).

## Monitoramento (spec §4.5)

Com `NOT NULL` aplicado direto (tabelas vazias no momento do SP4, clean-slate 2026-09-10), não
há necessidade da consulta de monitoramento `SELECT count(*) WHERE reserve_id IS NULL` — a
própria constraint do banco já impede a existência de uma linha `NULL`. Documentado aqui em vez
de implementado como query separada.
