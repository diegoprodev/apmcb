# EVIDENCE — R-34 / R-37, lote 6 da C_HYBRID: `/reserva/arsenal/manutencao`

## Estado inicial e decisão
| Campo | Valor |
|---|---|
| Branch / HEAD inicial | `claude/bold-planck-6xy9fc` / `f243865` (cca1d51, 9dde70b, 13eb82b, f6a0117, fb9a008, 28dd443, 8489f2c, 54a63cd, 940288f presentes) |
| `origin/main` | `70c3fa7` (inalterado; não mesclado) |
| Árvore inicial | limpa |
| Migration R-35 | sha256 `d63f4b5e…551b5b`, intacta; nenhuma migration; produção não acessada (Supabase MCP indisponível; nada consultado) |
| WIP_BIOMETRIA / WIP_INFRA_HIBRIDA | `worktree-biometric-unify-ssa` não toca arsenal, material nem a página; sem colisão |
| **BATCH6_DECISION** | **GO** |

## Discovery
- **Arquivos:** `page.tsx` (leitura), `_manutencao-client.tsx` (UI; recebe `rows`), `_registrar-ocorrencia-dialog.tsx` (escrita), `loading.tsx`; helper compartilhado `apps/web/src/lib/material-items-manutencao.ts` (`fetchManutencaoItems`, **também usado por `/admin/arsenal/manutencao`, que continua fora do lote e não foi alterado**).
- **Read direto (STAFF DATA):** `material_items` com embeds de `material_types` e `reserves`, filtrado só por `tenant_id` + status. Autorização por `profiles.role` (`armeiro`/`admin_reserva`; admin_global usa a rota de admin). `BATCH6_DIRECT_STAFF_READ = YES`.
- **Write path (intocado):** o botão "Registrar ocorrência" escreve por rotas BFF (`/api/arsenal/items/:id/ocorrencia`, `/api/arsenal/material-photo`, `/api/admin/search-profiles`); a página só o renderiza.
- **Domínio:** item físico (`material_items`) em triagem: danificados (`avariado`, `manutencao`), perdidos (`extraviado`, `furtado`), administrativo (`em_pericia`, `bloqueado`, `em_transito`, `aguardando_baixa`). `material_items.reserve_id` é NOT NULL e identifica a reserva dona (derivada do tipo de material por trigger); `current_unit_id` é onde o item está agora; a UI mostra a reserva de `current_unit_id`.
- **Escopo da RLS (`material_items_staff_select`):** staff do tenant; com isolamento ligado, `reserve_id = reserva ativa` ou matriz (admin_global/auditor sem reserva ativa).
- **Endpoint:** `NEW_ENDPOINT_REQUIRED`. Nenhum endpoint BFF devolvia itens em triagem.

## BEFORE
`page.test.tsx` (13 casos, handler real, borda mockada) contra a página antiga: **13 de 13 falham**.
- `BATCH6_BEFORE_MODE_USER = VULNERABLE`: o mesmo staff com papel efetivo `usuario` (Modo Usuário) continua recebendo a página com itens de staff (autorização por `profiles.role`, leitura direta pelo RLS do JWT).
- BEFORE tenant/reserva: a página recebia o TENANT inteiro; a reserva só era confinada pelo RLS (e só com isolamento ligado).

## Implementação (sem migration)
| Arquivo | Mudança |
|---|---|
| `apps/bff/src/routes/arsenal.ts` | novo `GET /api/arsenal/items/manutencao` (roleGuard `armeiro`/`admin_reserva`): tenant da sessão (403 sem tenant); `scopedReserveIds` (R-41: erro → `logFailure` + 500 genérico); sem reserva no escopo → `{items: []}` sem consultar; `.eq(tenant_id)` + `.in(reserve_id)` + status no banco; ordem (`last_movement_at`, `id`) total; paginação por `.range` com dedupe; embed `reserve:reserves!current_unit_id(...)` (hint de coluna, ver revisão); 11 campos |
| `reserva/arsenal/manutencao/page.tsx` | sem Supabase; papel efetivo (`resolveWebSessionRole`, fail-closed); abas por `TAB_STATUSES`; botão recebe o papel efetivo; 401 → login, 403 → `/`; 5xx/rede/forma inesperada → aviso de falha (nunca lista vazia); timeout 8 s; log por caso |
| `page.test.tsx` (13), `arsenal-manutencao-scope.test.ts` (13) | novos |
Não alterados: `lib/material-items-manutencao.ts`, `/admin/arsenal/manutencao`, `_manutencao-client.tsx`, `_registrar-ocorrencia-dialog.tsx`, handovers, `profiles.ts`, `reserve-scope.ts`, `categories.ts`.

## AFTER
| Cenário | Resultado |
|---|---|
| Armeiro/admin_reserva A1 | só itens em triagem da reserva A1 do tenant A: nem as 60 mais recentes de A2 à frente, nem B1, nem a de mesma `reserve_id` em outro tenant, nem `disponivel`/`cautelado` |
| Tenant B | só B1 |
| Modo Usuário / usuário comum | página redireciona; endpoint 403 sem nenhuma consulta |
| admin_global, auditor, superadmin | página redireciona; endpoint 403 (admin_global tem a rota própria, fora do lote) |
| Sem tenant | 403 sem consulta |
| Sem reserva ativa | 200 `{items: []}` sem consultar `material_items` |
| Reserva sem itens em triagem (vazio legítimo) | 200 `{items: []}`; a página entrega lista vazia ao cliente |
| Erro de banco / erro de escopo | 500 `{"error":"Erro ao buscar itens em manutenção"}`; a página mostra "Não foi possível carregar" |
| >1000 itens | paginação completa, sem duplicar |
Limit: sem limit de produto; ordem total com tiebreak `id`; filtros de tenant/reserva no banco antes do `.range`. Campos: exatamente os de `ManutencaoRow` (sem `tenant_id`, sem número de série).

## Multi-sessão e Bearer (R-28)
`/api/arsenal/*` está atrás do `authMiddleware` (`index.ts`); Modo Usuário rebaixa a `usuario` e Bearer sem sessão é limitado a `usuario`; o `roleGuard` barra ambos (`mode-user-auth-paths`, 12/12; não duplicado). A página só envia o cookie `apmcb_session`.

## Contraprovas (arquivos restaurados, `cmp` conferido)
| # | Mutação | Resultado |
|---|---|---|
| M1/M2 | roleGuard admite `usuario`/`admin_global` | DETECTED |
| M3 | sem filtro de tenant | DETECTED (5) |
| M4 | sem filtro de reserva | DETECTED (5) |
| status | sem filtro de status | DETECTED (3) |
| M5 | limit antes do filtro | NOT_APPLICABLE (sem limit) |
| M6 | erro de banco vira `{items: []}` | DETECTED |
| M8 | Bearer no lugar da sessão | NOT_APPLICABLE (a página só envia cookie) |
| M9 | sem fail-closed de tenant | DETECTED |
| M10 | sem `logFailure` | DETECTED (guarda estática) |
| paginação | sem paginação | DETECTED |
| escopo vazio | remove o atalho de reserva vazia | DETECTED (assertiva "sem consultar") |
| P1 | página sem autorização | DETECTED (4) |
| P2 | conjunto de papéis amplo | DETECTED |
| P3 | papel efetivo ignorado (Modo Usuário / `profile.role`) | DETECTED (5) |
| P4 | papel fixo ao botão | DETECTED |
| P5 | sem cookie | DETECTED |
| P7 | 403 não redireciona | DETECTED |
| P8 | falha de carga vira lista vazia | DETECTED |
| M7 | restaurar leitura direta | DETECTED ("nenhuma leitura direta" + guarda estática; a página antiga falha 13/13) |

## Static guard
`page.test.tsx`: a página não importa `@/lib/supabase/(server|client)` nem `@supabase/`, não usa `fetchManutencaoItems` (import de valor do helper; import de tipo é permitido), `.from(` nem `getSessionProfile`. Limitada a este alvo.

## Regressão
BFF unit 695/695 · integração 285/285 (inclui R-06, R-28, lotes 1–5, R-35, R-39, R-40, R-41, R-42/R-43) · web 366/366 · `tsc` BFF e web, eslint da página, `lint:logs`, `git diff --check` OK · hash R-35 intacto. E2E: **BLOQUEADO_AMBIENTE** (aponta para produção).

## Reviews
- **Security:** nenhum achado ≥ 8 introduzido. Confirmou: sem bypass de Modo Usuário/Bearer; tenant/reserva da sessão no banco; sem fail-open; campos iguais ou mais restritos que o helper antigo e a RLS. **Pré-existente, confiança 9/10 → R-46:** `GET /api/arsenal/items/disponiveis` lista `material_items` do tenant inteiro sem filtro de reserva (armeiro da reserva A enumera itens das reservas B, C; admin_global em filial vê o tenant); não corrigido (fora do lote; o botão "Registrar ocorrência" o usa).
- **Code review:** 0 CRÍTICO; **1 ALTO tratado**: `material_items` tem duas FKs para `reserves` (`current_unit_id` e `reserve_id`), então o embed `reserves(...)` sem hint podia dar PGRST201 → a rota viraria sempre 500. Correção: hint de coluna `reserve:reserves!current_unit_id(...)` (mantém o `reserve_nome` ligado a `current_unit_id`, como o helper antigo) + guarda estática. Não consegui confirmar contra o PostgREST real (MCP indisponível; produção fora de escopo), então o risco no helper antigo e em `/items/disponiveis` fica registrado como **R-47 (a confirmar)**.
  - MÉDIO 2 (testes não validam o embed): parcialmente tratado (guarda estática do hint; o fake não valida embeds nem FK). MÉDIO 3 (comportamento com isolamento desligado): registrado abaixo. MÉDIO 4 (sem teto na paginação; offset sem snapshot): registrado (falha vira aviso, não dado parcial).
  - BAIXOS: lista de status duplicada → teste que compara BFF × web **adicionado**; teste D enganoso → **corrigido**; nulos na ordenação iguais ao antigo; sem loop de login esperado. A nota do revisor sobre o trigger não procede: `reserve_id` deriva do **tipo de material**, não de `current_unit_id`; o escopo por `reserve_id` equivale ao da RLS.

## Mudanças de comportamento e limitações
- **Isolamento desligado:** a página antiga mostrava o tenant inteiro (RLS sem confinamento); agora armeiro/admin_reserva veem só a reserva ativa (o BFF nunca lê a flag; mesmo padrão dos lotes 3–5). Confirmar a flag por tenant antes do deploy.
- Item cuja reserva dona (`reserve_id`) difere de onde está (`current_unit_id`): é escopado pela dona e exibido com a reserva atual.
- `admin_global` e `superadmin` continuam fora desta rota.
- O fake não ordena, não projeta embeds nem valida FK/embed: ordem e embed só têm guarda estática.

## Inventário R-37 recontado (varredura por `supabase/server`/`.from(`/`resolveWebSessionRole`)
`REMAINING_R37_DIRECT_STAFF_PAGES = 12` (+ `reserva/page`, caso especial).
- `admin/` (7): `page`, `arsenal`, `arsenal/manutencao` (usa `fetchManutencaoItems`), `auditoria`, `comando`, `relatorios`, `usuarios`.
- `reserva/` (5): `arsenal`, `biometria` (WIP_BIOMETRIA), `passagens/[id]`, `relatorios`, `saidas/nova`.
- **Casos especiais:** `reserva/page.tsx` (guarda só por cookie de UI + leituras diretas) e os cards de contagem de ocorrências (`reserva/page`, `admin/page`).
- Migradas (7): `ocorrencias`, `solicitacoes`, `saidas`, `passagens`, `militares`, `arsenal/manutencao`. Sem dado staff direto: `admin/arsenal/solicitacoes`, `admin/estrutura`, `admin/inventario`, `admin/livros`, `admin/saidas`, `reserva/cautelas`, `reserva/criar-armeiro`, `reserva/livro`.
- **Próximo candidato (Batch 7): `/admin/arsenal/manutencao`**: mesmo domínio, helper já isolado, leitura pequena (1 `.from`), sem WIP; precisa de uma variante admin_global (matriz tenant-wide + lista de reservas) do endpoint e do hint de FK. `/reserva/arsenal` tem 10 leituras (maior). Evitar `/reserva/biometria`, `/reserva/saidas/nova` e `/reserva/passagens/[id]` enquanto a WIP_BIOMETRIA estiver ativa.

## Status
**Lote 6: DONE_VERIFIED** (repositório; produção só após o deploy do BFF e do web). **R-34 e R-37: PARTIAL_IMPLEMENTATION.** R-44 e R-45 OPEN. Novos: R-46 (OPEN), R-47 (OPEN, a confirmar).
