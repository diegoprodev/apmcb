# EVIDENCE — R-06: isolamento tenant/reserva em dashboard e stats

## Estado inicial
| Campo | Valor |
|---|---|
| Branch | `claude/bold-planck-6xy9fc` |
| HEAD | `612d3ac1ab5eff0ded44f99b9d71fbc77199070f` (`39f2615` e `9deb6ca` presentes) |
| `main` | `5f91635`, ancestral de HEAD, sem avanço |
| Working tree | limpo |

## Rotas analisadas
| Rota | Papéis | Tabelas | Situação antes |
|---|---|---|---|
| `GET /api/dashboard/command` | admin_global, admin_reserva | cautelamentos, material_items, lendings, ocorrencias, profiles, audit_events, service_handovers | filtro de **tenant** presente; `qReserveId` (da query ou da sessão) **calculado e ecoado, mas nunca aplicado** a nenhuma query |
| `GET /api/dashboard/stats` | admin_global, armeiro, admin_reserva | lendings, profiles, material_availability | **nenhum** filtro (nem tenant, nem reserva) |
| `GET /api/dashboard/branding` | todos | tenant_branding | filtra por tenant da sessão; sem dado de reserva — fora do problema |
| `GET /api/nexus/metrics` | superadmin (sessão Nexus) | plataforma | métrica de plataforma por desenho — fora do R-06 |
| `GET /api/notifications/unread-count` | autenticado | notificações do próprio usuário | por usuário — fora do R-06 |

Consumidor web: só `/admin/comando` (`_client.tsx`), que chama `/command` com `Authorization: Bearer` e, para admin_global com >1 reserva, `?reserve_id=`. `/stats` não tem consumidor (só um E2E marcado `test.fail`).

## Modelo de escopo (derivado do código, não inventado)
- `tenantId`: `session.tenantId` (login: `tenant_memberships` → fallback `profiles.default_tenant_id`); caminho Bearer: `tenant_memberships … limit(1)`.
- `reserveId`: `session.reserveId` = `profiles.active_reserve_id` (troca via `POST /api/reserves/switch/:id`, que exige membership para não-matriz).
- Papel efetivo: `profiles.role`, ou `usuario` quando `session.activeMode === "usuario"` (só no caminho iron-session).
- `lib/reserve-scope.ts`: **matriz** = `admin_global`/`auditor` **sem** reserva ativa → tenant inteiro; qualquer outro caso (inclusive admin_global/auditor em filial) → confinado à reserva ativa.
- `auditor_reserva` é papel de `reserve_memberships`, não de `profiles.role` — não chega a estas rotas como papel próprio.

## Defeito reproduzido (handler real, banco em memória que aplica os filtros)
Dados: Tenant A (A1 = 1 registro, A2 = 2), Tenant B (B1 = 4) de cada tipo.

| Cenário (código antigo) | Resultado |
|---|---|
| `/stats` armeiro A1 | `total_armados=7`, `cadastros_pendentes=7`, `total_militares=7`, `materiais` com **4 linhas do Tenant B** (nome, reserva) → **CROSS_TENANT** |
| `/stats` sem tenant na sessão | 200 com agregado global (7) → **MISSING_SCOPE fail-open** |
| `/command` admin_reserva A1 | `cautelas_ativas=3` (A1+A2) → **CROSS_RESERVE** |
| `/command` admin_reserva A1 `?reserve_id=B1` | 200, `reserve_id` ecoado "B1", dados de A1+A2 (parâmetro aceito sem validação, sem efeito) |
| `/command` sem tenant | 200 com zeros (query com `tenant_id=null` falhando em silêncio) |
| `/command` `ocorrencias_abertas` | sempre 0: filtrava `ocorrencias.tenant_id`, coluna que não existe no repositório |

## Correção (`apps/bff/src/routes/dashboard.ts`)
- `resolveDashboardScope(c, requestedReserveId)`: 403 + log `dashboard.scope.denied` sem tenant; matriz sem seleção → tenant inteiro; seleção do cliente só é aceita se estiver em `scopedReserveIds(...)` (reservas do tenant da sessão em matriz, ou a reserva ativa); não-matriz sem reserva → 403. `?reserve_id=` vazio = sem seleção. Reusa `scopedReserveIds`/`isMatriz` de `lib/reserve-scope.ts`.
- `byReserve(query, scope)`: `.in("reserve_id", …)` em todas as queries de cautelamentos, material_items, lendings, audit_events, service_handovers, material_availability quando o escopo é de reserva.
- `countProfiles`: profiles não tem reserve_id → em escopo de reserva, `reserve_memberships!inner(reserve_id)` + `.in("reserve_memberships.reserve_id", …)`, contagem no banco (sem lista de IDs na URL, sem teto de linhas).
- `countOpenOcorrencias`: mesma regra de `routes/ocorrencias.ts` — tenant pelo militar (`!inner`); reserva pela lending e, só sem lending, pelo material_type; sem nenhum → fora (fail-closed). Duas contagens no banco, disjuntas por `lending_id`.
- `/stats`: mesmo resolvedor, sem seleção do cliente.
- `logMetricFailures`: toda métrica com erro vira 0 no painel, mas loga `dashboard.metric.failure`.
- Resposta `reserve_id`: a reserva efetivamente aplicada (ou `null` em matriz).

## Testes
Arquivo: `apps/bff/src/__tests__/integration/dashboard-scope-real-handler.test.ts` (20 casos), com `__tests__/helpers/fake-postgrest.ts` (aplica eq/in/lt/gte/is/or, joins `!inner` com semântica do PostgREST — sem `!inner` o pai não é descartado —, join reverso, erro em coluna inexistente).

| Caso | Antes | Depois |
|---|---|---|
| CROSS_RESERVE (admin_reserva A1 só vê A1) | FAIL (3) | PASS |
| CLIENT_SUPPLIED_RESERVE (A1 pede A2 / B1) | FAIL (200) | PASS (403) |
| CLIENT_SUPPLIED_TENANT (`?tenant_id=B`) | FAIL (3) | PASS (1) |
| CROSS_TENANT `/command` matriz A (sem B) | FAIL (ocorrências 0) | PASS (3 + 1 órfã = 4) |
| matriz `?reserve_id=A2` | FAIL (3) | PASS (2) |
| matriz pedindo B1 | FAIL (200) | PASS (403) |
| admin_global filial A1 | FAIL (3) | PASS (1) |
| `?reserve_id=` vazio | — | PASS (sem seleção) |
| MISSING_SCOPE sem tenant (`/command`, `/stats`) | FAIL (200) | PASS (403) |
| MISSING_SCOPE não-matriz sem reserva (`/command`, `/stats`) | FAIL (200) | PASS (403) |
| CROSS_TENANT + CROSS_RESERVE `/stats` armeiro A1 | FAIL (7, materiais de B) | PASS |
| CLIENT_SUPPLIED_SCOPE `/stats` | FAIL | PASS |
| `/stats` matriz A | FAIL (7) | PASS (3) |
| MODE_USER_PRIVILEGE (`/command`, `/stats`) | PASS (roleGuard) | PASS |
| Invariante estrutural (toda query com tenant e reserva; nenhuma tabela fora da lista) | FAIL | PASS |

Precedência e caminhos de ocorrência cobertos: lending, fallback por material_type, lending de A2 com material_type de A1 (conta em A2), órfã (só matriz).

### Contraprova (executada)
| Variante | Resultado |
|---|---|
| código antigo (HEAD) | 2 pass / 18 fail |
| mutação: `byReserve` sem filtro | 11 / 9 |
| mutação: seleção do cliente sem validar | 17 / 3 |
| mutação: join do militar sem `!inner` | 19 / 1 |
| mutação: sem precedência lending (`is lending_id null` removido) | 16 / 4 |
| mutação: profiles sem filtro de reserva | 12 / 8 |
| corrigido | 20 / 0 |

## Regressão
| Comando | Resultado |
|---|---|
| `pnpm --filter @apmcb/bff test` (env CI) | 690/690 |
| `bun test src/__tests__/integration` | 124/124 |
| `tsc --noEmit` (BFF) | OK |
| `pnpm lint:logs` | OK |
| `git diff --check` | OK |
| Web | não alterado (não executado) |
| E2E | não executado (aponta para produção — B-06) |

## Reviews
- code-review (1ª rodada, 10 achados). Corrigidos: lista de IDs na URL/teto de 1000 linhas em profiles e ocorrências (agora contagem no banco com `!inner`); emulador tratava todo join como `!inner` (fail-open); invariante pulava `id=in`; métricas com erro sem log; `scopedReserveIds` desnecessário em matriz; fixtures sem fallback/precedência/órfã; `?reserve_id=` vazio. Não corrigidos (fora do escopo, registrados): Bearer sem Modo Usuário (R-28); duplicação da regra de ocorrências / tabela sem `reserve_id` (causa raiz); seletor de reserva no web em modo filial.
- security-review: nenhuma vulnerabilidade com confiança ≥ 8.

## WIP preservado
Nenhum arquivo de WIP_INFRA_HIBRIDA, WIP_BIOMETRIA, migrations, `cautelamentos.ts`, `shifts.ts`, SSA ou middleware alterado.

## Produção
Não acessada nesta sessão. Nenhuma mutação, nenhum teste ofensivo.

## Riscos residuais
1. **R-28 (ALTO, pré-existente, middleware)**: no caminho Bearer do `authMiddleware` o Modo Usuário não é aplicado — e o painel Comando usa Bearer. Um admin em Modo Usuário ainda recebe as métricas pelo painel. As rotas de dashboard bloqueiam corretamente o papel efetivo `usuario`; o erro está em como o middleware calcula esse papel.
2. admin_global em modo filial vê o seletor de reserva no web e recebe 403 ao escolher outra reserva (antes o filtro era ignorado silenciosamente).
3. `cautelas_com_item_vencido` sempre 0: filtra `cautelamentos.validade_item`, coluna inexistente no repositório (agora loga `dashboard.metric.failure`).
4. A contagem de ocorrências por reserva assume `lendings.reserve_id NOT NULL` (grupo B do isolamento); se houver lending legada com NULL, a ocorrência fica fora da contagem da reserva (subcontagem, nunca vazamento).
5. Prova em banco em memória, não no PostgREST real (B-01/B-04).

## Status R-06
**DONE_VERIFIED** para isolamento tenant/reserva de `/api/dashboard/command` e `/api/dashboard/stats`: defeito reproduzido no handler real, testes negativos provam o isolamento, e a contraprova mostra que os testes detectam cada filtro ausente. Modo Usuário via Bearer fica como R-28 (fora do escopo, middleware).
