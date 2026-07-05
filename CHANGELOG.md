# Changelog â€” APMCB Plataforma de GovernanÃ§a de Bens SensÃ­veis

> Mantido por convenÃ§Ã£o semÃ¢ntica. Datas em ISO 8601 (America/Recife, UTC-3).
> Roadmap completo: `docs/enterprise/02-enterprise-roadmap.md`
> DoD CanÃ´nica: `docs/enterprise/07-canonical-definition-of-done.md`

---

# 2026-07-05 (v13)

### Features

**Sidebar — Tooltips no modo colapsado + hamburger mobile-only**

* **`header.tsx` — hamburger duplicado removido**: O botão hamburger com `className="hidden md:flex"` que chamava `toggleSidebar` e ficava visível no desktop ao lado do próprio chevron do sidebar foi removido. Apenas o botão mobile (`className="md:hidden"`) permanece, abrindo o drawer deslizante
* **`sidebar.tsx` — TooltipProvider**: Toda a sidebar envoluta em `<TooltipProvider delay={300}>` (base-ui)
* **Tooltip no chevron**: Botão de colapso `btn-sidebar-toggle` com tooltip dinâmico "Fechar menu lateral" / "Abrir menu lateral" conforme estado; detectável por `getByRole("tooltip")`
* **Tooltips em ícones simples** (sem filhos): No branch colapsado (`!sidebarOpen`), cada link de navegação simples envoluto em `<Tooltip>` com `TooltipContent side="right"` exibindo o label da página
* **Tooltips em ícones accordion** (com filhos): No branch colapsado, tanto o ícone pai quanto cada ícone filho envolvidos em `<Tooltip>` individuais com `side="right"` — usuário pode navegar para qualquer sub-rota sem abrir o menu

### E2E

* Suite `sidebar-nav` (SDB-01..05): hamburger oculto em desktop, chevron visível, tooltip "Fechar menu lateral", colapso + tooltip "Abrir menu lateral", tooltip em ícone de nav colapsado

---

# 2026-07-05 (v12)

### Features

**Painel Efetivo — Materiais em uso com agrupamento enterprise**

* **`/efetivo` — "Materiais em uso" redesenhado**: substituída a tabela plana por `<MateriaisUsoClient>` com agrupamento por `movement_id` (mesma retirada = mesmo grupo), cabeçalho de grupo com armeiro e reserva, estado vazio com ícone
* **Checkboxes para export dinâmico**: seleção por item ou por grupo inteiro (toggle group); botão "Exportar PDF" desabilitado sem seleção, habilitado e mostra contagem quando há seleção; reutiliza o endpoint `/api/usuario/historico/pdf`
* **Toggle card/tabela**: modo cards (agrupado) e modo tabela (linhas individuais com colunas Armeiro e Reserva); padrão idêntico ao histórico
* **Busca em tempo real**: filtra grupos por nome ou categoria do material
* **Sidebar label**: accordion do efetivo renomeado de "Meus Materiais" → "Painel" em `sidebar.tsx` e `mobile-nav.tsx`

### Bug Fixes

* **`button.tsx` variant `outline` — contraste global**: `bg-background` substituído por `bg-white` + `text-foreground` + `shadow-xs`; todos os botões "Filtros", "PDF", "Exportar" em todas as rotas e roles agora contrastam visualmente com o fundo cinza da página em modo claro. Dark mode mantido

### E2E

* Suite `painel-materiais` (PAINEL-01..08, BTN-01..02): sidebar label, carregamento, agrupamento, checkboxes, PDF enable/disable, toggle tabela, busca, bg-white nos botões outline

---

# 2026-07-05 (v11.1)

### Bug Fixes

**TOTP — Regressão crítica na página de efetivo corrigida**

* **BFF `GET /api/totp/code`**: Quando o `TOTP_ENCRYPTION_KEY` diferia do key usado para criptografar o secret do militar, a desencriptação AES-GCM falhava e o endpoint retornava 500 causando regressão visível na página de efetivo. Agora retorna 422 com `{ needs_reconfigure: true }` para todos os endpoints TOTP (`/code`, `/validate`, `/self-validate`)
* **Frontend `totp-display.tsx`**: Tratamento explícito de 422 — para o polling (polling periódico desnecessário em caso de dados corrompidos), exibe mensagem orientando o militar a reconfigurar o autenticador no perfil. Antes mostrava genérico "Erro ao obter código." e continuava tentando a cada 5s
* **DB**: Secret inválido do cadete (matricula 000003) removido da tabela `totp_secrets`; `totp_configured = false` para que o fluxo de setup seja apresentado automaticamente no próximo acesso
* **Root cause**: `TOTP_ENCRYPTION_KEY` nunca pode ser alterado após uso em produção — todos os secrets criptografados com a key anterior tornam-se irrecuperáveis. Regra canônica reforçada em `totp_architecture.md`

---

# 2026-07-04 (v11)

### Features

**SSA — Overhaul UX Armeiro + Efetivo (v11)**

* **Armeiro `/reserva/solicitacoes`**: Cards redesenhados — seção "MATERIAIS SOLICITADOS" com label visível, categoria e quantidade; `remote_reason` em box âmbar para solicitações externas; `cancellation_reason` para canceladas; `armeiro_nota` em box verde; `is_external_request` badge "Externa"
* **Armeiro — Ação inline por card**: Substituídos os dois botões `Aprovar/Rejeitar` de largura total por `<select>` nativo por card + campos condicionais (textarea de nota para aprovar, input de motivo para rejeitar) + botão de confirmação compacto; estado `cardActions: Record<string, CardAction>` elimina dialogs globais
* **Armeiro — Toggle card/tabela**: Ícones `LayoutGrid`/`Table2` com estado `viewMode`; modo tabela com colunas Militar | Materiais | Status | Data | Ação
* **Armeiro — Paginação "Ver mais"**: `hasMore` via `limit + 1` no SSR; dropdown [20, 30] para selecionar quantidade; `?tab=&limit=` preservado na URL
* **Efetivo `/efetivo/solicitacoes`**: Convertido de SSR puro para SSR+cliente interativo; busca por material em tempo real; tabs de status (Todas/Pendentes/Aprovadas/Rejeitadas/Retiradas/Canceladas); toggle card/tabela; paginação "Ver mais" [20, 30]; cards renderizam `SolicitacaoStatusCard` (reaproveitamento total — sem duplicação)
* **Sidebar**: `usuario` — "Meus Materiais" agora é accordion com chevron; filhos: "Minhas Cautelas" + "Solicitações Remotas"; grupos auto-abertos quando rota filha está ativa; sidebar recolhida mostra ícones pai + filhos diretamente; `master` — link "Solicitações" → `/reserva/solicitacoes` adicionado
* **Mobile nav**: Mesma estrutura `NavItem` com `children?`; filhos sempre expandidos com indent visual; sem accordion (mobile já tem espaço vertical)
* **E2E**: Nova suite `ssa-ui-suite` (ARM01-ARM10, EFT01-EFT10) validando materiais, ação inline, toggle, paginação, accordion do sidebar

### Bug Fixes

* `_solicitacoes-client.tsx`: Interface `Request` agora inclui `remote_reason`, `is_external_request`, `cancellation_reason` — antes esses campos chegavam mas eram silenciosamente ignorados
* `reserva/solicitacoes/page.tsx`: `cancellation_reason` adicionado ao SELECT do Supabase; `searchParams.limit` suportado para paginação SSR

---

# 2026-07-04 (v10)

### Bug Fixes

**SSA — `POST /api/ssa/requests` retornava 500 (TOTP Base32 inválido)**
* Causa: `ssa.ts` chamava `verifySync({ secret: totpData.secret, ... })` com o blob criptografado `v1:...` diretamente como secret Base32 — a mesma correção feita no `totp.ts` na v8 nunca foi aplicada ao SSA
* Fix: `readSecret` agora exportado de `totp.ts` e importado/usado em `ssa.ts` antes de qualquer chamada a `verifySync`; ambas as chamadas (POST /requests e endpoint de re-validação) cobertos com try/catch explícito para não propagar throw do otplib → 500 global

**SSA — Autocomplete de material exibia lista completa por padrão**
* Causa: `filteredMaterials` retornava `materials` inteiro quando a busca estava vazia
* Fix: retorna `[]` quando `materialSearch` está vazio; filtra para `disponivel === true` apenas; 3 estados de UI: "Digite para buscar" (vazio), "Nenhum material disponível" (sem resultado), lista agrupada (com resultados)

### DB Changes

**`reserve_memberships` — role `usuario` adicionado ao check constraint**
* Constraint expandido: `('admin_reserva','armeiro','auditor_reserva','usuario')` — permite registrar usuários regulares como membros de uma reserva sem papel de staff
* Cadete (matricula 000003) inserido como `role='usuario'` na reserva APMCB — elimina o aviso "reserva fora da sua unidade" e o step de motivo ao selecionar a APMCB

---

# 2026-07-04 (v9)

### Bug Fixes

**SSA — 9 bugs críticos corrigidos no fluxo de Solicitação Remota**

* **BUG-RR-01 (CRÍTICO)** `allow_remote_requests` — migration SQL nunca havia sido aplicada; coluna existia com `DEFAULT true` sem controle real. Migrations aplicadas via Supabase MCP: `allow_remote_requests BOOLEAN NOT NULL DEFAULT false`, `remote_allowed_categories TEXT[] NOT NULL DEFAULT '{}'`
* **BUG-RR-02 (CRÍTICO)** `notifyAllArmeios()` enviava notificações push sem filtro de `tenant_id` — qualquer nova SSA notificava armeios de outros tenants. Substituído por `notifyArmeiosOfTenant(tenantId)` que filtra por `default_tenant_id`
* **BUG-RR-03 (CRÍTICO)** RLS `ssa_military_select` e `ssa_staff_update` sem cláusula `tenant_id` — armeiro podia ver e atualizar SSAs de outros tenants. Migrations D corrigiram ambas as policies
* **BUG-RR-04 (ALTO)** `reserve_id`, `tenant_id`, `is_external_request` e `remote_reason` nunca eram salvos no INSERT de `material_requests` — campos sempre nulos. BFF corrigido para incluí-los no INSERT
* **BUG-RR-05 (ALTO)** Push deep link enviado ao armeiro apontava para `/efetivo/solicitacoes` (página do efetivo) em vez de `/reserva/solicitacoes`. Corrigido via parâmetro `url` em `notifyUser`
* **BUG-RR-06 (MÉDIO)** `GET /api/ssa/available-materials` não verificava `allow_remote_requests` nem `remote_allowed_categories` para usuários externos. BFF agora rejeita requests de reservas bloqueadas e filtra categorias não autorizadas
* **BUG-RR-07 (MÉDIO)** Listagem do armeiro em `/reserva/solicitacoes` não filtrava por `tenant_id` no front (RLS apenas não é suficiente para defense-in-depth). Query agora com `.eq("tenant_id", profile.default_tenant_id)`
* **BUG-RR-08 (MÉDIO)** Contagens de pendências no dashboard do armeiro (`ssaPendingCount`, `retiradaCount`) sem filtro de tenant — exibia totais globais. Corrigido com filtro condicional por `default_tenant_id`
* **BUG-RR-09 (BAIXO)** Sem limite de quantidade no stepper de materiais — usuário podia solicitar qualquer número. Adicionado `Math.min(10, ...)` no front e `.max(10)` no schema Zod do BFF

### Features

**SSA — 8 novos requisitos implementados (RR-01..RR-08)**

* **RR-01** Combobox com autocomplete substituindo lista plana: campo de busca com filtro em tempo real, dropdown com click-outside, badge "Membro" para reservas de membership
* **RR-02** Filtro de reservas disponíveis: `GET /api/reserves/mine` agora retorna apenas reservas com `allow_remote_requests = true` ou onde o usuário é membro; flag `is_member` incluída na resposta
* **RR-03** Toggle admin para habilitar/desabilitar acesso remoto da reserva: `PATCH /api/reserves/:id/settings` aceita `allow_remote_requests` (booleano); `ReserveRemoteAccessToggle` atualizado; migration SQL aplicada
* **RR-04** Controle granular por categoria: `remote_allowed_categories TEXT[]` em `reserves`; BFF filtra materiais por categoria quando usuário é externo (não-membro); `PATCH /api/reserves/:id/settings` aceita o array
* **RR-05** Campo "motivo" obrigatório para externos: step `"motivo"` inserido no fluxo quando `!reserve.is_member`; `Textarea` com validação mínima de 10 chars; sugestões rápidas de texto; `remote_reason` salvo no banco
* **RR-06** Autocomplete de material: input de busca no step de seleção com filtro em tempo real via `useMemo`; estado vazio explícito; itens com `data-testid="ssa-material-item-{id}"`
* **RR-07** Armeiro: notificações tenant-safe via `notifyArmeiosOfTenant`; listagem e painel filtrados por tenant; `approve`, `reject`, `deliver` agora verificam `tenant_id` antes de agir (403 se discrepante)
* **RR-08** Efetivo: cancelamento com motivo obrigatório (min 10 chars) — novo endpoint `PATCH /api/ssa/requests/:id/cancel`; botão "Cancelar solicitação" em cards `pendente` e `aprovado`; dialog de confirmação; RLS `ssa_military_cancel` extendida para status `aprovado`; armeiro notificado via push

### Tests

**E2E — `remote-requests.spec.ts` (40 testes, todos `test.skip` — harness pendente de dados)**
* Grupos: RR01-RR30 (fluxo funcional), SEC-RR01-05 (isolamento cross-tenant), ADM-RR01-05 (controles admin)
* Suite adicionada ao `playwright.config.ts`: `remote-requests-suite` (1 worker, 60s timeout)
* Testids documentados: `ssa-reserve-combobox`, `ssa-reserve-search`, `ssa-reserve-option-{id}`, `badge-membro`, `ssa-motivo-textarea`, `btn-motivo-next`, `ssa-material-search`, `ssa-material-item-{id}`, `ssa-materials-empty`, `btn-cancelar-solicitacao`, `ssa-cancel-reason`, `btn-confirm-cancel`

---

# 2026-07-04 (v8)

### Bug Fixes

**TOTP — Corrige 500 em `/api/totp/code` (regressão crítica)**
* `readSecret`: antes retornava blob `v1:...` criptografado como plaintext quando `TOTP_ENCRYPTION_KEY` ausente — `generateSync` explodia fora do try/catch. Agora lança `TOTP_SECRET_ENCRYPTED_BUT_NO_KEY` antes de passar garbage ao otplib
* `GET /code`: `generateSync({ secret })` movido para dentro do bloco try/catch — qualquer throw é capturado e retorna 500 com JSON de erro, não Hono 500 opaco
* `/validate` e `/self-validate`: adicionado try/catch em torno de `readSecret` — antes qualquer throw virava 500 sem mensagem útil
* DB: deletado secret criptografado do cadete (matricula 000003) armazenado com chave diferente — cadete re-provisiona via `/api/totp/setup` automaticamente

**UI — React #418 (hydration mismatch)**
* `apps/web/src/app/layout.tsx`: adicionado `suppressHydrationWarning` em `<body>` — browser extensions modificam atributos de `<body>` causando mismatch que disparava #418

**BFF — `.env.example` documentado**
* `TOTP_ENCRYPTION_KEY`: documentado com aviso crítico — nunca alterar após existirem secrets criptografados no banco (chave diferente = todos os secrets inválidos → TOTP 500 em cascata)

### Tests

**E2E — `totp-regression.spec.ts` (TOTP-R01..R11) — 11/11 passing**
* TOTP-R01..R04: shape do payload `{ code, seconds_remaining, period }`, `code` = 6 dígitos, `seconds_remaining` ∈ [1,30], `period === 30`
* TOTP-R05: sem autenticação → 401
* TOTP-R06: 3 chamadas consecutivas nunca retornam 500
* TOTP-R07: user sem TOTP configurado → 404 (não 500)
* TOTP-R08: `POST /validate` token inválido → 200 `{valid:false}` ou 404/429, nunca 500
* TOTP-R09: `POST /self-validate` token inválido → nunca 500
* TOTP-R10: UI `TOTPDisplay` exibe 6 dígitos no card expandido (não "Erro ao obter código")
* TOTP-R11: console sem React #418 ao carregar dashboard

---

# 2026-07-04 (v7)

### Tests

**E2E — Bug Sprint 001: 45/46 passando (1 skipped por dados ausentes)**
* `e2e/harness.ts`: corrigido `landAt: "/registro-pendente"` → `"/efetivo"` para cadete com `registration_status: complete`
* `e2e/bug-sprint-001.spec.ts`: 5 correções de locators/lógica:
  - FLT01: `text=/sem estoque/i` trocado por `[data-testid='arsenal-card'] span.badge-danger` (badge real é "Crítico")
  - FLT05: locators corrigidos para `arsenal-card` / `arsenal-row` (testids reais do componente)
  - PDF04: test agora seleciona o segundo `<select>` (Reserva, não Departamento) antes de verificar botão
  - CAT02: input locator atualizado para `#req-nome` / fallback genérico (sem `name="nome"`)
  - GRP/EF/CAT07 (10 testes): desbloqueados pela correção do `landAt`

---

# 2026-07-03 (v6)

### Bug Fixes

**UI — Inputs brancos com contraste em todas as páginas**
* Todos os campos de busca/autocomplete agora usam `bg-white dark:bg-card` — contraste 100% branco contra o fundo cinza da página
* Botões inativos (status tabs, toggle card/grade, "Ver mais", pills de filtro) passam de `bg-background`/`bg-card` para `bg-white dark:bg-card` com hover na cor primária do tenant (`hover:bg-primary/10 hover:border-primary/40`)
* Arquivos afetados: `grid-search-input`, `historico-client`, `minhas-cautelas-client`, `saidas-client`, `admin-saidas-client`, `militares-table`, `cautelas-client`, `arsenal-client`, `arsenal-filters`, `admin-livros-client`, `aprovacao-client`

### Tests

**E2E — Bug Sprint 001 spec harness**
* `e2e/bug-sprint-001.spec.ts`: 35 testes cobrindo GRP01-05 (agrupamento), AC01-07 (autocomplete), FLT01-05 (filtros), CHK01-05 (checkbox), PDF01-06 (PDF enterprise), MOV01-06 (movement grouping), CAT01-07 (categoria request), EF01-05 (feature parity efetivo)

### Features

**Listagem — Busca + filtro status em arsenal, militares e minhas-cautelas**
* `admin/arsenal/_arsenal-filters.tsx`: filtro por estoque (Todos/Disponível/Em uso/Sem estoque) via pill tabs
* `reserva/militares/_militares-table.tsx`: busca livre por nome/matrícula/posto com estado vazio
* `efetivo/minhas-cautelas/_minhas-cautelas-client.tsx`: busca por material/categoria/armeiro + filtro status (Todas/Ativas/Devolvidas/Em revisão/Substituídas); tabela e cards iterando sobre `filtered`

---

# 2026-07-04 (v5)

### Bug Fixes (Sprint 001)

**TOTP 500 regression corrigida**
* `apps/bff/src/routes/totp.ts`: `readSecret` agora detecta prefix `v1:` antes de descriptografar — secrets legados em plaintext (sem encryption key no container antigo) são retornados diretamente, eliminando o 500

**Bug 4 — Checkbox click area**
* `_saidas-client.tsx` + `_admin-saidas-client.tsx`: todos os `<input type="checkbox">` recebem `onClick={(e) => e.stopPropagation()}`, `size-5` e `relative z-10` para área de clique correta

**Bug 6 — PDF enterprise**
* `grid-pdf-button.tsx`: reescrito com header profissional (logo tenant, nome do armeiro, nome da reserva, data/hora de emissão, total selecionado), filtro por `selectedGroupKeys`, hash SHA256 no footer, loading spinner durante geração
* `page.tsx` da reserva/saidas: busca `reserve_memberships` para obter nome da reserva e logo; passa `reserveName`, `armeiroName`, `tenantLogoUrl` para `SaidasClient`

**Bug 8 — Agrupamento por movement_id**
* `nova/_form.tsx`: `movementId` sempre gerado via `crypto.randomUUID()` (não mais `null` para 1 item)
* `_saidas-client.tsx` + `_admin-saidas-client.tsx`: fallback de `groupByRetirada` trunca `issued_at` ao minuto — saídas quasi-simultâneas de mesmo militar são agrupadas
* Cards de itens devolvidos agora exibem hora de `returned_at`

### Features

**Bug 7 — Armeiro solicita nova categoria**
* Migration `category_requests`: tabela com RLS (armeiro vê próprias, admin vê todas do tenant)
* BFF: `POST /api/categories/request`, `GET /api/categories/requests`, `POST .../approve`, `POST .../reject`
* `_category-manager.tsx`: botão "Adicionar categoria" visível para armeiro, abre modal com nome/ícone/descrição e botão "Solicitar aprovação do admin"

---

# 2026-07-03 (v4)

### Features

**Padrão universal de listagem — P3 a P9 (todas as páginas restantes)**

* `/admin/saidas` (`_admin-saidas-client.tsx`): checkboxes por grupo e por item com indeterminate; `selectedIds` state; exportação dinâmica (disabled sem seleção, mostra contador); `displayLimit` client-side com "Ver mais" dropdown 20/30; tooltips toggle renomeados para padrão canônico; `data-testid="admin-saidas-group"` adicionado
* `/admin/arsenal` (`_arsenal-filters.tsx`): toggle card/grade (default cards); novo componente `MaterialCard` com foto, quantidades, `AvailabilityBar`, `StockStatusBadge` e `MaterialRowActions`; checkboxes em card e em tabela (thead indeterminate); exportação dinâmica; `displayLimit` client-side com "Ver mais"
* `/admin/usuarios` (`_users-table.tsx`): toggle card/grade (default cards); novo componente `UserCard` com foto, matrícula, role badge, status badge e ações; checkboxes em card e em tabela; exportação dinâmica; `displayLimit` client-side com "Ver mais"; `useMemo` para filtro
* `/reserva/militares` (`_militares-table.tsx`): toggle card/grade (default cards); novo componente `MilitarCard` com foto, nome, status bio/TOTP, badge "em uso"; checkboxes; exportação dinâmica; `displayLimit` client-side com "Ver mais"; ações preservadas; lightbox e sheet `MilitarSheet` intactos
* `/reserva/ocorrencias` (`page.tsx` + novo `_ocorrencias-client.tsx`): página SSR refatorada com `limit` searchParam (default 10, max 30); novo client component com toggle card/grade, busca por texto, checkboxes, exportação dinâmica, "Ver mais" via `router.push`; `data-testid="ocorrencia-card"`
* `/admin/inventario` (`page.tsx`): toggle card/grade; checkboxes com indeterminate em tabela; exportação dinâmica; `displayLimit` client-side com "Ver mais"; cards com `data-testid="inventario-card"`
* `/efetivo/minhas-cautelas` (`_minhas-cautelas-client.tsx` + `page.tsx`): `page.tsx` SSR com `limit` searchParam; client component recebe `hasMore` + `currentLimit`; toggle card/grade; checkboxes; exportação dinâmica; "Ver mais" com redirect; botão PDF por item preservado em ambos os modos

---

# 2026-07-03 (v3)

### Bug Fixes

**React #418 + 401 race condition corrigido**
* `hooks/use-role-guard.ts`: primeiro check do BFF adiado 3s para dar tempo ao iron-session estabelecer após login Supabase; eliminado `router.push` durante hidratação

### Features

**Padrão universal de listagem — Armeiro Saídas**
* `reserva/saidas/page.tsx`: paginação SSR via `?limit=N` (default 10, max 30); busca `limit+1` para detectar `hasMore`; slicing correto antes de resolver foto URLs
* `reserva/saidas/_saidas-client.tsx`: props `hasMore` + `currentLimit`; estado `selectedIds` (Set); checkboxes com indeterminate em GroupCard (grupo) e por item; checkbox "selecionar todos" na thead da tabela; "Ver mais" dropdown 20/30 com `router.push`; exportação dinâmica: botão Exportar desabilitado sem seleção, mostra contador `(N)` quando selecionado, filtra `data-group-key` no DOM ao imprimir; títulos de toggle corrigidos para `"Ver em cards agrupados"` e `"Ver em grade"`; `data-testid="saidas-group"` e `data-testid="saidas-item"` adicionados
* `components/shared/grid-pdf-button.tsx`: props `disabled` e `selectedGroupKeys` adicionadas; handlePrint filtra grupos por `data-group-key` quando `selectedGroupKeys` fornecido

**Dashboard Armeiro — bugs e UX**
* `reserva/page.tsx`: link "Devoluções Pendentes" corrigido de `?status=pendente` para `?status=ativo`; `ActionCard` recebe `group relative` e tooltip CSS no padrão MiniStatLink (aparece acima do card no hover)

**Histórico do Efetivo — default cards**
* `efetivo/historico/_historico-client.tsx`: `viewMode` defaulta para `"cards"` (era `"table"`)

### Tests (E2E)
* `e2e/armeiro-saidas.spec.ts`: novo spec AS01-AS25 (paginação, filtros, toggle, seleção/export, link dashboard, tooltips)
* `e2e/admin-saidas.spec.ts`: novo spec ADS01-ADS20
* `e2e/admin-arsenal.spec.ts`: novo spec AAR01-AAR15
* `e2e/admin-usuarios.spec.ts`: novo spec AU01-AU15
* `e2e/reserva-militares.spec.ts`: novo spec ML01-ML15
* `e2e/reserva-ocorrencias.spec.ts`: novo spec OC01-OC15
* `e2e/admin-inventario.spec.ts`: novo spec INV01-INV15
* `e2e/efetivo-cautelas.spec.ts`: novo spec MC01-MC15
* `e2e/historico-usuario.spec.ts`: HU02/03/08 atualizados para clicar toggle antes de assertions de tabela
* `playwright.config.ts`: 8 novos projetos de suite (armeiro-saidas, admin-saidas, admin-arsenal, admin-usuarios, reserva-militares, reserva-ocorrencias, admin-inventario, efetivo-cautelas)

---

# 2026-07-03 (v2)

### Features

**Histórico do Efetivo — toggle card/grade + agrupamento por movimentação**
* `efetivo/historico/_historico-client.tsx`: adicionado toggle `LayoutGrid` / `Table2` idêntico ao armeiro; modo cards agrupa lendings por `movement_id` (fallback `issued_at`) via novo componente `HistoricoCardView`; tabela original preservada como vista "grade" sem alterações; "Ver mais" com dropdown 20/30 registros aparece quando limite foi atingido
* `bff/src/routes/usuario.ts`: `movement_id` adicionado ao SELECT; param `limit` (default 500, max 500 — cards passam 10/20/30); `toHistoricoLending` mapeia o campo novo
* `bff/src/lib/pdf/historico-pdf.ts`: `movement_id: string | null` adicionado em `HistoricoLending`

**Armeiro saídas — hora da saída no GroupCard**
* `reserva/saidas/_saidas-client.tsx`: `formattedDate` no `GroupCard` agora inclui hora (`"02 jul. 2026 · 21:28"`); assinatura de `onReceber` extendida para `(ids, militaryMatricula?)` em `GroupCard`, `SaidasTable` e callbacks pai

**Modal "Receber Material" — fluxo 80/20 + observações**
* `reserva/saidas/_saidas-client.tsx`: estado `militaryMatricula` adicionado ao `SaidasClient`; ao clicar "Receber" num grupo, matrícula do militar é passada automaticamente para a modal; reset ao fechar
* `reserva/saidas/_desarmamento-modal.tsx`: prop `militaryMatricula?` adicionada; quando preenchida, oculta input de matrícula TOTP e exibe banner "Identificando Mat. XXXXX"; estado `observacoes` + textarea opcional na fase 2; `bulk-return` envia `notes` quando preenchido

### Tests (E2E)
* `e2e/historico-usuario.spec.ts`: HU11-HU15 adicionados (toggle, modo cards, hora, limit param, busca em cards)
* `e2e/desarmamento-receber.spec.ts`: novo spec DM01-DM04 (hora no GroupCard, banner matrícula pré-preenchida, campo observações, modal geral sem pré-preenchimento)
* `playwright.config.ts`: projeto `desarmamento-suite` adicionado (depende de `armeiro-setup`)

---

# 2026-07-03

### Fixes (E2E — armeiro-suite + criar-armeiro-suite + livro-suite)

* **playwright.config.ts:** Removido projeto `livro-setup` duplicado — `livro-suite` agora depende de `armeiro-setup` (ambos usavam o mesmo setup file e escreviam no mesmo `.auth/armeiro.json` concorrentemente; race condition corrompia o arquivo mid-run, causando login redirect em AR12-AR18 e LDS09+)
* **e2e/criar-armeiro.spec.ts:** Seletor de e-mail no login corrigido de `[name=email], input[type=email]` para `#email` — o campo no login tem `type="text"` e `id="email"` sem atributo `name`, causando fill silencioso e falha de login em CA01/CA02
* **e2e/livro-digital.spec.ts:** Regex `/turno ativo/i` substituída por `/turno ativo —/i` em todas as guards condicionais — a versão anterior também batia em "Sem turno ativo" (badge do estado inativo), fazendo LDS04 sempre pular (skip) e LDS05-LDS14 nunca pularem quando deveriam

---

# 2026-07-02 (v2)

### Fixes

* **e2e/invite-privilege:** `apiLogin` não retornava `csrfToken` do corpo JSON do BFF — `callInvite` usava token hardcoded "e2e-test" que nunca correspondia ao token armazenado na iron-session; causa raiz dos falhos INV-01/03/05/07. Refatorado para usar `LoginResult { cookie, csrfToken }` em toda a suite.

### Docs

* **PRD §13/18/22/25/26:** Estado atual reescrito — Fase 7C concluída, RLS/RF24/ENT11/ENT12 marcados ✅, RF26/RF27/ENT13 adicionados
* **Roadmap v1.1:** Fase 7C marcada concluída; Fase 7D 🔵 EM PROGRESSO com spec detalhada (ícones de unidade + painel admin_reserva)

---

# 2026-07-02

### Features (Saídas Enterprise — Fase 7C continuação)

* **db/security:** `profiles_update` RLS recriada sem roles legados (`admin`, `military`) — self-update agora inclui `armeiro` e `auditor`
* **shared/combobox:** `ComboBox<T>` extraído de `_form.tsx` para `components/shared/combobox.tsx` — reutilizável em toda a aplicação
* **reserva/saidas:** filtros de data (from/to) com client-side filtering, toggle Cards↔Tabela, botão Exportar PDF via `GridPdfButton`
* **admin/saidas:** nova página `/admin/saidas` — monitor de saídas por reserva para admin_global; seletor Departamento→Reserva, filtros search/data/status, toggle Cards↔Tabela, exportar PDF
* **bff/admin:** `GET /api/admin/saidas` com RBAC admin_global/superadmin + validação cross-tenant (reserve.tenant_id === caller.tenantId)
* **sidebar/admin:** link "Saídas" adicionado ao nav do admin (entre Arsenal e Estrutura)

### Security

* **Fase 7C — Bug 1:** `requireNexusSession` já continha `role !== "superadmin"` — verificado e confirmado seguro
* **Fase 7C — Bug 2:** `material_availability` com `security_invoker = on` — confirmado via query no DB
* **Fase 7C — Bug 3:** RLS policies verificadas no DB — todas usam novos roles; `profiles_update` corrigida

---

# 2026-07-01 (v2)

### Features (Nexus — CRUD completo + UX)

* **nexus/superadmins:** CRUD completo por linha — botão Editar (dialog com nome, matrícula, posto, status) e Remover (confirm dialog que revoga role→usuario + desativa); guard impede auto-remoção
* **nexus/tenants:** aba "Cadastro" dentro de cada accordion com campos: valor contrato, vigência início/fim, responsável nome/e-mail/telefone, endereço, observações — salva via `PATCH /api/nexus/tenants/:id`
* **nexus/tenants:** formulário de criação de tenant inclui todos os campos contratuais (seção "Informações Contratuais")
* **bff/nexus:** `PATCH /api/nexus/superadmins/:id` + `DELETE /api/nexus/superadmins/:id` com audit log e guard anti-auto-remoção
* **nexus/tenants:** tooltips em todos os badges (Res:, Us:, Status, Tipo, Structure) via `@base-ui/react/tooltip`
* **nexus/tenants:** `userCount` corrigido — query separada no BFF elimina o `profiles(count)=0` causado por FK não descoberto pelo PostgREST
* **nexus/tenants:** remoção do TabsList externo; lista direta com toggle "+ Novo Tenant" no header (menos fricção, sem card desnecessário)

### Fixed

* **nexus/metrics-grid:** valores invisíveis no tema claro — `text-white` hardcoded → `text-gray-900 dark:text-white`
* **nexus/header:** header branco no tema dark — classe duplicada `dark:bg-white` após `dark:bg-[#0D0D14]` sobrescrevia; removida a duplicata
* **nexus/sidebar:** label "Controle" e links de nav invisíveis no tema claro — cores condicionadas a `dark:` variants
* **e2e/apmcb.spec:** `x-content-type-options` usa `toContain` em vez de `toBe` — BFF + Nginx duplicam o header (`nosniff, nosniff`)

---

# 2026-07-01

### Fixed

* **auth/exchange:** Supabase invite usa PKCE flow (`?code=` query param), não implicit flow (hash). `exchange/page.tsx` detecta `?code=` primeiro e chama `exchangeCodeForSession()` — eliminava "Falha na autenticação" ao clicar no link de convite.
* **mobile/hamburger:** Botão hamburger mobile agora abre drawer deslizante (`MobileNav`) com todos os itens do menu por role (admin=8, master=8, usuario=3). Desktop continua colapsando sidebar lateral. `ui.store` ganhou `mobileMenuOpen`, `toggleMobileMenu`, `closeMobileMenu`.
* **estrutura/crud:** Botões editar e excluir adicionados para OrgUnit (header do card) e Reserve (ações na linha). Dialogs de edição com formulário completo (nome, sigla, tipo/status, ícone). Dialog de confirmação destrutiva para exclusões.

### Security

* **bff/csrf:** CSRF token migrado de cookie duplo-submit para iron-session criptografada — cookies stale entre deploys causavam 403 CSRF em todos os PATCHs/POSTs após redeploy do BFF.
* **bff/invite:** `supabase.auth.admin.inviteUserByEmail()` via SDK substitui fetch manual para `/auth/v1/admin/invite` (retornava 404) — endpoint correto é `/invite` via GoTrue client.

### Fixed

* **db/reserves:** `status` corrigido de `"active"/"inactive"` para `"ativa"/"inativa"` — violava constraint `reserves_status_check`; afetava criação e atualização de reservas.
* **db/inventory:** `material_availability` query em `inventory.ts` corrigida para `.eq("status", "ativa")`.
* **auth/header:** `ROLE_DASHBOARD["superadmin"]` apontava para `/nexus` (loop 401); corrigido para `/nexus/login`.

### Note

* **supabase/invite:** Emails `@apmcb.dev` rejeitados por validação MX no Supabase GoTrue — requer desabilitar "Validate email addresses" em Authentication > Settings no dashboard Supabase. Domínios com MX (gmail, institucional) funcionam normalmente.

### Features (saídas enterprise)

* **saidas/grid:** UI `/reserva/saidas` reescrita com cards agrupados por `movement_id`, busca client-side, tabs Todas/Ativas/Devolvidas e botão "Receber Material"
* **desarmamento/identity-first:** modal `_desarmamento-modal.tsx` — identificação (TOTP/biometria/manual) → confirmação de itens com countdown TTL 2min
* **lendings/movement_id:** nova coluna `UUID` nullable agrupa múltiplos itens da mesma operação em 1 card; migration `20260701000001_lendings_movement_id.sql`
* **bff/lendings/identify:** `POST /api/lendings/identify` discriminatedUnion (totp|biometria|manual), pendingIdentity iron-session TTL 2min
* **bff/lendings/bulk-return:** `POST /api/lendings/bulk-return` devolução atômica; valida military_id + tenant_id; Phase 5 compat material_items
* **bff/totp/identify:** `checkTotpForMatricula()` exportado de `totp.ts`, reutilizado em `lendings.ts` (SSOT, sem duplicação)
* **bff/biometric/minScore:** `BIOMETRIC_MIN_SCORE=0.92` env-configurável em `biometric.ts` e `lendings.ts`
* **grid/shared:** `useGridState`, `GridSearchInput`, `GridSortHead`, `GridPdfButton`, `GridRowCheckbox` em `components/shared/`
* **arsenal/armeiro:** grade/lista toggle + busca + PDF — modo lista com `GridSortHead`, modo grade preserva cards
* **arsenal/admin:** `GridSearchInput` + `GridSortHead` + `GridPdfButton` em `_arsenal-filters.tsx`
* **efetivo/materiais:** `MateriaisTable` com `useGridState` + `GridSortHead` + busca substitui lista estática

### Bug Fixes (saídas enterprise)

* **saidas/ativas:** `page.tsx` filtrava `.eq("status", status)` — coluna certa é `status_legacy`; fix: `.eq("status_legacy", status)`
* **e2e/harness:** `USERS.cadete.landAt` corrigido de `/cadete` para `/efetivo` (BFF auth exchange roteia usuarios para `/efetivo`)

### Validation (saídas enterprise)

* Suite `saidas-enterprise-suite`: **12 passed, 5 skipped (intencionais), 0 failed**
* Build ✅ · Typecheck ✅ · BFF green slot :3002 · commit `6052ebd`
* Report: `docs/enterprise/reports/saidas-enterprise-final-report.md`

---

# 2026-06-30

### Security

* **bff/nexus:** `requireNexusSession` corrigido — condição `role !== "admin_global" && role !== "superadmin"` invertida permitia admin_global em todos os endpoints Nexus; fix: `role !== "superadmin"`.
* **db/views:** `material_availability` restaurado com `security_invoker = on` — migration `20260629000002` havia desfeito o fix de `20260629000007`.
* **rbac/invite-ceiling:** INVITE_CEILING SSOT em `apps/bff/src/lib/invite-ceiling.ts` — cada role só convida até seu teto (superadmin→admin_global, admin_global→{admin_global,admin_reserva,armeiro,usuario}, admin_reserva→{armeiro,usuario,auditor}, armeiro→{usuario}).

### Features

* **nexus/invite:** `POST /api/nexus/tenants/:id/invite` — superadmin convida admin_global via Nexus com TOTP.
* **nexus/patch:** `PATCH /api/nexus/tenants/:id` — altera `structure_mode` (simple/structured) com confirmação no UI.
* **admin/invite:** `POST /api/admin/users/invite` — endpoint unificado com validação de Privilege Ceiling.
* **reserva/convidar:** página `/reserva/criar-armeiro` renomeada para "Convidar para Reserva" com role selector por nível RBAC.
* **estrutura/icones:** org_units ganham `icon_name` com picker de 18 ícones Lucide; ícone dinâmico exibido no header de cada unidade.
* **estrutura/admin-reserva:** `ReserveRow` exibe admin_reserva atual ou link inline "Convidar admin"; dialog de convite com `reserve_id` pré-preenchido.
* **estrutura/gate:** "Nova Unidade" só aparece em `structure_mode=structured` (ativado pelo superadmin via Nexus).
* **nexus/ui:** Nexus tenants page ganha dialog de convite + badge clicável de structure_mode com confirmação antes de alterar.

### Database

* **supabase:** migration `20260629000006_requirenexus_fix.sql` — view security fix (já aplicada).
* **supabase:** migration `20260630000003_fix_material_availability_security_invoker.sql` — restaura `security_invoker=on`.
* **supabase:** migration `20260701000001_org_units_icon_name.sql` — ADD COLUMN `icon_name` em `org_units`.

### Tests

* `apps/web/e2e/invite-privilege.spec.ts` — INV-01..INV-08 + SEC-02 + SEC-03 (Privilege Ceiling + nexus guard).

### Validation

* `pnpm typecheck` OK (web + bff). `pnpm --filter web build` OK.
* BFF deployado em 91.99.113.89 — Health OK.
* CF Pages deploy via push to main.

---

# 2026-06-29

### Security

* **rls/auditoria:** auditoria global de seguranÃ§a â€” 14 achados em 4 categorias (crÃ­tico/alto/mÃ©dio/baixo). Migrations `000001`â€“`000005` aplicadas ao banco real.
* **rls/tenant-isolation (C1):** backfill de `default_tenant_id` + `tenant_memberships` + `reserve_memberships` para todo staff scoped (admin_reserva 17/17, armeiro 8/8, auditor 9/9). RLS com filtro de tenant enforÃ§ado em 6 tabelas: `profiles`, `lendings`, `material_types`, `audit_logs`, `biometric_templates`, `material_items`.
* **rls/roles (C2):** policies de 6 tabelas atualizadas para roles novas (`admin_global`, `superadmin`, `armeiro` etc.) â€” roles antigas `admin`/`master` removidas de todos os predicados.
* **storage (C4):** buckets `profile-photos` e `material-photos` passaram de `public = true` para privados; policies de leitura exigem usuÃ¡rio autenticado.
* **nginx/hsts (A4):** HSTS `max-age=31536000; includeSubDomains; preload` + `X-Frame-Options: DENY` + `Referrer-Policy` + `Permissions-Policy` aplicados no nginx host (Certbot-managed), que Ã© o nginx real de produÃ§Ã£o.
* **auth/callback (A2):** parÃ¢metro `next` validado contra whitelist de paths; open redirect fechado.
* **rls/material-items (A5):** policy N+1 unificada em EXISTS Ãºnico; sem subquery duplo por linha.
* **rls/notifications (A6):** INSERT de notificaÃ§Ãµes com `EXISTS (SELECT 1 FROM profiles)` â€” sem `WITH CHECK (true)`.

### Bug Fixes

* **auth/login:** spinner eterno intermitente corrigido â€” `supabase.signOut()` dentro do `catch` podia lanÃ§ar exceÃ§Ã£o em rede instÃ¡vel, impedindo `setLoading(false)`; agora wrappado em try/catch interno.
* **auth/login:** edge case defensivo â€” `data.session = null` sem `error` (rate-limit Supabase etc.) agora exibe toast e libera o botÃ£o.
* **auth/login:** fetch ao BFF sem timeout corrigido â€” `AbortController` com deadline de 10 s evita spinner eterno quando VPS estÃ¡ lento.
* **auth/exchange:** `auditor` redirecionava para `/cadete` em vez de `/nexus`; corrigido `landAt` no BFF.
* **auth/supabase:** corrigida regressao de login em producao causada por recursao infinita nas policies RLS de `profiles` e `reserve_memberships`; server components voltam a ler perfil e membership apos `/auth/exchange`.
* **audit/logging (M7):** `auditLog()` refatorado de fire-and-forget para `Promise<void>`; fallback `console.error` estruturado quando insert Supabase falha.
* **ui/dead-code (B1):** componentes `inventory-card.tsx` e `severity-alert.tsx` removidos (nÃ£o importados em lugar algum).

### Database

* **supabase:** migration `20260629000001_fix_rls_security_audit.sql` â€” policies iniciais + buckets privados.
* **supabase:** migration `20260629000002_fix_material_availability_reserve_id.sql` â€” view `material_availability` recriada com `tenant_id` e `reserve_id`.
* **supabase:** migration `20260629000003_fix_rls_populate_tenant_and_correct_policies.sql` â€” tentativa de populate via reserve_memberships (parcial).
* **supabase:** migration `20260629000004_rls_safe_roles_only.sql` â€” policies backward-compat com roles novas sem enforÃ§amento de tenant (correÃ§Ã£o da regressÃ£o AR01-AR18).
* **supabase:** migration `20260629000005_tenant_isolation_backfill.sql` â€” populate definitivo de memberships + RLS com tenant enforÃ§ado.

### Docs

* **docs/enterprise/supabase-access-canonical.md:** regra canÃ´nica de acesso ao Supabase (Management API PowerShell, SSH fallback, token env var).
* **docs/enterprise/specs/tenant-isolation-backfill.md:** spec tÃ©cnica da dÃ­vida C1, diagnÃ³stico, fases de soluÃ§Ã£o e validaÃ§Ã£o.

### Validation

* `pnpm typecheck` OK (web + bff).
* AR01â€“AR18: 17 passed (armeiro-suite) apÃ³s migration 000004+000005.
* E2E full suite em andamento.

---

# 2026-06-28

### Features

* **arsenal/categorias:** Almoxarifado agora tem aba de categorias para `admin_reserva`, com cadastro/edicao logica de categorias, flags de calibre, validade, numero de serie, veiculo e alertas configuraveis.
* **reserva/almoxarifado:** rota `/reserva/arsenal` agora exibe abas `Materiais` e `Categorias` para `admin_reserva` e `armeiro`; o dropdown de categoria tem seta explicita para listar categorias ja criadas e botao `+` separado para criacao rapida.
* **arsenal/ux:** dialogos de adicionar material no admin e de solicitar material no armeiro ganharam seletor-criador de categoria com botao `+`, mantendo a categoria no dropdown e ativando campos contextuais sem trocar de tela.
* **arsenal/veiculos:** categoria de veiculos passa a exigir placa e modelo, com campos de cor e ano opcionais para viaturas, carros, motos, vans e categorias equivalentes.
* **arsenal/metadados:** cadastro de material agora suporta categoria livre, descricao opcional, calibre obrigatorio para armas, controle opcional de numero de serie e validade obrigatoria para coletes com alertas configuraveis de 1 ano, 6 meses e 90 dias.
* **arsenal/rbac:** solicitacoes de armeiro carregam os novos metadados e continuam indo para aprovacao exclusiva do `admin_reserva`; `admin_global` deixou de ser role de mutacao direta em `/api/admin/almoxarifado`.
* **notificacoes:** criada base de deduplicacao `material_validity_alert_events` e rotina BFF para gerar notificacoes de validade para armeiros, admins da reserva e militar com posse ativa.
* **relatorios:** filtros avancados de admin/reserva agora incluem categoria e calibre quando categoria `arma` e exportacoes CSV/Excel incluem coluna `Calibre`.

### Bug Fixes

* **arsenal/usuarios:** abas `Materiais/Categorias` agora ficam no topo do Almoxarifado para `admin_reserva` e `armeiro`; modal de adicionar material foi ampliado, foto do perfil no header usa carregamento imediato, `/admin/usuarios` aceita `admin_reserva`, busca/autocomplete reutiliza o endpoint existente e o cadastro de militar permite perfil inicial `usuario` ou `armeiro` conforme RBAC.
* **reserva/ui:** abas do Almoxarifado foram separadas da area de acoes para ficarem sempre visiveis, solicitacao de material do armeiro agora abre em dialogo largo e o botao de recolher sidebar volta a ser o primeiro controle do menu.
* **arsenal/ux:** botao `Criar categoria` ganhou camada propria nos dialogs de material, evitando interceptacao de clique por campos vizinhos em viewports menores.
* **usuarios/ux:** botoes `Cadastrar Militar` e `Criar Login` aguardam hidratacao do toolbar antes de aceitar clique, evitando clique perdido no carregamento inicial.
* **auth/cloudflare:** server components em runtime Edge agora leem `SUPABASE_URL` e `SUPABASE_ANON_KEY` tambem dos bindings `getRequestContext().env`, evitando redirect indevido para `/login` apos login em Cloudflare Pages.
* **auth/layout:** dashboard deixou de selecionar `profiles.reserve_id` inexistente no banco real; a reserva atual agora vem de `reserve_memberships`, removendo redirect indevido para `/login` apos autenticacao valida.

### Database

* **supabase:** aplicada no banco real a migration `20260628000004_material_category_ux.sql`, ampliando `material_categories`, relacionando `material_types.category_id`, incluindo campos de veiculo e recriando `material_availability` com os novos metadados.
* **supabase:** aplicada no banco real a migration `20260628000003_material_metadata_alerts.sql`, com `material_types.categoria` em texto livre, `categoria_slug`, `calibre`, flags de serie/validade, `validity_alert_days`, indices e view `material_availability` ampliada.

### Validation

* `node --experimental-strip-types --test apps/bff/src/__tests__/audit-hash.test.ts apps/bff/src/__tests__/totp-guard.test.ts apps/bff/src/__tests__/material-metadata.test.ts` = 24 passed.
* `pnpm typecheck` OK.
* `pnpm lint` OK.
* `pnpm --filter web build` OK.
* `supabase migration list` confirma `20260628000004` local/remoto aplicado.

---

# 2026-06-27

### Features

* **arsenal/perfil/feedback:** fotos opcionais de materiais com bucket `material-photos`, upload/captura em cadastro de material, perfil do usuario com foto/preferencias, rota `/suporte` para problema/sugestao/critica/elogio e regressao E2E `arsenal-profile-feedback` (3/3).
* **arsenal/rbac:** fluxo de solicitacao do armeiro para adicao/desativacao/ajuste de material com aprovacao exclusiva por `admin_reserva`; `superadmin` permanece restrito a gestao global/tenants/saude/branding, sem dados internos da reserva.

* **fase-d:** PDF de passagem de turno com QR code verificÃ¡vel â€” endpoint pÃºblico `GET /api/handovers/:id/verify` embutido como matrix QR via `pdf-lib` rectangles (pure JS, zero canvas)
* **fase-d:** `apps/bff/src/lib/totp-guard.ts` â€” `checkTotpGuard()` funÃ§Ã£o pura extraÃ­da; TOTP anti-replay consolidado em `handovers.ts`, `saidas.ts` e `cautelamentos.ts` (elimina VULN #1)
* **fase-d:** testes unitÃ¡rios BFF â€” 15/15 passando com `node --experimental-strip-types`:
  - `audit-hash.test.ts` â€” 8 casos: determinismo, encadeamento SHA-256, JSON canÃ´nico, tamper detection
  - `totp-guard.test.ts` â€” 7 casos: anti-replay, rate-limit 5/15min, expiraÃ§Ã£o de janela, verificaÃ§Ã£o criptogrÃ¡fica

### Bug Fixes

* **suporte:** removido seletor redundante de tipo de contato; pagina mantem apenas canal unico, email, copiar email, envio por email e prazo de resposta.
* **auth/login:** login por senha agora cria sessao HttpOnly no BFF via `/api/auth/exchange` antes do redirect, evitando 401 em `/api/auth/me` e retorno para `login?reason=session_expired`.
* **suporte:** rota `/suporte` simplificada para canal unico, email `suporteonix@arckosia.com.br`, selecao de tipo de contato, botao de copiar email e prazo de resposta de ate 3 dias uteis.
* **reserva/arsenal:** botao `Adicionar Material` restaurado para `armeiro`; agora abre solicitacao de adicao via aprovacao do `admin_reserva`, sem permitir gestao direta interna por `superadmin`.
* **reserva/sw:** service worker deixou de cachear navegacoes autenticadas (`/reserva`, dashboard etc.) com `NetworkFirst`, evitando `sw.js no-response` em rotas dinamicas de sessao.
* **reserva/cautelas:** lista inicial carrega via cookie BFF sem aguardar `supabase.auth.getSession()`; endpoint reduziu payload do SELECT e recebeu indices compostos `tenant/status/created_at` e `tenant/militar/created_at`.
* **reserva/ui:** Sheet fecha por `Escape`, evitando overlay preso apos cancelar a solicitacao de material em testes e uso real.
* **bff/inventory:** verificacao publica de inventario movida para rota sem auth antes do middleware, preservando QR/hash publico em producao.
* **deploy/bff:** workflow do VPS agora usa `fetch/reset`, `set -euo pipefail`, remove container antigo `apmcb-bff` e recria o servico, evitando falso verde quando `git pull` ou `docker compose up` falham.
* **supabase:** migrations `20260627000002_material_photos_arsenal_rbac` e `20260627000003_cautelamentos_performance` aplicadas e verificadas no banco real; bucket `material-photos`, coluna `material_types.photo_url` e indices de cautelas confirmados.
* **deploy/cloudflare:** runtime Edge restaurado nas rotas dinamicas do App Router para compatibilidade com `@cloudflare/next-on-pages`.
* **arsenal:** botao/modal de Adicionar Material restaurado; `admin_reserva` gerencia direto e `armeiro` solicita aprovacao.
* **playwright/local:** smoke local estabilizado removendo runtime Edge das rotas dashboard afetadas pelo crash RSC no Next Windows; teste HTTPS continua valido em deploy e e pulado somente em `localhost`.

### Validation

* `pnpm typecheck` (web) OK; `pnpm --filter @apmcb/bff typecheck` OK; `pnpm lint` OK com warnings existentes; `pnpm build` OK; Playwright `chromium + rbac-suite + arsenal-profile-feedback` = 53 passed, 1 skipped local HTTPS.

### Bug Fixes (E2E)

* **e2e:** DEC13 â€” filtro de reserva localizado por `aria-label` (compatÃ­vel com produÃ§Ã£o); `name="reserve"` adicionado ao componente `_client.tsx`
* **e2e:** smoke brand panel â€” expectativa atualizada para "Plataforma de Controle" (texto padrÃ£o sem `?tenant=` param)
* **e2e:** smoke Reserva action cards â€” card renomeado para "Cadastrar Biometria" (era "Cadastrar Militar")
* **e2e:** M03 â€” `#create-role` nÃ£o renderizado para armeiro (MASTER_ROLES.length=1); teste corrigido
* **e2e:** M04 â€” seletor escopo `dialog#create-role` para nÃ£o capturar opÃ§Ãµes de outros `<select>` na pÃ¡gina
* **e2e:** F02/F03 â€” `img[alt='PrÃ©via']` (era "PrÃ©via da foto"); botÃ£o X via seletor CSS sibling
* **e2e:** playwright.config.ts â€” projeto `dec-suite` adicionado (DEC01-DEC15)

### Rastreabilidade

* `supabase/migrations/20260626000001_rls_material_items_role_based.sql` â€” formaliza RLS Fase B.2 aplicada via psql

---

# 2026-06-26

### Features

* **fase7:** Dashboard de Comando Enterprise â€” rota `/(dashboard)/admin/comando`, endpoint `GET /api/dashboard/command` com 14 cards de exceÃ§Ã£o e conformidade, filtro por reserva, auto-refresh 30s; suite dec-suite DEC01-DEC15 (15/15 âœ…)
* **fase6:** Livro Digital de ServiÃ§o â€” tabela `service_handovers`, 8 endpoints de passagem de turno, snapshot JSONB automÃ¡tico de 6 tabelas, assinatura dupla TOTP, PDF verificÃ¡vel, notificaÃ§Ãµes push para armeiro entrante; suite handover-suite HT01-HT08 (8/8 âœ…)
* **admin:** CRUD completo de org-units e reserves para `admin_global` em `/admin/estrutura` â€” spec ES01-ES15
* **bff:** endpoint `GET /api/categories` para categorias customizadas por tenant
* **ci/cd:** GitHub Actions â€” lint + typecheck + E2E smoke bloqueiam deploy CF Pages; auto-deploy BFF via SSH em push para main
* **security (fase-a):** consolidaÃ§Ã£o de 6 fixes crÃ­ticos do pm-assessment:
  - BUG #1: `roleGuard` explÃ­cito em `GET /api/ocorrencias`
  - BUG #2: `tenant_id` obrigatÃ³rio em `lendings.ts` â€” retorna 400 se null
  - VULN #1: anti-replay movido para ANTES de `verifySync` em `signatures.ts` (padrÃ£o consistente)
  - VULN #2: `pendingTotpSetup` migrado de `Map` em memÃ³ria para `iron-session` (stateless, sobrevive redeploy)
  - Fix: `PATCH /api/profiles` e `PATCH /api/profiles/:id/status` com `.eq("tenant_id")`
  - Fix: docker-compose.prod.yml sem devices USB para VPS limpa
* **security/ux (fase-b/c):**
  - RLS `material_items_staff_select` + `material_items_usuario_select` â€” staff vÃª tudo; usuÃ¡rio sÃ³ vÃª itens prÃ³prios ou disponÃ­veis
  - `sessions_invalidated_at` adicionado Ã  tabela `profiles`
  - Hook `useRoleGuard` â€” polling 5min + `window.focus` para revalidaÃ§Ã£o de sessÃ£o
  - `RoleWatcher` integrado ao dashboard layout
  - `/api/auth/me` valida role DB vs sessÃ£o; force re-login se divergir
  - `issuedAt` adicionado Ã  `SessionData` para invalidaÃ§Ã£o por timestamp

### Bug Fixes

* **handovers:** `document_type` correto para constraint (`lending | handover | inventory`)
* **handovers:** `tenant_id` adicionado no SELECT `GET /:id`; spec com `reserveId` fixo e membership check
* **handovers:** HT05 busca profile do cadete via Supabase REST (Bearer token)
* **rbac:** armeiro removido de `POST /api/admin/militares`; fix `dashboard.ts` TS2339
* **build:** `useSearchParams` em login wrappado em `Suspense boundary`; FK hint em cautelamentos
* **totp:** parar polling quando servidor retorna 404 (TOTP nÃ£o configurado)
* **lint:** `eslint.config.mjs` â€” ignora `e2e/`, `playwright-report/`, `public/sw.js` (212 erros â†’ 0 erros)
* **docker:** remover USB device do compose base; criar `docker-compose.biometric.yml` override
* **bugs:** 5 falhas crÃ­ticas de produÃ§Ã£o corrigidas (bff auth, fetch direto Supabase)

### Docs

* `docs/enterprise/reports/pm-assessment-fase-bc-report.md` â€” relatÃ³rio completo Fases B+C com checklist G01-G17
* `docs/enterprise/pm-assessment-v1.md` â€” Fases A, B, C marcadas como `[x]`

---

# 2026-06-25

### Features

* **fase5b:** Nexus Enterprise completo â€” BFF + frontend:
  - Sidebar colapsÃ¡vel com branding accordion
  - Login dinÃ¢mico por tenant (slug param)
  - Setup 2FA via `/nexus/setup-2fa`
  - GestÃ£o de usuÃ¡rios completa com reset TOTP
  - suite nexus-enterprise-suite NE01-NE16
* **fase5:** SaÃ­da DiÃ¡ria Enterprise (item-based) â€” `POST /api/saidas` e fluxo completo:
  - Dual-auth TOTP + biometria em `sign-armeiro` / `sign-militar`
  - Status machine: `pending` â†’ `signed_armeiro` â†’ `active` â†’ `returned`
  - suite saida-suite SD01-SD06 (6/6 âœ…)
* **fase5:** Cautela Permanente â€” tabelas `lendings` enterprise + `cautelamentos` + trigger P0001 (posse exclusiva):
  - PDFs com hash verificÃ¡vel
  - UI cautelas com `SignDialog` dual-auth
  - Bucket `custody-docs` no Supabase Storage
  - suite cautelamento-suite CT01-CT08 (8/8 âœ…)
  - suite item-integrity-suite IT01-IT09
* **fase4:** Assinatura EletrÃ´nica NÃ­vel 1:
  - Tabela `document_signatures` com RULE de imutabilidade
  - `apps/bff/src/lib/document-hash.ts` â€” `hashDocument()`
  - `apps/bff/src/lib/signature-proof.ts` â€” `computeSignatureProof()`
  - Rota pÃºblica `/v/[document_id]` para verificaÃ§Ã£o
  - suite signature-suite SIG01-SIG06 (6/6 âœ…)
* **e2e:** visual-full-suite â€” bateria visual ponta-a-ponta VF01-VF35

### Bug Fixes

* **bff:** `document_type` correto para constraint Supabase (`lending` vs `handover`)
* **bff/e2e:** `ip` invÃ¡lido em `inet NOT NULL`; suites F5 em serial mode
* **bff:** substituiÃ§Ã£o de `supabase.auth.getUser/signInWithPassword` por `fetch` direto (BFF iron-session)
* **fase4:** edge runtime na pÃ¡gina `/v/[document_id]` para CF Pages
* **totp:** `armeiro` e `admin` roles podem chamar `totp/setup` para document signing
* **layout:** mapeia roles RBAC Fase 2 para nav UI (`armeiroâ†’master`, `admin_globalâ†’admin`)
* **e2e:** NE14 usa `domcontentloaded` para evitar timeout no fetch de branding

---

# 2026-06-23

### Bug Fixes

* **types:** corrige `UserData` duplicado em `_edit-dialog.tsx` e `_user-actions.tsx` â€” tipo canÃ´nico exportado de `_edit-dialog`
* **types:** remove `@ts-expect-error` obsoleto em `e2e/rbac.spec.ts:34`
* **frontend:** role checks e `status_legacy` corrigidos em admin/usuarios, reserva/militares

### Docs

* **reports:** relatÃ³rios finais das Fases 1, 2 e 3 gerados em `docs/enterprise/reports/`
* **roadmap:** Fase 3 marcada como concluÃ­da; Fase 2B renumerada para 7B

---

# 2026-06-22

### Features

* **fase3:** `audit_events` com hash SHA-256 encadeado, RULE SQL de imutabilidade, snapshots before/after, middleware fire-and-forget em todos os endpoints sensÃ­veis
* **fase3:** `computeEventHash()` em `apps/bff/src/lib/audit-hash.ts` â€” cadeia de hash verificÃ¡vel (`previous_hash` do evento N+1 = hash do evento N)
* **fase3:** suite `audit-suite` â€” AT01-AT05 + SEC-3-01 + SEC-3-03 (7/7 âœ…)
* **fase2:** RBAC Enterprise â€” 6 roles institucionais: `superadmin`, `admin_global`, `admin_reserva`, `armeiro`, `usuario`, `auditor`
* **fase2:** migraÃ§Ã£o de dados: `adminâ†’admin_global`, `masterâ†’armeiro` aplicada via Supabase SDK (service_role)
* **fase2:** `roleGuard` atualizado em 10+ rotas BFF; `HonoVariables` com tipo `Role` expandido
* **fase2:** `landAt` corrigido: `armeiroâ†’/reserva`, `admin_globalâ†’/admin`, `auditor/admin_reservaâ†’/reserva`
* **fase2:** suite `rbac-suite` â€” PT01-PT08 + SEC-2-* (10/10 âœ…)
* **fase1:** suite `multitenant-suite` â€” TT01-TT14 (14/14 âœ…); Slice 1A completo
* **e2e:** `global-setup.ts` â€” fix permanente do ENOTEMPTY no Playwright (rimraf recursivo)
* **infra:** `playwright.config.ts` â€” workers:2, mobile-safari removido do run principal, invite-activate deduplicado

### Bug Fixes

* **auth:** `exchange` com role `master` redirecionava para `/cadete` apÃ³s migraÃ§Ã£o â€” corrigido `armeiroâ†’/reserva`
* **e2e:** harness.ts USERS atualizado: `admin_global` e `armeiro` como role values pÃ³s-migraÃ§Ã£o

### Breaking Changes

* Roles `"admin"` e `"master"` **removidos** do tipo `Role` e `SessionData`. Usar `"admin_global"` e `"armeiro"`.

---

# 2026-06-19

### Features

* **auth:** tela de ativaÃ§Ã£o de conta por convite (`/auth/confirmar-conta`) com formulÃ¡rio de primeira senha, medidor de forÃ§a, visibility toggle e redirecionamento por role
* **auth:** `/api/auth/activate-account` â€” edge route que marca `account_activated_at` via service_role apÃ³s definiÃ§Ã£o da primeira senha
* **auth:** melhoria em `/auth/update-password` â€” visibility toggle em ambos os campos, exibiÃ§Ã£o contextual do e-mail, checklist visual de requisitos
* **e2e:** suite `invite-suite` â€” IA01-IA17 (17 testes cobrindo ativaÃ§Ã£o, reset, routing PKCE e proteÃ§Ã£o de API)

### Bug Fixes

* **auth:** `inviteUserByEmail`/`generateLink` redirecionavam para `/login` que nÃ£o processa cÃ³digo PKCE â€” alterado para `/auth/callback?next=/auth/confirmar-conta`
* **auth:** callback route suporta fluxo de convite via parÃ¢metro `next` + fallback `token_hash + type` (OTP flows)
* **e2e:** flakiness SD05-SD07 eliminada usando `tr[data-testid^='saida-row-']` para aguardar hidrataÃ§Ã£o React
* **deploy:** `docker-compose.yml` corrigido com `SESSION_SECRET` e `INTERNAL_API_SECRET` no environment do BFF

---

# 2026-06-18

### Bug Fixes

* **e2e:** corrige autenticaÃ§Ã£o Bearer e session isolation no harness SSA
* **infra:** `SUPABASE_SERVICE_ROLE_KEY` no `/opt/apmcb/.env` substituÃ­do pela chave real; container BFF recriado para recarregar env vars
* **e2e:** `getSupabaseToken` detecta JSON plano vs base64url â€” `@supabase/ssr` v0.12 sem `cookieEncoding` armazena sessÃ£o como JSON direto
* **e2e:** `clearCookies()` antes de cada `login()` elimina corrupÃ§Ã£o de cookies fragmentados entre trocas de usuÃ¡rio
* **e2e:** `bffCall` omite `Content-Type` quando body ausente â€” evita 400 do zValidator Hono ao parsear corpo vazio
* **tests:** rate limit aumentado para 100/min; fix ST01 text mismatch

---

# 2026-06-17

### Features

* **arsenal:** filtros de busca + categoria + estoque na pÃ¡gina de almoxarifado do armeiro
* **arsenal:** clicar em material abre detail sheet com KPIs, barra de disponibilidade e status
* **arsenal:** armeiro pode solicitar ajuste de estoque ao admin (stepper +/- com mÃ­nimo = em uso)
* **arsenal:** armeiro pode solicitar adiÃ§Ã£o de material em batch; solicitaÃ§Ãµes pendentes no dashboard admin
* **arsenal:** pÃ¡gina `/admin/arsenal/solicitacoes` com tabs Pendentes/Aprovadas/Rejeitadas/Todas
* **arsenal:** aprovaÃ§Ã£o executa a aÃ§Ã£o imediatamente; rejeiÃ§Ã£o exige motivo obrigatÃ³rio â‰¥ 5 chars
* **arsenal:** armeiro recebe notificaÃ§Ã£o push/in-app ao ter solicitaÃ§Ã£o aprovada ou rejeitada
* **militares:** clicar em militar abre sheet com perfil, status biomÃ©trico e dedos cadastrados
* **saidas:** "Registrar SaÃ­da" exige verificaÃ§Ã£o de identidade antes do submit (biometria ou TOTP)
* **db:** migration `admin_approval_requests` com RLS, Ã­ndices, trigger de auditoria
* **bff:** rotas `/api/arsenal/requests` â€” POST/GET/approve/reject com notificaÃ§Ã£o automÃ¡tica
* **ui:** dropdowns/popovers com fundo sÃ³lido corrigido via `@theme inline {}` no globals.css

---

# Releases anteriores (prÃ©-2026-06-17)

Consultar git log completo: `git log --oneline` â€” histÃ³rico disponÃ­vel desde o commit inicial de 2026-05-x.

Marcos principais:
- **2026-06-17:** Arsenal enterprise â€” solicitaÃ§Ãµes, detail sheet, biometria
- **2026-06-16:** SSA sistema completo + UI/UX polish
- **2026-06-15:** Security hardening â€” CSP nonces, CSRF, body limit, fail2ban, super admin spec
- **2026-06-14:** BFF Hono + Docker Compose VPS + ZKTeco bridge + PWA manifest
- **2026-06-13:** Next.js 16 Turbopack + CF Pages edge runtime + auth flows completos
- **2026-06-12:** Scaffold inicial â€” Next.js 15, shadcn/ui, TanStack Query, Zustand, Supabase

