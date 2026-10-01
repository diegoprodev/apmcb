# EVIDENCE — R-34 / R-37, lote 5 da C_HYBRID: `/reserva/militares`

## Estado inicial e decisão
| Campo | Valor |
|---|---|
| Branch / HEAD inicial | `claude/bold-planck-6xy9fc` / `940288f` (cca1d51, 9dde70b, 13eb82b, f6a0117, fb9a008, 28dd443, 8489f2c, 54a63cd presentes) |
| `origin/main` | `70c3fa7` (inalterado; não mesclado) |
| Árvore inicial | limpa |
| Migration R-35 | sha256 `d63f4b5e…551b5b`, intacta; nenhuma migration; produção não acessada |
| WIP_INFRA_HIBRIDA | não tocada |
| WIP_BIOMETRIA | `worktree-biometric-unify-ssa` modifica **`_militares-table.tsx`** (fluxo de cadastro de digital: leitor escolhe o dedo, `fingerName`). **Não editei esse arquivo.** `page.tsx` e `routes/profiles.ts` não são tocados pela WIP; o contrato de props que a WIP consome (`registeredFingers`, `reserve_id`, `activeCount`…) foi preservado. Interpretação: sem colisão textual nem de contrato; registrada aqui como decisão explícita, porque o prompt trata "mesmo componente" como possível colisão |
| **BATCH5_DECISION** | **GO** |

## Discovery
- **Acessos Supabase da página antiga (todos READ, STAFF DATA):** `profiles` (role=usuario, tenant), `reserves` (opções de cadastro, só admin_global em matriz), `lendings` (contagem de ativos) e `biometric_templates` (`user_id`, `finger_index`). Autorização por `profiles.role`. `BATCH5_DIRECT_STAFF_READ = YES`.
- **WRITE_PATH_PRESENT = YES, intocado:** `AdminUserToolbar` (cadastro), `UserRowActions`/diálogos (edição, desativar), envio de convite, `ChangeStatusButton`, captura de digital (`BiometricCaptureDialog`). Nenhum usa o client Supabase na página; `page.tsx` só os renderiza.
- **Endpoint:** `NEW_ENDPOINT_REQUIRED`. `GET /api/profiles/usuarios` existe, mas devolve 4 campos e o tenant inteiro (seletores de formulário); `admin.ts` só lista reservas/estrutura para admin_global.
- **Semântica de "militares":** `profiles` com `role = 'usuario'` do tenant. A reserva do militar é a **lotação**, isto é, `reserve_memberships` (SP2). RLS `profiles_select`: staff vê o tenant; com o isolamento ligado, só a reserva ativa via `user_in_reserve(profiles.id, reserva_ativa)`, e a matriz (admin_global/auditor sem reserva ativa) vê todo o tenant. O dashboard (R-06, `countProfiles`) já usa o mesmo critério por `reserve_memberships!inner`. O BFF nunca lê a flag de isolamento.

## BEFORE
`page.test.tsx` (13 casos, handler real da página, borda mockada) contra a página antiga: **13 de 13 falham**.
- BEFORE_STAFF: renderiza linhas lidas direto do Supabase (sem dedos/contagem do BFF).
- `BATCH5_BEFORE_MODE_USER = VULNERABLE`: o mesmo staff com papel efetivo `usuario` (Modo Usuário) continua recebendo a tabela com dados de staff, porque a autorização é `profiles.role` e a leitura é pelo RLS do JWT.
- usuario comum / papel elevado só no perfil / identidade divergente: dependiam de `profiles.role`; nenhuma leitura passava pelo BFF.

## Implementação
| Arquivo | Mudança |
|---|---|
| `apps/bff/src/routes/profiles.ts` | novo `GET /api/profiles/militares` (roleGuard armeiro/admin_reserva/admin_global). Tenant da sessão (403 sem tenant). Escopo por `scopedReserveIds`: matriz = tenant; os demais = `reserve_memberships!inner` na reserva do escopo, `.in(...)` no banco. Erro de escopo (R-41) → `logFailure` + 500 sem consultar `profiles`. Ordem `nome_completo`, `id`. Empréstimos ativos por tenant (+ reserva fora da matriz) e digitais por tenant, só dos militares listados. `reserve_options` só para admin_global em matriz. Campos mínimos. Erros: 500 genérico + `logFailure` |
| `reserva/militares/page.tsx` | sem Supabase; autoriza por `resolveWebSessionRole` (fail-closed por identidade); `toolbarRole`/`editCallerRole` do papel EFETIVO; reserva da sessão; 401 → login, 403 → `/`, 5xx/rede/forma inesperada → aviso "Não foi possível carregar" (nunca "Nenhum usuário"); timeout 8 s; log em cada caso |
| `page.test.tsx` (13), `profiles-militares-scope.test.ts` (19) | novos |
`_militares-table.tsx`, `_user-actions.tsx`, handovers, `reserve-scope.ts`, `categories.ts`: **não alterados**.

## AFTER
| Cenário | Resultado |
|---|---|
| Staff A1 (armeiro/admin_reserva) | só militares com membership em A1 no tenant A; sem staff, sem tenant B, sem o do tenant B com membership em A1 (mesma `reserve_id`, outro tenant), sem quem não tem lotação |
| Outra reserva do mesmo tenant | militar exclusivo de A2 não aparece; staff A2 o vê |
| Tenant B | só os de B1 |
| Matriz (admin_global sem reserva ativa) | tenant inteiro (só `role=usuario`), opções de reserva ativas; contagem de empréstimos de todo o tenant |
| admin_global EM filial | confinado à reserva ativa, sem opções |
| Modo Usuário / usuário comum | página redireciona; endpoint 403 sem nenhuma consulta |
| Sem tenant / sem reserva ativa (não-matriz) | 403 / lista vazia sem consultar `profiles` |
| Erro de escopo (R-41) | 500 genérico, `profiles` não consultada |
| Erro de banco (profiles, lendings, biometric_templates) | 500 `{"error":"Erro ao buscar usuários"}`, sem vazar detalhe |
| Empréstimos "devolvido" ou de outro tenant | nunca contam; digital de outro tenant nunca entra |
Campos devolvidos: exatamente os que a tabela consome (sem hash de senha, role, tenant ou memberships).
**Limit/ordem:** a rota não tem `limit` de produto, então "filtro antes do limit" não se aplica. `profiles` é paginado em páginas de 1000 com ordem (`nome_completo`, `id`) e todo filtro de tenant/reserva ocorre no banco antes do `.range()`; lendings/digitais vão em blocos de 50 ids. A ordem tem desempate por `id` (guarda estática; o fake não ordena).

## Multi-sessão e Bearer (R-28)
`/api/profiles/*` está atrás do `authMiddleware` (`index.ts`); Modo Usuário rebaixa a `usuario` e Bearer sem sessão é limitado a `usuario`; o `roleGuard` barra ambos (`mode-user-auth-paths` 12/12, não duplicado). A página só envia o cookie `apmcb_session`.

## Contraprovas (arquivos restaurados; `cmp` conferido)
| # | Mutação | Resultado |
|---|---|---|
| M1/M2 | endpoint admite `usuario` (papel efetivo ignorado) | DETECTED |
| M3 | `profiles` sem filtro de tenant | DETECTED (4) |
| M3b | `lendings` sem tenant | DETECTED |
| M3c | digitais sem tenant | DETECTED |
| M4 | sem filtro de reserva (profiles) | DETECTED (4) |
| M4b | `lendings` sem reserva | DETECTED |
| C1 | lista inteira de ids na URL (sem blocos) | DETECTED (teste de escala) |
| C2 | sem paginação (trunca em 1000) | DETECTED (teste de escala) |
| M5 | limit antes do filtro | NOT_APPLICABLE (sem limit) |
| M7 | Bearer no lugar da sessão | NOT_APPLICABLE (a página só envia cookie; Bearer é limitado a `usuario` pelo `authMiddleware`) |
| M8 | sem fail-closed de tenant | DETECTED |
| R-41 | erro de escopo vira `[]` (filial) | EQUIVALENT (escopo de filial nunca lança; só papéis de matriz o consultam) |
| P1 | página sem autorização | DETECTED (4) |
| P2 | conjunto de papéis amplo | DETECTED |
| P3 | papel efetivo ignorado (Modo Usuário / `profile.role`) | DETECTED (6) |
| P4 | papel fixo ao cliente | DETECTED |
| P5 | sem cookie | DETECTED |
| P6 | reserva do casco nula | DETECTED |
| P7 | 403 não redireciona | DETECTED |
| M6 | restaurar leitura direta | DETECTED por "nenhuma leitura direta" e pela guarda estática (a página antiga falha 13/13) |

## Static guard
`page.test.tsx`: a página não importa `@/lib/supabase/(server|client)` nem `@supabase/`, não chama `.from(` e não usa `getSessionProfile`. Limitada a este alvo.

## Regressão
BFF unit 695/695 · integração 272/272 (inclui R-06, R-28, lotes 1–4, R-35, R-39, R-40, R-41, R-42/R-43) · web 353/353 · `tsc` BFF e web, `lint:logs`, eslint da página, `git diff --check` OK · hash R-35 intacto. E2E: **BLOQUEADO_AMBIENTE** (aponta para produção).

## Reviews
- **Security:** nenhum achado ≥ 8. Confirmou: sem bypass de Modo Usuário/Bearer; tenant filtrado em `profiles`, `lendings`, `biometric_templates` e `reserves`; membership de usuário do tenant B numa reserva do A não vaza; sem fail-open; **nenhuma exposição nova** (a RLS `profiles_select` e `biometric_staff_tenant` já davam aos mesmos papéis as mesmas colunas; só `finger_index` sai, sem template).
- **Code review (1ª passada):** 0 CRÍTICO, **1 ALTO**, 4 MÉDIO, 4 BAIXO; sem bloqueador de segurança.
  - **ALTO 1 (corrigido):** `.in("military_id"/"user_id", lista inteira de UUIDs)` poria centenas de ids na URL de uma GET (a página antiga fazia o mesmo, mas ignorava o erro e mostrava contagem 0; agora virava 500). Correção: lendings e digitais em **blocos de 50 ids** (cada bloco continua confinado por tenant e, fora da matriz, por reserva).
  - **MÉDIO 2 (corrigido):** teto de 1000 linhas do PostgREST truncava `profiles` em silêncio. `profiles` agora é **paginado por `.range()`** com ordem (nome, id). Teste com 1.104 militares.
  - **MÉDIO 3 (registrado, inferência):** reserva por membership vs. RLS com isolamento desligado; ver "Mudanças de comportamento". Militares sem `reserve_memberships` (convite sem `reserve_id`, falha do upsert de membership no cadastro) ficam visíveis só para a matriz: problemas de dado que a tela passa a expor. **Antes do deploy: conferir `reserve_isolation_enabled` por tenant e a lotação dos militares.**
  - **MÉDIO 4 (registrado):** `reserveId`/`role` vêm da iron-session (como em todas as rotas do BFF), não de `profiles.active_reserve_id` ao vivo; confirmar que a troca de reserva re-sela a sessão (não é específico deste lote).
  - **MÉDIO 5 (parcialmente tratado):** o fake continua sem ordenar nem aplicar teto de linhas/URL; adicionados teste de escala (paginação + blocos ≤ 50 ids), auditor/superadmin 403 e dependência de `reserves`. A guarda estática de ordem agora é tolerante a formatação.
  - **BAIXO 6 (corrigido):** `scopedReserveIds` só é chamado fora da matriz (a matriz não usa a lista; reduz um modo de falha). Consequência: o erro de escopo do R-41 só é alcançável para papéis de matriz, que esta rota não consulta; o `try/catch` ficou como defesa, e a mutação "erro de escopo vira `[]`" nesta rota é **EQUIVALENTE**.
  - BAIXOS 7–9: log duplicado no erro de escopo, builder preguiçoso, validação só por tipo dos arrays: sem ação.
- **Re-revisão focada** (blocos + paginação): 0 CRÍTICO, 0 ALTO; confirmou tenant/reserva em cada consulta e bloco, paginação com ordem total, `!inner` sem duplicar linhas, 500 genérico por bloco. Tratados: **MÉDIO** concorrência sem teto → no máximo 6 blocos em voo (empréstimos+digitais juntos); **MÉDIO** possível truncamento de `lendings` por bloco → resposta no teto de 1000 linhas falha alto (500, log `row_cap`) em vez de mostrar contagem errada (teste novo); **BAIXO** offset sem snapshot → dedupe por `id`; comentário desatualizado corrigido. Registrados: `reserve_options` só em matriz (igual à página antiga: `activeReserveId === null && admin_global`); ordem real não testada pelo fake.

## Mudanças de comportamento e limitações
- `superadmin` continua excluído (como antes).
- A reserva por membership é **inferida** (RLS com isolamento ligado + dashboard R-06); com o isolamento desligado a RLS era mais permissiva. Em tenant com militares sem `reserve_memberships`, o staff de filial deixa de vê-los (a matriz vê todos). Confirmar o estado do isolamento e o backfill de lotação antes do deploy.
- Falha de carga agora mostra aviso de erro (antes: lista vazia/"Nenhum usuário").
- O fake não ordena nem projeta colunas: ordem e projeção só têm guarda estática/asserção de chaves.
- Concorrência limitada a 6 blocos por rodada; para N militares são 2×ceil(N/50) requisições no total, em rodadas.
- Um bloco de empréstimos que atinja 1000 linhas derruba a listagem (falha alta, não truncamento silencioso).

## Inventário R-37 recontado (varredura de `apps/web/src/app/(dashboard)/{admin,reserva}/**/page.tsx` por `supabase/server`/`.from(`/`resolveWebSessionRole`)
`REMAINING_R37_DIRECT_STAFF_PAGES = 13` (+ `reserva/page.tsx`, caso especial).
- `admin/` (7): `page`, `arsenal`, `arsenal/manutencao`, `auditoria`, `comando`, `relatorios`, `usuarios`.
- `reserva/` (6): `arsenal`, `arsenal/manutencao` (**descoberta nesta recontagem**: lê via helper com o client Supabase e autoriza por `profiles.role`; não constava da lista anterior), `biometria` (WIP_BIOMETRIA), `passagens/[id]`, `relatorios`, `saidas/nova`.
- **Caso especial:** `reserva/page.tsx` (guarda só por cookie de UI + leituras diretas) e os cards de contagem de ocorrências (`reserva/page`, `admin/page`).
- Já migradas (6 páginas): `ocorrencias`, `solicitacoes`, `saidas`, `passagens`, `militares` (+ `reserva/page` parcialmente fora). Sem dados staff diretos (`supabase=0`, `.from=0`): `admin/arsenal/solicitacoes`, `admin/estrutura`, `admin/inventario`, `admin/livros`, `admin/saidas`, `reserva/cautelas`, `reserva/criar-armeiro`, `reserva/livro`.

## Status
**Lote 5: DONE_VERIFIED** (repositório; produção só após o deploy do BFF e do web). **R-34 e R-37: PARTIAL_IMPLEMENTATION.** R-44 e R-45 OPEN.
