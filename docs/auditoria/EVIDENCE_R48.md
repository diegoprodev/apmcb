# EVIDENCE — R-48: `PATCH /api/arsenal/items/:id/ocorrencia` confinado ao escopo da sessão

## Estado inicial
| Campo | Valor |
|---|---|
| Branch / HEAD inicial | `claude/bold-planck-6xy9fc` / `5b87c13` (28dd443, 8489f2c, 940288f, 586da10 presentes) |
| `origin/main` | `70c3fa7` (inalterado; não mesclado) |
| Árvore inicial | limpa |
| Migration R-35 | sha256 `d63f4b5e…551b5b`, intacta; nenhuma migration; produção não acessada |
| WIPs | `worktree-biometric-unify-ssa` toca `shift-auth.ts`/`shifts.ts`, **não** `routes/arsenal.ts` nem `lib/shift-guard.ts`; `cautelamentos.ts` (R-49) não foi tocado |

## Handler e fluxo BEFORE
`apps/bff/src/routes/arsenal.ts`, `PATCH /items/:id/ocorrencia`, atrás do `authMiddleware` (`/api/arsenal/*`), `roleGuard("armeiro","admin_reserva","admin_global")`. Consumer: modal "Registrar ocorrência" (`reserva/arsenal/manutencao/_registrar-ocorrencia-dialog.tsx`).
1. `requireActiveShift(role, userId)` (só armeiro; **sem `targetReserveId`**: o turno não limita a reserva da operação).
2. Lookup: `material_items` por `id` + `tenant_id` (sem `reserve_id`; o erro do SELECT era descartado e virava 404).
3. Domínio: status de origem permitido, B.O. para furtado, `usuario_associado_id` no tenant.
4. UPDATE por `id` + `status_operacional` (**sem tenant e sem reserva**), `.select("id").maybeSingle()`; zero linhas → 409.
5. Depois: `auditLog`, `logShiftEvent`, notificação do militar associado.
`R48_SCOPE_GAP`: nenhuma etapa comparava a reserva dona do item (`material_items.reserve_id`) com a reserva da sessão; o tenant só era checado no lookup (não no UPDATE).

## R48_REPRODUCED = YES
Handler real, sessão de armeiro da reserva A (turno ativo em A, tenant T), UUID direto de um item da reserva B (mesmo tenant, **sem passar por `GET /items/disponiveis`**): o item B virava `avariado`. O R-46 não mitiga: não enumerar não é autorizar. No código antigo, **7 dos 17 testes falham**: armeiro A→B, admin_reserva A→B, "múltiplas memberships", não-admin_global sem reserva ativa, TOCTOU de reserva, erro de banco (SELECT vira 404) e a guarda estática.
Já corretos antes: cross-tenant (404 no lookup), `usuario`/Modo Usuário (403), turno obrigatório (armeiro sem turno → `SHIFT_REQUIRED`), item inexistente, status de origem, zero linhas/status concorrente (409 via `.eq(status)`).

## Regra de autorização (`R48_AUTH_RESERVE_COLUMN = material_items.reserve_id`)
- **Coluna:** `reserve_id` (reserva dona, NOT NULL, derivada do tipo de material), a mesma da RLS `material_items_staff_select` e do R-46; `current_unit_id` (onde o item está) não autoriza.
- **armeiro e admin_reserva:** `canAccessResourceReserve(role, reservaAtiva, item.reserve_id)` (`lib/reserve-scope`): só a reserva ativa da sessão. Sem reserva ativa: nega. D-01: múltiplas memberships não alargam o escopo; a autoridade é a reserva ativa da sessão.
- **admin_global:** **tenant inteiro** (matriz e filial), preservando a convenção de ESCRITA do BFF (`assertActorReserveAccess` em `lendings.ts` retorna `true` para admin_global: "o privilégio amplo é sobre QUEM PODE OPERAR"; `requestBelongsToScope` em `arsenal.ts` é tenant-wide). O tenant continua sempre confinado. **Esta é uma assimetria consciente com a LEITURA do R-46 (admin_global em filial confinado) e fica como decisão de produto a confirmar: se a escrita do admin_global em filial também deve ser confinada, é uma troca de uma linha (`writeReserveScope`).**
- Fonte: `lib/reserve-scope.ts`, RLS `material_items_staff_select`, convenção de escrita de `lendings.ts`/`arsenal.ts`.

## Correção (só o handler, sem migration)
- Lookup seleciona `reserve_id`; **erro do SELECT → `logFailure("arsenal.ocorrencia.lookup_failure")` + 500** (antes virava 404; R-41: falha ≠ vazio).
- Fora do admin_global, item de outra reserva (ou sem reserva ativa) → **404 igual ao de item inexistente** + `logRejection("arsenal.ocorrencia.rejected")`.
- **UPDATE final confinado (`R48_FINAL_UPDATE_CONFINED = YES`)** via `confineUpdate`: o UPDATE principal e o fallback de colunas ausentes repetem `tenant_id` e, fora do admin_global, `reserve_id`, além de `id` e do status de origem. Fecha o TOCTOU entre a leitura e a escrita. Zero linhas → 409 (já existia); erro operacional → `logFailure("arsenal.ocorrencia.update_failure")` + 500 genérico.
- Não alterados: payload/schema, turno, state machine, `auditLog`/`logShiftEvent`/notificação (todos continuam só depois do UPDATE bem-sucedido), `cautelamentos.ts`, R-46, R-47.
- Harness: `fake-postgrest.ts` passou a devolver cópias rasas das linhas (antes referências vivas; uma mutação concorrente alterava o que o handler já tinha lido).

## AFTER (20 testes, `arsenal-ocorrencia-scope.test.ts`)
armeiro A→A: 200, item gravado, evento de turno disparado; armeiro A→B: 404, item B intacto, **zero INSERT/UPDATE/RPC**; admin_reserva A→B: 404, A→A: 200; múltiplas memberships não alargam; cross-tenant: 404; admin_global matriz e filial: 200 em B (tenant-wide), nunca o tenant B; sem reserva ativa (não-admin_global): 404; `usuario`/Modo Usuário: 403; armeiro sem turno: 403 `SHIFT_REQUIRED`; item inexistente: 404; sem tenant: 400; status `cautelado`: 409; **TOCTOU de reserva** (item muda de reserva entre a leitura e o UPDATE): 409 e item não alterado; **TOCTOU de tenant** (admin_global): 409; concorrência de status: 409 sem sobrescrever; zero linhas: não é 200; erro no UPDATE e no SELECT: 500 genérico sem vazar; guarda estática (UPDATE principal e fallback via `confineUpdate` e com o status de origem; lookup com tenant; `logFailure`).
Multi-sessão/Bearer (R-28): `/api/arsenal/*` está atrás do `authMiddleware`; Modo Usuário rebaixa a `usuario`, Bearer sem sessão é limitado a `usuario`; o `roleGuard` barra ambos (`mode-user-auth-paths` 12/12; não duplicado).

## Contraprovas (arquivo restaurado, `cmp` conferido)
| # | Mutação | Resultado |
|---|---|---|
| M1 | UPDATE final sem reserva | DETECTED (TOCTOU + guarda) |
| M2 | UPDATE final sem tenant | DETECTED (TOCTOU de tenant + guarda) |
| M3 | só UPDATE confinado, sem checagem prévia | DETECTED (4) |
| M4 | reserva vinda do cliente | NOT_APPLICABLE (a rota não lê reserva do cliente) |
| M5 | todos tratados como tenant-wide / autoriza qualquer `reserve_id` | DETECTED (4–5) |
| M6 | papel efetivo ignorado (`usuario` admitido) | DETECTED |
| M7 | erro do lookup vira 404 | DETECTED |
| M8 | zero linhas retorna sucesso | DETECTED (3) |
| M9 | lookup sem tenant | DETECTED |
| M10 | fallback sem status de origem | DETECTED (guarda estática) |
| M12 | fallback sem confinamento (reserva/tenant) | DETECTED (teste dinâmico do fallback + guarda) |
| M11 | efeito antes da autorização final | NOT_APPLICABLE (nenhum efeito antes do UPDATE; coberto por "zero INSERT/UPDATE/RPC" nos caminhos negados) |
| log | sem `logFailure` no UPDATE | DETECTED (guarda estática) |
Notas: o primeiro padrão de M7 era ambíguo (2 ocorrências) e foi refeito; o teste de concorrência de status só passou a ser válido depois de o fake devolver cópias (antes lia a linha viva).
`CONCURRENCY_TEST`: aplicável e coberto (reserva, tenant e status mudando entre a leitura e o UPDATE).

## Regressão
BFF unit 695/695 · integração 320/320 (inclui R-06, R-28, lotes 1–6, R-35, R-39, R-40, R-41, R-42/R-43, R-46) · web 366/366 · `tsc` BFF e web, `lint:logs`, `git diff --check` OK · hash R-35 intacto. R-46 (`arsenal-disponiveis-scope`) verde. E2E: **BLOQUEADO_AMBIENTE**.

## Reviews
- **Security:** nenhum achado ≥ 8 no diff. Confirmou: escopo só da sessão; fail-closed; UPDATE final confinado; efeitos (`auditLog`, `logShiftEvent`, notificação) só depois do UPDATE; erro do lookup não vaza. A assimetria admin_global (escrita tenant-wide × leitura confinada) foi considerada decisão consciente, não vulnerabilidade. **Pré-existentes, abaixo do limiar de escrita cross-reserve, registrados e NÃO corrigidos:** **R-50** (turno sem `targetReserveId`, confiança 8/10), **R-51** (`foto_url` sem vínculo de tenant/reserva, 6/10), **R-52** (`usuario_associado_id` só por tenant, 7/10).
- **Code review:** 0 CRÍTICO, 0 ALTO (confirmou que o UPDATE final confinado fecha o TOCTOU, que o `.eq` entra no builder certo antes do `.select`, que nenhum efeito roda antes do UPDATE, 404/403/409 coerentes e sem vazamento).
  - **MÉDIO (decisão de produto):** admin_global com escrita tenant-wide em filial contradiz o contrato de `canAccessResourceReserve` e a leitura do R-46 (o mesmo ator não vê o item na lista mas escreve por UUID). É deliberado (convenção de escrita do BFF); registrado como **decisão de produto a confirmar**. Alternativa fail-closed: `canAccessResourceReserve` para todos (matriz tenant-wide, filial confinada). O teste "admin_global (matriz e filial)" fixa o comportamento atual e mudaria junto.
  - **MÉDIO pré-existente:** turno sem `targetReserveId` → **R-50**.
  - **BAIXO B1 (teste de múltiplas memberships era vazio):** **corrigido**: agora cobre sessão em A (só A) e sessão trocada para B (só B). **BAIXO B2 (fallback só por guarda estática):** **corrigido**: o 1º UPDATE falha como `PGRST204` e o 2º é provado confinado (TOCTOU e caminho feliz); mutação "fallback sem confinamento" detectada. **B3:** suíte de integração completa rodada após a mudança do fake (318 → 320 verdes). B4/B5: sem ação.

## Limitações
- O fallback de colunas ausentes é exercitado com um `PGRST204` injetado no 1º UPDATE (o fake não emite esse erro por conta própria).
- Item cujo `reserve_id` difere de `current_unit_id`: a autorização usa a dona.
- admin_global tenant-wide em escrita: a confirmar com o produto (acima).

## Status
**R-48: DONE_VERIFIED_REPO_PENDING_DEPLOY.** R-34/R-37 PARTIAL_IMPLEMENTATION; R-44, R-45 OPEN; R-46 DONE_VERIFIED_REPO_PENDING_DEPLOY; R-47 OPEN/a confirmar; R-49 OPEN (colisão WIP_BIOMETRIA); Batch 7 NOT_STARTED. Novos: R-50, R-51, R-52.
