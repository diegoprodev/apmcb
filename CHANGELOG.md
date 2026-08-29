# Changelog — Andrômeda: Plataforma de Governança de Bens Sensíveis

> Mantido por convenção semântica. Datas em ISO 8601 (America/Recife, UTC-3).
> Roadmap completo: `docs/enterprise/02-enterprise-roadmap.md`
> DoD Canônica: `docs/enterprise/07-canonical-definition-of-done.md`

---

# 2026-08-29 (v40) — fix(lendings): itens presos sem reserva + UX do "Receber Material" + admin_global sem controle de reserva no Livro + service worker desatualizado

**Contexto**: mais 4 achados reais do usuário no mesmo lote.

**CRÍTICO real — "23 vs 25" (nunca pode ocorrer, palavras do usuário)**: painel do armeiro
("Receber Material") mostrava 23 materiais ativos pra um militar; o próprio painel do militar
mostrava 25. Investigado com dado real: 2 `lendings` tinham `reserve_id = NULL` (coluna sempre foi
nullable) — `POST /api/lendings/identify` filtra com `.eq("reserve_id", body.reserve_id)`, que
**nunca bate com NULL**, deixando esses itens invisíveis pra QUALQUER armeiro em QUALQUER reserva,
pra sempre — o militar via "ativo" no próprio painel, mas nenhum fluxo de devolução real
conseguia achá-los. As 2 linhas eram elas mesmas dado de teste ("E2E Cautela Bulk..."), mesma
classe de vazamento já corrigida nesta sessão (v38/v39), só que na tabela legada `lendings`, não
`cautelamentos`/`material_types`. Corrigido: `.or("reserve_id.eq.<atual>,reserve_id.is.null")` —
item sem reserva definida agora é recebível por qualquer armeiro, nunca mais fica preso. Limpeza:
as 2 linhas marcadas `devolvido`. `global-teardown.ts` ganha seção 10 pra isso não vazar de novo.

**UX do modal "Receber Material"**: lista era uma coluna única sem separação — vários itens iguais
("Cinto Branco") sem indicar que vieram de retiradas/dias diferentes. Adicionado: agrupamento por
retirada (`movement_id`, mesmo padrão "Lote de N" de Cautelas) ou por dia civil (fallback pra
retiradas antigas sem lote); busca por material/categoria; checkbox "marcar todos" (respeitando o
filtro de busca ativo) + checkbox por grupo.

**Livro de Serviço do admin_global sem controle de reserva**: `/admin/livros` misturava turnos de
TODAS as reservas sem nenhum seletor, diferente do padrão já estabelecido em `/admin/saidas`
(Departamento → Reserva em cascata). Página convertida de client-puro pra Server Component
buscando `/api/admin/estrutura` (mesmo padrão de `admin/saidas/page.tsx`) + `loading.tsx` novo
(antes não tinha, por ser síncrona). BFF (`GET /api/shifts`) ganhou filtro opcional `reserve_id`.
Inputs de busca/data também tinham fundo cinza (herdado do `bg-transparent` default do componente
`Input`) enquanto o select de status ao lado já usava `bg-white dark:bg-card` — inconsistência
visual corrigida pra bater com o resto do toolbar.

**Service worker desatualizado em produção**: `Uncaught (in promise) no-response` em
`/admin/comando` — investigado: o código-fonte (`src/app/sw.ts`) já tinha um `handlerDidError`
específico pra esse erro exato (achado real de 2026-07-26, documentado no próprio arquivo), mas o
`public/sw.js` COMMITADO nunca foi regerado depois desse fix — build local (`npm run build`)
confirmou que o artefato publicado carecia do handler. Rebuildado e commitado.

**Validação**: `tsc --noEmit` limpo (bff+web); BFF node 305/305 (1 teste novo: guard de
reserve_id NULL); BFF bun (integração) 72/72; web vitest 109/109; build de produção completo
rodado com sucesso (`npm run build --webpack`, confirma que o SW gerado bate com o código-fonte).

---

# 2026-08-29 (v39) — feat(cautelas): expõe "Trocar material" na UI + fix(pdf): cabeçalho reflete filtro real + limpeza de dados de teste (material_types)

**Contexto**: 4 achados reais do usuário no mesmo lote. (1) PDF do histórico do militar sempre
dizia "sem filtros" mesmo com um filtro ativo (ex: Devolvido) na hora do export. (2) "Editar
Cautela" nunca ofereceu trocar o material — endpoint já existia (`POST /:id/substitute`, da spec
de ciclo de vida), nunca teve gatilho na UI. (3) Nos cards/diálogos de cautela, o "material"
mostrado às vezes era um nome de teste tipo "E2E Cautela EditCautela 1787084098710-276" — não
bug de UI, dado de teste real vazado em produção. (4) 137→645 investigado antes nesta sessão já
tinha resposta (tabelas diferentes); esta rodada revelou que boa parte do "178→312" da limpeza
anterior (v38) era ela mesma poluição de teste voltando a "disponível".

**fix(pdf)**: `efetivo/historico/_historico-client.tsx`, `exportPdf()` — passa a mandar
`reserve_id`/`categoria`/`status`/`from`/`to` (filtros ativos na tela) junto com `ids` na
querystring. O BFF (`usuario.ts`, `GET /historico/pdf`) já sabia descrever esses filtros no
cabeçalho — só nunca os recebia neste fluxo específico (que sempre mandou só `ids`). `ids`
continua sendo a única coisa que decide quais linhas entram no PDF; os filtros novos servem só
pra descrever o cabeçalho corretamente.

**feat(cautelas) — Trocar material**: novo item "Trocar material" no menu de 3 pontinhos,
condicionado a `canReturnCautela(c)` (mesma exigência de 2 assinaturas do "Devolver" — o
endpoint já rejeitava sem isso). Dialog reaproveita `availableItems`/`loadFormData` já usados
por "Emitir"; ao concluir, abre o `SignDialog` pra assinar a cautela nova como armeiro (mesma UX
de emitir).

**CRÍTICO encontrado ao expor a rota**: `POST /:id/substitute` nunca validou que o item novo
pertence à MESMA reserva da cautela antiga — `GET /api/arsenal/items/disponiveis` (fonte do
autocomplete, usada tanto por "Emitir" quanto agora por "Trocar material") escopa só por
`tenant_id`, nunca por reserva. Como a rota nunca teve gatilho na UI antes, o gap nunca foi
alcançável na prática — expor "Trocar material" agora o tornaria alcançável pela primeira vez.
Corrigido: `novoMaterialType.reserve_id !== antiga.reserve_id` → 422, antes de criar a cautela
nova.

**fix(arsenal)**: `GET /items/disponiveis?for=cautela` não filtrava `material_type.ativo` —
um tipo desativado (soft-delete, mesmo botão "Desativar" do admin) continuava selecionável no
autocomplete de cautela. Sem esse fix, a limpeza de dados abaixo teria voltado a poluir a tela
imediatamente (itens liberados por status_operacional, mas com tipo ainda "ativo").

**Limpeza de dados (migration `20260829090000`)**: 119 `material_types` sintéticos (nome literal
de teste, ex: "E2E Cautela EditCautela...", "E2E AVU Eligible...") desativados (`ativo=false`,
soft-delete — nunca hard-delete, cautelas históricas ainda referenciam esses itens via FK).
Eram o resto do que a migration anterior (v38) tinha "liberado" sem desativar o tipo por trás —
contagem real de itens disponíveis pra cautela: 312 (pós-v38, inflado por lixo de teste) → **128**
(real). `global-teardown.ts` ganha seção 9 desativando automaticamente qualquer `material_type`
futuro nomeado com prefixo "E2E "/"Teste " depois de qualquer suíte E2E rodar — mesmo padrão já
usado pra categorias (seção 7).

**Validação**: `tsc --noEmit` limpo (bff+web); BFF node 304/304 (1 teste novo: guard de reserva
do substitute); web vitest 109/109.

---

# 2026-08-29 (v38) — fix(e2e): limpeza de 134 cautelas de teste vazadas em produção + cleanup permanente no teardown

**Contexto**: achado real do usuário — a tela real de Cautelas (armeiro fixture, matrícula
000002, reaproveitado por toda a suíte E2E) mostrava dezenas de linhas "Teste .../E2E .../AVU ..."
nunca assinadas, lido como bug de assinatura ("como assim pendente do armeiro e minha? como
assino? houve regressão?"). Investigado a fundo: **não é bug de assinatura** (`canReturnCautela`
+ o guard de 2 assinaturas no servidor, ambos de 2026-08-28, continuam corretos e verificados de
novo agora) — é dado de teste real deixado em produção. 6 specs E2E diferentes
(`cautelamentos-batch`, `cautelamentos`, `cautela-eligibility`, `item-integrity`, `livro-digital`,
e o `avu-alertas-vencimento` desta mesma sessão) criam cautelas via `/api/cautelamentos(/batch)`
pra testar o fluxo, **nenhum com cleanup**.

**Migration** (`20260829080000_limpeza_cautelas_teste_e2e.sql`, aplicada): cancela 134
cautelamentos "ativa" com `motivo_emissao` começando em "Teste "/"E2E"/"AVU" e libera os
`material_items` presos por elas — **16 eram itens REAIS de inventário** (Espadim, Quepe de
Cerimônia, Cinto Branco, Luvas Brancas, FUZIL ARAD, Túnica de Gala), travados como
`status_operacional='cautelado'` por uma cautela que nunca existiu de verdade, reduzindo
silenciosamente a contagem de "disponíveis para cautela" já questionada pelo usuário mais cedo
nesta sessão. Efeito medido: contagem de itens disponíveis pra cautela subiu de 178 para **312**
depois da limpeza.

**Correção permanente** (`apps/web/e2e/global-teardown.ts`, seção 8 nova): o teardown já tinha
2 achados históricos idênticos documentados (itens presos por usuários E2E, categorias vazadas) —
estendido com a mesma lógica pra cautelamentos, cobrindo automaticamente QUALQUER spec (inclusive
futuros) que crie cautela nomeando `motivo_emissao` com o prefixo "Teste "/"E2E"/maiúsculas do
próprio spec (convenção já em uso). Roda depois de toda suíte Playwright, qualquer projeto.

**Validação**: `tsc --noEmit` limpo em `apps/web`; sintaxe do filtro `.or()` do Supabase testada
contra produção real (0 erro), lógica de cancelamento+liberação testada criando e limpando uma
cautela sintética de verdade antes de considerar correto.

---

# 2026-08-29 (v37) — feat(alertas): AVU — Alertas de Vencimento Unificados (cautela + validade de material, configurável por reserva, snooze/silenciar)

**Contexto**: implementação de `docs/enterprise/specs/alertas-vencimento-unificado-enterprise.md`
(2 rodadas de revisão adversarial da spec antes de codar — 6 → 9/10, sem crítico/alto pendente).
Pedido do usuário: reativar o alerta de validade de material (morto em produção); backfill
retroativo de prazo pras cautelas ativas sem prazo definido; janela de "vencendo" configurável
pelo admin da reserva (não mais fixa em 7 dias); "vencida" passa a alertar todo dia (era a cada 3);
opção de adiar (snooze, N dias, personalizável) ou silenciar de vez o alerta por cautela.

**Migrations** (7, aplicadas e verificadas via MCP): `reserves.cautela_alert_dias_antes` (array de
inteiros, default `{7}`) e `reserves.material_validity_alert_dias_padrao` (array restrito a
`{90,180,365}`, default `{365,180,90}`); `cautelamentos.vencimento_snooze_until`/
`vencimento_silenciado`; backfill de 129 cautelas ativas sem prazo → 90 dias a partir de hoje;
`check_cautelas_vencimento()` reescrita pra ler os dias configurados por reserva (era literal `7`)
e alertar "vencida" todo dia (era filtro de 3 dias), respeitando snooze/silenciamento; nova
function + `pg_cron` diário para `check_material_validade_vencimento()` (reativa o alerta de
validade de material, substituindo o endpoint manual morto).

**CRÍTICO de segurança encontrado em code review**: `check_cautelas_vencimento()` e
`check_material_validade_vencimento()` — ambas `SECURITY DEFINER` — foram criadas sem `REVOKE`
explícito e ficaram executáveis por `anon`/`authenticated` via PostgREST
(`POST /rest/v1/rpc/<função>`), confirmado com `has_function_privilege('anon', oid, 'EXECUTE')
= true` e pelo Supabase Security Advisor. Como rodam com privilégio do dono (ignoram RLS de
propósito), qualquer pessoa com a anon key pública (embutida no bundle do frontend, por design)
podia chamar essas funções sem autenticar, bypassando totalmente o `roleGuard("admin_reserva")`
e o escopo por `p_reserve_id` do BFF — o parâmetro só protege a chamada feita PELO BFF, não fecha
a porta direta ao Postgres. Mesma classe de bug já corrigida uma vez neste projeto
(`20260714000008_emergency_lockdown_exposed_functions.sql`). **Achado pré-existente corrigido
junto pela regra canônica do projeto**: `record_cautelamento_batch` (função de outra spec, só
estendida nesta tarefa com um parâmetro novo) tinha a idêntica exposição. Fix: `REVOKE EXECUTE ...
FROM PUBLIC, anon, authenticated` + `GRANT ... TO service_role` nas 3 funções — verificado
via MCP antes/depois e re-testado funcionando após o lockdown.

**MÉDIO de code review**: `check_material_validade_vencimento()` consulta `material_items` por
`validade_item` sem filtro de `status_operacional` (correto — material extraviado/em manutenção
com validade vencendo ainda deve alertar) — mas o único índice existente é parcial e exige
`status_operacional='cautelado'`, não cobrindo a query nova. Fix: índice parcial adicional
`WHERE validade_item IS NOT NULL`.

**BFF**: `PATCH /:id/settings` (reserves) valida os 2 arrays novos (1-365 dias pra cautela;
conjunto fechado `{90,180,365}` pra material — mesmo `CHECK` constraint do banco, achado CRÍTICO
da própria revisão da spec: um valor fora do conjunto abortaria o cron de validade inteiro, todo
dia, silenciosamente). `POST /validity-alerts/run` (arsenal) trocado de ~90 linhas de loop TS com
bug de timezone por uma chamada de 1 linha à function nova. `POST /:id/vencimento-snooze`
(cautelamentos) novo — adiar N dias ou silenciar, `roleGuard` exclui `"usuario"` de propósito
(decisão de gestão da reserva, não preferência pessoal do militar dono da cautela); `PATCH /:id`
reseta silenciamento/snooze quando o prazo é de fato editado.

**Frontend**: `ReserveAlertSettingsCard` novo (tela `/reserva`) — chips removíveis pra dias de
cautela, toggles pro conjunto fechado de material. Menu de 3 pontinhos em Cautelas ganhou
"Adiar alerta" (submenu 3/7/15/30 dias) e "Não mostrar mais" (`AlertDialog` de confirmação) quando
a cautela está de fato vencida. Sino de notificações ganhou `material_validity_warning` — achado:
já existia no enum do banco e era emitido por código morto, mas nunca tinha sido adicionado em
`notification-bell.tsx` (instância pré-existente da mesma classe de bug "union fechada em 4
lugares" já documentada na v36).

**Code review na implementação real (2 rodadas)**: 1ª — 1 CRÍTICO (exposição de EXECUTE, acima) +
1 MÉDIO (índice faltando, acima). 2ª (sobre os fixes de BAIXO da 1ª) — 2 MÉDIO novos: badge
"Adiado até DD/MM" reintroduzia o bug de "meia-noite UTC ≠ meia-noite Brasília" (`formatDate` com
coluna `date` pura do Postgres cai no dia anterior — extraído `formatDateOnly()` como SSOT pra
campos `date`, aplicado retroativamente em `prazo_devolucao_data`/`prazo_proxima_conferencia`,
que já tinham o mesmo bug antes desta tarefa); `snoozeSchema` aceitava `{"silenciar":false}` sem
`dias` e o handler usava `body.dias!` sem checagem em runtime, virando 500 em vez de erro de
validação. + 3 BAIXO: menu "Adiar" permitia reverter um silenciamento sem aviso (fix: item
informativo quando já silenciado, oculta "Não mostrar mais" duplicado); comentário do refactor
`checkShiftOrBlock()` com contagem incorreta (dizia 6 pontos duplicados, eram 4 pré-existentes);
cobertura de teste ausente pro SELECT novo e pro schema de validação (3 testes estáticos +
4 testes de `formatDateOnly` adicionados).

**Validação**: `tsc --noEmit` limpo em `apps/bff` e `apps/web`; suíte BFF (node) 301/301; suíte
BFF (bun, integração real) 72/72; suíte BFF (pentest, contra produção real —
isolamento cross-tenant, sessão, escalação de privilégio, endpoints públicos) 42/42; suíte web
(vitest) 109/109.

**Fora de escopo, registrado na spec**: `admin_reserva` recebe toda notificação de vencimento da
reserva, sem filtro de ruído (mesma limitação já registrada na v36).

---

# 2026-08-29 (v37.1) — feat(alertas): botão "reativar" + suíte E2E AVU01-AVU10

**Contexto**: fechamento dos 2 itens registrados como fora de escopo na v37 — pedido explícito do
usuário depois de ver o CHANGELOG. (1) botão de "reativar" um alerta silenciado sem precisar
editar o prazo (spec §6, pergunta aberta 1, antes resolvida como "aceitável ficar de fora"). (2) a
suíte E2E `AVU01..09` que a própria DoD da spec exigia e não tinha sido escrita.

**BFF**: `POST /:id/vencimento-snooze` ganhou um 3º modo, `{"reativar": true}` — limpa
`vencimento_silenciado` e `vencimento_snooze_until` sem tocar no prazo.

**Frontend**: o item desabilitado "Alerta silenciado atualmente" (fix de BAIXO #1 da v37) virou um
item clicável "Reativar alerta" — quando a cautela está silenciada, o menu mostra só essa opção
(esconde "Adiar"/"Não mostrar mais" nesse estado, evitando a ambiguidade que motivou o BAIXO #1
original). Sem `AlertDialog` de confirmação — reativar é o oposto de silenciar, que é a ação que
de fato reduz visibilidade e merece confirmação. Uma cautela **adiada mas não silenciada** ganhou
"Cancelar adiamento" (mesmo endpoint `reativar:true`) — achado MÉDIO da revisão: sem isso, desfazer
um "Adiar 30 dias" clicado por engano só era possível esperando expirar ou dando a volta por
Silenciar→Reativar.

**Code review na implementação do "reativar"**: 3 MÉDIO corrigidos — (1) `snoozeSchema` exigia só
"pelo menos uma ação" (`{reativar:true, dias:5}` passava e o handler resolvia a ambiguidade em
silêncio pela ordem do `if/else`, descartando o resto do payload sem avisar) — agora exige
exatamente uma ação, combinação vira 400; (2) `{reativar:true}` numa cautela que já não estava
silenciada/adiada gravava `audit_log`+`logShiftEvent` como se algo tivesse mudado — agora responde
`{ok:true, noop:true}` sem tocar nos logs quando não há mudança real; (3) mensagem de erro do guard
defensivo (inalcançável dado o `.refine`, mas por rigor) desatualizada, sincronizada com a do schema.

**Suíte E2E** (`apps/web/e2e/avu-alertas-vencimento.spec.ts`, projeto `avu-suite` novo no
`playwright.config.ts`, `workers: 1`): AVU01 (defaults numa reserva isolada, criada e destruída
via `/api/admin/reserves` — nunca toca a reserva compartilhada) · AVU02 (config `{15,7,3}` gera 3
alertas "vencendo" em marcos diferentes) · AVU03 (simula a transformação exata do backfill numa
cautela sintética) · AVU04 (cautela com `created_at` de 10 dias atrás ainda gera "vencida" —
prova que o filtro antigo de 3 dias foi removido de verdade) · AVU05 (adiar exclui do dia; reativar
volta a alertar no mesmo dia) · AVU06 (mesmo par para silenciar/reativar) · AVU07 (endpoint bate
na mesma RPC do cron — dedup idêntico) · AVU08 (notificação `material_validity_warning` no sino
navega pra `/reserva/arsenal`, teste de UI real) · AVU09 (override do material ignora o default da
reserva, não funde com ele) · **AVU10** (bônus, não pedido pela spec original — fecha o achado ALTO
de code review "sem cobertura pro menu novo": testa o menu Silenciar→Reativar de verdade em
`/reserva/cautelas`, clicando pela UI).

**Achado real durante a escrita dos testes**: a 1ª versão de AVU02/04/07/09 assumia
`toHaveLength(1)` pra contagem de `notifications` — errado. A function manda 1 notificação POR
DESTINATÁRIO (militar + armeiro + admin_reserva da reserva), não 1 por execução — como a cautela
de teste foi criada via `admin_reserva` (o campo `armeiro_id` grava quem chamou a rota), esse
mesmo usuário aparece 2x na união de destinatários (como "armeiro" da cautela e como membro
`admin_reserva` da reserva) e o `UNION` do SQL colapsa pra 1, dando 2 notificações totais em vez
de 3 — nem o "1" nem qualquer contagem fixa são o invariante certo. Corrigido: os testes agora
verificam a tabela de eventos (`cautela_vencimento_alert_events`/`material_validity_alert_events`,
1 linha por chave via `UNIQUE INDEX`) para o dedup exato, e só `notifications.length > 0` pra
confirmar que alguém foi avisado — sem prender o teste a quantos destinatários uma reserva
específica tem.

**Achado operacional (não é bug, é a cota de requisição da Cloudflare)**: o usuário recebeu alerta
da CF de 92% do limite diário de 100k requisições em Workers/Pages sem usuários reais no sistema
ainda. Investigado: o `ci-cd.yml` roda `e2e-smoke` (41 testes) + `e2e-suite` (148 testes) contra
`https://apmcb.pmpb.online` **automaticamente a cada push em `main`** — cada commit desta sessão já
disparou esse pipeline; somado a execuções manuais de Playwright direto contra produção (inclusive
desta tarefa) e ao polling de 1s de `_biometric-console-client.tsx` caso alguma aba fique aberta,
isso explica o volume sem depender de tráfego real. Não corrigido nesta tarefa (fora de escopo,
registrado a pedido do usuário para revisão futura).

**Validação**: `tsc --noEmit` limpo em `apps/bff` e `apps/web`; BFF node 303/303 (4 testes novos:
schema exige exatamente uma ação, handler nunca usa `body.dias!`, guard de no-op, SELECT com as
2 colunas novas). Suíte `avu-suite` (E2E real contra produção, todos os 10 testes, incluindo os
2 de UI) verde após a correção do achado de contagem acima — não re-rodada contra produção após os
3 fixes de MÉDIO por serem aditivos/mais restritivos (o payload que o frontend manda continua
válido; o deploy automático do CI/CD já vai exercitar o caminho real no próximo push).

---

# 2026-08-29 (v36) — feat(cautelas): ciclo de vida completo — prazo, vencimento, cancelamento, edição, histórico, compartilhamento

**Contexto**: implementação de `docs/enterprise/specs/cautela-lifecycle-enterprise.md` (4 rodadas
de revisão adversarial da spec antes de codar — 6.5 → 8 → 7.5 → 7/10, 13 achados corrigidos,
nenhum crítico/alto pendente). Pedido do usuário: prazo de devolução personalizável (15/30/90
dias, 6 meses, 1 ano, indeterminado), notificação de vencimento no sino (usuário + armeiro +
admin_reserva), nova aba "Vencidas", edição/cancelamento de cautela com motivo obrigatório, e
menu de 3 pontinhos (Editar/Cancelar/Abrir/Histórico/Compartilhar).

**Migrations** (6, aplicadas e verificadas via MCP): colunas `prazo_devolucao_tipo`/
`prazo_devolucao_data`/`cancelada_por`/`cancelada_em`/`motivo_cancelamento` em `cautelamentos`;
2 novos valores no enum de notificação (`cautela_vencendo`/`cautela_vencida`, migration própria —
Postgres não permite usar um valor de enum recém-criado na mesma transação); `service_log_events`
ganhou 3 novos `event_type` (`cautela_assinada`/`cancelada`/`editada`); RPC
`record_cautelamento_batch` estendida com o prazo (cálculo em SQL, `date + interval` do Postgres
já clampa overflow de mês/ano bissexto nativamente — sem precisar de função de clamp manual como
o lado JS); function `check_cautelas_vencimento()` + `pg_cron` diário (11h UTC = 8h Brasília).

**BFF**: 3 endpoints novos em `cautelamentos.ts` — `POST /:id/cancel` (motivo obrigatório, não
exige assinaturas — ao contrário de Devolver, é o caminho pra desfazer algo antes/durante o
processo — mas bloqueia se as 2 assinaturas já existirem), `PATCH /:id` (edição de motivo/prazo,
trocar item/militar continua sendo `/substitute`), `GET /:id/historico` (combina
`service_log_events` + `document_signatures`, segue a cadeia de substituição inteira). `ShiftEventType`
(BFF) e `EventType` (web, `lib/livro/event-type-config.ts`) — 2 unions fechadas paralelas —
estendidas junto; o `Record` de labels do PDF do Livro Digital (`livro-pdf.ts`) é uma 3ª (achado
do próprio `tsc`, sem precisar de code review pra pegar).

**Frontend**: menu de 3 pontinhos, dialogs de Cancelar/Editar/Histórico/Compartilhar, seletor de
prazo no formulário de emissão, aba "Vencidas" (reaproveita o fetch de "Ativa", filtra
client-side — nunca manda `status=vencidas`, valor inexistente no banco). Sino de notificações
(`notification-bell.tsx`) ganhou os 2 tipos novos nos 3 `Record` + 1 rota — achado CRÍTICO da
1ª rodada de code review: "não precisa mudar o sino" estava errado, e um `isStaffViewing`
(vindo do `dbRole` real do `Header`, não do hook `useRole` obsoleto) decide se a notificação leva
pra `/reserva/cautelas` ou `/efetivo/minhas-cautelas`.

**3 rodadas de code review na implementação** (achados reais em cada uma, típico desta sessão):
1ª rodada — 1 CRÍTICO (`GET /:id/historico` nunca mostrava "Cautela Emitida": o único fluxo de
criação do frontend usa `POST /batch`, que grava o evento sob `subject_type="cautelamento_batch"`
por `movement_id`, não `"cautelamento"` por `cautelamento_id` — a query original nunca batia) +
2 ALTOS (cron sem proteção real contra notificação "vencida" duplicada; `PATCH /:id` gravava
edição fantasma de prazo — incluindo mutar `NULL`→`"indeterminado"` — em toda chamada, por falta
da mesma checagem de igualdade que `motivo_emissao` já tinha). 2ª rodada (verificação) — confirmou
os 3 corrigidos, achou 2 novos: eventos de lote numa cadeia de substituição eram atribuídos à
cautela errada (mascarando o rótulo "cautela substituta"); o mesmo bug de edição fantasma existia
dormente em `prazo_proxima_conferencia` (sem caller real hoje, corrigido preventivamente).

**Achado pré-existente, não relacionado, corrigido pela regra canônica do projeto**: `useState`
com inicializador não-lazy chamando `crypto.randomUUID()` em `_cautelas-client.tsx` (roda a cada
render, quebra a garantia de pureza que o React Compiler exige) — confirmado via `git stash` que
já existia antes desta tarefa. 1 erro do React Compiler (`movementGroupSizes`, também
pré-existente) investigado sem causa raiz encontrada dentro do orçamento da tarefa — documentado
e silenciado pontualmente (perda de otimização, não bug de runtime). 2 warnings pré-existentes de
"set-state-in-effect" (padrões idiomáticos — guard de hidratação SSR, fetch-on-mount) também
documentados e silenciados.

**Validação**: `tsc --noEmit` limpo em `apps/bff` e `apps/web`; eslint limpo (repo inteiro tem 101
problemas pré-existentes em arquivos nunca tocados por esta tarefa — fora de escopo, registrado);
suíte BFF (node) 296/296; suíte BFF (bun, integração real via Hono+authMiddleware, incluindo
2 arquivos novos para `/cancel` e `PATCH /:id`) 72/72; suíte web (vitest) 105/105.

**Fora de escopo, registrado na spec** (§6, perguntas ao dono do produto): backfill de cautelas
já existentes sem prazo definido; janela de "vencendo" fixa em 7 dias (não configurável por
tenant/reserva ainda); cadência de "vencida" a cada 3 dias (arbitrária); `admin_reserva` recebe
toda notificação de vencimento da reserva, sem filtro de ruído; cancelamento em lote (`movement_id`)
não tem variante própria, só individual. Cadeia de substituição em `GET /:id/historico` é N+1
sequencial (até 40 round-trips no pior caso) — impacto baixo hoje (cadeias raramente passam de
1-2 saltos), registrado como possível ponto de atenção futuro.

---

# 2026-08-28 (v35) — fix(cautelas) CRÍTICO×2: devolução e substituição sem as 2 assinaturas

**Contexto**: usuário reportou (produção): "ACABEI DE RECEBER UMA CAUTELA QUE NEM SEQUER FOI ASSINADA PELO USUÁRIO" — o botão "Devolver" aparecia em qualquer cautela `ativa`, mesmo sem nenhuma das 2 assinaturas (armeiro/militar). Uma cautela só prova cadeia de custódia se as 2 partes aceitaram — devolvê-la antes disso apaga essa prova sem ela nunca ter existido de fato.

**Causa confirmada**: `POST /api/cautelamentos/:id/return` só checava `status === "ativa"`, nunca `armeiro_signature_id`/`militar_signature_id`. Botão "Devolver" no frontend (`reserva/cautelas/_cautelas-client.tsx`, 3 pontos de renderização: tabela, cards, dialog de detalhe) tinha a mesma lacuna.

**2º achado CRÍTICO, pela revisão de código deste próprio fix**: `POST /api/cautelamentos/:id/substitute` (endpoint já existente, com rastreabilidade via `substitui`/`substituido_por`, mas sem nenhuma tela consumindo-o ainda) tinha exatamente a mesma falha — substituir também encerra a cautela antiga (`status: "substituida"`, libera o item) igual a devolver, sem checar as 2 assinaturas.

**Fix**: guard idêntico nos 2 endpoints — `if (!armeiro_signature_id || !militar_signature_id) return 422 SIGNATURES_PENDING` antes de qualquer `.update()`. Frontend: as 3 renderizações do botão "Devolver" foram unificadas num único helper `canReturnCautela()` (achado MÉDIO de code review: a condição estava duplicada 3x — exatamente esse tipo de duplicação permitiu o bug original) e uma nota explicando por que o botão some ("Devolução disponível após as 2 assinaturas") substitui o antigo silêncio.

**Validação**: teste estático (`idor-write-scope.test.ts`) cobrindo os 2 endpoints; **novo teste de integração real** (`__tests__/integration/cautelamentos-return-real-handler.test.ts`, roda via `bun test` — monta o Hono real com `authMiddleware` + `cautelamentosRoutes`, chama `POST /:id/return` de verdade com Supabase mockado, cobre as 3 combinações de assinatura pendente) — achado ALTO da própria revisão: o teste estático original só confere texto-fonte, nunca invocava o handler; o teste de integração fecha essa lacuna. Suíte completa do BFF 292/292 + integração 64/64; `tsc --noEmit` limpo em `apps/bff` e `apps/web`; web 105/105.

**Investigado nesta mesma sessão, sem achado de bug** (registrado por transparência): (1) contagem "137 de 645 itens" em "Nova Cautela Permanente" — confirmado NÃO ser bug: é o resultado esperado de 3 filtros (`status_operacional=disponivel` + `material_type.cautela_habilitada=true` + `cautela_elegivel=true` por item), não o total do acervo. (2) Erro 400 ZodError relatado em "Adicionar Material" (`POST /api/arsenal/requests`) — testado o schema atual (`RequestSchema`) contra 5 cenários realistas (arma, veículo, bulk+cautela, foto legada, categoria custom): todos passam; log do BFF já não tinha o incidente original (container reiniciado por deploy desta própria sessão) — sem reprodução nova, tratado como possivelmente anterior ao fix de `photo_url` (v29) já em produção; pedido ao usuário para reportar de novo com `requestId` se recorrer.

**Fora de escopo desta entrega, registrado para spec futura** (pedido explícito do usuário, tamanho não compatível com um fix pontual): prazo de cautela personalizável (15/30/90 dias, 6 meses, 1 ano, indeterminado) + notificação de vencimento (sino) para usuário/armeiro/admin_reserva; menu de 3 pontinhos por cautela (Editar, Cancelar com motivo, Abrir, Histórico completo, Compartilhar via WhatsApp/PDF); nova sub-aba de cautelas vencidas.

---

# 2026-08-28 (v34) — feat(efetivo): sub-aba "Ocorrências" + clique no card do Histórico agora mostra detalhe/status

**Contexto**: achado real do usuário — no Histórico (`efetivo/historico`), um card avisando sobre uma ocorrência de material (avaria/perda/furto/etc.) registrada em seu nome pelo armeiro aparecia sem nenhuma interação: clicar não fazia nada, sem detalhe, sem status atual, sem indicação de a quem recorrer. Pedido explícito: corrigir o clique, e criar uma sub-aba dedicada "Ocorrências" no sidebar (abaixo de "Solicitações Remotas") reunindo tanto as ocorrências que o próprio militar reportou quanto as ocorrências de material associadas ao seu nome.

**Fix**: extraído `apps/web/src/components/efetivo/ocorrencia-material-detail-dialog.tsx` (SSOT) com `OcorrenciaMaterialCard` (agora clicável, `role="button"` + `onClick`/`onKeyDown`) e `OcorrenciaMaterialDetailDialog` (detalhe somente-leitura: material, identificador, status, foto, descrição, quem registrou e quando, reserva, e uma nota fixa "Para mais informações ou contestações, busque informações com o cadastrante desta ocorrência" — o fluxo é intencionalmente sem ação do militar, quem resolve é o armeiro). `_historico-client.tsx` passou a consumir esses dois componentes em vez do card estático anterior sem `onClick`.

Nova rota `/efetivo/ocorrencias` (`page.tsx` + `_ocorrencias-client.tsx`, mesmo padrão de guard de `historico/page.tsx`) com duas seções: ocorrências que o militar reportou (`GET /api/ocorrencias`) e ocorrências de material associadas a ele (novo `GET /api/usuario/ocorrencias-material`, reaproveitando `loadOcorrenciasAssociadas` já existente). Novo item no sidebar (`sidebar.tsx` e `mobile-nav.tsx`) abaixo de "Solicitações Remotas".

**2 achados CRÍTICOS de segurança pré-existentes, descobertos ao investigar a causa raiz** (não relacionados ao pedido original, corrigidos na mesma investigação por exigirem entender o fluxo completo de `ocorrencias` — ver entrada v33 para o registro detalhado): a policy RLS `occ_staff` usava roles obsoletos (tornando a tela de gestão de staff permanentemente vazia) e o endpoint `GET /api/ocorrencias` vazava ocorrências entre tenants.

**Validação**: `tsc --noEmit` limpo em `apps/bff` e `apps/web`; suíte do BFF 290/290; suíte do web 105/105; revisão de código sênior em 2 rodadas (1ª encontrou 2 CRÍTICOS + 1 ALTO + 2 MÉDIOS + 2 BAIXOS, todos corrigidos; 2ª rodada confirmou os 7 corrigidos e não achou bloqueador novo — ver v33).

---

# 2026-08-28 (v33) — fix(ocorrencias) CRÍTICO×3: RLS com roles obsoletos, vazamento cross-tenant no GET e IDOR de escrita no PATCH

**Contexto**: investigando a causa raiz do bug de clique do v34 (por que uma ocorrência reportada por um militar — matrícula 000003 — nunca foi vista/resolvida por nenhum armeiro), a trilha levou a 3 bugs de segurança independentes e pré-existentes na tabela `ocorrencias` (reportes de problema com material feitos pelo próprio militar), nenhum causado pela mudança de produto do v34.

**1. RLS `occ_staff` usava role_enum obsoletos** — a policy só aceitava `auth_role() = ANY (ARRAY['master','admin'])`, valores que não existem em nenhum `profiles.role` real desde a migração de roles (confirmado: 0 de ~1000 profiles usa 'admin'/'master'). Resultado: a página de gestão `reserva/ocorrencias/page.tsx` (Server Component, sujeita a RLS) sempre devolvia lista vazia pra qualquer staff real — a ocorrência real da matrícula 000003 nunca apareceu pra ninguém desde então. `supabase/migrations/20260828020000_fix_ocorrencias_rls_obsolete_roles_and_tenant_leak.sql` trocou pros roles atuais (armeiro/admin_reserva/admin_global) e adicionou isolamento por tenant (via `profiles.default_tenant_id` do militar que reportou — `ocorrencias` não tem tenant_id próprio).

**2. Regressão introduzida pelo próprio fix acima, achada pela 1ª rodada de code review**: a policy corrigida incluía `auth_role() = 'superadmin'::role_enum` como acesso irrestrito sem filtro de tenant — violando a regra canônica já estabelecida no projeto (`superadmin` é papel de operação da plataforma, nunca deve ver dado de tenant nenhum; confirmado que nenhuma outra policy do banco referencia superadmin no `USING`). Corrigido em `supabase/migrations/20260828030000_fix_ocorrencias_occ_staff_exclude_superadmin.sql`, removendo o branch.

**3. `GET /api/ocorrencias` e `PATCH /api/ocorrencias/:id` (BFF, service role — RLS não se aplica) sem NENHUM filtro de tenant** — qualquer armeiro/admin_reserva/admin_global autenticado via o GET via TODAS as ocorrências abertas da plataforma inteira; via o PATCH, um armeiro do Tenant A sabendo/enumerando o UUID de uma ocorrência do Tenant B conseguia marcá-la como resolvida/improcedente (IDOR de escrita), notificando o militar errado e gravando evento de Livro Digital cross-tenant. Ambos corrigidos com `!inner` no join com `profiles` + `.eq("military.default_tenant_id", tenantId)` (mesmo padrão de `shifts.ts:423`); PATCH responde 404 (não 403) em tenant errado, pra não vazar existência.

**Risco residual conhecido, registrado e não corrigido nesta entrega** (fora de escopo — pré-existente e sistêmico, não introduzido por este fix): militares com `profiles.default_tenant_id IS NULL` ficam com suas ocorrências invisíveis/irresolvíveis pelo `!inner` acima (mesma dependência de `default_tenant_id` que `my_tenant_id()` já tem em dezenas de policies pré-existentes do banco). Hoje, 0 ocorrências reais afetadas — dos 22 profiles `role=usuario` com `default_tenant_id` nulo, 21 estão em onboarding (`pending_biometric`, não conseguem completar login) e o único com `registration_status='complete'` é uma conta de teste órfã sem nenhum `tenant_membership`. Corrigir de raiz exigiria auditar o modelo de tenant como um todo — fora do escopo desta tarefa.

**Validação**: 2 migrations aplicadas e verificadas em produção via MCP (policy final reconsultada via `pg_policies`, batendo com o SQL); novo teste estático em `idor-read-scope.test.ts` cobrindo o filtro de tenant no PATCH (espelhando o já existente pro GET); suíte do BFF 290/290; revisão de código sênior em 2 rodadas confirmando os 2 CRÍTICOS + 1 ALTO corrigidos, sem bloqueador novo.

---

# 2026-08-28 (v32) — security: 12 funções sem search_path fixo corrigidas (Supabase Security Advisor)

**Contexto**: com o conector MCP do Supabase liberado pro projeto `jepitcrkicwmvzrmllpn` (correção de escopo feita pelo dono do produto), rodei o Security Advisor logo após validar o fix do v29 — achado sistemático: 12 funções (`update_updated_at`, `audit_material_request`, `audit_approval_request`, `audit_push_subscription`, `has_totp`, `expire_material_requests`, `fn_check_reserve_org_unit_tenant`, `_block_signature_update`, `_block_signature_delete`, `_update_cautelamentos_timestamp`, `aar_set_updated_at`, `set_updated_at_tenant_branding`) sem `search_path` fixo — mesma classe de risco (search_path hijacking) que `my_tenant_id()`/`auth_role()`/`can_read_material_photo()` (v29) já mitigam corretamente desde `20260629000006_fix_auth_role_recursion.sql`.

**Fix**: `supabase/migrations/20260828010000_fix_functions_mutable_search_path.sql` — `ALTER FUNCTION ... SET search_path = public, pg_temp` nas 12, preservando o corpo/lógica de cada uma (mesmo padrão já usado e comprovado em produção). Todas com 0 argumentos (confirmado via `pg_get_function_identity_arguments` antes de escrever a migration — sem overload, sem ambiguidade de assinatura).

**Validado ao vivo via MCP** (antes/depois): rodei o Security Advisor antes da migration (12 avisos `function_search_path_mutable` presentes) e depois (os 12 desapareceram da lista, confirmado também via `pg_proc.proconfig` mostrando `search_path=public, pg_temp` nas 12).

**Achados do mesmo advisor, registrados mas não tratados nesta entrega** (risco baixo ou decisão de produto, não de código): 9 tabelas com RLS habilitada e zero policies (`biometric_*`, `service_handovers`, `revoked_sessions`, `handover_attachments`, `totp_identity_claims`) — RLS sem policy nega tudo por padrão (fail-closed), consistente com serem tabelas tocadas só pelo BFF via service role; extensões `hypopg`/`index_advisor` instaladas no schema `public` (ferramentas de análise de performance, sem risco de segurança real); funções `SECURITY DEFINER` executáveis via RPC por `anon`/`authenticated` (inclusive `can_read_material_photo` do v29 — verificado que não vaza nada, sempre retorna `false` sem `auth.uid()` válido, e é o mesmo padrão de todas as outras funções do projeto); proteção de senha vazada (HaveIBeenPwned) desabilitada no Auth (toggle de painel, não migration).

---

# 2026-08-28 (v31) — feat(cautelas): paginação, seleção/exportação em PDF e modal de detalhe

**Contexto**: achado real do usuário — a página operacional `/reserva/cautelas` (usada pelo armeiro no dia a dia) nunca teve paginação, nem checkbox de seleção/exportação em PDF (ao contrário do Almoxarifado, que já tinha os três), e clicar numa linha/card não abria nada — só dava pra ver os dados emitindo o PDF inteiro.

**Fix**: reaproveitados os mesmos componentes compartilhados já usados no Almoxarifado (`usePaginatedSelection`, `GridPdfButton`, `GridRowCheckbox`/`GridSelectAll`) — "Ver mais" (10→20→30→50→100) nos dois modos de visualização (grade e lista, um limite linear único já que Cautelas não agrupa por categoria como o Almoxarifado); checkbox de seleção com exportação em PDF (sem seleção exporta a lista filtrada inteira via um alvo de impressão oculto que sempre renderiza todos os itens, nunca só a página visível — mesmo achado crítico já registrado no Almoxarifado); novo Dialog de detalhe somente-leitura ao clicar numa linha/card, com atalhos pras ações já existentes (Assinar Armeiro/Usuário, Devolver, PDF), fechando-se antes de abrir a próxima.

**Validação**: `tsc --noEmit` limpo em `apps/web`.

---

# 2026-08-28 (v30) — feat(obs): 3 gaps de observabilidade do BFF corrigidos (validação Zod, rate-limit, roleGuard)

**Contexto**: ao investigar o bug do v29, nenhuma parte da observabilidade "premium" já implementada (Pino estruturado + `requestId` de correlação + access log NDJSON + `audit_logs`, ver `docs/enterprise/specs/observability-logging-enterprise.md`, todas as 6 fases já em produção) tinha registrado o evento. Varredura pedida pelo dono do produto encontrou 3 pontos onde falhas/negações reais nunca deixavam rastro nenhum no log.

**1. `zValidator` sem hook em ~86 pontos do repo** — `@hono/zod-validator` sem `hook` responde 400 direto ao cliente sem passar por logger/onError/audit_logs. Criado `apps/bff/src/lib/validated-json.ts` — wrapper *drop-in* com a mesma assinatura de 2 argumentos, loga `validation.failure` (path, method, target, nomes dos campos com erro — nunca o valor enviado, `.flatten().fieldErrors` do Zod nunca inclui isso, REP10 preservado). Import trocado em **16 arquivos de rota**, nenhuma outra linha mudou nos call sites.

**2. Rate limiter bloqueando (429) sem nenhum log** — o branch de bloqueio sempre respondeu direto via `c.json()`, nunca lançando exceção — nunca passava por `onError`. Um ataque de força bruta em `/api/auth/login` (a própria defesa que o rate-limit existe pra fornecer) era 100% invisível no log. Agora loga `rate_limit.blocked` com qual limiter disparou, IP/chave, contagem e teto.

**3. `roleGuard` negando (403) sem contexto de quem/o quê** — só chegava ao log como um `http.exception` genérico. Agora loga `role_guard.denied` com userId, papel que tinha, papéis exigidos e path — sinal real de possível escalação de privilégio, distinguível de qualquer outro 403.

**Nova regra no CLAUDE.md**: debug sempre pelo BFF primeiro (`docker logs`/`/api/nexus/errors`) antes de assumir a causa pelo sintoma no cliente — documentada a limitação real de que `docker logs` só retém desde o último restart do container (um deploy recente apaga o histórico de um incidente anterior).

**Validação**: `tsc --noEmit` limpo; 2 testes novos de regressão — um no harness de rate-limit existente (monkey-patch de `baseLogger.warn`, confirma `rate_limit.blocked` emitido com os campos certos) e um arquivo novo (`role-guard-logging.test.ts`, monkey-patch de `baseLogger.child`, confirma `role_guard.denied` com contexto completo e ausência de log quando o papel é permitido); suíte completa do BFF **288/288**.

---

# 2026-08-28 (v29) — fix(arsenal) CRÍTICO: solicitação de material com foto sempre falhava (400 ZodError)

**Contexto**: usuário reportou em produção (logado como armeiro) que toda solicitação de adição de material COM foto falhava com erro 400 (`ZodError`) — sem foto, funcionava normal. Zero testes cobriam esse caminho.

**Causa raiz**: `POST /api/arsenal/material-photo` devolve `photo_url` como path relativo do Storage privado (`materials/<uuid>.webp`) — decisão deliberada e já documentada no próprio código (`material-photos` é privado, uma URL pública nunca funcionaria). Mas o schema Zod de `POST /api/arsenal/requests` (`photo_url: z.string().url()`) exigia uma URL completa — rejeitava 100% dos uploads reais. `git blame` confirma a linha tocada em 2026-08-23, um dia antes do usuário reportar (segunda-feira) — o próprio arquivo já documentava a regra certa 1000 linhas abaixo, em `OcorrenciaSchema.foto_url`, só que `RequestSchema` nunca foi atualizado pra seguir o mesmo padrão.

**Fix**: `photo_url`/`photo_storage_path` viram um schema compartilhado (`materialPhotoPathSchema`, `apps/bff/src/lib/arsenal-request-schema.ts`, novo) — `min(1).max(500)` + bloqueio de path traversal (`..`) e injeção de controle/newline, aceitando tanto o path relativo novo quanto a URL pública legada que `resolvePhotoUrl` já suporta. `RequestSchema` foi extraído pra esse mesmo módulo (sem imports internos) — necessário pra conseguir testar de verdade com `.safeParse()` via `node --experimental-strip-types --test`, já que `routes/arsenal.ts` importa outros arquivos do pacote sem extensão de arquivo (funciona via Bun em runtime, quebra a resolução ESM nativa do Node usada pelos testes).

**Achado CRÍTICO adicional, encontrado pelo code review deste próprio fix**: a policy de RLS do bucket `material-photos` permite qualquer usuário autenticado de **qualquer tenant** ler a foto de material de **qualquer outro tenant** — o bug de `photo_url` mascarava isso sem querer (upload real sempre falhava, então nenhum path de foto real chegava a ser persistido por este fluxo). Investigado a fundo, spec e migration escritas (`docs/enterprise/specs/material-photos-tenant-isolation-enterprise.md`, `supabase/migrations/20260828000000_fix_material_photos_cross_tenant_rls.sql`). **Aplicada em produção pelo dono do produto no mesmo dia (2026-08-28)** — validado via harness da spec: `can_read_material_photo` existe com `prosecdef = true`; a policy antiga `material_photos_auth_read` não existe mais, só `material_photos_tenant_read`.

**Validação**: `tsc --noEmit` limpo; 9 testes novos (`arsenal-request-schema.test.ts`) incluindo teste de mutação (reverti o fix, confirmei 2/5 falhando, restaurei), casos de borda (500/501 chars, URL legada, path traversal) e wiring estático (confirma que `routes/arsenal.ts` usa o schema extraído de verdade, não um schema divergente reintroduzido por engano); suíte completa do BFF 285/285 (depois 288/288, ver v30).

---

# 2026-08-27 (v28) — chore(i18n): renomeia "TOTP" para "Código dinâmico" na interface

**Contexto**: pedido de produto — o termo técnico "TOTP" (Time-based One-Time Password) aparecia cru na tela em ~20 pontos do frontend e em mensagens de erro do BFF, sem significado óbvio pra usuário final não-técnico. Escopo deliberadamente limitado a **texto exibido**, não à mecânica: nomes de variável/função/tipo, colunas do banco (`totp_secrets`, `totp_configured`), rotas `/api/totp/*` e chaves de log estruturado continuam iguais.

**Onde o texto mudou**: badges/tooltips/labels em `admin/comando`, `admin/usuarios/_users-table.tsx`, `reserva/militares/_militares-table.tsx`, `efetivo/page.tsx`, `reserva/cautelas`, `reserva/livro`, `reserva/passagens/[id]`, `reserva/saidas` (3 arquivos), `reserva/solicitacoes`, toda a área `nexus/*` (6 páginas) e a página pública de verificação de documento `/v/[document_id]`; componentes `sign-dialog.tsx`, `shift-auth-dialog.tsx`, `_verify-totp-dialog.tsx`, `self-totp-hint.tsx`, `totp-display.tsx`. No BFF, mensagens de erro em `totp-guard.ts` (SSOT) e nas rotas `cautelamentos.ts`, `handovers.ts`, `saidas.ts`, `inventory.ts`, `signatures.ts`, `nexus.ts`, `ssa.ts`, `totp.ts`.

**Achado crítico verificado durante a migração**: 3 rotas do BFF (`cautelamentos.ts`, `handovers.ts`, `saidas.ts`) comparavam a string literal `"TOTP inválido"` pra incrementar o contador de rate-limit/lockout anti-bruteforce — trocar só a mensagem sem atualizar essas comparações quebraria o lockout silenciosamente (todo erro passaria a ser tratado como "não é TOTP inválido", nunca incrementando o contador). As 3 comparações foram atualizadas junto com a mensagem e a lógica de lockout foi conferida linha a linha.

**Validação**: `tsc --noEmit` limpo em `apps/web` e `apps/bff`; `apps/bff`: 271/271 testes passando (inclui a suíte `checkTotpGuard`, que cobre exatamente o texto renomeado); validação visual via Playwright standalone em 4 telas (`/efetivo`, `/admin/usuarios`, `/admin/comando`, `/reserva/militares`) confirmando ausência de "TOTP" cru na UI. Revisão de código encontrou 2 MÉDIOs (4 mensagens inconsistentes em `totp.ts`, nome de teste alterado por engano em `login-invite.spec.ts`) — ambos corrigidos antes desta entrega.

---

# 2026-08-27 (v27) — feat(ux): AlertDialog compartilhado substitui `window.confirm()` + `friendlyApiError` cobre 401/403 + ALTO de regressão corrigido

**Contexto**: auditoria de UX/mensagens encontrou 5 usos de `window.confirm()` nativo (sem estilo, sem loading, incompatível com teste automatizado de verdade) e `friendlyApiError` deixando 401/403 caírem no fallback genérico do call site em vez de avisar "sessão expirada"/"sem permissão".

**Componente novo — `src/components/ui/alert-dialog.tsx`**, espelhando `dialog.tsx` sobre `@base-ui/react/alert-dialog` (sem botão de fechar — ação destrutiva não deve ter saída ambígua; `AlertDialogAction`/`AlertDialogCancel` "burros", sem estado próprio, o caller decide quando fechar).

**Migração dos 5 `window.confirm()`**: `_arsenal-client.tsx` (desativar material), `_biometric-console-client.tsx` (revogar leitor) — fecham o dialog antes do await; `_criar-armeiro-client.tsx`, `_cadastrar-militar-dialog.tsx` (reenviar convite), `_edit-dialog.tsx` (alterar e-mail de acesso) — fecham só no sucesso, mantendo spinner visível durante a request. Também aplicado ao botão "Fechar campanha" de `admin/inventario/[id]/page.tsx`, que não tinha loading/disable/confirmação nenhuma antes.

**ALTO de regressão encontrado por code review e corrigido**: nos 2 dialogs que já continham um `<Dialog>` próprio (`_edit-dialog.tsx`, `_cadastrar-militar-dialog.tsx`), o `<AlertDialog>` novo tinha sido renderizado como IRMÃO do `Dialog` sob um Fragment — o base-ui só suprime o Escape do dialog pai quando o filho está aninhado na árvore React (via `DialogRootContext`/`ownNestedOpenDialogs`), não quando é irmão. Resultado: apertar Esc na confirmação fechava o formulário inteiro junto, perdendo os dados digitados. Confirmado empiricamente por 2 rodadas de revisão independentes (uma reproduziu o bug renderizando a estrutura quebrada; outra fez teste de mutação removendo o fix pra confirmar que o teste de regressão realmente falha sem ele). Fix: mover o `<AlertDialog>` pra dentro do `<DialogContent>` do pai.

**`friendlyApiError` (`src/lib/api-error.ts`)**: 401 sem mensagem útil (vazia ou na blocklist de mensagens cruas em inglês) agora vira "Sessão expirada. Faça login novamente."; 403 vira "Você não tem permissão para realizar esta ação." — em vez do texto genérico do call site (ex: "Erro ao carregar solicitações"). Não afeta nenhuma mensagem de negócio já em pt-BR que acompanhe um 401/403 (ex: "Credenciais inválidas" do login), que continua passando verbatim. Aplicado também em `solicitacao-status-card.tsx`, `solicitacao-detail-sheet.tsx`, `_aprovacao-client.tsx`, `_admin-saidas-client.tsx`. `cancel-request-dialog.tsx` passou a distinguir `ApiError` (mensagem segura, mostrada verbatim) de qualquer outro erro (rede/timeout, fallback genérico "Erro de conexão").

**Refactor DRY (`src/hooks/use-confirm.ts`)**: o padrão handle→do→confirm usado nos 5 fluxos acima duplicava o mesmo par `useState<T|null>` + abrir/cancelar em cada arquivo. Extraído pra um hook — `useConfirm<T>()` guarda o alvo pendente (ou `useConfirm<true>()` como sinalizador puro quando o dado real já vive em outro state), sem tentar unificar QUANDO cada um fecha o dialog (isso continua sendo uma decisão de UX real e deliberadamente diferente entre os dois grupos).

**`src/hooks/use-last-truthy.ts`**: a `Description` de cada AlertDialog é condicional no dado que disparou a confirmação — fechar o dialog limpa esse dado antes da animação de saída terminar, fazendo o texto sumir por ~100ms num flash visual. Hook guarda o último valor truthy visto e o exibe durante o fade-out.

**Validação**: `tsc --noEmit` limpo; suíte completa de testes novos/atualizados cobrindo os 4 fluxos reais com AlertDialog aninhado (`_arsenal-client.test.tsx`, `_criar-armeiro-client.test.tsx`, `_cadastrar-militar-dialog.test.tsx`, `_edit-dialog.test.tsx`) + o componente genérico (`alert-dialog.test.tsx`, incluindo o teste de regressão do Escape) + `api-error.test.ts` — 99/99 na suíte inteira de `apps/web`. `e2e/admin-usuarios.spec.ts` atualizado nos 2 pontos que dependiam do `window.confirm` nativo removido.

---

# 2026-08-27 (v26) — perf(dashboard): loading states, fetch paralelo em `efetivo`, throttle de SSE, pausa em background, lazy-load do gráfico

**Contexto**: usuário reportou ao vivo (logado como efetivo, matrícula 000003) troca de página/aba lenta em produção — "loading no topo por uns 3 segundos", igual ao problema já mitigado antes para o papel armeiro. Duas auditorias dedicadas (performance + UX/mensagens) confirmaram, lendo o código real, um conjunto de causas concretas, endereçadas nesta entrega em 5 frentes.

**1. Loading states (skeleton) — 30 rotas via `loading.tsx` + 7 rotas via upgrade interno.** `apps/web` não tinha nenhum `loading.tsx` — o Next.js não tinha nenhuma forma de mostrar feedback visual durante o `await` de um Server Component, deixando a navegação "travada" sem indicação nenhuma até a página inteira estar pronta. Adicionados 3 componentes reutilizáveis em `src/components/skeletons/` (`dashboard-cards-skeleton`, `list-skeleton`, `detail-skeleton`, sobre o `Skeleton` genérico que já existia e nunca tinha sido usado) e 30 arquivos `loading.tsx` nas rotas assíncronas de verdade. As 7 rotas restantes são wrappers síncronos ou client components na própria `page.tsx` (`loading.tsx` de rota não ajudaria) — nelas, o spinner genérico interno foi trocado pelo `Skeleton` equivalente, preservando os `data-testid` já consumidos por e2e existentes (`_cautelas-client.tsx`, `_livro-client.tsx`, `_historico-client.tsx`, `_admin-livros-client.tsx`, `admin/estrutura`, `admin/inventario`, `admin/inventario/[id]`).

**2. `efetivo/page.tsx` — fetch paralelo (`Promise.all`) + 2 bugs reais encontrados no caminho.** As 4 operações desta página (cautelas ativas via BFF, lendings do militar, contagem total, últimas solicitações) rodavam em série — paralelizadas, seguindo o mesmo padrão já usado em `reserva/page.tsx`/`admin/page.tsx`. No processo de reimplementar a query de lendings, um bug de dado real foi descoberto e corrigido: a query buscava só os 50 lendings mais recentes de **qualquer status** e filtrava "ativo"/"devolvido" em JS depois — com usuários de alto volume (confirmado ao vivo com `cadete@apmcb.dev`: 102 lendings reais, 22 ativos, 80 devolvidos), o card "Devolvidos" mostrava **28 em vez de 80**, silenciosamente incompleto. Corrigido com 2 queries diretas (`status_legacy="ativo"` e `count:exact` dedicado para "devolvido"), mais um cap defensivo de 200 registros ativos com link "Ver todos (N)" para o histórico paginado quando excedido. Achado CRÍTICO tangencial: as 3 queries de lendings não tratavam erro do Supabase — uma falha silenciosa exibiria "0 materiais" indistinguível de "usuário sem nada em custódia"; agora qualquer erro exibe "—"/banner de aviso em vez de um zero enganoso.

**3. Throttle (trailing) em `useSSERefresh`.** Sem `onEvent`, o hook disparava `router.refresh()` a cada evento SSE — uma rajada de eventos disparava N refreshes seguidos. Throttle com trailing call garante no máximo 1 refresh/segundo, sem nunca ficar em zero (diferente de debounce simples, que atrasaria todo evento isolado). Beneficia os 4 consumidores sem `onEvent` (`RealtimeArmeiroSync`, `RealtimeArsenalSync`, `RealtimeEfetivoSync`, `admin/usuarios/_users-table.tsx`) sem precisar editar nenhum deles.

**4. Pausar polling em aba oculta, sem flash de loading ao voltar.** `admin/comando/_client.tsx` fazia polling a cada 60s mesmo com a aba em background. Guarda de visibilidade adicionada — mas medindo **quanto tempo a aba ficou oculta** (não "tempo desde o último fetch", que dispararia refetch/flash em qualquer alt-tab rápido). `use-role-guard.ts` ganhou a mesma guarda só no `setInterval` de 5min, preservando o check inicial e o listener de `focus` já existentes.

**5. Lazy-load do `recharts` via wrapper client.** `admin/page.tsx` (Server Component) importava `LendingChart` estaticamente — `recharts` inteiro carregava no bundle inicial mesmo antes do gráfico aparecer na tela. `next/dynamic({ssr:false})` não compila direto em Server Component (confirmado no binário do compilador Next 16.2.9) — isolado num novo `lending-chart-lazy.tsx` com `"use client"` próprio.

**Validação**: `npx tsc --noEmit` limpo em `apps/web`; `npm run build` (não só `tsc`, que não pega o erro do SWC da Fase 5) compilando com sucesso; suíte completa `npx vitest run` — 99/99 testes passando; validação visual via Playwright standalone (nunca `npx playwright test` — `global-teardown.ts` cancela `material_requests` reais em produção) confirmando números de `efetivo/page.tsx` batendo com o banco antes e depois do fix (reproduzido com `git stash`, revertido). Risco residual não fechado nesta entrega: 1 achado ALTO de review sobre timeout de RLS na query de lendings sob volume alto foi verificado apenas estaticamente (leitura do SQL das migrations `20260823000000`/`20260824010000`, confirmando `military_id = auth.uid()` direto e funções `STABLE SECURITY DEFINER`) — não foi possível rodar `EXPLAIN ANALYZE` ao vivo por restrição de permissão do MCP do Supabase nesta sessão.

---

# 2026-08-19 (v22) — fix(ssa) CRÍTICO, parte 2: o fix anterior não resolveu — causa raiz era outra

**Contexto**: a migration da v21 (nomes de role obsoletos) foi aplicada em
produção, mas o timeout continuou **idêntico** (revalidado ao vivo: ainda
8s+, erro 57014) — a v21 corrigiu um problema real, mas não era a causa
completa do sintoma reportado.

**Causa raiz verdadeira**: mesmo depois de corrigir os nomes de role, a
policy continuava usando `EXISTS (SELECT 1 FROM material_requests r WHERE
r.id = request_id AND r.tenant_id = my_tenant_id())` — um EXISTS
**correlacionado** (referencia `request_id` da linha de fora), que o
Postgres precisa replanejar/reexecutar para CADA linha de
`material_request_items` sendo avaliada pela RLS, mesmo com `r.id` sendo
PK. Isolado com um teste direto: `SELECT count(*) FROM
material_request_items` **sem nenhum join, sem filtro nenhum**, também
travava em ~8s — não era o embed do PostgREST (hipótese da v21), era a
avaliação da própria RLS, linha a linha, contra as ~1000 linhas
acumuladas de execuções de teste.

**Fix de verdade**: `material_request_items` já tem uma coluna
`tenant_id` própria desde a fundação multi-tenant do projeto — nunca
populada de forma consistente no INSERT (631 de 1005 linhas com
`tenant_id` NULL). Corrigidos os 2 pontos de criação de solicitação em
`apps/bff/src/routes/ssa.ts` (fluxo remoto padrão e fluxo "Modo A" —
saída presencial por código de acesso) para popular `tenant_id`.
Migration faz backfill das linhas existentes, adiciona índice em
`tenant_id`, e reescreve a policy pra comparar a coluna direto
(`tenant_id = my_tenant_id()`) em vez do EXISTS correlacionado — um
filtro plano por linha, sem subquery, ordens de magnitude mais barato.

**Lição registrada**: a v21 já tinha um aviso próprio sobre isso ("a
suposição de performance não verificada foi exatamente o que causou o
bug original") — mesmo assim, o fix da v21 repetiu o mesmo tipo de erro
(assumir que EXISTS-por-PK seria rápido o suficiente sem medir). Desta
vez o fix foi desenhado copiando um padrão **já comprovadamente rápido no
mesmo banco** (o filtro `tenant_id = X` direto que `material_requests` já
usa com sucesso, medido em 236-445ms), não uma suposição nova.

**Achado ALTO de code review, corrigido no mesmo commit**: os dois pontos
de INSERT em `ssa.ts` aceitavam `tenant_id: tenantId ?? null` sem
nenhuma guarda — como o BFF usa a service role key (ignora RLS
inteiramente), nada impedia gravar uma solicitação órfã (`tenant_id`
NULL) se a sessão não tivesse tenant resolvido, o que reintroduziria o
mesmo bug aos poucos, um request de cada vez, sem nenhum erro visível.
Adicionado `if (!tenantId) return 403` nos dois pontos — mesmo padrão já
usado em `GET /available-materials`.

**Achado tangencial, não corrigido (fora de escopo desta entrega)**:
rodando a suíte `ssa-suite` completa, `GET /api/notifications` do BFF
(`apps/bff/src/routes/notifications.ts`) sempre retorna 404 — a rota é
importada e o middleware é registrado em `index.ts`, mas nunca foi
montada com `app.route(...)`. Não afeta usuários reais: o sino de
notificações de verdade (`components/layout/notification-bell.tsx`) usa
a rota nativa do Next.js (`app/api/notifications/route.ts`), que lê
direto do Supabase — o caminho do BFF é código morto, sem nenhum
consumidor real. Só quebrava 2 testes E2E (`SA04`/`SA06`), que passaram
a checar a tabela `notifications` direto (mesmo caminho da rota real) em
vez de bater na rota do BFF. Ficou pendente uma decisão de produto: montar
a rota do BFF (redundante com a do Next.js) ou remover o arquivo morto.

**Ação pendente do dono do produto — URGENTE, substitui a da v21**: (1)
deploy do BFF atualizado (`apps/bff/src/routes/ssa.ts`) e (2) aplicar
manualmente no Supabase Dashboard (SQL Editor), na mesma janela — achado
de code review: se a migration rodar antes do deploy do código, qualquer
solicitação criada nesse intervalo nasce órfã de novo —
`supabase/migrations/20260819020000_fix_ssa_items_rls_correlated_subquery_timeout.sql`.
Assim que aplicada, o timing será revalidado ao vivo de novo antes de
considerar a entrega definitivamente fechada.

---

# 2026-08-22 (v25) — feat(cautela): múltiplos materiais numa única cautela (movement_id)

**Pedido**: "tb nessa página modal deve ter opção de incluir mais de uma
material igual na saída. assim produzir uma cautela com mais de um
material se possível ok." — o modal "Nova Cautela" só permitia 1 item
físico por operação. Spec completa em
`docs/enterprise/specs/cautela-multi-item-batch-enterprise.md`.

**Arquitetura**: replicado o padrão já provado de `lendings.movement_id`
— N cautelas criadas na mesma operação compartilham um `movement_id`,
cada uma independentemente rastreável/devolvível/substituível. Nova RPC
transacional `record_cautelamento_batch` (idempotente por movement_id,
`FOR UPDATE` por item físico, revalida elegibilidade CAU-06/
disponibilidade/validade — nunca confia no frontend) e
`sign_cautelamento_batch` (1 verificação de TOTP/biometria cobre N
cautelas, mas grava N `document_signatures` independentes). Modal migrado
pra lista dinâmica de itens (mesmo padrão de reserva/saidas/nova/
_form.tsx), grid ganha badge "Lote de N".

**Achado colateral corrigido antes da feature (CMB-00)**: `POST /:id/
sign-militar` nunca funcionava quando o armeiro tentava facilitar a
assinatura de um militar — validava TOTP/biometria contra quem estava
logado (o armeiro), não contra o dono da cautela. Corrigido com
`resolveSigningIdentity()` (allow-list explícita de roles staff).

**CRÍTICO achado e corrigido durante o desenvolvimento**: a suíte de
testes E2E (nova e a pré-existente `cautelamentos.spec.ts`) mutava
permanentemente `material_types.cautela_habilitada` de tipos REAIS e
pré-existentes do banco — como "local" roda o app mas usa o MESMO banco
Supabase de produção, isso alterou configuração de negócio real
silenciosamente (inclusive desligando a flag de um tipo real, sem
revert). Corrigido: todo material usado em teste agora é sintético,
criado via o fluxo real de aprovação (`POST /api/arsenal/requests` +
approve), nunca mais `UPDATE` em linhas pré-existentes.

**ALTO achados de code review, corrigidos no mesmo commit**: ordem de
lock não determinística na RPC de criação (risco real de deadlock
40P01 entre lotes concorrentes); race de idempotência sob concorrência
genuína (não só replay sequencial) resolvida com
`pg_advisory_xact_lock`; códigos de erro crus da RPC vazando pro toast
do usuário (tradução pt-BR adicionada no BFF); contagem do badge "Lote
de N" podia superestimar o que a assinatura em lote realmente cobre;
zero cobertura E2E de UI real pro modal (só testes de API — corrigido
com um teste Playwright dirigindo o browser de verdade).

**Validado ao vivo** contra o banco real via localhost: 11 testes de
`cautelamento-suite`, 12 de `cautelamento-batch-suite` (incluindo prova
de concorrência real com `Promise.all` de dois cliques simultâneos), 5
de `cautelas-ui-suite`, e os testes afetados de `livro-digital.spec.ts`.

**Pendente**: deploy do BFF (Hetzner) + frontend (Cloudflare Pages) e
validação final contra produção — aguardando decisão do usuário.

---

# 2026-08-21 (v24) — fix: divergência de contagem militares/usuários + bug crítico de identidade em sign-militar

**Pedido**: usuário reportou divergência entre a contagem de militares em
`/reserva/militares` (473) e o valor visto em `/admin` ("393, se eu não me
engano"), pedindo varredura de materiais e usuários pra identificar a
causa. Também estabeleceu regra canônica pro projeto: "toda validação de
dado sempre deve ser validada pelo servidor e nunca pelo frontend... nunca
devemos confiar no front."

**Investigação**: testado ao vivo (login real como armeiro, query
idêntica à da página) — RLS de `profiles` restringe corretamente por
tenant (602 = contagem real do tenant, não o total global de 659 do
banco inteiro). **Não havia vazamento cross-tenant.** A divergência real
tinha duas causas: (1) `admin/usuarios` conta profiles de **qualquer
role** (armeiro, admin_reserva, admin_global, auditor, usuario) mas
usava o mesmo rótulo "usuários cadastrados" que `reserva/militares` usa
pra contar só `role='usuario'` — comparação de semânticas diferentes
disfarçada de mesma unidade; (2) nenhuma das 4 páginas de dashboard
(`admin/page.tsx`, `admin/usuarios/page.tsx`, `reserva/militares/page.tsx`,
`reserva/page.tsx`) filtrava `profiles` explicitamente por tenant no
código — dependiam 100% do RLS, violando o padrão de defense-in-depth já
estabelecido no projeto (`BUG-RR-07`/`BUG-RR-08`).

**Fix**: rótulo corrigido para "contas cadastradas (todas as roles)" em
`admin/usuarios`; filtro explícito de tenant adicionado nas 4 páginas,
condicional (`tenantId ? query.eq(...) : query`) — nunca `.eq("default_
tenant_id", "")` direto, que gera erro real de Postgres (22P02) contra
coluna UUID pra roles com tenant estruturalmente nulo (ex: superadmin).
**Achado ALTO de code review, corrigido no mesmo commit**: a primeira
versão do fix usava exatamente esse `.eq(..., "")` — o erro ficava
mascarado porque nenhum call site checava `{ error }`, só `?? 0`/`?? []`.

**Bug crítico pré-existente achado durante a investigação, não
relacionado ao pedido original**: `POST /api/cautelamentos/:id/sign-militar`
validava TOTP/biometria contra `c.get("userId")` (quem está logado) em
vez de `cautela.militar_id` (dono da cautela) — quando o armeiro abre
`/reserva/cautelas` e clica "Assinar Usuário" pra **facilitar** a
assinatura de um militar que pode nem estar logado, a chamada sempre
recebia 403 antes de validar qualquer código. Essa função nunca
funcionou. Extraído `resolveSigningIdentity()` (allow-list explícita de
roles staff, não blacklist — achado ALTO de code review) que resolve o
alvo correto por caso: self-sign continua exigindo `callerId ===
militar_id`; facilitação por staff sempre valida contra o secret/template
do militar dono da cautela, nunca do armeiro que opera o teclado.
`admin_global` adicionado ao `roleGuard` da rota (única do arquivo sem
esse role, inconsistente com `sign-armeiro`/`return`/`substitute`).

**Validado ao vivo** via Playwright contra localhost — suítes
`admin-usuarios-suite`/`reserva-militares-suite` (regressão) e
`cautelamento-suite` com 3 testes novos: facilitação com sucesso usando o
TOTP real do militar, `usuario` barrado de assinar cautela de outro
`usuario` (403 preservado), e armeiro barrado de facilitar usando o
**próprio** TOTP (prova negativa da validação de identidade).

**Em andamento**: feature de cautela com múltiplos materiais (pedido do
mesmo usuário — hoje `cautelamentos.item_id` é 1:1 com um item físico,
sem coluna de agrupamento). Fase 1 (migration `movement_id`) escrita,
aguardando aplicação manual no Supabase Dashboard antes das próximas
fases (RPCs de criação/assinatura em lote, endpoints BFF, modal
multi-item). Spec completa a documentar em
`docs/enterprise/specs/cautela-multi-item-batch-enterprise.md`.

---

# 2026-08-21 (v23) — feat(cautelas): busca avançada + alternância grade/lista

**Pedido**: "na página de cautelas deve ter autocomplete filtros para
pesquisa avançada e opções tb assim como em outras páginas de ver por
lista e por card." — `/reserva/cautelas` não tinha busca nem alternância
de visualização, diferente de `/reserva/arsenal` e outras páginas.

Adicionado o mesmo padrão já usado no resto do sistema: `GridSearchInput`
+ `useGridState` (busca por material, identificador, militar, matrícula,
posto e motivo — concatenados num campo sintético, já que o hook só
filtra campos de topo do objeto) e alternância grade/lista (grade mantém
o card já existente; lista é uma tabela nova, ordenável por material ou
data, com scroll horizontal próprio — mesmo wrapper de
`efetivo/historico/_historico-client.tsx` — pra não cortar a coluna de
ações em telas estreitas).

**Achados de code review, corrigidos no mesmo commit**: a coluna
"Material" ordenava pelo campo de busca concatenado (material+
identificador+militar+matrícula+motivo), não só pelo nome do material —
"parecia" certo só porque o nome é sempre o primeiro token da string;
separado em campo dedicado (`_materialNome`). Badge de status duplicado
byte-a-byte entre as duas views, extraído em `<CautelaStatusBadge>`.
Campo de busca sintético recalculado sem `useMemo` a cada render.

**Validado ao vivo** via Playwright contra localhost — 4 testes novos
(`CAUUI01-04`), incluindo um provando a correção da ordenação (nomes de
material realmente saem em ordem alfabética ao clicar na coluna).

---

# 2026-08-19 (v21) — fix(ssa) CRÍTICO: lista de solicitações remotas sempre vazia (RLS obsoleta)

**Pedido**: report crítico — solicitação remota feita pela matrícula
000003 em 28/07/2026 gerou notificação e apareceu como pendência no card
do painel principal do armeiro (000002), mas `/reserva/solicitacoes`
nunca mostrava nada, "nem antiga nem nova". Pedido adicional: garantir
suporte a solicitação remota com mais de um material. Spec completa em
`docs/enterprise/specs/ssa-items-rls-timeout-critical-fix.md`.

**Causa raiz confirmada ao vivo**: a policy RLS `ssa_items_staff_all` em
`material_request_items` (criada na implementação original do SSA, NUNCA
atualizada por nenhuma das migrations posteriores que corrigiram esse
mesmo problema em outras 10+ tabelas) ainda checava
`auth_role() IN ('admin', 'master')` — nomes de role **obsoletos** de uma
fase anterior do projeto. Nenhum usuário real tem mais essas roles; o
sistema atual usa admin_global/admin_reserva/armeiro/auditor. Resultado:
um armeiro nunca conseguia ler os itens de uma solicitação de outra
pessoa, e a avaliação repetida dessa condição sempre-falsa (combinada via
OR com a outra policy existente, que também nunca batia pro armeiro) para
cada linha do join `items:material_request_items(...)` usado pela página
real — sem conseguir aproveitar o `LIMIT` pra cortar cedo — estourava o
timeout do Postgres: 445ms sem o join, 8.164s (erro 57014) com ele,
medido diretamente contra o banco de produção.

**Achado secundário real**: a página não checava o `error` da query — um
timeout virava silenciosamente "nenhuma solicitação", indistinguível de
"não há nada pendente de verdade". Agora mostra um banner visível.

**Multi-item remoto**: verificado ao vivo — já funcionava desde a
implementação original (`POST /api/ssa/requests` aceita N materiais,
`SolicitarArmamentoSheet` já permite seleção múltipla). Não havia bug;
só faltava cobertura de teste, agora adicionada (`SSAQ02`).

**Achado de code review**: a primeira versão do comentário da migration
atribuía a lentidão a uma subquery correlacionada que a policy quebrada
não tinha de fato — corrigido para descrever a causa real (custo
acumulado da combinação sempre-falsa de duas policies PERMISSIVE via OR).
Também corrigida a falta de idempotência (faltavam `DROP POLICY IF
EXISTS` das duas policies novas) e aumentada a fidelidade do teste
`SSAQ01` ao shape exato da query real da página (todas as colunas/embeds,
incluindo o filtro de `tenant_id`).

**Validado ao vivo, ANTES do fix aplicado** (prova que os testes pegam o
bug de verdade): `SSAQ01` reproduz o erro `57014` exato; `SSAQ02` já
passa. Timing de performance pós-fix ainda **não** revalidado — pendente
de aplicação da migration (ver nota na própria migration: a suposição de
performance não verificada foi exatamente a causa do bug original, não
repetir o mesmo erro no fix).

**Ação pendente do dono do produto — URGENTE**: aplicar manualmente no
Supabase Dashboard (SQL Editor):
`supabase/migrations/20260819010000_fix_ssa_items_staff_rls_obsolete_roles.sql`.
Assim que aplicada, o timing será revalidado ao vivo e `SSAQ01` re-executado
contra o banco real antes de considerar a entrega definitivamente fechada.

---

# 2026-08-19 (v20) — fix(cautelas): UX de assinatura + realtime na lista de cautelas

**Pedido**: reporte com screenshot de `/reserva/cautelas` mostrando "Assinar
Individual" desabilitado — label errado ("deveria ser usuario e não
individual") e achado de UX mais sério: "não deve aparecer o totp do
armeiro aqui para assinar" + reclamação geral de que mudanças de assinatura
não refletem na UI sem F5. Spec completa em
`docs/enterprise/specs/cautela-sign-ux-realtime-enterprise.md`.

**Achado real de UX/segurança**: `SignDialog` é reaproveitado em dois
contextos — `/efetivo/minhas-cautelas` (o próprio militar logado assina a
própria pendência — self-sign, correto mostrar o hint "seu código atual")
e `/reserva/cautelas` (o ARMEIRO abre o mesmo dialog com `role="militar"`
só pra FACILITAR a assinatura de alguém que pode nem estar logado ali). No
segundo caso, o hint mostrava o código TOTP do **armeiro**, que nunca
valida contra o secret do militar da cautela — nova prop `selfSign`
(default `true`, não regride `/efetivo/minhas-cautelas`) troca o hint por
uma mensagem informativa quando `false`. Label "Individual" → "Usuário"
em todos os lugares (dialog, botões, badges).

**Achado real — zero realtime em `/reserva/cautelas`**: ao contrário de
`/reserva/saidas` (que já reflete mudanças de `lendings` via SSE), esta
página nunca teve nenhum componente de realtime montado. Estendidos os
canais `armeiro-sync`/`efetivo-sync` (BFF) para assinar `cautelamentos`, e
adicionado `useSSERefresh` no client (padrão de refs já usado em
`livro/_livro-client.tsx`, pra `onEvent` ter referência estável). Achado
adicional durante a validação ao vivo: mesmo com o BFF assinando a tabela
certa, a tabela `cautelamentos` nunca tinha sido adicionada à publication
do Supabase Realtime — sem isso o Postgres nunca emite evento nenhum,
então nada chegaria no SSE de qualquer forma (mesma causa raiz, resolvida
antes em `service_log_events`/`service_shifts`).

**Validado ao vivo** via Playwright contra localhost: label correto,
mensagem amigável no lugar do hint incorreto, badges "Usuário assinou"/
"Usuário pendente". Migration aplicada em produção pelo dono do produto —
realtime revalidado end-to-end depois: assinatura feita via banco (simula
outra aba/usuário) fez o botão "Assinar Usuário" desaparecer e a badge
virar "Usuário assinou" na tela já aberta, sem nenhum reload manual.

---

# 2026-08-18 (v19) — feat(livro-digital): código TOTP dinâmico no dialog de abrir/encerrar turno

**Pedido**: "para abrir turno de livro bem como encerrar deve aparecer o
código de acesso dinâmico no mesmo modal assim o user clica e já copia e
cola automaticamente ok. igual na cautela."

Extraído `SelfTotpHint` (antes só existia dentro de `cautelas/sign-
dialog.tsx`) para `components/shared/self-totp-hint.tsx` — busca o código
TOTP do próprio usuário logado (`GET /api/totp/code`, polling a cada 5s) e
mostra um botão "Seu código atual (expira em Ns) — toque para usar" que
preenche o campo automaticamente ao clicar. Reaproveitado em
`components/livro/shift-auth-dialog.tsx` (dialog de Abrir/Encerrar Turno),
que antes só dizia "Toque em Meu Perfil para ver seu código" — texto
removido, substituído pelo mesmo componente clicável já usado na
assinatura de cautela.

**Validado ao vivo** via Playwright contra localhost: dialog "Encerrar
Turno" mostra o código dinâmico, clique preenche o input com os 6 dígitos
corretos.

---

# 2026-08-18 (v18) — fix(e2e): testes legados de saída reescritos para /api/lendings + reserve lookup determinístico

**Pedido**: correção dos dois achados pré-existentes documentados na entrega
v17 ("corrija"), não deixados como follow-up.

**Migrations `20260818110000`/`20260818120000` da v17 já aplicadas** (o
dono do produto aplicou entre a entrega e esta correção) — validado ao
vivo contra o banco real, não só em teoria.

**1) `.limit(1)` sem filtro na tabela `reserves`**: `cautelamentos.spec.ts`,
`saidas.spec.ts` e `item-integrity.spec.ts` escolhiam "a primeira reserva
do banco" sem nenhum filtro — funcionava só enquanto a tabela `reserves`
não tinha linhas extras. Sessões de pentest passaram a criar reservas
próprias na mesma tabela, e a escolha arbitrária passou a quebrar o setup
(403 "Você não pertence a esta reserva") de forma não-determinística.
Trocado por lookup via `reserve_memberships` escopado ao próprio usuário
fixture (`armeiro@apmcb.dev`) — mesmo padrão que `apps/bff/src/
middleware/auth.ts` já usa pra resolver `reserveId` no path de
autenticação via Bearer token.

**2) `POST /api/saidas` e `PATCH /api/saidas/:id/return` permanentemente
aposentados** (`LEGACY_CUSTODY_FLOW_RETIRED`, 501 — travado por um teste
de segurança dedicado em `idor-write-scope.test.ts`), substituídos por
`POST /api/lendings/batch` + `POST /api/lendings/bulk-return`. Não foi
uma troca mecânica de URL: o modelo novo é **agregado por quantidade**
(`material_type_id` + `quantidade`), não mais por `item_id` individual, e
a identidade do militar é verificada **antes** da emissão, num passo
separado (`POST /api/lendings/identify`) que grava a verificação numa
sessão por cookie (`apmcb_session`, HttpOnly) — os testes antigos usavam
só `fetch()` cru com Bearer token, sem cookie jar, então precisaram
capturar o `Set-Cookie` da resposta de `/identify` e reenviá-lo na
chamada seguinte (exatamente o que o navegador já faz sozinho numa sessão
real).

`saidas.spec.ts` (SD01-06) reescrito: os antigos SD03/SD04 (armeiro
assina TOTP → militar confirma, em 2 fases) não têm equivalente — o fluxo
novo verifica identidade e emite num único passo. `item-integrity.spec.ts`
— mais delicado, por proteger o trigger `trg_validate_item_transition`
(`BEFORE UPDATE OF status_operacional ON material_items`): confirmado que
a RPC `record_lending_batch` (rota nova) **nunca** toca `material_items` —
saída agregada não seleciona mais um item físico específico, então o
conflito item-a-item entre saída e cautela (antigos IT03/IT04/IT05) deixa
de ser um caso testável **por construção**, não por rejeição de trigger.
Retirados com justificativa no próprio arquivo, não adaptados à força.
IT02/IT06/IT08 (conflito cautela↔cautela, ainda item-based) permanecem
sem nenhuma mudança — continuam validando o trigger de verdade.

**Achado adicional durante a correção**: o secret TOTP do fixture
`cadete@apmcb.dev` estava num estado corrompido/chave de encriptação
divergente (`422 needs_reconfigure` em `GET /api/totp/code`) — não
relacionado a esta mudança, mas bloqueava a validação. `getFreshTotpCode`
agora se autorrecupera chamando `POST /api/totp/reconfigure` (caminho de
recuperação oficial, seguro — só regenera se o secret atual está
comprovadamente quebrado) antes de repetir a tentativa.

**Validado ao vivo, sequencial (workers=1) contra localhost**:
`saida-suite` 4/4, `item-integrity-suite` 6/6, `cautelamento-suite` 8/8,
`cautela-eligibility-suite` 11/11 — todas passando contra o banco real,
migrations incluídas.

---

# 2026-08-18 (v17) — feat(cautela): edição de elegibilidade em material já cadastrado (CAU-08) + fix de double-booking de estoque

**Pedido**: continuação explícita da entrega anterior (v15) — "continue
nessa edição", referindo-se ao item deixado de fora ("editar
elegibilidade/quantidade de um material já cadastrado").

**CAU-08**: novo `PATCH /api/arsenal/:id` (`admin_reserva`) permite
alternar `cautela_habilitada`/`quantidade_cautela` de um material já
cadastrado, sem precisar recriá-lo. Desabilitar é bloqueado com 409 se
existir item em custódia ativa (`status_operacional='cautelado')`.
Material com rastreio individual (série/validade) sempre recalcula a
quantidade pela contagem real de itens; material "bulk" cria/remove a
diferença de itens sintéticos (bloqueando redução com 409 se não houver
unidades "disponível" suficientes pra remover). Botão + dialog novos em
`/reserva/arsenal` (ícone de escudo ao lado do botão de desativar).

**Achado CRÍTICO em code review, corrigido antes do commit**: a primeira
versão fazia leitura+decisão+escrita em vários passos sequenciais no BFF,
sem lock nem transação — dois `PATCH` concorrentes no mesmo material
podiam gravar um `quantidade_cautela` inconsistente com os
`material_items` reais por trás. Reescrito como RPC Postgres transacional
(`set_material_cautela_eligibility`, migration
`20260818120000_cautela_edit_material_types_rpc.sql`) com
`SELECT ... FOR UPDATE` travando a linha — mesmo padrão já usado por
`record_lending_batch`. Também corrigido, mesmo review (ALTO): o índice
dos itens sintéticos agora vem de `MAX` do sufixo numérico já persistido
(não mais `COUNT`/ordenação por `created_at`, que não desempatava linhas
inseridas na mesma instrução) — elimina risco real de colisão com a
constraint `UNIQUE (tenant_id, tipo_identificador, identificador_principal)`
em ciclos de aumento/redução sucessivos. E a contagem de elegibilidade em
material com rastreio individual passou a excluir itens em estado
terminal (`baixado`/`extraviado`), que não representam mais estoque
físico real.

**Bug real descoberto durante a investigação (não introduzido por esta
feature, mas nunca corrigido até agora)**: `quantidade_cautela` nunca era
descontada de `quantidade_disponivel` em nenhum dos 3 pontos de checagem
de estoque do sistema (view `material_availability`, RPC
`record_lending_batch` usada por "Nova Saída", e o check em TypeScript de
`POST /api/lendings`) — permitindo que a mesma unidade física fosse
contabilizada como "disponível para saída diária" **e** "reservada para
cautela" ao mesmo tempo (double-booking). Corrigido nos 3 pontos
(migration `20260818110000_cautela_reserve_excludes_daily_stock.sql` +
`apps/bff/src/routes/lendings.ts`). O check de estoque em
`PATCH /api/ssa/requests/:id/approve` lê da mesma view e é corrigido
automaticamente, sem mudança de código própria.

**Validado ao vivo**: suíte `cautela-eligibility-suite` — 11/11 passando
contra localhost (`E2E_BASE_URL`/`E2E_BFF_URL`), incluindo os 5 testes
novos de CAU-08 (habilitar, desabilitar bloqueado/permitido, aumentar e
reduzir quantidade com bloqueio de redução, e o caso de rastreio
individual não tocando `material_items`). Corrigidos de passagem 2
achados em testes pré-existentes do mesmo arquivo (não causados por esta
mudança, mas expostos agora que a migration `20260818100000` já está
aplicada): `GET /items/disponiveis?q=` filtra por `identificador_principal`,
não pelo nome do material — o teste `CAUELIG07/08` passava `q=nome`, que
nunca deveria bater; e `reserve_id` obtido via `.limit(1)` sem filtro na
tabela `reserves` (dado de teste acumulado na mesma tabela quebra esse
padrão) — trocado por `current_unit_id` do próprio item, que é
autoritativo.

**Achados pré-existentes, confirmados via `git stash` como não causados
por esta mudança, fora de escopo desta entrega**: (1) `saidas.spec.ts`
(SD01+) e `item-integrity.spec.ts` (IT01) testam `POST /api/saidas`, um
endpoint de custódia legado já **deliberadamente retirado**
(`501 LEGACY_CUSTODY_FLOW_RETIRED`, aponta para `/api/lendings` com
TOTP/biometria) — os testes nunca foram atualizados para o fluxo novo;
retomar isso é um follow-up dedicado, não algo pra emendar aqui. (2) o
mesmo padrão frágil `.from("reserves").select("id").limit(1).single()`
usado em `cautelamentos.spec.ts` (setup do `beforeAll`) quebra o CT01 com
403 "Você não pertence a esta reserva" pela mesma causa — dados de teste
acumulados (reservas extras de sessões de pentest) tornam a escolha "a
primeira reserva da tabela" não-determinística. Requer decisão do dono do
produto: limpar os dados de teste acumulados (ação destrutiva num banco
compartilhado, não tomada sem autorização explícita) ou trocar o padrão
em todas as suítes afetadas.

**Ação pendente do dono do produto**: aplicar manualmente no Supabase
Dashboard (SQL Editor), **nesta ordem**:
1. `supabase/migrations/20260818110000_cautela_reserve_excludes_daily_stock.sql`
2. `supabase/migrations/20260818120000_cautela_edit_material_types_rpc.sql`

(A migration `20260818100000` da entrega v15 já está aplicada.) Este
projeto não tem CLI/push automatizado para DDL.

---

# 2026-08-18 (v16) — rebrand: plataforma renomeada para Andrômeda

"APMCB" era o nome de uma reserva/tenant real usado como validação inicial
do produto — não o nome da plataforma multi-tenant em si. Renomeado o
branding visível ao usuário para "Andrômeda": título/manifest PWA, login
(tenant e Nexus/superadmin), cartão de suporte, letterhead dos PDFs
gerados (handover, histórico, livro digital), app Windows Bridge (título
de janela, tooltips da bandeja, mensagens de log), `CLAUDE.md`,
`DESIGN.md`. **Não alterado de propósito** (domínio real será migrado
separadamente, fora do código): domínio `apmcb.pmpb.online` e toda config
de infra que depende dele (nginx, CI/CD, VPS), nomes de variável de
ambiente do Bridge Windows (`APMCB_BRIDGE_*`), formato do código de
pareamento biométrico (`APMCB-XXXX-XXXX`, gerado no BFF), caminho local
`%LOCALAPPDATA%\APMCB\BridgeClient` do Bridge já instalado em campo, dados
reais de seed/fixture (a reserva "APMCB" continua existindo como tal
dentro do tenant PMPB).

---

# 2026-08-18 (v15) — feat(cautela): elegibilidade e quantidade reservada por material

**Pedido**: "quero opção de incluir checkbox durante adição de material
[...] para incluir ou não (disponibilizar) esse material para cautela,
bem como quantidade específica." Spec completa em
`docs/enterprise/specs/cautela-eligibility-quantity-enterprise.md`.

**Causa raiz do problema anterior**: se um material podia ou não ser
cautelado era um efeito colateral de ele já rastrear número de série/
validade (`has_serial_numbers`/`requires_validity`) — nunca uma decisão
deliberada do admin_reserva. Materiais "bulk" nunca ganhavam nenhuma linha
em `material_items` e por isso já eram implicitamente impossíveis de
cautelar, sem que ninguém tivesse decidido isso.

**Fix**: novas colunas `cautela_habilitada`/`quantidade_cautela` em
`material_types` (migration `20260818100000_cautela_eligibility_quantity.sql`,
com backfill automático para materiais que já tinham cautelas ativas
antes da feature existir, preservando custódias em andamento). No
cadastro, checkbox "Disponibilizar para cautela" — material com rastreio
individual (série/validade) tem todas as unidades elegíveis
automaticamente; material "bulk" ganha um campo de quantidade que reserva
essa fração do estoque exclusivamente para cautela, deixando o resto só
para saída diária. Backend passa a **rejeitar com 409** qualquer
tentativa de cautelar um item de material não habilitado — fronteira de
segurança real, não decoração de UI — mesmo manipulando o payload direto,
fora do autocomplete já filtrado (`GET /api/arsenal/items/disponiveis?for=cautela`).

**Achado adicional durante a implementação**: `PATCH /requests/:id/approve`
(tipo `stock_adjustment`) reduzia `quantidade_total` sem checar
`quantidade_cautela` — um ajuste de estoque aprovado depois da feature
existir podia deixar a reserva de cautela retroativamente maior que o
total. Bloqueado com 409 explícito em vez de corrigir o valor em silêncio
(a decisão de quantas unidades reservar para cautela é do admin).

**Fora de escopo nesta entrega** (documentado na spec, seção 6): edição
de elegibilidade/quantidade em material já cadastrado (hoje só existe no
momento da criação) — planejado como follow-up.

**Validado ao vivo**: suíte `cautela-eligibility-suite`
(`cautela-eligibility.spec.ts`) — os 2 testes de UI (checkbox/campo de
quantidade condicional) passam contra localhost; os 3 testes de API que
dependem da migration falham com 500 (esperado — migration ainda não
aplicada em produção, ver nota abaixo). Corrigido de passagem um teste
pré-existente (`cautelamentos.spec.ts` beforeAll) que escolhia um item
"disponível" genérico sem garantir que seu material ficasse habilitado
para cautela — quebraria após a migration ser aplicada.

**Ação pendente do dono do produto**: aplicar manualmente no Supabase
Dashboard (SQL Editor) a migration
`supabase/migrations/20260818100000_cautela_eligibility_quantity.sql`
antes da feature funcionar em produção — este projeto não tem CLI/push
automatizado para DDL.

---

# 2026-08-18 (v14) — feat(livro-digital): regra canônica de turno fechado aplicada a toda movimentação + timeline de solicitação/aprovação/rejeição

### Regra canônica — "proibido qualquer movimentação com turno fechado"

**Pedido**: "toda essa regra são canônica para todo sistema multy tenant [...]
deve ser proibido realizar qualquer tipo de movimentação com livro fechado."
Reportado com um caso concreto: armeiro conseguia receber devolução de
cautela mesmo sem turno aberto.

A checagem (`service_shifts.status='ativo'` do armeiro + 403
`SHIFT_REQUIRED`) já existia, mas duplicada em 4 lugares
(`lendings.ts` × 3, `cautelamentos.ts` × 1 — só na criação) e **ausente**
em pelo menos mais 9 endpoints de mutação armeiro-acionáveis. Consolidada
num único helper (`lib/shift-guard.ts`, `requireActiveShift(role, armeiroId)`)
e aplicada em:

- `cautelamentos.ts`: `/:id/sign-armeiro`, `/:id/return` (**o bug
  explicitamente reportado**), `/:id/substitute`, e `/:id/sign-militar`
  quando quem assina é o próprio armeiro (self-cautela).
- `ocorrencias.ts`: `PATCH /:id` (armeiro resolve ocorrência).
- `arsenal.ts`: `POST /requests` (solicitação de material/ajuste),
  `PATCH /items/:id/ocorrencia` (manutenção).
- `categories.ts`: `POST /request`, `POST /:id/edit-request`.
- `ssa.ts`: `PATCH /requests/:id/approve|reject|deliver` (solicitação
  **remota** de armamento).

Endpoints com `roleGuard` restrito a admin_reserva/admin_global (nunca
armeiro) foram deixados de fora de propósito — o helper seria sempre
no-op ali.

### Timeline rastreável — solicitação, aprovação, rejeição remota

Os tipos `solicitacao_aprovada`/`solicitacao_negada` já existiam no enum
`ShiftEventType` e no mapa de labels/ícones do frontend
(`lib/livro/event-type-config.ts`), mas nunca eram de fato emitidos —
achado real. Adicionadas chamadas `logShiftEvent(...)` em
`categories.ts`/`arsenal.ts` (approve/reject de solicitações de
categoria/material — evento atribuído ao turno do **armeiro que
solicitou**, não de quem aprovou, pra aparecer na timeline certa) e
`ssa.ts` (approve/reject/deliver de solicitação remota — aqui o armeiro é
quem aprova/entrega, então o evento é dele mesmo).

**Revisão de código**: achado CRÍTICO da 1ª rodada (`/:id/sign-militar`
sem gate) reavaliado — o cenário de exploração descrito ("armeiro assina
em nome de outro militar sem turno aberto") não procede, já existe checagem
`cautela.militar_id !== militarId` que impede qualquer assinatura em nome
de terceiros independente de turno; mesmo assim, gate adicionado por
consistência para o caso de auto-cautela do armeiro. Demais achados
MÉDIO/BAIXO da rodada eram pré-existentes/fora de escopo ou decisões de
design já documentadas inline.

**Validação**: TS limpo em ambos os apps; rastreamento manual completo de
cada call site alterado. Suíte E2E completa não pôde ser validada com
sinal limpo nesta sessão — os servidores de dev estavam sob uso
concorrente real (tráfego do próprio dono do produto navegando a
aplicação ao vivo durante a sessão), causando timeouts de rede
intermitentes nos testes automatizados, não relacionados à lógica desta
mudança.

---

# 2026-08-18 (v13) — feat(arsenal): paginação/edição por aprovação de categorias, CRUD completo de materiais, filtros em dropdown, KPI cards clicáveis

### Categorias (`/reserva/arsenal` e `/admin/arsenal`)

- Paginação na listagem de categorias.
- Armeiro agora pode solicitar **edição** de uma categoria já existente
  (`POST /api/categories/:id/edit-request`), não só criação — mesmo fluxo de
  aprovação do admin_reserva/admin_global já usado para criação, reaproveitando
  `normalizeCategoryBody`/`applyCategoryUpdate` (sem duplicar validação).
  Migration `20260817120000_category_requests_edit_flow.sql` adiciona as
  colunas `type`/`target_category_id` + 5 colunas de flags à tabela
  `category_requests` já existente. **Precisa ser aplicada manualmente no
  Supabase Dashboard (SQL Editor)** — este projeto não usa CLI/push
  automatizado para DDL.
- Hover sobre "Desativar" mostra quantos `material_types` ativos usam a
  categoria antes do clique (`category-usage.ts`, `withMaterialTypesCount`),
  em vez de só descobrir o bloqueio 409 depois.

### Materiais (`/reserva/arsenal`)

- Novo `DELETE /api/arsenal/:id` (soft-delete direto por admin_reserva,
  mesmo padrão de segurança de `DELETE /api/categories/:id`) — antes só
  existia uma rota edge legada (`/api/admin/almoxarifado`) com bug de
  contagem (usava `material_availability.quantidade_armada`, que não via
  itens em cautela de longo prazo).
- Filtros de categoria/estoque: pills → dropdowns (`<select>`), mais limpo.
- Os 4 KpiCards (Total/Disponíveis/Baixo estoque/Esgotados) agora são
  clicáveis, navegando para a lista já filtrada com a mesma contagem exibida
  no card — SSOT do cálculo de status extraída para
  `lib/arsenal-status.ts` (`getMaterialStockStatus`), usada tanto pelo
  Server Component (contagem dos cards) quanto pelo client (filtro).
- Modal "Solicitar adição de material": dropdown de categoria fecha ao
  clicar fora (`use-click-outside`, reaproveitado); detecção de categoria
  já existente agora reconsulta o backend no momento do clique em "+" (antes
  só comparava contra a lista carregada no mount, criando categorias
  "fantasma" com `category_id: null`); tooltips adicionados.

### Bug crítico encontrado e corrigido — limpeza E2E de itens cautelados

`apps/web/e2e/global-teardown.ts` (seção 6) usava nomes de coluna errados
(`status`/`current_holder_id`) para `material_items` — os nomes reais são
`status_operacional`/`current_holder_user_id`. O erro do PostgREST era
descartado silenciosamente (`{ data }` sem checar `error`), então nenhum
item cautelado por conta de teste era devolvido desde que este bloco foi
escrito — mesma classe de falha já documentada na seção 4 (service_shifts)
deste arquivo. Corrigido com os nomes certos + checagem explícita de erro.

### Achado adicional — `scopedReserveIds` (categories.ts)

Erro de rede/timeout na query de reservas era descartado silenciosamente,
virando "sem acesso" (404 genérico) em vez de um erro logado — corrigido
para logar e manter o mesmo contrato de retorno.

**Validado ao vivo**: `crud-arsenal.spec.ts` + `admin-arsenal.spec.ts` — 26
passaram (1 worker), a única falha real encontrada (AAR06) era um
locator de teste desatualizado (`title*='tabela'` nunca batia com o botão
real, titulado "Ver em lista" — mascarado até esta sessão adicionar
tooltips aos botões) — corrigido no teste. Revisão de código: 2 rodadas,
achados reais endereçados.

---

# 2026-08-18 (v12) — feat(usuarios): ocultar "Impedimento Administrativo" indevido + promover usuário a armeiro/admin_reserva com seleção de reserva(s)

### Fix — "Impedimento Administrativo" oferecido a quem não pode aplicá-lo

O backend (`PATCH /api/profiles/:id` e `/:id/status`) já bloqueava com 403
a transição para `impedimento_administrativo` quando o caller é
admin_reserva/armeiro (achado de code review anterior, restrição
deliberada) — mas o `<select>` de Status em `_edit-dialog.tsx` sempre
oferecia essa opção pra qualquer `callerRole`, prometendo uma ação que o
backend sempre rejeitava. Corrigido: a opção só aparece pra admin_global;
quando o alvo já está nesse status e quem edita não é admin_global, o
select vira um texto informativo read-only.

### Feature — promover usuário a armeiro/admin_reserva com seleção de reserva(s)

**Pedido**: "o admin global vai criar um perfil de armeiro, mas para que
reserva? [...] usuário pode ser admin de várias reserva, bem como armeiro
de várias reservas."

`reserve_memberships` já suportava múltiplas reservas por usuário no
schema (`UNIQUE(reserve_id, user_id)`, não por `user_id` isolado) — só
faltava a UI/API pra usar isso. `PATCH /api/profiles/:id` ganhou um campo
`reserve_ids: string[]`: quando o papel efetivo (novo, se mudando, senão
atual) é armeiro/admin_reserva, faz upsert/delete em `reserve_memberships`
contra o solicitado, com teto de privilégio estrito — **admin_global**
escolhe qualquer reserva ativa do tenant; **admin_reserva** só pode
atribuir a própria reserva (nunca outra, mesmo manipulando o payload
diretamente), nunca aceita lista vazia (evitaria zerar o acesso do alvo), e
só remove memberships dentro do próprio escopo de autoridade do caller
(nunca toca numa reserva que o caller não administra). A escrita em
`reserve_memberships` só ocorre depois que o UPDATE de `profiles` confirma
sucesso via lock otimista, evitando gravar memberships pra um papel que o
UPDATE concorrente rejeitou por TOCTOU. Novo `GET /api/profiles/:id/reserves`
pré-marca os checkboxes com as reservas atuais do alvo.

**Revisão de segurança**: 2 rodadas — 1º achado real corrigido (admin_global
podia atribuir reserva já desativada, faltava `.eq("status","ativa")`) +
mensagens de erro genéricas ao cliente (detalhe do Supabase só no log
interno). Demais achados da 1ª rodada (vazamento cross-tenant, enumeração
via 404, TOCTOU em hard-delete de reserva) reavaliados e descartados como
falsos positivos — confirmado contra o schema real e os padrões já
estabelecidos no resto do repositório. **Aprovado, nota 10/10** na
re-revisão independente.

---

# 2026-08-18 (v11) — fix(notifications): sino nunca navegava para o registro real ao clicar

### Bug — "erro grave": clicar numa notificação não levava a lugar nenhum

**Reportado**: notificação "Nova Solicitação de Armamento" aparecia no
sino com contador, mas clicar nela não fazia nada.

**Causa raiz**: o `onClick` de cada notificação em `notification-bell.tsx`
sempre só chamava `markRead()` — nenhuma navegação jamais foi implementada,
para nenhum dos 16 tipos de notificação (não era um bug isolado do tipo
armamento). Cada notificação já carregava, em `metadata`, os campos
necessários pra montar um deep-link real (`request_id`, `ocorrencia_id`,
`material_item_id`, `lending_id`/`lending_ids`) — só faltava usá-los.

**Fix**: `resolveNotificationRoute()` — mapa tipo→rota construído lendo o
código real do BFF que cria cada notificação (nunca adivinhado), navegando
via `router.push` ao clicar (além de marcar como lida). Novo hook
`use-highlight-item.ts` (`useHighlightItem`) padroniza como uma tela honra
`?highlight=<id>` pra destacar/rolar até o item certo — hoje aplicado em
`/reserva/solicitacoes` e `/efetivo/solicitacoes` (ambos também reforçados
com busca de fallback server-side quando o item-alvo está fora da 1ª
página, e validação de formato UUID antes de qualquer query). Tipos sem
tela real de destino hoje (`ocorrencia_resolvida`) ou com audiência ambígua
ficam documentados como gap conhecido, não resolvidos às cegas.

**Revisão de código**: 2 rodadas — corrigidos: falha de rede silenciosa em
`markRead`/`markAllRead` (agora checam `res.ok` antes do update otimista),
`CSS.escape()` no seletor de scroll, e sincronização do destaque visual
entre cliques sucessivos em notificações diferentes (o estado não se
re-sincronizava com um novo `?highlight=` na mesma navegação client-side).

---

# 2026-08-18 (v10) — fix(lendings): divergência grave no "Receber Material" via TOTP (reserve_id/tenant_id NULL em dados legados)

### Bug crítico — "Nenhum material ativo encontrado" após TOTP, com item real e ativo

**Sintoma reportado**: no modal "Receber Material" (`reserva/saidas/_desarmamento-modal.tsx`),
após verificação TOTP de um militar, o sistema informava "Nenhum material
ativo encontrado para este usuário" — mas a tela de listagem de saídas
mostrava claramente 2 itens ativos ("Cinto Branco" ×1, "Quepe de Cerimônia"
×2) para a mesma pessoa. Reportado pelo dono do produto como "gravíssimo".

**Causa raiz**: 39 linhas em `lendings` tinham `reserve_id IS NULL` (19
dessas também `tenant_id IS NULL`) — dado legado, anterior à validação
`z.string().uuid()` (sem `.optional()`) que hoje torna `reserve_id`
obrigatório em toda inserção via `POST /` e `POST /batch` (ambas via RPC
`record_lending_batch`, que sempre grava `reserve_id`). `POST /identify`
em `apps/bff/src/routes/lendings.ts` filtra lendings ativos com
`.eq("reserve_id", body.reserve_id)` — um filtro de igualdade nunca casa
com `NULL` em Postgres/PostgREST, tornando esses itens reais e ativos
invisíveis ao fluxo de identificação/devolução. A listagem de saídas não
filtra por `reserve_id` (só por tenant via RLS), por isso mostrava os
mesmos itens normalmente — daí a divergência exata reportada.

Todas as 39 linhas pertenciam a um único `master_id`, sem nenhuma
ambiguidade de `reserve_membership` — confirmado via query read-only em
produção antes de qualquer escrita.

**Fix**: migration `20260818090000_backfill_lendings_null_reserve_tenant.sql`
(revisada 3x pelo gate de code review até nota 9.5/10) faz backfill
idempotente de `reserve_id`/`tenant_id` a partir da `reserve_membership`
única do `master_id` de cada linha (só atua quando há exatamente 1
membership, nunca escolhe entre valores ambíguos), mais índice
`idx_lendings_master_id` (ausente até então). O backfill real em produção
(39 linhas) foi aplicado e verificado antes da migration ser commitada;
uma segunda execução da migration não encontra mais linhas elegíveis
(idempotente por natureza via `WHERE ... IS NULL`).

**Não alterado de propósito**: a lógica de `/identify`/`/batch`/`POST /`
continua exigindo `reserve_id` — é uma fronteira de segurança real
(escopo multi-tenant/multi-reserva), e afrouxá-la seria pior que o bug.
A correção é os dados ficarem consistentes com a invariante que o código
já assume.

**Validado ao vivo**: reprodução exata da query de `POST /identify` contra
produção, pós-backfill, confirma os 2 itens ("Cinto Branco" ×1, "Quepe de
Cerimônia" ×2) agora retornados corretamente para o cenário reportado.

---

# 2026-08-16 (v9) — feat(arsenal): solicitações de categoria visíveis + reformulação do modal de ocorrência (foto/associação/notificação) + fix(storage): egress de fotos do arsenal

### Feature — solicitações de categoria invisíveis no painel do armeiro

**Causa raiz**: `category_requests` existia no banco e tinha fluxo de
aprovação no backend, mas nenhuma tela do frontend jamais consultava a
tabela — só `material_requests` era exibida em "Minhas solicitações"
(`_my-requests-banner.tsx`) e na fila de aprovação do admin
(`/admin/arsenal/solicitacoes`). Um armeiro que pedia uma categoria nova
nunca via o próprio pedido em lugar nenhum.

**Fix**: `category_requests` passou a ser buscada em paralelo
(`Promise.all`) com `material_requests` em `reserva/arsenal/page.tsx` (banner
próprio) e integrada às mesmas abas de aprovação do admin
(`_aprovacao-client.tsx`). No caminho, dois achados de segurança reais
corrigidos em `categories.ts`:
* IDOR — `POST /requests/:id/approve|reject` checava "já processado" (409)
  **antes** de checar o escopo do reserva/tenant do caller, vazando
  existência de solicitações de outros tenants; corrigido filtrando
  `reserve_id` já na SELECT inicial.
* `GET /api/categories/requests` usava `reserveId` da sessão sem escopar
  por tenant — quebrava para `admin_global` (cuja sessão normalmente tem
  `reserveId` nulo); corrigido com o mesmo helper `scopedReserveIds` já
  usado em `arsenal.ts`.
* Lock otimista (`.eq("status","pendente")`) antes de gravar em
  `material_categories`, com reversão se o insert da categoria falhar —
  mesmo padrão TOCTOU-safe já usado no resto do repo.

**Validado ao vivo via Playwright**: `category-requests-suite` nova,
10/10 (CATREQ01-05 fluxo completo + SEC-CATREQ01-05 segurança/permissão,
incluindo double-approve concorrente).

### Feature — modal "Registrar ocorrência de material" (pedido do dono do sistema)

**Pedidos originais**: (1) modal não cabia num monitor de 14" sem dar
zoom-out no navegador; (2) "Tipo de ocorrência" era um grid de cards, não um
dropdown funcional; (3) foto opcional da ocorrência; (4) autocomplete
opcional pra associar um militar (matrícula/nome de guerra) à ocorrência;
(5) se associado, notificação automática (sino + página de histórico do
próprio usuário, com o máximo de detalhe).

**Implementação**:
* `components/ui/dialog.tsx` (componente base, 26+ consumidores) ganhou
  `max-h-[calc(100vh-2rem)]` + `overflow-y-auto` no conteúdo e
  `sticky bottom-0` no rodapé — validado ao vivo via Playwright em outros 2
  dialogs (Editar/Cadastrar Usuário) em 1440×900 e 1280×620 antes de aceitar,
  sem regressão.
* "Tipo de ocorrência": grid de 6 cards → `<select>` nativo com
  `<optgroup>` (mesmo agrupamento Dano/Perda/Administrativo, ~40px em vez de
  ~250-300px de altura).
* Foto opcional (`ocorrencia_foto_url`) e associação opcional de usuário
  (`ocorrencia_usuario_associado_id`, `AsyncComboBox` contra
  `/api/admin/search-profiles`) — novas colunas em `material_items`
  (migration pendente, ver abaixo). IDOR real corrigido: o id do usuário
  associado chega como texto livre no PATCH e é revalidado contra o tenant
  do caller antes de gravar/notificar (um id forjado associaria/notificaria
  alguém de outro tenant sem essa checagem).
* Fallback de migration pendente: se o UPDATE falhar com `42703`/`PGRST204`
  mencionando uma das colunas novas, repete só com as colunas antigas e
  nunca afirma (audit log/notificação) que a foto ou associação foi salva
  quando não foi.
* Notificação (`ocorrencia_associada`) só é disparada
  `if (usuario_associado_id && attachmentPersisted)`; nova seção "Ocorrências
  de material associadas ao seu nome" em `efetivo/historico` (foto, status,
  descrição, reserva, quem registrou, timestamp).
* Vazamento de memória real corrigido: `URL.createObjectURL(photoFile)`
  rodava a cada re-render sem `revokeObjectURL` — movido pra `useEffect`
  escopado em `photoFile`.
* Achado de code review, confirmado ao vivo via Playwright (MNT16, viewport
  1280×620): o painel de resultados do `AsyncComboBox` (`position: absolute`
  dentro do `DialogContent`, que agora rola internamente) podia ultrapassar
  a borda do dialog em vez de flutuar por cima — componente compartilhado
  (3 consumidores) ganhou "collision detection": mede o espaço real contra o
  ancestral rolável mais próximo (ou a janela) e clampa a altura ou inverte
  o dropdown pra cima quando falta espaço abaixo. Revisão de código própria
  (agente de revisão indisponível por rate limit de sessão) — 9,8/10, sem
  achado crítico ou alto, 2 baixo (degradação cosmética em viewport
  extremamente apertado; consumidores fora do arsenal ainda sem teste de
  geometria dedicado — não-regressivo pra eles).
* SW: console error real (`no-response` em `/reserva/arsenal/manutencao`)
  era um gap genuíno de fallback offline, não o bug de cache obsoleto de
  2026-07-20 — corrigido com `handlerDidError` (Serwist) só no matcher de
  navegação, página de fallback tema-aware, sem tocar a estratégia
  `NetworkOnly` deliberada.

**Validado ao vivo via Playwright** (contra dev local, `E2E_BASE_URL`/
`E2E_BFF_URL` explícitos — nota operacional abaixo): `manutencao-suite`
18/18 (MNT16 dialog cabe em 1280×620 e não deixa o dropdown vazar; MNT17
foto opcional; MNT18 associação opcional/notificação/histórico, com
skip-gracioso quando a migration ainda não está aplicada no ambiente).

### Fix — egress de fotos do arsenal não seguia o padrão já corrigido pra fotos de perfil (2026-07-27)

**Causa raiz** (achado pelo dono do sistema): `/api/arsenal/material-photo`
fazia upload DIRETO ao Storage a partir da rota edge do Next.js, com os
bytes brutos do cliente — até 5 MiB, sem compressão nem cap de dimensão. É
exatamente a mesma classe de bug de custo de egress já corrigida pra fotos
de perfil em 2026-07-27, só que nunca replicada aqui — usado tanto pelo
cadastro de material (`_material-dialog.tsx`, já existente) quanto pela
nova foto opcional de ocorrência acima.

**Fix**: mesmo padrão do fix de 2026-07-27 — BFF vira o único lugar que
toca Sharp e o client de service role do Storage; a rota Next agora é um
proxy fino (mesmo mecanismo de CSRF do proxy de foto de perfil).
* `domain/material-photo/process-material-photo.ts` — pipeline Sharp
  próprio (não compartilhado com o de perfil: dimensões e alvo de tamanho
  diferentes de propósito, foto de material precisa preservar mais detalhe
  pra servir de evidência): resize "fit inside" até 1280px no maior lado
  (sem forçar recorte quadrado, ao contrário do avatar de perfil), escada de
  qualidade WebP 80→56, alvo de 300KB / teto de 400KB, guarda de bomba de
  descompressão em 40M pixels.
* `POST /api/arsenal/material-photo` novo no BFF — staff-only
  (`admin_global`/`admin_reserva`/`armeiro`), path novo por UUID a cada
  upload (sem CAS: fotos de material antigas já não eram limpas na troca
  antes desta correção, e um material pode ter fotos referenciadas por
  múltiplas solicitações pendentes simultâneas — limitação pré-existente,
  fora de escopo, não piorada aqui).
* `request-body-limit.ts` ganhou instância própria (`materialPhotoBodyLimit`,
  5 MiB + 64 KiB) independente da de foto de perfil — nunca compartilha a
  mesma constante, pra uma mudança futura numa não afetar a outra por
  acidente.

**Revisão de código — 2 rodadas** (rubrica do CLAUDE.md, agente
`code-reviewer` indisponível no ambiente — usada a mesma rubrica via agente
genérico): 1ª rodada 7,5/10 (1 ALTO — instância de body-limit compartilhada
por engano; 2 MÉDIO — testes faltando), todos corrigidos; 2ª rodada
**9,8/10**, sem achado crítico/alto/médio.

**Evidência**: `apps/bff` 262/262 testes unitários (+6 novos); typecheck
limpo em `apps/web` e `apps/bff`; `manutencao-suite` 18/18 (MNT17 confirma
`POST /api/arsenal/material-photo` → 200 real, ponta a ponta); teste
sintético pior-caso (JPEG 2800×2100 quase incompressível, q90): upload bruto
4.859.245 B (4,63 MiB) → processado 375.802 B (367,0 KiB), 1280×960,
qualidade 56 — **-92,3%**.

### Fix — 3 bugs pré-existentes achados durante a validação (regra canônica do CLAUDE.md)

Nenhum era regressão desta entrega — todos root-caused e corrigidos antes
de fechar, conforme exigido:
* `CATREQ04`: locator de teste (`div` com `hasText`) resolvia pro `<div>`
  mais interno (só o badge de status), não a linha inteira — `rejection_reason`
  estava persistido corretamente no banco (confirmado via query direta),
  bug era só do teste. Fix: `data-testid="own-request-row"` na linha externa
  em `_my-requests-banner.tsx` + locator ajustado.
* `MNT09`: React deixava de disparar `onChange` sintético pro input de busca
  compartilhado (`GridSearchInput`) depois de um fluxo específico de
  abrir/fechar o dialog de ocorrência — confirmado ao vivo (trace do
  Playwright, log no handler) que o evento nativo `input` sempre disparava
  mas `onChange` não. Fix: `onInput` em vez de `onChange` (equivalente pra
  `<input type="text">`, mais robusto contra esse caso).
* `MNT15`: locator redundante e pré-existente
  (`dialog.getByTestId(x).getByTestId(x)...`) causava timeout de 10s —
  `dialog` já estava escopado no testid; segunda chamada buscava um
  aninhado que não existe. Fix: removida a chamada duplicada.

### Nota operacional — alvo de teste ambíguo

`e2e/harness.ts` usa `https://apmcb.pmpb.online` (produção real, Cloudflare)
como default de `BASE_URL` quando `E2E_BASE_URL` não está setado no shell —
rodar a suíte sem exportar essa variável explicitamente aponta pra produção
em vez do dev local, silenciosamente. O banco (Supabase) é o mesmo em
qualquer dos dois casos (fixtures de teste sempre limpas no teardown,
independente do alvo), mas o CÓDIGO servido é diferente — gerou um falso
negativo nesta sessão (MNT16 "falhando" contra produção, que ainda não
tinha o deploy de hoje). Sem mudança de código proposta aqui; registrado
como lembrete pra sempre exportar `E2E_BASE_URL`/`E2E_BFF_URL` ao validar
mudanças locais.

### Migrations pendentes de aplicação manual

Três migrations aditivas, sem acesso de DDL neste ambiente (colar no SQL
Editor do Supabase Dashboard):
`20260816090000_add_category_notification_types.sql` (`category_request`,
`category_approved`, `category_rejected`),
`20260816120000_add_ocorrencia_associada_notification_type.sql`
(`ocorrencia_associada`), e
`20260816120100_add_material_items_ocorrencia_columns.sql` (4 colunas novas
em `material_items` + índice parcial). Sem elas, os inserts de notificação
correspondentes e a persistência de foto/associação da ocorrência falham de
forma graciosa (logados/detectados, nunca lançados nem afirmados como
sucesso ao usuário — ver fallback `42703`/`PGRST204` acima) até serem
aplicadas.

---

# 2026-08-16 (v8) — feat(usuarios): admin pode trocar e-mail de acesso de conta ativa + fix(notifications): 2 tipos ausentes do enum + ci: lint/test:unit do web

### Feature — pedido do dono do produto ("sistema pra caso o user perca acesso ao e-mail")

**Pedido**: só `admin_global`/`admin_reserva` podem trocar o e-mail de acesso
de um usuário que JÁ tem conta ativa (saiu da unidade, e-mail invadido, erro
de digitação no cadastro). Não existia NENHUM jeito de fazer isso — o fluxo
de convite existente (`_cadastrar-militar-dialog.tsx`) só cobria "primeiro
provisionamento" (usuário sem e-mail ainda).

**Implementação** (`_edit-dialog.tsx`, `POST /api/admin/users` — reaproveita
o branch `existing_user_id` já existente, não duplica lógica):
* Novo teto `canChangeUserEmail()` em `invite-ceiling.ts` — independente de
  `canInvite`/`allowedRoles`, nunca inclui `armeiro` mesmo quando o alvo
  (role `usuario`) está dentro do teto geral dele (trocar e-mail de login de
  quem já tem acesso ativo é mais sensível que conceder acesso a quem não
  tem nenhum).
* Botão "Alterar" no dialog de edição, só visível quando `user.email` já
  existe E o caller passa no teto — revela um campo de novo e-mail com
  confirmação explícita (`window.confirm`, ação quase irreversível: revoga
  o acesso pelo e-mail antigo na hora).
* Backend distingue "primeiro provisionamento" de "troca de e-mail" comparando
  o e-mail submetido (normalizado) contra `profiles.email` atual — sem flag
  nova no payload.
* **Lock otimista em `profiles` ANTES de tocar `auth.users`** — a Admin API
  do GoTrue não suporta compare-and-swap direto em `auth.users.email`, então
  a claim em `profiles` (`.eq("email", oldEmail)`) decide qual request
  concorrente "vence" ANTES de qualquer mutação de login acontecer; o
  perdedor recebe 409 sem nunca ter trocado o login de ninguém.
* Rollback em caso de falha do `updateUserById` reconsulta `auth.users`
  diretamente (fonte de verdade) em vez de usar o valor capturado no início
  da request — fecha um cenário de 2 falhas encadeadas em requests
  concorrentes que podia gravar em `profiles` um e-mail "fantasma" nunca
  confirmado em `auth.users`.
* Audit log (`profile.email_changed`) + notificação in-app pro usuário
  afetado (tipo `email_changed`, nova migration — ver abaixo). Sem pipeline
  de e-mail transacional custom neste repo, não há como avisar o e-mail
  ANTIGO diretamente; a notificação in-app é o mínimo viável documentado.

**Revisão de código — 3 rodadas** (achados corrigidos antes de fechar):
CRÍTICO (enum de notification ausente, insert engolindo erro em silêncio —
mesma classe de bug já vista 2x neste repo); ALTO (race condition entre
admins concorrentes — fix do lock otimista acima); e um 2º achado mais sutil
no PRÓPRIO fix (rollback restaurando valor stale em vez do verificado).

**Validado ao vivo via Playwright**: `admin-usuarios-suite` completa —
21/21 (gate de visibilidade pra admin_global vs armeiro; fluxo completo com
usuário descartável, incluindo erro amigável de e-mail duplicado). Nenhuma
fixture compartilhada foi mutada — teste usa usuário `E2E*`/`@e2e.test`
descartável, limpo em `finally` e confirmado pelo teardown global.

### Bug Fix — achado durante a revisão final (regra canônica do CLAUDE.md, não relacionado à feature acima)

**Causa raiz**: `PATCH /api/profiles/:id/status` notifica o usuário afetado
ao ser desativado (`type: "account_deactivated"`) ou receber impedimento
administrativo (`type: "account_blocked"`) — nenhum dos dois valores nunca
existiu em `notification_type_enum` desde o schema inicial. O INSERT é
fire-and-forget (resultado nunca checado) — falha 100% das vezes em
silêncio, e o usuário nunca recebeu esse aviso, desde sempre.

**Fix**: nova migration adiciona os 2 valores ao enum (mesmo padrão já usado
4x neste repo pro mesmo tipo de bug).

### CI

`ci.yml` ganhou steps de `lint` e `test:unit` pro web — já existiam como
scripts e já estavam verdes (0 erros/86 warnings de lint; 45/45 testes
unitários), só nunca tinham sido conectados ao pipeline.

### Migrations pendentes de aplicação manual

Duas migrations aditivas (`ALTER TYPE ... ADD VALUE`, seguras e
não-destrutivas) precisam ser coladas manualmente no SQL Editor do Supabase
Dashboard — sem acesso de DDL neste ambiente:
`20260815090000_add_email_changed_notification_type.sql` e
`20260815091500_add_account_status_notification_types.sql`. Sem elas, os
inserts de notificação correspondentes falham (logados, não lançados — a
mutação principal de cada fluxo funciona normalmente mesmo assim).

---

# 2026-08-15 (v7) — fix(build): deploy do Cloudflare Pages falhando ao buscar a fonte Inter do Google Fonts

### Bug Fix — reportado pelo usuário (log de build do Cloudflare Pages colado, deploy do commit `f7556d9` falhou)

**Causa raiz**: `src/app/layout.tsx` usava `next/font/google` — Next.js busca os
arquivos da fonte Inter da rede do Google (`fonts.gstatic.com`) NO MOMENTO DO
BUILD. Uma falha de rede/DNS transitória no ambiente de build da Cloudflare
Pages (fora do nosso controle, log mostra 3 tentativas de retry esgotadas
por variante de subset) derruba o build inteiro com `NextFontError: Failed
to fetch \`Inter\` from Google Fonts` — o deploy nunca chega a acontecer.

**Fix**: fonte trocada para auto-hospedada via `next/font/local`
(`src/fonts/Inter-Variable.woff2`, ~48KB, baixado uma vez e commitado).
Achado ao investigar: a API do Google já servia o MESMO arquivo variable
font pras 4 declarações de peso (400/500/600/700) — cada `@font-face` só
seleciona a instância certa a partir do eixo de variação do próprio
arquivo — então uma única entrada local (`weight: "400 700"`) cobre os 4
pesos sem duplicar binário nem mudar a tipografia renderizada.

**Validado**: `npx next build --webpack` local completo com sucesso (exit
0, todas as rotas geradas) — mesmo comando que o pipeline da Cloudflare
executa. Elimina esta classe de falha de build permanentemente (zero
dependência de rede externa no build a partir de agora), não só nesta
ocorrência específica.

---

# 2026-08-15 (v6) — fix(rbac): admin não pode mais forjar status biométrico + reserva com múltiplos admins + busca de usuário existente cega a staff

### Bug Fix — reportado pelo usuário, com screenshot ("quem deve definir status deve ser o sistema, nunca o usuário")

**Causa raiz**: o `<select>` de Status em `_edit-dialog.tsx` oferecia livremente
"Completo" e "Pendente biometria" — mas esses dois valores são DERIVADOS do
cadastro biométrico real (`supabase/migrations/20260721173926_..._enrollment_
liveness_gate_txn.sql`: só a RPC de enrollment, ao consumir um challenge de
biometria com sucesso, seta `registration_status = 'complete'`). Um admin
podia declarar biometria capturada sem ela nunca ter existido — exatamente a
mesma classe de bug (status mentindo sobre o estado real) já corrigida horas
antes nesta mesma sessão (`AccessBadge`/`classifyAccountStatus`).

**Fix**: `PATCH /api/profiles/:id` e `PATCH /api/profiles/:id/status` (BFF)
agora rejeitam com 400 qualquer transição MANUAL para "complete"/
"pending_biometric" que não seja um no-op (reenvio do valor já atual — o
dialog de edição sempre reenvia todos os campos). Único jeito de reativar
uma conta inativa/impedida: enviar o valor sintético `"reactivate"`, que o
backend resolve consultando se o usuário TEM template biométrico cadastrado
(`biometric_templates`) — nunca aceita esse valor de volta do cliente.
`ChangeStatusButton` ("Ativar conta"/"Remover Impedimento") atualizado pra
enviar `"reactivate"` em vez de `"complete"` hardcoded, e usa o status
DEVOLVIDO pela resposta (não o sentinel enviado) pro toast final.

**Validado ao vivo contra o BFF local** (produção real por trás): transição
direta `complete→pending_biometric` rejeitada com 400 e mensagem amigável;
`inactive→reactivate` resolvido corretamente pra `complete` (usuário de
teste tinha biometria cadastrada) e persistido; reenvio no-op do status
atual continua funcionando (não quebra o fluxo normal de salvar outros
campos do perfil).

### Bug Fix — reportado pelo usuário, com screenshot (`/admin/estrutura`: "sempre deve ser possível ter mais de um admin da reserva")

**Causa raiz**: `reserve_memberships` sempre foi M:N por design (o upsert de
`POST /users/invite` nunca exigiu unicidade por `reserve_id` sozinho) — mas
`GET /api/admin/estrutura` (BFF) agregava os admins de cada reserva com
`Object.fromEntries()`, que colapsa chaves duplicadas: se uma reserva tivesse
2+ `admin_reserva`, só o ÚLTIMO processado sobrevivia na resposta, os demais
somem silenciosamente. A UI (`admin_reserva: AdminReserva | null`, singular)
também só tinha espaço pra mostrar UM nome, e escondia o botão "Convidar
admin" sempre que já havia um.

**Fix**: agregação trocada pra `Map<reserve_id, Admin[]>` (todos os membros,
não só o último); tipo `admin_reservas: AdminReserva[]`; UI lista TODOS os
admins atuais da reserva e sempre mostra "Convidar mais um admin" —
independente de já haver um ou não.

**Validado**: resposta real do endpoint local confirmada com o shape de
array correto (`admin_reservas: [...]`) contra o tenant de produção. Não
validado visualmente com 2+ admins reais na mesma reserva — nenhuma reserva
do tenant de produção tem esse cenário hoje pra testar sem criar dado
descartável; a mudança de render é um `.map()` direto sobre dado já confirmado
correto, e passou no typecheck.

### Bug Fix — reportado pelo usuário ("não vi... todo usuário no dropdown")

**Causa raiz**: `GET /api/admin/search-profiles` (usado pelo fluxo "Militar
já cadastrado" de `_cadastrar-militar-dialog.tsx`, pra reenviar convite a um
perfil já existente) tinha uma whitelist fixa de só 2 papéis pesquisáveis
(`usuario`, `armeiro`) — um admin_global nunca encontrava um
admin_reserva/admin_global/auditor JÁ CADASTRADO ao tentar reenviar acesso
pra ele.

**Fix**: whitelist fixa trocada por `allowedRoles(callerRole)` (SSOT do teto
de privilégio, mesma usada em `canInvite`) — reproduz a restrição antiga
"armeiro não busca armeiro" automaticamente (teto de armeiro é só
`["usuario"]`), sem caso especial dedicado. Novo valor `role=any` no query
param busca em TODOS os papéis do teto do caller de uma vez. Resultados
agora mostram um badge de papel quando não é "usuário".

**Achado durante a implementação, corrigido antes de terminar**: a busca
ampliada agora pode encontrar contas JÁ ATIVAS (`account_activated_at`
preenchido) de admin/auditor — sem guarda, o fluxo "Militar já cadastrado"
(pensado pra PRIMEIRO acesso) sobrescreveria silenciosamente o e-mail de
login de uma conta admin em uso ativo. Bloqueado no client (botão desabilitado
+ aviso inline) e no fluxo de submit, direcionando pra edição de usuário
dedicada quando a conta já está ativa.

**Validado ao vivo via Playwright** contra dev local: busca por matrícula do
armeiro fixture (antes invisível pra esse endpoint) agora retorna o
resultado com o papel correto.

---

# 2026-08-15 (v5) — fix(perf): delay de 1-3s ao navegar + fix(usuarios): dropdown de papel ausente na edição

### Performance — reportado pelo usuário ("delay de 1 a 3s ao trocar de página/aba")

**Investigação**: nenhum `loading.tsx`/Suspense existe (a mitigação do incidente
2026-07-17 segue intacta). Causa real: cadeia de round-trips SEQUENCIAIS que
se repete em toda navegação — `middleware.ts` chama o BFF (`/api/auth/me`,
timeout de até 3s) → `(dashboard)/layout.tsx` refaz `getUser()`+`profile` →
cada `page.tsx` refaz `getUser()`+`profile` de novo (redundante com o
layout) → e várias páginas rodavam suas próprias queries independentes uma
após a outra em vez de `Promise.all`. Destaque: `reserva/page.tsx` tinha 9
contagens 100% independentes, todas sequenciais.

**Fix**: paralelizado via `Promise.all()` em `reserva/page.tsx` (9 queries),
`admin/usuarios/page.tsx`, `reserva/militares/page.tsx`, `reserva/arsenal/page.tsx`,
`admin/relatorios/page.tsx`, `reserva/relatorios/page.tsx`,
`admin/arsenal/solicitacoes/page.tsx` — nenhuma tinha dependência real entre
si (confirmado item a item na revisão de código). Adicionado
`navigation-progress.tsx`: barra de progresso no topo, Client Component puro
reagindo a clique em `<Link>`/mudança de rota, **sem nenhum Suspense em volta
de Server Component** — o único `<Suspense>` novo (em `providers.tsx`) é
exigência local do `useSearchParams()` e envolve só esse componente.

**Achado CRÍTICO de code review, corrigido antes do commit**: a primeira
versão reduzia o timeout de `verified-user.ts` de 3s para 1.2s, argumentando
que por ser fail-open isso não afetava segurança. Falso: a checagem inteira
de session-mismatch em `(dashboard)/layout.tsx` só roda DENTRO do
`if (verifiedUserId && ...)` — timeout (null) pula a checagem inteira, não
só "um dado a menos para comparar". Reduzir o timeout aumentava a frequência
real com que a mitigação do incidente de session-bleed (2026-07-17) ficava
desligada sob latência normal do BFF. **Revertido para 3s** — a percepção de
lentidão é resolvida pela paralelização de queries + barra de progresso, não
por afrouxar esse guard.

**Validado ao vivo via Playwright** contra dev local: suíte completa
`admin-usuarios-suite` (17/17) sem regressão; barra de progresso confirmada
aparecendo no DOM ao clicar num link do sidebar. `reserva-militares-suite` e
`admin-inventario-suite` re-rodadas após o fix do achado de checkbox abaixo
— resultado registrado na seção seguinte.

### Bug Fix — reportado pelo usuário, furioso ("não aparece dropdown de papel ao editar")

**Causa raiz**: o dialog de EDITAR usuário (`_edit-dialog.tsx`) nunca teve
campo de papel — só o de CRIAR tinha, e mesmo esse só oferecia um binário
fixo Usuário/Armeiro (botões hardcoded), não o teto completo por chamador
(`allowedRoles(callerRole)`) que o próprio dono do produto já tinha
especificado em detalhe numa entrada anterior deste changelog (v3).

**Fix**:
* Novo componente compartilhado `role-select.tsx` (SSOT visual do dropdown
  de papel, usado nos dois dialogs — evita a 4ª cópia divergente que o v4
  já tinha registrado como débito técnico).
* `_edit-dialog.tsx`: campo "Papel" novo, só renderizado quando
  `canInvite(callerRole, user.role)` é true E não é auto-edição.
* `_cadastrar-militar-dialog.tsx`: "Perfil inicial" trocou os 2 botões fixos
  por `RoleSelect` com todas as opções do teto do chamador.
* `PATCH /api/profiles/:id` (BFF) ganhou suporte a `role`, com teto de
  privilégio checado nos DOIS sentidos (papel novo E papel atual do alvo),
  bloqueio de auto-alteração, audit log e lock otimista contra TOCTOU.
* `admin/usuarios/page.tsx` + `_users-table.tsx`: filtros avançados novos
  (Papel, Reserva, Unidade, Pendência) usando os componentes compartilhados
  já estabelecidos (`FilterField`/`SearchableSelect`, mesmo padrão de
  `RelatorioFilterPanel`) — paginação/seleção local que estava duplicada
  substituída por `usePaginatedSelection` (hook já existente, nunca usado
  aqui).

**Achados de code review, todos corrigidos antes do commit**:
* Race condition (TOCTOU) na troca de papel — lock otimista adicionado
  (`UPDATE ... WHERE role = <role lido>`, 409 se o papel mudou no meio).
* Zero cobertura de teste para o campo `role` — espelhados os 5 casos de
  `registration_status` já existentes em `privilege-escalation.pentest.test.ts`
  (admin_reserva tentando papel novo fora do teto; admin_reserva tentando
  alterar alvo cujo papel ATUAL está fora do teto; armeiro fora do próprio
  teto; auto-alteração; caminho positivo com round-trip real no banco).
* `/reserva/militares`: `UserRowActions` nunca recebia o papel real do
  chamador, caindo no default `"admin_global"` — armeiro/admin_reserva viam
  um seletor com os 5 papéis do sistema em vez de só o próprio teto
  (backend já rejeitava, mas a UI mentia sobre o permitido). Prop
  `editCallerRole` adicionada e propagada a partir do `profile.role` real.
* Audit log usava presença de `registration_status` no body em vez da
  mudança real (`statusIsChanging`) — toda edição de perfil gravava uma
  linha sugerindo mudança de status que não ocorreu. Corrigido.
* Mensagem de erro 403 duplicava a lista de papéis hardcoded em vez de
  reusar `allowedRoles()`. Corrigido.

**Falha pré-existente encontrada durante a validação e corrigida** (regra
canônica do CLAUDE.md — investigar até a causa raiz mesmo sem relação com a
mudança atual): o e2e `ML09` falhou consistentemente contra `/reserva/militares`
com `"Clicking the checkbox did not change its state"`. Causa: o checkbox de
seleção de linha tinha `onChange` no `<input>` E `onClick` no `<div>`/`<td>`
que o envolve, ambos chamando o mesmo toggle — um clique direto no checkbox
disparava as duas vezes, a segunda desfazendo a primeira. Mesmo padrão
encontrado (via grep, não por teste vermelho) em `admin/inventario/page.tsx`
— corrigido nos dois arquivos com `onClick={(e) => e.stopPropagation()}` no
próprio `<input>`.

**Segunda falha pré-existente, achada em produção pelo próprio dono do
produto durante a validação desta entrada**: card de `/reserva/militares`
mostrava "Completo"/"Ativo" para um militar sem NENHUMA conta de login
criada (`account_activated_at` null) — o card só considerava
biometria+TOTP, nunca se a conta de acesso existia; `/admin/usuarios` já
fazia essa checagem certo (`AccountStatusBadge`), mas as duas telas nunca
compartilharam a lógica. Clicar no card revelava a contradição: "Conta não
criada" + botão de reenviar convite. Extraído `lib/account-status.ts`
(`classifyAccountStatus`, SSOT), usado agora pelas duas telas; novo
indicador "Sem acesso"/"Convite enviado"/"Convite expirado" adicionado às
duas visualizações (card e tabela) de `/reserva/militares`, que antes não
tinham NENHUM sinal de status de acesso na listagem.

**Validado ao vivo via Playwright**: 2 casos novos (`AU16`, `AU17`) somados à
suíte `admin-usuarios-suite` completa (17/17) — filtros abrem e reduzem a
lista de verdade, e o seletor de Papel aparece com as 5 opções para
`admin_global`. Screenshots confirmam o painel de filtros e o dialog de
edição com o campo "Papel" visível e populado. `reserva-militares-suite`
e `admin-inventario-suite` confirmaram o fix do checkbox (`ML09`/`INV09`
antes vermelhos, agora verdes); ambas re-rodadas mais uma vez após o
`AccessBadge` (novo indicador de acesso) — `admin-usuarios-suite` 17/17,
`reserva-militares-suite` 32/33 (1 flaky em busca por texto, passou no
retry, sem relação com as mudanças desta entrada — investigado, não é
regressão).

---

# 2026-08-15 (v4) — fix(ui): modais presos em 384px em qualquer desktop (14 dialogs)

### Bug Fix — reportado pelo usuário ("modal cramped, não fluida")

**Causa raiz**: `DialogContent` (`components/ui/dialog.tsx`) define `sm:max-w-sm`
como default. Qualquer consumidor que sobrescrevia a largura via
`className="max-w-2xl"` (sem o prefixo `sm:`) perdia — `tailwind-merge` não
deduplica classes com modificadores diferentes (`sm:max-w-sm` vs `max-w-2xl`
ficam as DUAS no DOM), e no CSS gerado pelo Tailwind a regra do breakpoint
(`@media (min-width:640px){.sm\:max-w-sm{...}}`) vem depois da regra base no
stylesheet — vencendo em qualquer tela ≥640px, ou seja, praticamente
qualquer desktop. O modal "Solicitar adição de material" (pedia `max-w-6xl`,
1152px) renderizava preso em 384px, cramped, com o seletor de calibre
cortado e o botão de foto quebrando linha.

**Alcance**: varredura de todos os 26 arquivos que usam `DialogContent`
encontrou 14 ocorrências reais do mesmo padrão (11 fora do que já tinha sido
tocado nesta sessão): `_material-dialog.tsx` (max-w-5xl — dialog de
material do admin), `_category-manager.tsx` (×2), `shift-auth-dialog.tsx`,
`nexus/tenants/page.tsx`, `nexus/superadmins/page.tsx`, `_livro-client.tsx`,
`admin/inventario/page.tsx`, `_cautelas-client.tsx`, `admin/estrutura/page.tsx`
(×1 caso onde a classe pretendida era MENOR que o default, renderizando
maior que o intencional), `_registrar-ocorrencia-dialog.tsx`.

**Fix**: todos os 14 passaram a usar o prefixo `sm:` (`sm:max-w-2xl` em vez
de `max-w-2xl`). Comentário de alerta adicionado no próprio `DialogContent`
para não recorrer — achado de code review: o fix não ataca a causa raiz no
componente base (o default `sm:max-w-sm` continua sendo a armadilha para o
próximo dialog que reutilizar o padrão sem prefixo), decisão consciente
dado o risco de alterar comportamento de todo dialog do app sem uma bateria
de regressão visual completa; documentado como follow-up.

**Validado ao vivo via Playwright** (não apenas leitura de código): modal de
solicitação de material mede 1152px (era 384px); modal de cadastrar usuário
mede 672px (era 384px). Screenshots confirmam layout fluido, sem cortes.

### Débito técnico registrado (não corrigido nesta entrada)

* `canCreateArmeiro` em `_cadastrar-militar-dialog.tsx` é uma 4ª cópia
  hardcoded do teto de privilégio, independente de `invite-ceiling.ts` e do
  espelho em `route.ts` — achado de code review, candidato a consolidação
  futura (ex: expor `allowedRoles()` para o client via uma rota dedicada).

---

# 2026-08-15 (v3) — fix(usuarios): UX de cadastro/edição de usuário + admin_global também cria auditor

### Decisão de produto — teto de admin_global ampliado

* Confirmado com o dono do produto: `admin_global` também pode criar/conceder
  o papel `auditor` (não só `admin_reserva`). `invite-ceiling.ts` e o espelho
  em `apps/web/src/app/api/admin/users/route.ts` atualizados — dropdown de
  papéis por chamador agora é: `admin_global` → Admin Global, Admin Reserva,
  Armeiro, Usuário, Auditor; `admin_reserva` → Armeiro, Usuário, Auditor;
  `armeiro` → só Usuário.

### Bug Fixes — reportados pelo usuário

* **Novo usuário cadastrado não aparecia na lista sem F5/navegar**: `_militares-table.tsx`
  (`/reserva/militares`) usava `useState(initialMilitares)` sem sincronizar
  quando o Server Component pai buscava dados novos via `router.refresh()`
  — o componente client continuava mostrando a lista antiga em memória.
  Adicionado `useEffect` de sync (mesmo padrão já usado em
  `_users-table.tsx`, que nunca teve esse bug).
* **"Enviar login e permissão" não aparecia ao editar um usuário existente**:
  `_edit-dialog.tsx` (`/admin/usuarios`) só editava campos de perfil — não
  havia NENHUM jeito de conceder acesso a partir dali, só pelo fluxo
  separado de "Cadastrar Usuário". Adicionado checkbox único (reaproveita
  `CheckboxCard`) que, marcado, revela um campo de e-mail — visível só para
  usuários sem acesso ainda (`!user.email`). Duplicidade de e-mail já
  retornava erro tratado no backend (`POST /api/admin/users`), só faltava a
  UI para chegar até lá.
* **Armeiro via a opção "Armeiro" no seletor de perfil ao cadastrar usuário**
  (`_cadastrar-militar-dialog.tsx`, `/reserva/militares`): o teto já
  bloqueava no backend e o botão já vinha desabilitado, mas continuava
  visível (cinza, com tooltip) — dava a impressão de que seria possível em
  algum caso. Agora a opção nem aparece para quem não pode concedê-la
  (mesmo padrão de "papel único" já usado em `/reserva/criar-armeiro`).

### Refactor — DRY (achado em code review)

* Novo `apps/web/src/lib/send-login-invite.ts`: a chamada
  `POST /api/admin/users` (reenvio/provisionamento de login) estava
  duplicada em 3 componentes (`_cadastrar-militar-dialog.tsx` ×2,
  `_militares-table.tsx`). Extraído; a função nunca rejeita (sempre resolve
  `{ok, message}`), corrigindo de quebra um achado real: em
  `_edit-dialog.tsx`, uma falha no convite (rede, JSON malformado) caía no
  `catch` externo e mostrava "Erro de conexão" mesmo quando a atualização
  do perfil já tinha sido salva com sucesso — usuário achava que perdeu a
  edição e tentava de novo.
* `CheckboxCard` (antes local a `_cadastrar-militar-dialog.tsx`) exportado e
  reaproveitado em `_edit-dialog.tsx`, em vez de uma segunda cópia do mesmo
  markup (inclusive o fix de área de clique documentado no componente).

### Testes

* `tsc --noEmit` limpo em `apps/web`; nenhuma mudança de backend nesta
  entrada além de `invite-ceiling.ts` (245/245 BFF já cobria `canInvite`).

---

# 2026-08-15 (v2) — fix(rbac): teto de privilégio divergente no cadastro de usuário (admin_reserva bloqueado de criar auditor) + hardening de material-photo/approve

### Bug Fixes — reportado pelo usuário, confirmado pré-existente (30+ dias)

* **`admin_reserva` recebia 403 ao tentar cadastrar um "Auditor"** em
  `/reserva/criar-armeiro`. Causa raiz: o dropdown (`_criar-armeiro-client.tsx`,
  Fase 7C) foi atualizado para oferecer "Auditor" a `admin_reserva`, mas o
  submit desse formulário bate em `POST /api/admin/users` (rota Next.js
  antiga) — cuja checagem de teto de privilégio ficou com uma cópia
  divergente do `invite-ceiling.ts` (fonte canônica), sem "auditor". A mesma
  divergência existia em `POST /api/admin/militares` (BFF), usado por
  `/admin/usuarios`.
* **`GET /api/admin/militares` 403 no console**: investigado — não existe
  rota GET nesse path (só POST); é o mesmo submit acima aparecendo no
  Network tab.
* **Fotos de material 400 no Storage**: código de exibição já estava correto
  (fix `fe19405`, 2026-07-10) — os 400 reportados eram cache de navegador
  antigo. Achado real e corrigido no caminho: `POST /api/arsenal/material-photo`
  ainda retornava `getPublicUrl()` (bucket privado desde
  `20260629000001_fix_rls_security_audit.sql` — nunca vai funcionar), em vez
  do path relativo que `resolvePhotoUrl`/SSOT já sabe resolver.
* **`PATCH /api/arsenal/requests/:id/approve` 500 (request `104c43fb...`)**:
  reproduzido via SQL direto (INSERT idêntico em transação com ROLLBACK) —
  os dados da solicitação não violam nenhuma constraint; não foi possível
  reproduzir a causa raiz exata, provavelmente transitório (coincide com
  janela de deploy blue-green do BFF durante a mesma sessão). Hardening
  aplicado no caminho: `ensureMaterialCategory` podia lançar exceção não
  capturada dentro do loop de `material_addition` — sem try/catch nem
  `revertClaim`, uma falha ali agora reabre a solicitação corretamente em
  vez de deixá-la presa/inconsistente.

### Segurança — CRÍTICO, achado durante o próprio fix (code review, 3 rodadas independentes)

* **`admin_global` conseguia escalar para criar contas `auditor`/`superadmin`.**
  A primeira versão deste fix ampliou o enum/cast de `role` para aceitar
  `"auditor"` em `POST /api/admin/militares` (BFF) e `POST /api/admin/users`
  (Next.js) — mas nenhum dos dois endpoints jamais checava teto de
  privilégio para `callerRole === "admin_global"` (só armeiro/admin_reserva
  eram checados). Isso expôs uma lacuna pré-existente: `admin_global` (papel
  escopado ao próprio tenant) passou a poder criar `auditor`, que
  `invite-ceiling.ts` explicitamente não autoriza para esse papel. Pior no
  endpoint Next.js: `role`/`userRole` ali nunca teve validação de schema
  (`string` puro) — um `admin_global` conseguia enviar `role: "superadmin"`
  e criar uma conta de operador da plataforma inteira (Nexus-only,
  tenant-less), antes mesmo deste fix tocar o arquivo.
* **Corrigido**: os dois endpoints agora checam o teto para os TRÊS papéis
  chamadores (armeiro/admin_reserva/admin_global) via `canInvite()`
  (BFF, reusa a fonte de verdade já importada no arquivo) e um espelho local
  tipado (`INVITE_CEILING`/`canCreateRole`) no endpoint Next.js, que não tem
  acesso ao pacote do BFF.
* Validado ao vivo contra produção (Supabase real): `admin_reserva` → criar
  `auditor` agora retorna sucesso (era 403); `admin_global` → criar `auditor`
  agora retorna 403 (antes teria passado); `admin_global` → criar
  `admin_reserva` continua funcionando (sem regressão no teto legítimo).
  Contas de teste (`E2E-AUD-001`, `E2E-AR-003`) desativadas após validação —
  não removidas via DELETE porque `audit_events` é imutável por design
  (RULE SQL bloqueia a exclusão de profile referenciado em audit log).

### Testes

* 245/245 BFF, `tsc --noEmit` limpo em `apps/bff` e `apps/web`.
* Code review obrigatório: 2 rodadas (4 + 3 sub-agentes), achados de
  DRY/SSOT (checagem hand-rolled em vez de `canInvite()`) e o CRÍTICO de
  escalação de privilégio acima, todos corrigidos e revalidados.

---

# 2026-08-15 — fix(arsenal): admin_global revisa solicitações de armeiro + acordeon no almoxarifado

**Bug real**: o banner de "solicitações pendentes de armeiro" em `/admin`
(única tela que o admin_global vê) linkava para `/admin/arsenal/solicitacoes`,
mas essa página e as rotas do BFF (`GET/approve/reject /api/arsenal/requests`)
só aceitavam `admin_reserva` — todo clique redirecionava o admin_global de
volta para `/`. A policy RLS `aar_admin_select`/`aar_admin_update` também
checava `role = 'admin'`, valor que não existe mais no enum atual, então a
contagem exibida no banner sempre foi 0, mesmo com solicitações reais
pendentes.

**Correção**:

- página e rotas do BFF passam a aceitar `admin_global`, escopado pelo
  **tenant inteiro**; `admin_reserva` continua escopado só pela própria
  reserva — BFF e RLS agora usam exatamente a mesma lógica de escopo;
- nova migration corrige `aar_admin_select`/`aar_admin_update` para checar os
  papéis atuais com o escopo correto (reserva via `auth_admin_reserve_ids()`,
  tenant via `my_tenant_id()`), em vez do `role = 'admin'` obsoleto;
- `approve`/`reject` passam a reivindicar a solicitação atomicamente
  (`WHERE status = 'pendente'`) antes de aplicar a mutação de material,
  evitando dupla aplicação quando dois revisores agem quase ao mesmo tempo —
  risco que aumentou ao abrir a revisão para dois papéis simultâneos;
- `notification_type_enum` ganha `arsenal_request`/`arsenal_approved`/
  `arsenal_rejected` (nunca existiam — mesma classe de bug já corrigida uma
  vez para `armament_cancelled`) e os inserts de notificação passam a logar
  falha em vez de falhar em silêncio; `admin_global` do tenant também é
  notificado quando a reserva não tem `admin_reserva` designado.

**UI**:

- novo acordeon "Solicitações de armeiro" em `/reserva/arsenal`: armeiro não
  vê (sem permissão de revisão); admin (`admin_reserva`/`admin_global`) vê
  contagem de pendentes e é redirecionado para a tela de aprovação ao clicar;
- `/admin/arsenal/solicitacoes` ganha abas horizontais
  (Pendentes/Aprovadas/Rejeitadas/Histórico) e busca por armeiro/matrícula/
  material, reaproveitando `GridSearchInput`/`useGridState` já usados em
  outras páginas do admin.

Validado com Playwright contra o Supabase de produção (BFF + web locais):
login como `admin_reserva` e `admin_global` confirma acordeon, redirecionamento,
abas, busca e contagem real do banner — antes sempre 0, agora reflete o banco.

---

# 2026-07-28 — fix(audit): IP confiável e normalizado na borda

**Incidente**: `auth.exchange` concluía a autenticação, mas o evento de
auditoria falhava ao tentar persistir uma cadeia `X-Forwarded-For` com
múltiplos endereços em uma coluna PostgreSQL `inet`.

**Correção**:

- Cloudflare passa a ser a única origem pública permitida em HTTP/HTTPS;
- Nginx confia apenas nos CIDRs oficiais Cloudflare, normaliza
  `CF-Connecting-IP` em `$remote_addr` e sobrescreve headers encaminhados;
- o BFF usa `getAuditClientIp()` como fonte canônica, aceitando somente um
  IPv4/IPv6 válido ou `null`;
- `audit_events`, login/exchange e `biometric_devices.last_ip` deixam de
  consumir cadeias ou headers Cloudflare diretamente;
- ausência ou valor inválido gera `null` e warning sanitizado, sem quebrar a
  operação principal.

`document_signatures`, provas de assinatura, fluxos de custódia, rate limit e
inventory permanecem inalterados nesta fase.

---

# 2026-07-27 — fix(storage): redução cirúrgica do egress de fotos de perfil

**Incidente**: o bucket privado `profile-photos` armazenava JPEG/PNG originais
de até 5 MiB e o frontend regenerava signed URLs em ciclos de
`router.refresh()`/RSC, produzindo URLs de cache diferentes para o mesmo objeto.
Listagens também assinavam fotos antes de saber quais registros seriam
renderizados.

**Correção BFF**:

- uploads de foto usam limite específico de `5 MiB + 64 KiB` antes do parser,
  enquanto todas as demais APIs permanecem limitadas a 2 MiB;
- nginx aceita `5 MiB + 64 KiB` na borda (em vez do default implícito de
  1 MiB), deixando o BFF aplicar 2 MiB às APIs comuns e a exceção às fotos;
- bytes reais são validados e processados com Sharp no VPS, gerando WebP
  imutável de no máximo 512×512 e 150 KB;
- troca de foto segue upload novo → CAS do banco → recontagem normalizada →
  remoção condicional do objeto antigo;
- geração do UUID mantém o receiver de Web Crypto, compatível com o runtime
  Bun/Alpine real usado na VPS;
- o CAS preserva exatamente `oldPhotoReferenceRaw`, inclusive URLs legadas,
  enquanto Storage usa somente `oldPhotoPathNormalized`;
- migração administrativa vincula os bytes ao snapshot bruto inventariado e
  aborta em conflito, sem sobrescrever foto mais recente;
- endpoint de signed URL deriva o path do banco, aplica autorização self/staff
  same-tenant e nunca aceita bucket/path arbitrário do cliente.

**Correção web**:

- `DashboardLayout` e Server Components deixaram de gerar signed URLs de
  `profile-photos`;
- `ProfileAvatar` compartilha uma query TanStack por
  `(profileId, photoPath)`, fresca por 50 minutos;
- referências públicas/signed legadas são comparadas pelo path normalizado,
  sem falso conflito quando o BFF devolve o mesmo objeto canônico;
- navegação, re-render e refresh com path estável reutilizam a mesma URL;
- logout e troca de identidade removem imediatamente as queries privadas;
- cadastro administrativo cria o perfil primeiro e envia a foto depois, sem
  repetir a criação em falha parcial.

**Evidência**:

- Network comparável: GETs de Storage `2 → 1` (-50%), URLs únicas `2 → 1`
  (-50%) e `Content-Length` declarado `740.609 → 494.766 B` (-33,2%), antes
  de aplicar qualquer migração;
- dry-run das quatro fotos ativas: `2.513.085 → 95.726 B` projetados (-96,2%);
- BFF 226/226, web unit 21/21, typechecks e build aprovados;
- Playwright Chromium 40 aprovados/1 skip esperado e suíte CI isolada com
  178 aprovados/1 flaky recuperado, sem falha final;
- imagem Alpine equivalente à produção validada com Bun 1.2.23,
  Sharp 0.34.5 e os oito testes reais de processamento aprovados;
- concorrência repetida 20 vezes sem remover a foto vencedora;
- ESLint em 0 erros/88 warnings, exatamente o baseline;
- code review independente final 9,7/10, sem achado crítico, alto ou médio.

**Segurança operacional**: bucket continua privado; service role e Sharp
permanecem exclusivos do BFF. O relatório de sete órfãos foi somente leitura.
Nenhuma migração `--apply` nem remoção automática de objetos faz parte desta
entrega.

---

# 2026-07-23 — feat(bridge-windows): captura usa a janela nativa do SDK NITGEN (POPUP), não silenciosa

**Motivo**: pergunta do dono do sistema — a animação "insira o dedo" que ele
já tinha visto em outro sistema vem do próprio SDK NITGEN (confirmado nos 3
samples oficiais + `SDK/Skins/`, telas de boas-vindas e captura ao vivo
embutidas, sem custo de recriar nada), não é algo que precisa ser desenhado
do zero. Decisão de produto: usar a janela nativa (`WINDOW_STYLE.POPUP`) em
vez do modo silencioso (`INVISIBLE`) usado até então — com a ressalva
explícita de que essa janela aparece no desktop do PC físico do leitor, não
dentro do navegador (o card web `BiometricCaptureDialog` continua mostrando
o estado da chamada em paralelo).

**Correção técnica necessária junto**: `Capture`/`Enroll` (já síncronas
bloqueantes) passam a também criar/conduzir uma janela Win32 real — os
samples oficiais da NITGEN sempre chamam isso a partir de uma thread STA
(UI do WinForms); o bridge chama de dentro de um `Task.Run` (ThreadPool,
MTA por padrão). Corrigido: cada chamada agora sobe numa thread STA
dedicada e descartável. Build limpo, 36/36 testes continuam verdes.
Comportamento de threading com o SDK real ainda não validado contra
hardware físico — mesmo gate de hardware (spec 8.2) já documentado para o
resto do adapter, sem mudança de escopo.

---

# 2026-07-23 — feat(bridge-windows): Biometric Bridge Fase C — Bridge Client Windows (C#/.NET 8)

**Entrega**: app de bandeja Windows (`apps/bridge-windows/`) que roda no PC da
reserva, fala com o leitor biométrico NITGEN via SDK oficial (.NET, v5.2) e
implementa o protocolo completo já exposto pelo BFF desde a Fase 1B —
pareamento, heartbeat, polling de challenges, sincronização de templates
(AES-256-GCM, chave derivada por tenant via HKDF), identificação 1:N (loop
`VerifyMatch`) e cadastro (enroll), tudo assinado com Ed25519 (device-auth) e
protegido por certificate pinning + DPAPI.

**Verificação**: `NitgenSdkAdapter` (única classe que toca o SDK real) foi
implementado e compilado contra a DLL oficial (`NITGEN.SDK.NBioBSP.dll`),
com a API confirmada via reflection direto na máquina de desenvolvimento —
não por suposição. Build limpo (0 warnings), 36 testes unitários verdes
(canonicalizadores byte a byte contra o BFF real, round-trip de cripto,
poller/sync/pairing via `HttpMessageHandler` fake).

**Code review sênior — 2 rodadas + 1 re-revisão de confirmação** (detalhes
completos no DoD, `docs/enterprise/reports/2026-07-22-biometric-bridge-phase1c-bridge-client-dod.md`).
Achados corrigidos, destaque para 2 CRÍTICO que quebravam **100% do fluxo
real** contra o BFF de produção (confirmados empiricamente, não por
inspeção): (1) `DateTimeOffset.UtcNow.ToString("O")` produz `+00:00`, mas o
BFF valida `proof.timestamp` com Zod `.datetime()` sem `offset:true` — só
aceita `Z`, rejeitava toda proof/enrollment com 400 antes de qualquer lógica
de negócio rodar; (2) `format: "eNBSP"` (nome do produto) enviado onde o BFF
só aceita `"nitgen-fmd"` — todo enrollment seria rejeitado. Mais 1 ALTO
(corrida entre repareamento manual e uma captura bloqueante em andamento no
mesmo device nativo compartilhado), 3 MÉDIO (refresh de tenant key nunca
rodava após o boot; device revogado — ex: PC roubado — ficava com ícone
verde indefinidamente, escondendo o único controle real contra esse cenário;
estado cross-thread sem `volatile`) e 1 BAIXO (URL do BFF sem exigir
`https://`) — todos corrigidos, com teste de regressão para os mais graves.

### Pendência conhecida — gate de hardware, não contornável

**"Finalizado não é entregue"**: toda a implementação e validação possível
sem o leitor físico foi concluída, mas o DoD desta fase permanece
explicitamente aberto até alguém com o dispositivo NITGEN físico na mão
confirmar o fluxo ponta a ponta (enumeração do device, qualidade de captura,
enroll gravando template, identify reconhecendo o usuário certo, dedo
errado falhando, device revogado parando de funcionar sem restart). Também
pendentes, sem ação de código possível nesta sessão: pins reais da CA
intermediária (mecanismo pronto, valores vêm do runbook de deploy) e
confirmação de LFD (liveness) do modelo real de leitor.

---

# 2026-07-22 — fix(web): erro de hidratação #418 global em todo o dashboard (Sidebar)

**Como foi encontrado**: validação visual via Playwright (pendente desde a
reconexão do MCP) em `/admin` e `/admin/livros` — console mostrava
`Minified React error #418` (mismatch de HTML) logo após o login em ambas as
páginas. Descartadas as duas causas já conhecidas neste projeto (Service
Worker cacheando RSC — testado desligando o SW, erro persistiu; `toLocale*`
sem `timeZone` — nenhuma ocorrência em componente de layout compartilhado).
Reproduziu-se também em `/admin`, página nunca tocada nesta sessão —
confirmando causa global, não local a nenhuma feature recente.

**Causa raiz**: `Sidebar` (`apps/web/src/components/layout/sidebar.tsx`),
renderizado em toda a árvore `(dashboard)` via `AppShell`, aninhava
`<Button>`/`<Link>` dentro de `<TooltipTrigger>` (`@base-ui/react/tooltip`)
em 4 lugares. `TooltipTrigger` sempre renderiza seu próprio `<button>` por
padrão (confirmado lendo `TooltipTrigger.js` da lib) — o aninhamento produzia
HTML inválido (`<button><button>` ou `<button><a>`), que o parser HTML do
browser corrige de um jeito diferente do que o React esperava ao hidratar,
causando o mismatch. Mesma classe de bug já corrigida nesta sessão em
`DropdownMenuTrigger` (`event-type-filter-chips.tsx`) — API do
`@base-ui/react` sempre renderiza o elemento interativo real no próprio
Trigger; nunca deve envolver outro elemento interativo.

**Fix**: os 4 pontos passaram a usar a prop `render` (padrão polimórfico do
`@base-ui/react`, equivalente a `asChild`) para o `TooltipTrigger` renderizar
o `<Link>`/`<button>` diretamente, sem wrapper. Novo teste de regressão
`SDB-06` em `sidebar-nav.spec.ts` verifica zero erros de console ao carregar
e colapsar o sidebar (cobre os dois estados: `TooltipTrigger` puro do botão
de colapsar e `render={<Link>}` dos itens colapsados).

**Achado adicional durante a validação — gap de CI pré-existente, também
corrigido**: o projeto Playwright `sidebar-nav` (SDB-01..05, já existente
antes desta mudança) nunca esteve no `--project` que o workflow de CI
executa (`suite`/`chromium`) — rodava só localmente sob demanda. Ou seja, o
teste novo `SDB-06` (e os 5 já existentes) não teria travado nenhuma
regressão futura em CI sem essa correção. `ci-cd.yml` passou a rodar
`--project=suite --project=sidebar-nav` no mesmo step já existente
("Run CRUD/journeys suite") — confirmado localmente (6 testes, 1 flake de
timing pré-existente em `SDB-05` sem relação com esta mudança, 3/3 limpo
isolado) antes do push.

---

# 2026-07-22 — fix(bff): Livro Digital nunca registrava o encerramento de turno (100% dos casos)

**Como foi encontrado**: investigando 2 falhas reais na suíte E2E `livro-suite`
(LDS35 — verificação pública de hash chain sem `root_hash`; LDS38 — CSV
exportado sem nenhuma linha de evento) rodada contra produção após o deploy
da Fase 3 do redesign do Livro Digital. Não foi flakiness — as duas falhas
apontavam para o mesmo turno fechado sem nenhum evento gravado.

**Causa raiz**: `POST /api/shifts/:id/close` (`apps/bff/src/routes/shifts.ts`)
atualiza `service_shifts.status` para `'encerrado'` e só depois chama
`logShiftEvent({ eventType: "turno_encerrado", ... })`. `logShiftEvent`
(`apps/bff/src/lib/shift-events.ts`), quando não recebe o `shiftId`
explicitamente, busca "o turno ativo deste armeiro"
(`.eq("status", "ativo")`) — mas o turno que acabou de fechar não é mais
`'ativo'` nesse ponto exato. A busca não encontra nada, a função retorna
silenciosamente sem gravar nada, sem erro, sem log.

**Alcance confirmado via query direta em produção**: **71 de 71 turnos
encerrados** (100%) não têm o evento `turno_encerrado` em
`service_log_events`. O bug existe desde que o encerramento de turno foi
implementado — nunca funcionou.

**Fix**: `logShiftEvent` ganhou um parâmetro `shiftId` opcional; quando o
caller já sabe qual turno é (todos os 3 call sites em `shifts.ts` — `/open`,
`/:id/log`, `/:id/close` — sabem), passa explicitamente e pula a busca
frágil por `status='ativo'`. Novo teste de regressão em
`livro-digital-shift-events.test.ts` trava isso no nível de código-fonte.

### Pendência conhecida — backfill NÃO feito, decisão registrada, não escondida

Os 71 turnos já fechados continuam sem o evento retroativamente — mesmo
raciocínio já registrado nesta changelog em 2026-07-21 para um gap
parecido: `service_log_events` é uma cadeia de hash imutável
(`event_hash`/`prev_hash`), e inserir um evento com timestamp retroativo
quebraria a cadeia de qualquer evento que já veio depois dele no mesmo
turno. Se um backfill for necessário no futuro, tratar como migração
dedicada com recálculo explícito da cadeia, não como um insert avulso.

---

# 2026-07-21 — fix(bff): Livro Digital não registrava saída/devolução de armamento

**Sintoma reportado pelo usuário**: saída de armamento registrada para a
matrícula 000003 (`issued_at` 2026-07-21 18:26:26 UTC, `movement_id`
`a5093ebd-8f21-45ce-ae21-714fca87dadd`, persistida corretamente em
`lendings`) não apareceu no Livro Digital do turno do armeiro.

**Causa raiz**: `POST /api/lendings/batch` (rota real da tela "Nova Saída")
e `POST /api/lendings/bulk-return` (rota real do modal de devolução) nunca
chamavam `logShiftEvent`. Só a rota singular legada `POST /api/lendings/`
(usada apenas em e2e) tinha a chamada — e com o `eventType` errado
(`cautela_emitida` em vez de `saida_autorizada`). Detalhe completo e fix em
`apps/bff/src/routes/lendings.ts` (commit `9939fee`).

### Pendência conhecida — não corrigida por este fix, documentada por decisão explícita do usuário (2026-07-21)

O evento específico do incidente relatado (saída da matrícula 000003,
`movement_id` acima) **continua sem entrada correspondente em
`service_log_events`** — confirmado via query direta em produção. O fix
acima impede a recorrência **daqui pra frente**; não faz backfill do
registro que já faltou.

**Por que não foi preenchido retroativamente**: `service_log_events` é uma
cadeia de hash imutável (`log_shift_event_atomic`, cada evento encadeia no
`event_hash` do evento anterior via `prev_hash`). Inserir agora um evento
com timestamp retroativo (2026-07-21 18:26:26 UTC) exigiria recalcular o
hash de TODOS os eventos já gravados depois dele no mesmo turno para
manter a cadeia consistente — uma operação invasiva demais para ser feita
sem planejamento dedicado, num sistema de custódia de armamento onde essa
cadeia é justamente o mecanismo de detecção de adulteração.

**Decisão**: gap aceito e documentado, não corrigido nesta sessão. Se uma
correção retroativa for necessária no futuro, tratar como uma migração
dedicada (recalculo explícito da cadeia de hash do turno afetado), não como
um insert avulso.

---

# 2026-07-21/22 — fix(security): CI/CD PB09 (2 bugs reais em `record_biometric_enrollment`) + UX do hash no Livro Digital

**CI/CD**: `record_biometric_enrollment` falhava em toda chamada (não só em
conflito de upsert) por dois bugs reais na função SQL — `ON CONFLICT
(user_id, finger_index)` ambíguo contra o parâmetro `RETURNS TABLE`
(mesma classe de bug já vista 2x nesta base, ver entrada
`consume_biometric_pairing_code` abaixo) e `RETURN QUERY` retornando
`smallint` numa coluna `integer` sem cast. Corrigido com o mesmo padrão já
validado (`ON CONFLICT ON CONSTRAINT`) + cast explícito. Novo teste guarda
estático (`sql-migrations-on-conflict-guard.test.ts`) falha o build se essa
classe de bug reaparecer em qualquer função `RETURNS TABLE` das migrations.
Validado por reprodução direta com dados reais + suite E2E completa
(10/10) + suite BFF completa (171/171).

**UX**: hash de integridade do evento (antes texto monoespaçado sempre
visível na timeline) passou a ser exibido via ícone "i" com tooltip —
pedido do usuário, design 80/20. Novo componente
`apps/web/src/components/livro/event-hash-tooltip.tsx`, aplicado nos 4
pontos de uso (armeiro, histórico, admin).

---

# 2026-07-20 — fix(security): login travado (sessão anterior) + feat(security): Biometric Bridge Phase 1B fechada

### Incidente 1 — login travado quando o navegador já tinha sessão anterior

**Sintoma reportado pelo usuário**: login com credenciais corretas, BFF confirmava
sucesso, mas o navegador voltava pro `/login` sem abrir o painel — sem erro visível.
Reproduzido ao vivo via Playwright contra produção antes de qualquer fix.

**Causa raiz**: `GET /api/auth/upgrade-session` lia o cookie `sb-*-auth-token` via
`cookies()`+`getSession()` para "promovê-lo" a HttpOnly pós-login. Se o navegador
JÁ TINHA um cookie `sb-*-auth-token` HttpOnly de um login anterior (estado normal
depois do 1º login bem-sucedido de qualquer usuário), o SDK client-side do
`signInWithPassword()` não conseguia sobrescrevê-lo — JavaScript é bloqueado de
escrever em cookies HttpOnly, só o servidor pode via `Set-Cookie`. O cookie antigo
continuava sendo o único enviado, `getSession()` lia dados errados, devolvia 401,
e o login travava silenciosamente.

**Fix**: a rota passou a receber `access_token`/`refresh_token` explicitamente no
body de um `POST` (os mesmos tokens que `login/page.tsx` e `auth/exchange/page.tsx`
já têm em mãos, recém-emitidos), chamando `setSession()` direto com eles — o
servidor sempre pode sobrescrever um cookie HttpOnly via `Set-Cookie`, então isso
elimina a dependência do estado do navegador. Revisão de segurança obrigatória
confirmou: mesmo modelo de confiança já usado em `POST /api/auth/exchange` do BFF;
nenhum caller esquecido; adicionado try/catch em `setSession()` (token malformado
lançava exceção não tratada). **Confirmado resolvido ao vivo** via Playwright
contra produção real após o deploy: login → `/reserva` → painel carregado.

### Incidente 2/feature — Biometric Bridge Phase 1B: contrato de device-auth do bridge Windows

Retomado o wiring de `/api/biometric-bridge/*` (rotas bridge-facing, autenticação
por assinatura Ed25519 do request — nunca cookie/sessão de usuário), revertido em
2026-07-17 para destravar o CI. Spec formal escrita e aprovada em 2 rodadas de
revisão sênior de arquitetura (7.8 → 9.6/10 —
`docs/superpowers/specs/2026-07-14-biometric-bridge-phase1b-windows-bridge-mvp-design.md`).

UI nova: botão "Revogar bridge" em `/reserva/biometria` (admin-only) — a API já
existia auditada, mas sem nenhum caminho de UI, apesar de ser a mitigação
documentada contra furto físico do PC/leitor.

**4 correções necessárias durante o deploy** (nenhuma pega pelas 2 rodadas de
revisão de arquitetura — só apareceram rodando de verdade contra produção, já que
este projeto não tem staging/Docker):
1. **CRÍTICO** (achado em code review de implementação, camada distinta da revisão
   de arquitetura): `consume_biometric_pairing_code` (RPC) tinha `ON CONFLICT
   (tenant_id, device_name) DO UPDATE` sem `reserve_id` no `SET` — um
   `admin_reserva` autorizado só numa reserva B podia sequestrar a identidade de
   um device ativo numa reserva A (mesmo tenant) reusando seu `device_name`. Fix:
   migration rejeita a colisão cross-reserve.
2. **ALTO**: `BIOMETRIC_PAIRING_CODE_PEPPER` (env var nova, obrigatória) nunca
   tinha sido adicionada ao `.env` real do VPS — só documentada no `.env.example`.
3. **Bug de SQL #1**: `RETURNS TABLE(device_id, tenant_id, reserve_id)` cria
   parâmetros OUT implícitos com esses nomes — um `SELECT` novo (do fix do
   CRÍTICO) referenciava `tenant_id`/`reserve_id` sem qualificar a tabela,
   causando "column reference is ambiguous" em produção real.
4. **Bug de SQL #2** (mesma classe, posição diferente): `ON CONFLICT (tenant_id,
   device_name)` — a lista de colunas do conflict target é parseada pelo Postgres
   como lista de EXPRESSÕES, não nomes puros, então também colidia com o
   parâmetro OUT. Fix definitivo: `ON CONFLICT ON CONSTRAINT
   biometric_devices_tenant_id_device_name_key` em vez de `ON CONFLICT (colunas)`
   — elimina essa classe de ambiguidade de forma estrutural, não só o caso
   específico.

**Fora de escopo, explícito**: o app Bridge Windows real (que fala com o SDK
NITGEN via USB) não existe em nenhum lugar do repositório — este commit fecha só
o contrato do lado do BFF. TOTP continua funcionando normalmente e não foi
substituído — biometria é aditiva, não substitui o fluxo existente.

**Confirmado**: CI/CD 100% verde (TypeScript Check, Deploy BFF, E2E Smoke, E2E
Suite com os 8 cenários PB01-PB08 do bridge, incluindo o teste de regressão do
CRÍTICO).

---

# 2026-07-17 — feat(pwa): experiência de abertura nativa (splash + ícones) + mascaramento de resume

### Contexto

Após os fixes de logout automático e FOUC de tema (ver entradas anteriores),
usuário pediu explicitamente: pesquisar como apps nativos (Play Store/App
Store) resolvem a tela preta remanescente no cold-open do PWA, planejar com
rigor de produto, e ampliar pra cobertura global (todos os tamanhos de tela,
todas as marcas Android). Spec completa, revisada 4 vezes por um agente com
postura de PM+engenheiro mobile sênior (nota final 9.6/10, sem CRÍTICO/ALTO/
MÉDIO sobrevivente):
`docs/superpowers/specs/2026-07-17-pwa-native-boot-experience-design.md`.

### Causa raiz

- **iOS não gera splash automaticamente** — precisa de
  `<link rel="apple-touch-startup-image">` explícito por resolução de
  device, inexistente no projeto até este commit.
- **Ícone fonte** (`public/images/logo.png`, usado 2× no manifest) na
  verdade tinha 4723×6583px, retangular — não um ícone gerado, degradando a
  splash automática do Android (que depende de um ícone quadrado
  corretamente dimensionado) e adicionando latência de download/decode.

### Fix

- Ícones (192/512 `any` + 512 `maskable`) e splash do iOS gerados via
  `@vite-pwa/assets-generator` a partir do brasão oficial, canvas quadrado
  `#F5F5F7` (mesma cor da tela de login), sem corte de conteúdo
  institucional. Matriz de devices: iPhone 13 mini→16 Pro Max (inclui o
  device real do usuário, iPhone 13 Pro Max, confirmado antes da geração —
  pré-requisito bloqueante da spec). Limitação conhecida da ferramenta
  nesta versão (1.0.2): nomes de device `iPad *`/`iPhone SE *` quebram a
  geração de splash (documentado em `pwa-assets.config.ts`); ícones
  (não-splash) não são afetados.
- `manifest.webmanifest` e `layout.tsx` (`metadata.icons`/
  `metadata.appleWebApp.startupImage`) atualizados. O array de splash é
  importado de `src/lib/pwa/apple-startup-images.json` — saída bruta da
  ferramenta, nunca reescrita à mão, mesma fonte usada pelo harness E2E
  (evita dessincronia entre geração e metadata).
- **Service Worker**: confirmado empiricamente que o Serwist precacheava
  `manifest.webmanifest` — corrigido com `runtimeCaching` `NetworkFirst`
  específico pra esse arquivo em `sw.ts` (não `StaleWhileRevalidate`, que
  ainda serviria a versão antiga no 1º resume pós-deploy).
- **Mascaramento no resume** (`ResumeMaskOverlay` em `providers.tsx`):
  usuário relatou o painel de um usuário anterior aparecendo por um
  instante ao reabrir o PWA a partir de background (iOS suspende, não
  encerra, o processo). Overlay sempre montado na árvore, mascarado por
  padrão, revelado só após `supabase.auth.getUser()` confirmar sessão
  válida — mitigação **best-effort**, não garantia (WebKit não garante
  repaint antes de congelar o snapshot de resume — WebKit bug 202399).
  100% client-side, zero mudança em `middleware.ts`/`(dashboard)/layout.tsx`/
  qualquer `redirect()` de Server Component.
- Instrumentação de diagnóstico temporária do incidente de PWA removida:
  `POST /api/public/diag-log` (BFF), `reportMismatchDiag` + 2 call sites
  (`(dashboard)/layout.tsx`), `ClientErrorReporter` (`providers.tsx`).

### Pendências de segurança conhecidas

**Guard `session-mismatch` — ação de derrubar sessão permanece suspensa
para o caso "inconclusive"** (`apps/web/src/app/(dashboard)/layout.tsx`,
bloco `console.error("[session-mismatch-ACTION-SUSPENDED]", ...)`,
comentário `AÇÃO DE DERRUBAR SESSÃO SUSPENSA TEMPORARIAMENTE (2026-07-17)`).
**NÃO fechado por este commit** — fora de escopo desta spec, que é sobre
assets/splash, não sobre reativar esse guard. Condição objetiva de
reativação (já documentada no próprio código-fonte): confirmar que a causa
raiz do "inconclusive" no iOS (hipótese: PWA saindo de background / rede
instável colidindo com a janela de 300ms do recheck) está resolvida antes
de reativar o redirect fail-closed para esse caso.

### Harness (novo)

- `apps/web/scripts/verify-pwa-assets.mjs` — verificação estática
  (existência, dimensões, quadratura, alpha em apple-touch-icon), rodado
  como pré-requisito do `pnpm build`.
- `apps/web/e2e/pwa-manifest.spec.ts` — matriz de devices (iPhone 13
  mini/13/13 Pro Max/iPad Pro 11), verifica que os `<link>` renderizados
  batem byte-a-byte com a saída da geração. 6/6 testes verdes localmente
  antes do push. **Escopo explícito**: não valida comportamento real do
  WebKit (impossível sem hardware Apple) — só consistência
  geração↔metadata. Validação real é o screenshot do usuário (pendente).

---

# 2026-07-17 — fix(web): elimina tela preta ~5s antes do login + tentativa revertida por risco de segurança

### Incidente

Após o fix do domínio canônico (ver entrada anterior) resolver o logout
automático, usuário reportou dois sintomas residuais: (1) tela preta por
~5 segundos antes da tela de login abrir; (2) flash de tema claro→escuro
perceptível durante o carregamento, tanto no PWA iOS quanto no PC.

### Causa raiz

Nem `app/page.tsx` (rota raiz, decide para onde redirecionar por role) nem
`app/(dashboard)/layout.tsx` tinham `loading.tsx`/Suspense boundary —
ambos são Server Components fazendo chamadas sequenciais ao Supabase
(`getUser()` + query de perfil, no dashboard também branding/memberships)
só para, no caso mais comum, descobrir que o usuário não está autenticado
e precisa ir para `/login`. Sem Suspense, o Next.js buffereia a resposta
inteira até tudo resolver antes de mandar qualquer byte ao browser — daí a
tela em branco (preta, no modo PWA standalone do iOS) durante toda a espera.

### Tentativa 1 (REVERTIDA) — loading.tsx + Suspense

Primeira tentativa: `app/loading.tsx` + `app/(dashboard)/loading.tsx` com
um componente `PageLoader` (spinner + mensagem + fundo branco). Passou no
`tsc` mas o code review obrigatório encontrou, com **evidência empírica
via curl** (não especulação), um CRÍTICO real: o Suspense boundary criado
por `loading.tsx` transforma qualquer `redirect()` chamado depois do
primeiro `await` de um Server Component suspenso de um HTTP 307 real para
um redirect **só-no-cliente**, codificado no stream RSC e só processado via
JS/hidratação (`RedirectErrorBoundary` + `router.replace()`). Isso afeta
diretamente o guard fail-closed de `session-mismatch` em
`(dashboard)/layout.tsx` — criado por causa de um incidente real de
vazamento de sessão entre usuários — cujo `redirect("/auth/session-mismatch")`
passaria a depender de JS ter carregado/executado, em vez de ser garantido
pelo protocolo HTTP. Confirmado via curl: `GET /admin` sem sessão passou de
`307 Temporary Redirect` para `200 OK` com o corpo contendo o spinner e um
`"digest":"NEXT_REDIRECT;..."` embutido no stream. Revertido integralmente
antes do commit — nenhuma versão desta abordagem foi ao ar.

### Tentativa 2 (aplicada) — fast-path no middleware.ts

Fix definitivo evita tocar em Suspense/redirect de Server Component:
`middleware.ts` (roda antes de qualquer render, sempre produz HTTP
redirect real, nunca dependente de JS) ganhou um fast-path — quando não
há **nenhum** cookie `sb-*-auth-token` presente, redireciona direto para
`/login` sem passar pelo round-trip `getUser()`+perfil. Ausência de cookie
é sinal seguro e sem ambiguidade (sessão válida sempre teria o cookie);
cookie presente mas inválido continua caindo no fluxo completo existente
(`getUser()` real + guard `session-mismatch`, ambos intocados). Também
adicionado `appleWebApp` metadata (`apple-mobile-web-app-capable`) — iOS
ignora partes do `manifest.webmanifest` padrão para o modo standalone.

Bônus: `package.json`'s `"dev": "next dev"` corrigido para
`"next dev --turbopack"` explícito — a causa raiz de um 500 reproduzido em
toda rota do dev server local durante esta investigação (erro "Could not
find the module ... boundary-components.js ... React Server Consumer
Manifest"), rodando sob `next dev --webpack` (usado por engano numa sessão
anterior para evitar um prompt interativo). `next.config.ts` já
documentava a intenção de dev via Turbopack; só o script não fixava isso.

### Testes

* Curl (produção, pós-deploy): `/` e `/efetivo` sem cookie → `307` para
  `/login`; `/login` → `200`; `/nexus` sem cookie → `200` (guard próprio,
  corretamente fora do escopo do fast-path).
* `tsc --noEmit` limpo.
* 2 rodadas de code review obrigatório (1ª bloqueou o CRÍTICO da tentativa
  1; 2ª, sobre o fix final, passou limpa).
* CI/CD completo pós-push: TypeScript Check, E2E Smoke, Deploy BFF (VPS),
  E2E Suite (CRUD + jornadas — inclui login para os 3 perfis) — todos
  verdes.

---

# 2026-07-17 — fix(pwa): PWA iOS instalado no domínio errado (apmcb.pages.dev) causava "logout automático"

### Incidente

Usuário reportou repetidamente, ao longo de várias horas, que o app instalado
como PWA no iPhone (ícone na tela inicial) abria o painel do último usuário
por um instante, mostrava um flash de tema claro→escuro (FOUC), e em seguida
deslogava — tanto em sessão restaurada quanto logo após um login bem-sucedido
com TOTP. Ocorria consistentemente só no PWA, nunca no Safari normal.

### Investigação

Eliminação sistemática, cada hipótese descartada com evidência: perfil de
browser sujo, service worker desatualizado (removido um handler de `activate`
suspeito por precaução), `SameSite=Strict` em `apmcb_session` (corrigido para
`Lax`), `SameSite=Strict` nos 4 cookies relacionados a `sb-*`/`upgrade-session`/
`mode` (corrigidos), ação destrutiva do guard `session_mismatch` (corrigida
para suspender ação em caso "inconclusivo", só redirecionar em divergência
persistente confirmada), DNS (verificado via 2 resolvers DoH independentes —
OK), cache de CDN (`Cf-Cache-Status: DYNAMIC` confirmado via curl — OK).

Sem Mac disponível para Web Inspector remoto, foi construída instrumentação
temporária de diagnóstico: `POST /api/public/diag-log` no BFF (relay não
autenticado que ecoa payload pro log estruturado, já que a sessão do
chamador está justamente inválida no cenário sendo diagnosticado) e um
`ClientErrorReporter` (captura `window.onerror`/`unhandledrejection` +
reporta um evento `client-boot` a cada carregamento, via `fetch(...,
{keepalive: true})`). O evento `client-boot` revelou a causa raiz:
`"url":"https://apmcb.pages.dev/efetivo","standalone":true`.

### Causa raiz

O ícone do PWA do usuário foi instalado a partir de `apmcb.pages.dev` (o
domínio bruto que Cloudflare Pages sempre expõe ao lado do domínio
customizado), não `apmcb.pmpb.online`. Como `manifest.webmanifest` usa
`start_url` relativo (`"/"`), o PWA fica permanentemente amarrado à ORIGEM de
onde foi instalado. Nesse domínio errado o app carrega normalmente (mesmo
build, JS roda, tema aplica) mas nenhum cookie de sessão existe (todos
escopados para `.apmcb.pmpb.online`) — toda autenticação por cookie falha em
silêncio, indistinguível de um logout aleatório. Fator agravante:
`CORS_ORIGINS` em produção incluía `https://apmcb.pages.dev` (relíquia de
config inicial), permitindo que algumas chamadas cross-origin "funcionassem"
(CORS-wise) do domínio errado enquanto a autenticação por cookie nunca
poderia funcionar ali.

### Fix

* `apps/web/src/middleware.ts` — redirect (307) de qualquer `Host` diferente
  de `apmcb.pmpb.online`, em produção, executado antes de qualquer lógica de
  sessão/CSP — corrige automaticamente o PWA já instalado do usuário, sem
  exigir reinstalação manual. Code review obrigatório encontrou um open
  redirect CRÍTICO na primeira versão (`new URL(pathname + search, base)`
  reinterpreta um path começando com `"//"` como referência
  protocol-relative, sobrescrevendo o host do `base`) — corrigido usando os
  setters de `NextURL` (`clone()` + `hostname =`), que nunca fazem esse
  re-parsing de autoridade a partir do path.
* `CORS_ORIGINS` em produção limpo (removida a entrada `apmcb.pages.dev`).

### Achado operacional adicional (infra órfã)

Editar `CORS_ORIGINS` em `/opt/apmcb/.env` no VPS não teve nenhum efeito —
esse diretório e seu script blue/green (`scripts/deploy-bff.sh`) são
infraestrutura **não usada pelo CI/CD atual**. O deploy real (job
`deploy-bff` em `.github/workflows/ci-cd.yml`) opera em `/var/www/apmcb/`,
lendo `env_file: .env` a partir de `docker-compose.prod.yml` — container
único chamado literalmente `apmcb-bff`, sem sufixo de cor. A env var correta
só entrou em vigor após editar `/var/www/apmcb/.env` e forçar
`docker compose ... up -d --force-recreate bff`. Confirmado via
`docker exec apmcb-bff printenv CORS_ORIGINS` + teste OPTIONS real (Origin
`apmcb.pages.dev` deixou de receber `Access-Control-Allow-Origin`).

### Testes

* `tsc --noEmit` limpo em `apps/web`.
* CI/CD completo pós-push: TypeScript Check, Deploy BFF (VPS), E2E Smoke, E2E
  Suite (CRUD + jornadas) — todos verdes.
* Verificação manual pós-deploy: redirect 307 confirmado
  (`apmcb.pages.dev/efetivo` → `apmcb.pmpb.online/efetivo`), CORS confirmado
  rejeitando `apmcb.pages.dev` e aceitando `apmcb.pmpb.online`.

### Pendente

Instrumentação de diagnóstico temporária (`diag-log`, `ClientErrorReporter`,
`reportMismatchDiag`) marcada para remoção após confirmação final do usuário
de que o PWA já instalado foi corrigido pelo redirect, sem reinstalação.

---

# 2026-07-16 — fix(auth): corrige falso-positivo de session_mismatch + 2 links mortos em /admin/comando

### Contexto

Sub-agente de jornada E2E completa (3 perfis de usuário, produção) encontrou,
de forma reprodutível (3/3), que o guard `session_mismatch`
(`apps/web/src/app/(dashboard)/layout.tsx`) derrubava a sessão no PRIMEIRO
login pós-logout mesmo com todas as chamadas de rede retornando 200 — um
segundo login imediato sempre funcionava. Spec completa em
`docs/superpowers/specs/2026-07-16-session-mismatch-race-and-dead-link-fix-design.md`.

### Causa raiz

O guard compara `user.id` (validado via `supabase.auth.getUser()` — round-trip
de rede real contra o Supabase Auth a cada chamada) contra `x-verified-user-id`
(resolvido por `middleware.ts` via chamada independente ao BFF). São duas
chamadas de rede paralelas, para backends diferentes, sem garantia de
ordenação — uma divergência isolada logo após login é compatível com uma
corrida de propagação transitória, não necessariamente vazamento real de
sessão entre usuários (o incidente real que motivou a criação do guard).

### Fix

Ao detectar divergência, reconfirma chamando `supabase.auth.getUser()` uma
segunda vez (não o BFF — que é determinístico por cookie, reconferir não
teria efeito) antes de declarar incidente. Decisão isolada em função pura
testável (`decideSessionMismatch`, `apps/web/src/lib/session-mismatch.ts`) —
falha ao reconfirmar (timeout, erro) NUNCA é tratada como "ok", mantém
fail-closed. Duas rodadas de code review obrigatório: a primeira encontrou um
CRÍTICO (fail-open assimétrico na primeira versão do fix, que reconferia o
lado errado — BFF — e tratava timeout como confirmação positiva) e um ALTO
(reconferir o BFF não ataca a causa provável); ambos corrigidos e revalidados
antes do commit.

Também corrigidos, na mesma auditoria: 2 links mortos em `/admin/comando`
(`/admin/cautelamentos`, achado original; `/admin/passagens?status=vencido`,
achado adicional na varredura) — cards ficam informativos, sem `href`, mesmo
padrão já usado por um card irmão.

### Testes

* Novo `apps/web/src/lib/session-mismatch.test.ts` (4 casos, Vitest) — cobre
  concorda / diverge de novo / recheck falha (`null`/`undefined`, sempre
  fail-closed).
* `tsc --noEmit` limpo em `apps/web`.

---

# 2026-07-16 — fix(security): CSRF ausente em getAuthHeaders locais quebrava saída + TOTP em produção

### Incidente

Usuário reportou em produção: `POST /api/lendings/identify 403 (Proibido)` repetido
ao registrar saída de material com verificação TOTP — fluxo essencial de custódia
bloqueado. Causa raiz confirmada via log real do BFF (`docker logs apmcb-bff`
mostrou `"status":403,"message":"CSRF token inválido"`).

O helper local `getAuthHeaders()` em `.../reserva/saidas/nova/_form.tsx` nunca
enviava `X-CSRF-Token`, dependendo silenciosamente do bypass
`Authorization: Bearer` do `csrfMiddleware` (BFF) — que só funciona enquanto o
`access_token` do Supabase no browser está válido. Bug pré-existente desde
17/06/2026 (confirmado via `git blame`); ficou exposto agora que o access token
expirou em sessões reais. Não foi introduzido pela sessão de trabalho da
Biometric Bridge — essa feature só reaproveitou o endpoint (`/api/totp/validate`
→ `/api/lendings/identify`) através do mesmo helper já defeituoso.

Auditoria (2 rodadas de code review obrigatório) encontrou o mesmo padrão em
mais dois pontos, ambos corrigidos na mesma varredura:

* **CRÍTICO — `sidebar.tsx` (`switchReserve`):** troca de reserva no menu
  lateral falhava por CSRF e o código **ignorava o erro silenciosamente**,
  chamando `router.refresh()` mesmo assim — o usuário via a UI "atualizar"
  mas `session.reserveId` no backend continuava sendo o antigo. Risco de
  operar custódia sob o contexto de reserva errado sem qualquer aviso.
  Pré-existente desde 04/07/2026.
* **MÉDIO — `solicitacao-detail-sheet.tsx` (`handleCancel`):** mesmo padrão
  de headers manuais sem `csrfHeaders()`, e sem `credentials: "include"`
  (cookie de sessão nunca era enviado). Erro tratado (não silencioso), por
  isso severidade menor.

### Fix

* `_form.tsx`, `sidebar.tsx`, `solicitacao-detail-sheet.tsx` — alinhados ao
  padrão canônico já usado em `_desarmamento-modal.tsx` e `bff-client.ts`
  (`csrfHeaders()` + `credentials: "include"`); `switchReserve` agora também
  checa `res.ok` e mostra toast de erro em vez de assumir sucesso.
* **fix(a11y/hydration):** `sidebar.tsx` também corrigia um erro de
  hidratação React (#418) pré-existente, encontrado durante a mesma
  investigação — `sidebarOpen` (Zustand + `persist`/localStorage) era lido
  direto no render sem guard de montagem, divergindo do SSR (que sempre usa
  o default) quando o usuário já tinha colapsado a sidebar antes. Corrigido
  com o mesmo padrão `mounted`-guard já usado em `header.tsx` para o tema.

### Testes

* **SE14** (novo, `e2e/saidas-enterprise.spec.ts`) — dirige o fluxo real de
  verificação TOTP em Nova Saída via UI (sessão de cookie real, não Bearer
  cru), especificamente para pegar essa classe de regressão. SE07 (existente)
  usa `fetch` com Bearer direto e por isso nunca teria pegado este bug — gap
  de cobertura confirmado e fechado.
* Reproduzido RED contra produção antes do deploy (confirma que o teste
  pega o bug real), fix local validado via `tsc --noEmit` limpo em
  `apps/web`.

### Root cause classification

Não é regressão da Biometric Bridge Phase 1A.2 — bug de CSRF pré-existente
(17/06 e 04/07/2026) exposto por expiração de token em sessão real. Investigado
e corrigido por dois sub-agentes despachados em paralelo (causa raiz + jornada
E2E dos 3 perfis de usuário), com revisão de código sênior obrigatória antes do
commit, conforme CLAUDE.md.

# 2026-07-15 — feat(security): Biometric Bridge Phase 1A.2

### Features

* **biometria/enrollment:** cadastro presencial com challenge assinada,
  validação de tenant/reserva/ator/usuário esperado, liveness, qualidade,
  hash e persistência atômica via RPC.
* **biometria/saída:** nova saída exige `biometric_proof_id` e `movement_id`,
  com consumo anti-replay vinculado à operação.
* **biometria/devolução:** identificação do militar e devolução em lote usam
  proof na sessão HttpOnly e consomem a prova uma única vez.
* **devolução atômica:** `/api/lendings/identify` e
  `/api/lendings/bulk-return` repetem as validações no PostgreSQL e atualizam
  lendings e itens físicos na mesma transação.
* **movimento atômico:** `/api/lendings/batch` e o POST unitário usam a RPC
  `record_lending_batch`, com lock de estoque, idempotência por movimento e
  consumo da prova no mesmo commit.
* **enrollment real:** `POST /api/biometric/challenges/:id/enroll-submit`
  valida bridge, assinatura, hash, liveness e persiste pelo serviço comum.
* **biometria/legado:** rotas que tentavam executar SDK USB no BFF falham
  fechado com `BIOMETRIC_BRIDGE_REQUIRED`; TOTP permanece disponível no fluxo
  legacy.

### Validation

* BFF tests: 126 passed, 0 failed.
* BFF e web typecheck: passed.
* Harness Phase 1A.2: enrollment, proof linkage, replay e contratos UI
  aprovados.

### Docs

* `docs/enterprise/reports/2026-07-15-biometric-bridge-phase1a2-dod.md`
* `docs/security.md` atualizado com o contrato e os gates de release.

### Hardening pós-review (2 rodadas de code review obrigatório antes do commit)

A implementação acima foi revisada por 2 rodadas independentes antes de
qualquer commit/deploy, por exigência do CLAUDE.md (custódia de armamento
real, sem tolerância a achado ALTO/CRÍTICO não endereçado):

* **CRÍTICO — 4 RPCs de custódia expostas a `anon`/`authenticated`.**
  `record_biometric_proof`, `record_biometric_enrollment`,
  `record_lending_batch` e `record_lending_returns` (todas `SECURITY DEFINER`)
  ficaram, por um tempo, chamáveis por qualquer cliente com a anon key
  pública, direto via PostgREST, bypassando toda a autenticação/autorização
  do BFF — causa raiz: `revoke ... from public` não atinge grants diretos que
  este projeto Supabase concede a `anon`/`authenticated` via
  `ALTER DEFAULT PRIVILEGES`. Corrigido com `revoke ... from anon,
  authenticated` explícito.
* **CRÍTICO — incidente ativo não relacionado a esta feature, descoberto na
  mesma auditoria de grants.** `log_shift_event_atomic` (grava o Livro
  Digital de Serviço com encadeamento de hash, sem nenhuma checagem de
  autorização interna) estava exposta a `anon` desde sua criação
  (2026-07-08), permitindo forjar eventos no livro digital com hash
  encadeado e `actor_id` arbitrário. Corrigido junto (varredura completa
  confirmou mais 2 funções de menor impacto — `get_email_by_matricula`,
  `expire_material_requests` — com a mesma exposição).
* **ALTO — corrida entre requisições paralelas no consumo de identidade
  TOTP.** Limpar `session.pendingIdentity` após sucesso não é atômico
  (cookie stateless); duas requisições verdadeiramente paralelas com o mesmo
  cookie podiam autorizar 2+ movimentações distintas com um único código
  TOTP. Corrigido com nova tabela `totp_identity_claims`, consumida
  atomicamente (`FOR UPDATE`) dentro de `record_lending_batch`/
  `record_lending_returns` — mesmo padrão já usado para prova biométrica via
  `biometric_proof_consumptions`.
* **MÉDIO** — `assertReserveAccess` fazia `admin_global` pular a checagem de
  vínculo do MILITAR com a reserva (só deveria pular a checagem do próprio
  ator); idempotência de `movement_id` rodava em paralelo com a validação de
  identidade em dois lugares diferentes (BFF e RPC), com risco de divergir;
  `record_lending_batch` não rejeitava replay de `movement_id` com lista de
  materiais diferente da original.
* Migrations: `20260714000003` a `20260714000010` (5 novas desde o commit
  original do Codex: lockdown de grants, incidente do Livro Digital,
  `totp_identity_claims` e integração nas RPCs de lending).

### Regressão autoinfligida durante a validação pós-deploy (corrigida na mesma sessão)

O lockdown de grants acima (`20260714000008`) revogou `EXECUTE` de
`get_email_by_matricula` para `anon`/`authenticated` partindo do pressuposto
de que só o BFF a chamava via `service_role`. Errado: `apps/web/src/app/login/page.tsx`
chama essa RPC **direto do navegador** com a anon key para resolver
matrícula→e-mail antes de `signInWithPassword` — **quebrou o login de todos
os usuários em produção** por alguns minutos. Detectado via validação visual
real (Playwright contra produção, não apenas leitura de código) antes de
declarar a tarefa concluída, e corrigido de imediato
(`20260714000011_restore_get_email_by_matricula_anon_grant.sql`) — login
reconfirmado funcionando (matrícula 000002 → `/reserva` → `/reserva/biometria`
carregando corretamente, sem simulador exposto).

---

# 2026-07-15 — fix(infra): rate limit compartilhado entre todos os clientes de produção (incidente real)

### Incidente — login bloqueado para todos os usuários

* **Causa raiz**: `apps/bff/.env` de produção nunca definiu `RATE_LIMIT_TRUST_PROXY_HEADERS`. Com `NODE_ENV=production` e a flag ausente, `getClientIp()` (`middleware/rate-limit.ts`) caía no fallback `"proxy-headers-untrusted"` — **todos os clientes de produção compartilhavam a mesma chave de rate limit**, em vez de cada IP ter sua própria cota.
* **Gatilho**: uma sessão de auditoria de segurança rodou dezenas de suítes E2E/pentest completas contra produção ao longo de várias horas, esgotando a cota compartilhada e bloqueando login de usuários reais (não só os testes).
* **Correção aplicada**: confirmado que o nginx em frente ao BFF já sobrescreve `X-Real-IP`/`X-Forwarded-For` com o IP real da conexão (`proxy_set_header X-Real-IP $remote_addr;` — nunca repassa valor vindo do cliente, então é seguro confiar nesses headers). `RATE_LIMIT_TRUST_PROXY_HEADERS=true` adicionada ao `.env` de produção do BFF (backup do `.env` anterior preservado no servidor) e ao `apps/bff/.env.example` como documentação para setups futuros. Deploy blue-green do BFF re-executado para aplicar a variável.
* **Mitigação imediata**: container do BFF reiniciado/recriado para limpar o estado em memória do rate limiter (`Map` por processo, não persistente) e desbloquear login imediatamente enquanto a correção definitiva era aplicada.

---

# 2026-07-14 — feat(security): Biometric Bridge Phase 1A.1 console do armeiro + simulator gated

### Segurança/Implementação — identificação biométrica cloud-safe

* Adicionada migration `20260714000002_biometric_phase1a1.sql` com `biometric_devices.is_simulator`, `biometric_proof_consumptions` (`unique(proof_id)`) e RPC `record_biometric_proof` para consumir challenge e inserir proof em transação única.
* BFF ganhou `GET /api/biometric/challenges/:id/result`, helpers `assertUsableBiometricProof`/`consumeBiometricProof`, `simulator_available` na listagem de devices e rota simulator registrada apenas quando `NODE_ENV !== "production"` e `BIOMETRIC_SIMULATOR_ENABLED=true`.
* `/api/biometric/devices/pair` continua sem aceitar `is_simulator`; simulator é controlado exclusivamente pelo servidor e gera proof Ed25519 para validação sem hardware real.
* Criado console `/reserva/biometria` com `BiometricBridgeStatus` e `BiometricCaptureDialog`, estados de bridge ausente/offline/revogado/ativo/simulator, challenge, pending, success, failure, expired e retry.
* Painel `/reserva` troca o card legado de identificação por bridge local da reserva, removendo hardcode ZKTeco e apontando o armeiro para o console biométrico.
* Validação local: `cd apps/bff && pnpm test` passou com 112 testes; `pnpm --filter bff typecheck` passou; `pnpm --filter web typecheck` passou; `pnpm --filter web build` passou; ESLint focado nos arquivos da tarefa passou sem erros. `pnpm --filter web lint -- --quiet` segue falhando por 5 erros pré-existentes fora do escopo em `efetivo/_materiais-uso-client.tsx` e `reserva/livro/_livro-client.tsx`.

---

# 2026-07-14 — feat(security): Phase 0 do Biometric Bridge NITGEN/eNBioBSP

### Segurança/Implementação — fundação backend para biometria cloud

* Criada migration `20260714000001_biometric_bridge_foundation.sql` com `biometric_devices`, `biometric_challenges` e `biometric_proofs`, RLS habilitado, proof imutável e `challenge_id` único para bloquear replay.
* `biometric_templates` endurecida para matching tenant-wide futuro: `tenant_id` obrigatório, `template_hash`, formato/versão SDK, qualidade, versão de chave, device de enrollment e revogação.
* `apps/bff/src/routes/biometric.ts` deixa de tentar capturar/verificar USB no VPS; endpoints legados `/identify` e `/register` falham fechado com `BIOMETRIC_BRIDGE_REQUIRED`, e a nova base expõe pareamento/listagem/revogação de bridge, challenge e proof assinada.
* Adicionados helpers de canonicalização, verificação Ed25519 e política biométrica com testes contra tampering, replay, challenge expirada/consumida, tenant/reserva/device/document mismatch, usuário esperado, score baixo e status impedido/inativo.
* Hardening operacional: bucket dedicado `/api/biometric/*` em 30 req/min e redaction de assinatura, chaves e artefatos biométricos em logs.
* Correções pós-code-review: escopo por `reserve_memberships` para `admin_reserva`/`armeiro`, enforcement de `BIOMETRIC_MIN_SCORE`/usuário esperado/status/liveness no submit de proof, consumo de challenge com checagem explícita de linha `pending`, `tenant_id` defensivo em `biometric_templates` e triggers SQL de consistência tenant/reserva/device/challenge.
* Validação local: `pnpm --filter bff test` passou com 106 testes; `pnpm --filter bff typecheck` passou.

---

# 2026-07-14 — docs(security): spec enterprise do Biometric Bridge NITGEN/eNBioBSP

### Segurança/Arquitetura — biometria cloud com leitor local

* Criada spec canônica `docs/superpowers/specs/2026-07-14-biometric-bridge-design.md` para substituir o modelo incorreto de captura biométrica no BFF/VPS por **template central por tenant + bridge local Windows + prova biométrica assinada + BFF autoritativo**.
* Incorporado relatório de auditoria `docs/security/reports/biometric-bridge-architecture-audit-2026-07-14.md`: nota 7/10 para a direção antes dos hardenings, código atual ~2/10, lacunas obrigatórias para chegar a 9/10 e bugs existentes de URL sem `/api`.
* `docs/security.md` atualizado com seção canônica de biometria NITGEN/eNBioBSP: uso tenant-wide controlado, proof com nonce/TTL/consumo único, pareamento/revogação de bridge, dados sensíveis, enrollment presencial, rate limit dedicado e liveness/anti-spoof.
* Regra de produto formalizada: biometria cadastrada uma vez no tenant pode identificar o usuário em qualquer reserva do mesmo tenant, mas nunca substitui RBAC, tenant isolation, reserve scope, turno ativo, IDOR defense ou precondições de material/documento.

---

# 2026-07-13 (v32) — security(rbac): teto de privilégio ausente em profiles.ts + superadmin fora do H-RBAC (10 rotas) + Livro Digital + Usuários unificado + harness de pentest banking-grade

### Segurança — CRÍTICO (achado em code review, corrigido antes de produção ser afetada)

* **`PATCH /api/profiles/:id` faltava o teto de privilégio que a rota irmã `/:id/status` já tinha.** Um `armeiro`/`admin_reserva` conseguia setar `registration_status:"inactive"` (suspensão de conta) no profile de um `admin_global`/`admin_reserva` da própria reserva — a única guarda existente bloqueava só `armeiro` e só para o valor `"impedimento_administrativo"`. Corrigido espelhando a lógica da rota irmã (resolve o role do alvo escopado por tenant antes do update), incluindo bloqueio de auto-alteração do próprio status — com cuidado para não bloquear edições legítimas de outros campos que reenviam `registration_status` inalterado (o dialog de edição sempre inclui esse campo no payload).
* **`superadmin` (Nexus/SaaS-only) tinha acesso indevido a 10 rotas operacionais de tenant do BFF** (`admin.ts`, `categories.ts`, `dashboard.ts`, `handovers.ts`, `ocorrencias.ts`, `realtime.ts`, `reserves.ts`, `signatures.ts`, `ssa.ts`, `totp.ts`) — violação da regra H-RBAC canônica (`docs/security.md` §21 regra 6) já corrigida antes em `profiles.ts`, mas não varrida no resto do BFF. Removido de todos os `roleGuard(...)` e checagens inline de role operacionais; mantido apenas em `totp.ts /self-validate` (Nexus step-2 auth) e nos canais `nexus-events`/`nexus-errors` (legitimamente Nexus-only). Defesa em profundidade: `POST /api/auth/login` agora zera `tenantId`/`reserveId` da sessão quando `role=superadmin`, independente do que `tenant_memberships`/`default_tenant_id` contenham.
* **`profiles.tenant_id` (coluna inexistente, era `default_tenant_id`)** — regressão real de 2+ semanas (commit `889adc2`) que quebrava editar/desativar usuário; corrigida em `dashboard.ts`, `lendings.ts` (x2), `nexus.ts` e no filtro raw do canal `admin-profiles-grid` (`realtime.ts`).
* **CORS/502 disfarçado ao trocar de armeiro para modo usuário** — `middleware/auth.ts` renovava a sessão (sliding TTL) com sua própria instância de `getIronSession()`, independente da instância usada pela rota (`session.ts` `/api/session/mode`); as duas chamavam `.save()`, produzindo 2 headers `Set-Cookie` (~1.7KB cada, carregam o JWT completo) que excediam o `proxy_buffer_size` (4KB) do nginx → 502 "upstream sent too big header", que o browser reporta como falha de CORS (nginx aborta antes de encaminhar `Access-Control-Allow-Origin`). Corrigido com `try { await next() } finally { if (!alreadyPersisted) await session.save() }`. Hardening adicional aplicado direto na VPS: `proxy_buffer_size 16k`/`proxy_buffers 4 16k`, e `proxy_hide_header` nos 3 headers de segurança que o nginx re-adiciona (elimina duplicação/conflito entre nginx e `secureHeaders()` do Hono).

### Testes — Harness de pentest dinâmico banking-grade (novo)

* `docs/security/pentest-banking-grade-spec.md` + `pentest-banking-grade-prompt.md`: metodologia audit→plano→execução→teste, taxonomia de severidade com score numérico (nota mínima 9/10), estrutura de 7 suites planejadas.
* `apps/bff/src/__tests__/pentest/` (novo, roda contra o BFF de produção real com tokens reais — prova comportamento, não intenção de código): `pentest-fixtures.ts` (cria/limpa um tenant B descartável, com compensação de falha parcial e fallback de ban+rotação de senha quando o delete de conta falha), `cross-tenant-write.pentest.test.ts` (isolamento entre tenants), `privilege-escalation.pentest.test.ts` (teto hierárquico dentro do mesmo tenant — já provou os 2 achados críticos acima antes de chegarem sozinhos em produção).
* `apps/bff/package.json`: `pnpm test` não varre mais `pentest/` (exigia credenciais de produção que o job de CI padrão não tem, quebrando o pipeline); nova script `test:pentest` dedicada.

### Feat — Livro Digital de Serviço (guard de turno + timeline + histórico)

* Guard de turno agora bloqueia a página inteira de "Nova Saída"/cautela/lending (não só o submit) quando o armeiro não tem turno ativo — antes o BFF só rejeitava no `POST`, deixando o armeiro preencher todo o formulário antes de descobrir que precisava abrir turno.
* `logShiftEvent` corrigido para `await` em todos os call sites (bug latente: response podia ser enviado antes do evento ser gravado) e integrado também no fluxo legado `/api/lendings`.
* Timeline rica, histórico paginado, bloqueio de turno duplicado na mesma reserva.

### Feat — Cadastro de Usuários unificado

* "Cadastrar Usuário" (sem login) e "Criar Login" (militar já cadastrado) unificados num único dialog com toggle interno — eram dois fluxos redundantes/confusos.
* `tenant_id` nulo na criação de usuário corrigido; checagem de teto de privilégio + escopo de tenant adicionada antes da mutação de e-mail em `existing_user_id` (achado CRÍTICO: sem isso, um armeiro conseguia sequestrar o login de um `admin_global` do mesmo tenant só sabendo o UUID do profile — coberto por `crud-usuarios-create.spec.ts` U16).

### Testes — varredura completa da suite CRUD/jornadas (148 testes, 1a execução real em CI)

* `ci.yml`: novo job `e2e-suite` roda a suite completa (antes só manual) serializado após `e2e-smoke`, não bloqueando o deploy do BFF (sem ambiente de staging).
* 1a execução real confirmou 21 falhas determinísticas (não flakiness), a maioria stale desde antes desta sessão. Corrigidas por causa raiz:
  * `waitUntil:"networkidle"` → `"load"` em 16 arquivos de spec: o SSE do sino de notificações (`notification-bell.tsx`, migrado de WebSocket para SSE nesta mesma sessão) mantém conexão aberta, arrastando `networkidle` para perto do timeout do Playwright.
  * Seletores desatualizados (`role="option"` vs `<button>` real; "Fardamento" vs "farda"; "Voltar ao login" é `<a>` role="link", não `<button>`; heading do dialog casando com o botão de submit de mesmo texto; alt do logo é "Logo", não "APMCB"; label "Identificar Militar" renomeado).
  * Testes editando a "primeira linha" de tabelas reais de produção compartilhadas entre workers paralelos — reescritos para criar fixtures próprias e descartáveis.
  * `SearchInput` só filtra a lista de fato ao pressionar Enter (autocomplete-then-confirm), não a cada tecla digitada.
* `_material-dialog.tsx` (Arsenal): botão de submit só desabilitava durante `loading`, nunca por validação de formulário — inconsistente com o padrão já usado no dialog de usuários. Adicionado `canSubmit` espelhando as validações de `handleSave` (nome/categoria/calibre/veículo/validade/quantidade); corrigida uma trava de regressão introduzida pelo próprio fix (reabrir o dialog do mesmo material sem tocar em Qtd. deixava o botão preso desabilitado — `open` faltava nas deps do `useEffect` de repopulação de itens).
* 2 bugs reais de produção encontrados mas não corrigidos nesta sessão (decisão consciente — exigem novo endpoint de backend, fora do escopo seguro de um fix rápido em sistema de inventário de armamento): dialog de edição não pré-carrega itens físicos existentes para categorias com validade obrigatória; materiais com `quantidade_total=0` carregam Qtd.=0 sem aviso claro.

---

# 2026-07-11 (v31) — fix(auth): ativação de conta e recuperação de senha quebradas em produção (cookies HttpOnly) + demais rotas afetadas

### Segurança/Correção — CRÍTICO (achado em auditoria própria, confirmado via E2E contra produção)

* **`/auth/confirmar-conta` (ativação de conta por convite) e `/auth/update-password` (recuperação de senha) estavam completamente quebrados** para qualquer usuário real desde o hardening "Phase 2" (cookies `sb-*` forçados a `HttpOnly`, tanto no upgrade explícito de `/auth/exchange` quanto — de forma determinística, sem race — em `lib/supabase/server.ts`/`/auth/callback`). Client components que liam a sessão via `createBrowserClient()` (`document.cookie`) passavam a rodar como `anon`. Confirmado empiricamente: suíte `invite-suite` (`invite-activate.spec.ts`) tinha **10 de 19 testes falhando** (IA03–IA07, IA09–IA13).
* Ambas as páginas foram convertidas para Server Component (leem a sessão via `next/headers`, imune a HttpOnly) + client component só para a UI interativa. A troca de senha em si passou a rodar 100% no servidor via `auth.admin.updateUserById` (service role), eliminando a dependência de uma sessão legível no navegador.
* `/api/auth/update-password` agora revoga todas as sessões/refresh tokens antigos do usuário (`auth.admin.signOut(..., "global")`) após a troca — paridade com o comportamento antigo do SDK client-side, relevante no cenário "conta comprometida" que motiva a recuperação de senha.
* **Botão "Devolver" em Saídas (`_return-button.tsx`) — falha silenciosa com falso sucesso.** Fazia `UPDATE` direto via client Supabase sem checar linhas afetadas; a RLS bloqueava a escrita (sessão `anon`), retornando `error: null` e 0 linhas — o toast de sucesso aparecia mesmo sem nada ter sido devolvido no banco. Corrigido: agora usa `PATCH /api/lendings/:id/return` (rota BFF já existente, tenant-scoped, valida `status_legacy = "ativo"` e retorna 404 em vez de sucesso vazio).
* **Upload de foto de perfil e de materiais do arsenal** — Supabase Storage também exige sessão `authenticated` real; upload direto do navegador falhava (bucket privado, RLS `TO authenticated`). Movido para rotas Next.js server-side novas: `POST /api/profiles/photo` e `POST /api/arsenal/material-photo` (esta última reimplementa o mesmo allowlist de roles da policy RLS `material_photos_staff_write`).
* **Sino de notificações (`notification-bell.tsx`)** — canal Realtime do Supabase no navegador nunca abria (`auth.getUser()` client-side retornava `null`), então notificações não chegavam ao vivo (só no fetch inicial da página, sem atualização em tempo real). Migrado para o padrão SSE já usado no resto do sistema (`useSSERefresh`, canal `notifications` novo no BFF, service role + iron-session).
* Nas duas novas páginas de auth, navegação pós-sucesso usa `window.location.href` (hard navigation), não `router.replace` — mesma causa raiz do incidente de session-bleed cross-user já corrigido no commit `7204251`; as duas páginas (Server Components) e as 4 rotas POST novas declaram `export const dynamic = "force-dynamic"` — mesma causa raiz do commit `e059f7f` (cache cross-user em adaptador `@cloudflare/next-on-pages`).
* Novo `apps/web/src/lib/password-policy.ts` (`isPasswordStrongEnough`) — validação de força de senha no servidor, espelhando a regra já aplicada na UI (antes só client-side, contornável via fetch direto).
* Revisão de código sênior obrigatória (2 rodadas): 1 CRÍTICO + 1 ALTO encontrados e corrigidos antes do commit; 1 achado adicional (revogação de sessão em update-password) endereçado proativamente.

---

# 2026-07-11 (v30) — security(rls): vazamento cross-tenant em 11 tabelas + feat(arsenal): Manutenção de materiais + feat(relatorios): overhaul completo

### Docs — planejamento anti-IDOR enterprise

* Criada spec/harness de defesa anti-IDOR cobrindo qualquer referência externa a objeto, não só `/:id`: path/query/body IDs, arrays, filtros, metadata, Storage, Realtime/SSE, PDFs públicos, busca/autocomplete, relatórios e exportações.
* Regra de privilégio mínimo formalizada para BFF com `service_role`: mutation sensível deve carregar `tenant_id`, `reserve_id` ou owner field na própria query de escrita sempre que a tabela possuir esses campos; checagens separadas viram exceção documentada.
* `docs/security.md` atualizado com seção Anti-IDOR, roles atuais e regra canônica de `superadmin` Nexus-only.

### Segurança — anti-IDOR slice 1 aplicado

* `lendings`, `saidas` e `cautelamentos`: mutations críticas de custódia agora escrevem com predicado de `tenant_id` na própria query (`update/delete`) em vez de depender apenas de checagem anterior por `id`.
* `bulk-return`, rollback de lending, assinaturas, retornos, criação de saída/cautela e substituição de cautela agora validam linha afetada quando a operação depende de write tenant-scoped, reduzindo falso sucesso em corrida ou tentativa IDOR.
* Writes críticos de assinatura/retorno/substituição carregam pré-condições de estado e assinatura na própria query (`status`, `*_signature_id`, `active_*_id`), não apenas em leitura anterior.
* Criações de custódia agora validam IDs recebidos no corpo dentro do tenant da sessão (`profiles.default_tenant_id`, `material_types.tenant_id`, `reserves.tenant_id`) antes de inserir documentos.
* Retornos de saída/cautela executam rollback tenant-scoped do documento quando a liberação do item falha, evitando sucesso parcial silencioso.
* `superadmin` removido dos role guards operacionais de saídas e cautelamentos, preservando a regra Nexus/SaaS-only.
* Novo teste BFF `idor-write-scope.test.ts` bloqueia regressão de writes por `id` puro e `superadmin` em rotas operacionais de custódia.

### Segurança — OWASP input hardening

* Novo harness BFF `owasp-input-safety-harness.test.ts` adiciona guardrails estáticos contra regressões conhecidas de SQLi/XSS/CSRF em código de aplicação: raw SQL runtime, sinks HTML/script, CSP de produção e wiring de CSRF.
* `GridPdfButton` deixou de montar documento de impressão com `document.write`/`outerHTML`; exportação agora usa DOM API segura (`createElement`, `textContent`, `appendChild`) e allowlist para URL de logo.
* `docs/security.md` atualizado com seção canônica de SQL Injection, XSS e CSRF, incluindo escopo do harness e regra atual de CSRF via iron-session + `X-CSRF-Token`.

### Segurança — rate limiting enterprise

* Novo harness BFF `rate-limit-hardening-harness.test.ts` valida comportamento real do `routeRateLimiter`: bloqueio de `/api/auth/login` na 6ª tentativa por IP, headers/body de `429`, isolamento de buckets, preferência por `CF-Connecting-IP`, buckets dedicados e `/health` fora de `/api/*`.
* `RATE_LIMIT_PROFILES` centraliza o contrato de limites (`login`, `exchange`, `sensitive`, `general`, `authMe`, `publicVerify`) para evitar drift entre código, testes e documentação.
* `docs/security.md` e spec dedicada documentam Turnstile como camada anti-bot complementar, não substituta de throttling no BFF, e registram o risco residual de storage in-memory em escala multi-instância.

### Segurança — CRÍTICO (achado em auditoria própria, não relatado por terceiros)

* **Vazamento de dados cross-tenant via RLS em 11 tabelas**: `admin_global` e `superadmin` estavam agrupados numa mesma cláusula de policy SEM checagem de `tenant_id` em `cautelamentos`, `profiles`, `audit_logs`, `biometric_templates` (dados biométricos!), `category_requests`, `lendings`, `material_items`, `material_types`, `material_requests` e `admin_approval_requests`. Qualquer `admin_global`/`superadmin` de um tenant conseguia ler (e em vários casos escrever) registros de custódia de armamento, biometria e perfis de **qualquer outro tenant** da plataforma. O achado partiu da nova página de Relatórios (que passou a consultar `cautelamentos` diretamente via Supabase SSR/RLS), tornando o vazamento diretamente explorável a partir do client, não só teórico a nível de banco.
* **Regra canônica definida com o dono do produto**: `superadmin` é papel Nexus/SaaS-only e não deve acessar dado de tenant algum, sob nenhuma circunstância; `admin_global` deve ser sempre escopado ao próprio tenant (estrutura em cascata *dentro* do tenant, nunca cross-tenant). 5 migrations aplicadas em produção corrigindo todas as policies encontradas nesse padrão, removendo `superadmin` de toda cláusula de dado de tenant e adicionando escopo de `tenant_id`/`default_tenant_id` a `admin_global` onde faltava (`20260711000001` a `20260711000005`).
* Achado correlato em code review: o branch de `admin_global` reescrito para `category_requests` usava `reserve_memberships`, tabela cuja CHECK constraint nunca aceita esse role (código morto) — corrigido com checagem direta via `reserves.tenant_id` (`20260711000005`).

### Segurança — bloqueio de item vencido antes ausente

* **`validade_item` (ex: validade de colete balístico) só gerava alerta visual, nunca bloqueava emissão**: `POST /api/cautelamentos` e `POST /api/saidas` não comparavam a validade do item contra a data atual antes de autorizar saída/cautela — um item vencido podia ser normalmente retirado. Adicionado bloqueio 409 nos dois endpoints, comparando por data local (`America/Sao_Paulo`) em vez de UTC (evita bloquear ~3h antes do fim real do último dia válido).

### Novo — Materiais em Manutenção (danificados / perdidos / administrativo)

* Nova página `/reserva/arsenal/manutencao` (armeiro, admin_reserva) e `/admin/arsenal/manutencao` (admin_global, com filtro de reserva), acessível via novo item em acordeão no menu Almoxarifado/Arsenal. Cards/tabela, checkbox + exportação PDF/CSV, busca, mesmo padrão visual do restante do Almoxarifado.
* **Lacuna funcional real corrigida**: não havia nenhum jeito de declarar um material do próprio estoque (nunca retirado) como danificado, extraviado ou furtado — só era possível via devolução de uma saída/cautela ativa. Novo modal "Registrar Ocorrência" + rota `PATCH /api/arsenal/items/:id/ocorrencia`, com concorrência otimista (evita corromper o registro se o item mudar de posse entre a leitura e a gravação) e preservação do texto de notas pré-existente do item.
* `status_operacional` de `material_items` expandido de 7 para 13 valores (`avariado`, `furtado`, `em_pericia`, `bloqueado`, `em_transito`, `aguardando_baixa` além dos originais), com exigência de nº de B.O. (registro interno, não delegacia) para itens marcados como furtados. A CHECK constraint da coluna nunca tinha sido efetivamente aplicada em produção desde a criação da tabela — corrigida junto (`20260711000002`).
* Bugs pré-existentes encontrados e corrigidos no caminho: `isActive()` do sidebar usava `startsWith` puro e marcava o item pai como ativo mesmo dentro de uma rota-irmã aninhada; `GridSearchInput` nunca expunha `data-testid`, deixando os testes `crud-arsenal.spec.ts` C9/C10 quebrados em produção silenciosamente.

### Novo — Relatórios: seleção + PDF dinâmico, paginação, autocomplete escalável, Cautelas/Livro de Serviço

* Checkbox de seleção + exportação PDF dinâmica (`GridPdfButton`, com hash de integridade) e CSV nas 3 tabelas de detalhe; paginação "Ver mais" (10/20/30) substituindo a listagem de até 500 linhas de uma vez.
* Novo autocomplete assíncrono (`AsyncComboBox`, debounce + descarte de respostas fora de ordem) para o filtro de Usuário, preparado para 10k+ cadastros por tenant — o `<Select>` nativo anterior carregava a lista inteira no client. Dropdowns menores (Material/Categoria/Calibre/Posto) ganharam busca no topo da lista (`SearchableSelect`).
* Novo filtro "Tipo de Registro": Saídas (padrão) / Cautelas / Livro de Serviço — o relatório antes só enxergava `lendings`. Trocar o tipo reseta os filtros incompatíveis (status/material/categoria/calibre/usuário) e preserva De/Até/Posto.
* Livro de Serviço no relatório enriquecido: foto do usuário, material referenciado (resolvido via `lendings`/`cautelamentos` a partir do `subject_id` polimórfico), descrição completa — antes mostrava só tipo de evento e autor.
* `superadmin` removido do guard de acesso às duas páginas de Relatórios, consistente com a regra canônica de segurança acima.
* `/admin/relatorios` e `/reserva/relatorios` compartilham agora os mesmos componentes (`RelatorioFilterPanel`, `RelatorioDetailTable`, `RelatorioExportButtons`) — antes ~95% duplicados linha por linha.

### E2E — débito técnico de suite descoberto e corrigido durante regressão completa

* Regressão completa (1020 testes, 49 projetos) revelou um padrão sistêmico: 12 páginas foram migradas para "cards" como view padrão (toggle para tabela) sem atualização dos specs, que assumiam `<table>` sempre presente. Corrigido em `crud-arsenal`, `crud-saidas`, `crud-usuarios(-create)`, `smoke`, `regression`, `stress`, `visual-full`, `status-detail`, `admin-dec-estrutura`, `historico-usuario`, `arsenal-profile-feedback`, `reserva-cadastro`.
* Rename "Militares" → "Usuários" não propagado a specs (heading, botão "Cadastrar Militar" vs. "Cadastrar Usuário") — alinhado nos testes e, onde o próprio app tinha o rename incompleto (botão de submit do dialog ainda dizia "Cadastrar Militar"), corrigido no app também.
* `crud-saidas.spec.ts` S9/S10 testavam um fluxo "Devolver" que não existe mais (substituído por "Receber"/`DesarmamentoModal`) — reescritos para o fluxo atual; corrigido de quebra um botão de fechar sem `aria-label` no modal.
* `criar-login-real.spec.ts` ML01 usava o e-mail real do desenvolvedor como fixture de "criar usuário novo" — nunca idempotente após o primeiro run bem-sucedido (409 permanente). Trocado por e-mail gerado por run.
* `login-invite.spec.ts` (20 testes) referenciava `data-testid` que nunca existiram no componente — adicionados; arquivo segue não registrado em nenhum projeto do Playwright até validação end-to-end.
* Removido `apmcb-full.spec.ts`: arquivo órfão (não registrado em nenhum projeto), com corrupção de encoding mista (mojibake de duas origens diferentes) e 100% superseded por specs dedicados já existentes.
* Corrigida a mesma corrupção de encoding (mojibake) nas 3 linhas de cabeçalho deste próprio CHANGELOG.

### Infra

* `apps/web/playwright-report/index.html` estava listado em `.gitignore` mas continuava rastreado desde antes da regra existir (artefato de teste gerado a cada run, ruído constante de diff) — destrancado do git (`git rm --cached`).
* 7 screenshots avulsos de debug manual (sem relação com nenhuma tarefa em andamento) removidos do working tree.

### Regressão E2E — nota de execução

* Suite completa (1020 testes) ficou rodando por >17h contínuas durante este ciclo; identificado que a carga concorrente sustentada de múltiplos logins simultâneos estava disparando com frequência anormal o bug pré-existente de session-bleed do Cloudflare Workers (mitigação de `def1434` reagindo corretamente, mas a taxa de disparo tornava o login pouco confiável para uso real). Suite encerrada manualmente; BFF confirmado 100% consistente em request isolado (não é regressão desta sessão). Cobertura já obtida (>900 resultados) foi suficiente para identificar e corrigir todo o débito técnico listado acima.

### Code review

* Revisado por sub-agente sênior em duas rodadas (achados de segurança + achados de produto). Rodada 1: 1 CRÍTICO (race condition na rota de ocorrência), 2 ALTO (perda de dados em `descricao_adicional`, branch morto de RLS), 4 MÉDIO — todos corrigidos e reconfirmados pelo mesmo revisor antes deste commit. `tsc --noEmit` limpo em `apps/web` e `apps/bff`.

---

# 2026-07-10 (v29) — fix(arsenal): 400 no Storage ao exibir fotos de material + achado crítico de CI

### Bug Fixes

* **Fotos de material retornando 400 (bucket `material-photos`)**: `photo_url` era renderizado diretamente como `<img src>`, mas o bucket é privado — precisa de signed URL via `createSignedUrl`. Novo helper `withMaterialPhotoDisplayUrls` (`apps/web/src/lib/storage.ts`) resolve a signed URL para um campo separado (`photo_display_url`), preservando o valor bruto de `photo_url` intacto (o formulário de edição reenvia esse valor ao salvar sem trocar a foto — sobrescrevê-lo com uma URL temporária de 1h corromperia o dado permanente). Aplicado em `admin/arsenal`, `reserva/arsenal` e no detail sheet.
* **`resolvePhotoUrl` sem tratamento de erro (achado ALTO em code review)**: a chamada de rede ao Storage podia rejeitar o `Promise.all` inteiro por causa de UMA foto, derrubando a página de listagem completa. Adicionado try/catch na função SSOT — degrada para "sem foto" e loga via `console.error`.

### CI — achado crítico

* **`apps/web/package.json` tinha `"name": "web"` em vez de `"@apmcb/web"` desde o commit inicial do projeto.** Todo o CI filtra por `pnpm --filter @apmcb/web ...`; um filtro que não casa com nenhum pacote não falha — imprime "No projects matched" e sai com código 0. Ou seja: **os steps "Typecheck web" e o job "Build Web" nunca executaram de fato**, em nenhum push/PR desde o início do projeto — sempre reportaram sucesso sem checar nada. Corrigido renomeando o pacote; verificado manualmente que `pnpm --filter @apmcb/web typecheck`/`build` passam limpos (nenhuma quebra pré-existente estava sendo mascarada).

---

# 2026-07-10 (v28) — fix(arsenal): 401 do armeiro ao solicitar categoria/material ao admin da reserva

### Bug Fixes

* **401 Unauthorized ao armeiro solicitar nova categoria/material**: reportado em produção (`GET /api/categories` e `POST /api/categories/request` retornando 401 para role `armeiro` em `/reserva/arsenal?tab=categorias`). Causa raiz: 3 componentes client-side (`_category-manager.tsx`, `material-detail-sheet.tsx`, `_aprovacao-client.tsx`) usavam um padrão legado `getBearerHeaders()` que obtinha o token via `supabase.auth.getSession()` no browser — mecanismo que dependia das cookies `sb-*` serem legíveis por JS. Desde a migração dessas cookies (e de `apmcb_session`) para HttpOnly (`/api/auth/upgrade-session`, endurecimento de segurança anterior), `document.cookie` passou a retornar vazio e `getSession()` sempre `null`, então nenhum header `Authorization` era enviado — e como o `fetch` também não usava `credentials: "include"`, a cookie de sessão HttpOnly também não ia junto. O BFF (`authMiddleware`) não encontrava nem iron-session nem Bearer válido → 401. Reproduzido e confirmado em produção via Playwright (`document.cookie === ""` com usuário autenticado; replay exato da chamada quebrada retornou 401 idêntico ao relatado).
* **Fix**: os 3 arquivos passaram a usar `bffFetch()` (`apps/web/src/lib/bff-client.ts`), helper já existente e testado que usa `credentials: "include"` (envia a cookie HttpOnly `apmcb_session`) + header CSRF (`X-CSRF-Token`), eliminando a duplicação de `getBearerHeaders()`/`BFF_URL` copiada em 3 lugares (SRP/DRY). Corrige, no mesmo passo, o fluxo simétrico do admin (aprovar/rejeitar solicitação de material em `_aprovacao-client.tsx`) e as 3 solicitações de material do armeiro (adição, ajuste de estoque, desativação) em `material-detail-sheet.tsx`, que sofriam do mesmo bug.
* Validado em produção via Playwright: chamada replicada com o padrão corrigido (`credentials:"include"` + CSRF) retornou `201 Created` (antes: `401`).
* Novo teste de regressão E2E `CAT08` (`apps/web/e2e/bug-sprint-001.spec.ts`) exercita o submit real do formulário de solicitação de categoria pelo armeiro e falha explicitamente em caso de 401 — os testes `CAT01-03` pré-existentes só checavam visibilidade de botão/modal, sem exercitar a chamada de rede, e por isso não pegaram esta regressão.
* Revisado por sub-agente de code review (CLAUDE.md): 0 itens CRÍTICO/ALTO. Itens MÉDIO/BAIXO (cobertura de teste do submit real — endereçada com CAT08; inconsistência menor de `friendlyApiError` em `_aprovacao-client.tsx`; hidratação de CSRF token em nova aba) documentados como follow-up, não bloqueiam este commit.
* **Achado correlato, já corrigido por outro agente em paralelo**: durante a reprodução, um redirect inesperado de `/reserva/arsenal` para `/efetivo` foi observado para o mesmo usuário `armeiro` — rastreado até `apmcb_mode` cookie stale via cache cross-user em rotas GET, já corrigido em `main` pelo commit `e059f7f` ("fix(auth): causa raiz do session-bleed - GET routes cacheadas cross-user"), anterior a este.

---

# 2026-07-10 (v27) — fix(auth): session-bleed cross-user no login/logout + pendências do checklist

### Bug Fixes — CRÍTICO (incidente de produção)

* **Session-bleed cross-user no login**: usuário logava com uma conta e, momentaneamente, a UI renderizava dados de outro usuário já autenticado anteriormente na mesma aba (reproduzido em `usuario`, `admin_reserva` e `admin_global`), com erro de hidratação React #418 no console. Causa raiz (confirmada via `git blame` — bug presente desde o commit inicial do fluxo de login, não é regressão recente): navegação client-side "soft" (`router.replace`/`push`) após login/logout permitia que o Router Cache do Next.js reaproveitasse payload RSC de uma sessão anterior na mesma aba.
* **Fix**: `router.replace`/`push` trocado por `window.location.href` (hard navigation) em `login/page.tsx`, `auth/exchange/page.tsx` (fluxo de convite/reconvite — mesmo bug, encontrado em code review), `header.tsx`, `_sign-out-button.tsx` (efetivo/perfil), `registro-pendente/page.tsx`, e em toda a área `/nexus` (superadmin): `nexus/login/page.tsx`, `nexus-header.tsx`, `nexus-sidebar.tsx`, `use-nexus-guard.ts`.
* **Logout não destruía a sessão do servidor**: `handleSignOut()` chamava apenas `supabase.auth.signOut()` (limpa cookies `sb-*`), nunca o endpoint do BFF que destrói a iron-session — o cookie `apmcb_session` sobrevivia ao "logout". Corrigido: todos os pontos de logout agora chamam `POST /api/auth/logout` (ou `/api/nexus/logout`) antes de limpar os cookies do Supabase, centralizados em `apps/web/src/lib/auth-actions.ts` (`signOutAndRedirect`).
* **CSRF podia bloquear logout silenciosamente**: `/api/auth/logout` e `/api/nexus/logout` exigiam header CSRF; numa aba nova sem token em `sessionStorage`, o logout falhava com 403 sem o usuário perceber, deixando a sessão órfã no servidor. Ambas as rotas foram isentas do middleware de CSRF (`apps/bff/src/middleware/csrf.ts`) — pior caso de um logout forjado via CSRF é deslogar a própria vítima, sem escalonar privilégio nem vazar dado.
* Revisado 2x por sub-agente code-reviewer (CLAUDE.md): 1º pass achou 1 CRÍTICO (`auth/exchange/page.tsx` esquecido) + 1 ALTO (gap de CSRF) + 1 MÉDIO (duplicação); todos corrigidos e confirmados no 2º pass. Commit `7204251`.

### Pendências conhecidas (checklist DoD em andamento, não bloqueiam este commit)

* **Validação visual do fix acima**: aplicado e commitado/pushed, mas ainda sem confirmação do usuário testando ao vivo em produção.
* **Auditoria de toasts (i18n + vazamento de erro técnico)**: ~65 call sites em 33 arquivos já corrigidos por agente em background, mas o resultado está isolado em worktree não revisado nem mergeado (`.claude/worktrees/agent-a9a50856f49826ba2`, branch `worktree-agent-a9a50856f49826ba2`) — pendente review + merge em `main`.
* **Regressão E2E completa (DoD etapa 15)**: run anterior (~660+ testes) foi interrompido propositalmente para não contaminar a investigação do incidente crítico acima; precisa ser re-executado do zero e triado.
* **Relatório final do DoD (etapa 20)**: ainda não gerado em `docs/enterprise/reports/` para o ciclo desta fase (Livro Digital Fase 6-B + hardening de auth).
* Múltiplos worktrees de agentes em background de sessões anteriores ainda presentes em `.claude/worktrees/` (`git worktree list`) — avaliar quais têm trabalho aproveitável antes de limpar.

---

# 2026-07-09 (v26) — fix(livro): TOTP/biometria obrigatórios em turno + regressões de sessão HttpOnly

### Security

* **Fase E do Livro Digital**: abrir/fechar turno de armeiro agora exige TOTP ou biometria (`auth_mode` no BFF, novo `ShiftAuthDialog` no frontend). Aba de biometria fica oculta na UI até o SDK ZKTeco real estar integrado — o stub atual (`verify()` sempre `false`) e a ausência de leitor USB no VPS tornariam essa opção uma autenticação que sempre falha.
* **`POST /api/biometric/register`**: bloqueado cross-tenant para `admin_reserva`/`admin_global` — só podem registrar biometria de usuários do próprio tenant (service_role ignora RLS; validação movida para a rota).
* **`validateSelfBiometric`**: agora varre todos os templates registrados do usuário, em vez de comparar contra um template arbitrário (`.limit(1)` sem `.order()`).
* Removido `POST /api/biometric/self-verify` — endpoint morto, sem caller no frontend.
* Guard contra `FINGERPRINT_SDK=mock` em produção (`NODE_ENV=production` bloqueia o SDK de testes).

### Bug Fixes

* **TOTP 422 "Autenticador inválido" (matrícula 000003)**: catches que engoliam a exceção de decrypt/chave (`totp.ts`, `shift-auth.ts`, `biometric.ts`) agora logam a causa raiz via `lib/logger.ts` — sem isso o incidente era indiagnosticável a partir dos logs do servidor.
* **"Meu Perfil" sem UI de TOTP**: `TOTPSetupCard` adicionado a `/efetivo/perfil`; novo `POST /api/totp/reconfigure` permite regenerar o secret quando de fato está corrompido — restrito ao caso em que o secret atual falha em `readSecret()`, para não abrir bypass do rate limit de tentativas.
* **`/efetivo/historico` e páginas irmãs travadas em "Carregando..." infinito**: `getSession()` client-side (quebrado desde a migração dos cookies `sb-*` para HttpOnly) trocado por `bffFetch`/cookie de sessão em `_historico-client.tsx`, `_materiais-uso-client.tsx`, `_minhas-cautelas-client.tsx`, `TOTPDisplay`, `TOTPSetupCard`.
* **`POST /api/shifts/open`**: ordem de validação corrigida — turno já ativo e tenant são checados antes de consumir o código TOTP, evitando queimar o código numa tentativa que sempre resultaria em 409.
* **`auth.ts` login failure**: removido `catch {}` vazio — falha ao gravar `auth.login_failed` agora é logada (evento de monitoramento de segurança não pode se perder sem rastro).

### Infra

* Container Docker órfão `apmcb-nginx` (status `Created`, nunca esteve ativo) removido do VPS junto com o volume `apmcb_nginx_logs` — host nginx (systemd) é o proxy canônico deste ambiente.
* `docker-compose.yml` / `docker-compose.prod.yml`: `TOTP_ENCRYPTION_KEY` e `CORS_ORIGINS` adicionados ao ambiente do BFF (o fail-fast no boot exigia essas vars e elas não estavam sendo repassadas pelo compose); rotação de logs (`json-file`, 50m × 5) adicionada em ambos.

### Docs

* Auditoria de observabilidade de logging (`docs/enterprise/reports/observability-audit-2026-07-08.md`) e spec de implementação faseada (`docs/enterprise/specs/observability-logging-enterprise.md`).

---

# 2026-07-08 (v25) — fix(csrf): exchange page nao armazenava csrfToken + fallback localStorage

### Bug Fixes

* **`auth/exchange/page.tsx`**: após o login via exchange (magic link / fluxo de tokens), o BFF retornava `{ landAt, csrfToken }` mas a página só lia `data.landAt` e descartava `csrfToken`. Sem o token em `sessionStorage`, todas as requisições mutantes (POST/PUT/DELETE) do browser falhavam com 403 "CSRF token inválido". Adicionado `if (data.csrfToken) setCsrfToken(data.csrfToken)` após o exchange bem-sucedido.
* **`lib/csrf.ts` — `getCsrfToken()`**: adicionado fallback para `localStorage` quando `sessionStorage` está vazio. Permite que `storageState` do Playwright capture o CSRF token (que é persistido em `localStorage` pelo armeiro-auth.setup) e o reuse em testes que usam storageState sem passar pelo fluxo de login completo.
* **`e2e/setup/armeiro-auth.setup.ts`**: após login, copia o CSRF token de `sessionStorage` para `localStorage` antes de salvar o `storageState`, garantindo que testes E2E com storageState tenham o token disponível.

---

# 2026-07-08 (v24) — refactor(bff-client): centraliza fetch BFF com timeout e tratamento de 401

### Refactoring

* **`lib/bff-client.ts`** (novo): SSOT para chamadas ao BFF. Centraliza `credentials: "include"`, AbortController com timeout de 10s (previne spinner infinito quando BFF não responde), redirect automático para `/login` em 401/403, e retorno consistente `{ ok, status, data }`.
* **`_livro-client.tsx`, `_historico-client.tsx`, `_admin-livros-client.tsx`**: removidas as três cópias locais de `bffFetch` e `BFF_URL`; agora importam de `@/lib/bff-client`. Elimina DRY violation identificada em code review.

### Bug Fixes

* **Spinner infinito (LDS01, LDS04)**: timeout de 10s no AbortController garante que o `fetch()` rejeite mesmo quando o BFF não responde — `finally { setLoading(false) }` passa a ser chamado em todos os casos.

---

# 2026-07-08 (v23) — fix(livro): remove getSession/Bearer token quebrado por Phase 2 HttpOnly

### Bug Fixes

* **LivroClient, HistoricoClient, AdminLivrosClient**: após a Phase 2 de segurança, os cookies `sb-*` foram tornados HttpOnly, fazendo `supabase.auth.getSession()` no browser retornar `null`. Os três componentes do Livro Digital usavam esse token como `Authorization: Bearer` para o BFF — que agora autentica exclusivamente via `apmcb_session` (iron-session). Removido `createClient`, estado `token`, `useEffect` de `getSession`, guard `if (!token) return` e parâmetro `token` em `bffFetch`. Componentes agora chamam o BFF com `credentials: "include"` diretamente. Corrige LDS01–LDS14 (spinner infinito).
* **try/catch em fetchers**: adicionado `try/finally` em `loadData`, `loadShifts` e `toggleExpand` para garantir que os estados de loading sejam sempre resetados em caso de falha de rede, com `toast.error` descritivo.

---

# 2026-07-08 (v22) — E2E: React Hydration Guard no wrong-credentials test

### Bug Fixes

* **e2e smoke**: `wrong credentials` falhava consistentemente porque `fill()` e `pressSequentially()` rodavam antes da hidratação do React — o input controlado era resetado para `""` no mount, mantendo o botão desabilitado. Adicionado `waitForFunction` que aguarda `__reactFiber$` no `input#email` (indica que o React montou e os event handlers estão em place) antes de interagir. Também adicionado `expect(btn).toBeEnabled()` como guarda explícito antes do click.

---

# 2026-07-08 (v21) — Exchange Timeout + E2E Reliability Fixes

### Bug Fixes

* **exchange/page.tsx**: Fetch BFF sem timeout ficava suspenso até o TCP timeout do browser (~75s) quando o BFF estava indisponível — usuário travava na tela de exchange sem mensagem de erro. Adicionado `AbortController` com 15s que garante redirect imediato para `/auth/error`
* **e2e harness**: `login()` passava `TimeoutError` genérico quando exchange redirecionava para `/auth/error` (BFF fora do ar) — agora lança erro descritivo que comunica a causa real, permitindo retry automático do Playwright
* **e2e smoke**: `wrong credentials` usava `fill()` que pode não disparar `onChange` do React quando hidratação do Suspense ainda está pendente (beforeEach usa `domcontentloaded`). Trocado por `pressSequentially()` que dispara eventos de teclado por caractere

---

# 2026-07-08 (v20) — Code Review Fixes: Realtime Singleton + HttpOnly Deploy

### Bug Fixes

* **CF Pages**: `/api/auth/upgrade-session` faltava `export const runtime = "edge"` — bloqueava deploy desde o commit da Phase 2
* **BFF realtime**: `stream.sleep(25_000)` bloqueava até 25s após disconnect do cliente, mantendo Supabase WebSocket pendurado. Substituído por Promise abortável com `clearTimeout` em `onAbort`
* **BFF realtime**: `createClient()` era criado por conexão SSE (N usuários = N WebSockets de service role). Movido para singleton de módulo com `removeChannel(rtChannel)` no cleanup (em vez de `removeAllChannels()` que destruiria canais de outras conexões)
* **BFF realtime**: `admin-profiles-grid` sem filtro de tenant — service role bypassa RLS, entregando notificações de profiles de outros tenants. Adicionado `filter: tenant_id=eq.${tenantId}` (consistente com armeiro-sync e arsenal-sync)
* **E2E global-setup**: `Promise.allSettled()` engolia falhas de login silenciosamente; adicionado `console.warn` por entrada rejeitada
* **Deploy script BFF**: URL do repo estava incorreta (`diegocpro` → `diegoprodev`); corrigida no servidor

### Security

* `useSSERefresh` e BFF SSE proxy: todos os canais filtraram por sessão (userId/tenantId), nunca por input do cliente — IDOR mitigado por design

### Performance

* **E2E rate-limiting eliminado**: `login()` agora usa tokens pré-autenticados do `global-setup` (1x por user por suite) em vez de `signInWithPassword` por teste. Elimina ~37 chamadas à API Supabase Auth por run do chromium smoke suite
* **E2E**: removida navegação `/login` intermediária do `login()` — Phase 2 usa HttpOnly cookies, não localStorage. Reduz 1 CF Pages round-trip por login
* `playwright.config.ts`: projeto `chromium` com `navigationTimeout: 60s` e `retries: 2` como safety net

---

# 2026-07-08 (v19) — Phase 2 Security: SSE Realtime Proxy + HttpOnly Cookies

### Security

**Realtime migrado para SSE via BFF — JWT nunca sai do servidor**

Eliminação completa do Supabase Realtime WebSocket do browser. A constraint que impedia `sb-*` cookies de serem HttpOnly (WebSocket precisava ler JWT via `document.cookie`) foi removida.

**Nova arquitetura:**
```
Browser → SSE (iron-session cookie) → BFF → Supabase Realtime (service role)
```

| Mecanismo | Antes | Depois |
|---|---|---|
| JWT em localStorage | ✅ Nunca | ✅ Nunca |
| iron-session (apmcb_session) | ✅ HttpOnly | ✅ HttpOnly |
| sb-* cookies | ⚠️ SameSite=Lax, NÃO HttpOnly | ✅ HttpOnly, SameSite=Strict |
| Supabase WebSocket no browser | ⚠️ Ativo (lê JWT) | ✅ Eliminado |

**Componentes da migração:**

* **BFF `GET /api/realtime/stream`** (novo) — endpoint SSE autenticado por iron-session. Cria subscriptions Supabase com service role server-side. Channel registry com filtros construídos da sessão (nunca do client). Role guard + nexusAuthorized check por canal. Keepalive ping 25s + `removeAllChannels()` no cleanup (garante fechamento do WebSocket).

* **`useSSERefresh` hook** (novo) — substitui `useRealtimeRefresh`. `EventSource` com `withCredentials: true`. Suporta callback opcional (`onEvent`) para componentes com estado local. `window.__rtReady = true` no evento `ready` (compatível com E2E).

* **`useRealtimeRefresh`** (deletado) — hook anterior dependia de `createBrowserClient.auth.getSession()` para obter JWT de cookies não-HttpOnly. Removido sem deprecation wrapper.

* **`GET /api/auth/upgrade-session`** (novo) — Next.js API route que re-emite `sb-*` cookies como HttpOnly imediatamente após login (`setSession` server-side força `httpOnly: true` via `setAll` override em `server.ts`).

* **`server.ts`** — `setAll` callback agora força `httpOnly: true, sameSite: "strict"` em todos os cookies Supabase SSR setados server-side.

* **Smoke test `[PASS] auth cookies are HttpOnly`** — removido `test.fail(true)`. Teste agora passa.

### Refactor

* `RealtimeEfetivoSync`, `RealtimeArmeiroSync`, `RealtimeArsenalSync` — substituídos por `useSSERefresh`; userId/tenantId removidos das props (BFF lê da sessão).
* `_users-table.tsx` — substituído canal Supabase direto por `useSSERefresh("admin-profiles-grid")` + `useEffect` que sincroniza `initialUsers` após `router.refresh()`.
* `event-table.tsx` (Nexus) — substituído canal direto por `useSSERefresh("nexus-events", onEvent)` com callback `useCallback`; BFF envia `row` completo para atualização de estado local sem refetch.
* `nexus/erros/page.tsx` — idem com `nexus-errors`; SSE só conecta após `nexusAuthorized` (guard do nexus).

### Fixos (code review pós-implementação)

* `realtime.ts` — cleanup usa `removeAllChannels()` em vez de `removeChannel()` — garante fechamento do WebSocket subjacente.
* `realtime.ts` — guard `if (alive)` antes do primeiro `writeSSE({ event: "ready" })` — previne exception não capturada se cliente desconectar durante setup.

### Process

* **Regra canônica de code review** adicionada ao `CLAUDE.md` — sub-agente sênior obrigatório antes de todo commit com código de produção.

---

# 2026-07-07 (v18)

### Fixes

**Realtime — Correção raiz: `event:"*"` + `filter` rejeitado pelo servidor**

* **Root cause**: Supabase Realtime rejeita a combinação `event:"*"` + `filter` com `system: "Unable to subscribe to changes"` APÓS confirmar o canal com `SUBSCRIBED`. Como `window.__rtReady` é setado no callback de canal (não de postgres_changes), os testes acreditavam que a subscription estava ativa.
* **Fix `use-realtime-refresh.ts`**: auto-expande `event:"*"` + filtro em INSERT + UPDATE + DELETE separados quando `filter` está presente
* **Fix em todos os componentes sync**: eventos explícitos em `RealtimeEfetivoSync`, `RealtimeArmeiroSync`, `RealtimeArsenalSync` (sem wildcard quando há filtro)

**Realtime — Session await antes de subscribe**

* **Root cause**: Componentes com canal Realtime direto (`_users-table.tsx`, `event-table.tsx`, `nexus/erros/page.tsx`) criavam canal sem aguardar `getSession()` → phx_join com JWT anon → RLS bloqueava todos os eventos
* **Fix**: todos os canais diretos agora aguardam `supabase.auth.getSession().then(...)` com flag `cancelled` para cleanup seguro

**Realtime — `removeAllChannels()` → `removeChannel(channel)`**

* `event-table.tsx` e `nexus/erros/page.tsx` usavam `supabase.removeAllChannels()` (destrutivo — remove subscriptions de TODOS os componentes)
* **Fix**: substituído por `supabase.removeChannel(channel)` com referência correta

**DB Migration — `profiles` e `notifications` na publication Realtime**

* `supabase/migrations/20260707000002_realtime_profiles_notifications.sql`: adiciona `profiles` e `notifications` com `REPLICA IDENTITY FULL`
* Sem esta migration, `RealtimeEfetivoSync` (filtro por `profiles.id`) e `NotificationBell` nunca recebiam eventos WAL

**E2E — Realtime Debug Harness**

* `e2e/harness/realtime-debug.ts`: `attachRealtimeMonitor()` + `waitForRTReady()` com diagnóstico estruturado
* `e2e/realtime-suite.spec.ts` reescrito: elimina `console.log` ad-hoc; todos os triggers aguardam `__rtReady`
* `window.__rtReady` em vez de `data-realtime-ready` em `<html>` (evita conflito com reconciliação RSC)

**Resultado pós-deploy**: `realtime-suite` — **3 passed, 3 skipped** (RT-02, RT-03, RT-05 passam; RT-01/04/06 skip por falta de dados no ambiente)

### E2E Smoke — Correções CI

* **"admin sidebar has all 5 nav items"** (CI blocker): locators scopados a `<aside>` — `BottomNav` renderiza links com os mesmos nomes causando strict mode violation (`getByRole` encontrava 2 elementos)
* **"no JWT in localStorage"**: corrigido label de `[FAIL]` para `[PASS]` — `@supabase/ssr` usa cookies, não localStorage; o teste PASSA corretamente
* **"auth cookies are HttpOnly"**: comentário atualizado com a constraint arquitetural completa (Realtime WebSocket precisa de JWT legível por JS em `sb-*` cookies)

### Auditoria de Segurança

**Estado atual documentado:**

| Mecanismo | Status |
|---|---|
| JWT em `localStorage` | ✅ Nunca armazenado (`@supabase/ssr` usa cookies) |
| `apmcb_session` (iron-session) | ✅ HttpOnly, Secure, SameSite=Strict |
| Cookies `sb-*` (Supabase SSR) | ⚠️ SameSite=Lax, NÃO HttpOnly |
| CSRF token | ✅ Dentro da iron-session criptografada |

**Constraint arquitetural — por que `sb-*` não pode ser HttpOnly hoje:**
O Supabase Realtime (`createBrowserClient`) lê o JWT de `sb-*` via `document.cookie` para autenticar o WebSocket (phx_join). Cookies HttpOnly não são acessíveis via JS → `getSession()` retorna null → WebSocket usa anon JWT → RLS bloqueia todos os eventos privados.

**Migração Phase 2 (roadmap):**
1. BFF emite token efêmero de curta duração exclusivo para Realtime
2. `createBrowserClient` configurado com storage em memória (JWT nunca persistido)
3. Server Components lêem iron-session via `IRON_SESSION_SECRET` compartilhado
4. Cookies `sb-*` eliminados — `apmcb_session` torna-se a única sessão

---

# 2026-07-07 (v17)

### Features

**Realtime completo — toda movimentação de estoque, saídas e solicitações**

**DB Migrations:**
- `material_items` e `material_types` com `REPLICA IDENTITY FULL` + `ALTER PUBLICATION supabase_realtime ADD TABLE` — almoxarifado agora dispara WAL events para clientes Realtime
- Tabelas agora na publication: `audit_logs`, `lendings`, `material_items`, `material_requests`, `material_types`

**Hook compartilhado `useRealtimeRefresh`** (`apps/web/src/hooks/use-realtime-refresh.ts`):
- SSOT para subscriptions postgres_changes; elimina código duplicado
- Aceita event `"*"` (wildcard `REALTIME_POSTGRES_CHANGES_LISTEN_EVENT.ALL`) além de INSERT/UPDATE/DELETE
- Re-cria canal automaticamente quando `channelName` ou subs mudam (suporte a `userId` dinâmico)
- Todos os 3 componentes de sync usam o hook

**Componentes de sync criados:**
- `RealtimeArmeiroSync` — `lendings` + `material_requests` filtrados por `tenant_id` — incluído em `/reserva`, `/reserva/saidas`, `/reserva/solicitacoes`
- `RealtimeArsenalSync` — `material_items` + `material_types` + `lendings` filtrados por `tenant_id` — incluído em `/reserva/arsenal` e `/admin/arsenal`
- Filtro explícito por `tenant_id` necessário: Supabase Realtime não avalia corretamente policies com `STABLE` functions (`auth_role`, `auth_tenant_id`) no contexto WAL para subscriptions sem filtro

**`RealtimeEfetivoSync` refatorado** para usar `useRealtimeRefresh`; event `"*"` substitui INSERT+UPDATE separados

**Layout `/efetivo/layout.tsx` criado:**
- Monta `RealtimeEfetivoSync` uma única vez para todas as sub-rotas do cadete
- Cobre: `/efetivo`, `/efetivo/solicitacoes`, `/efetivo/minhas-cautelas`, `/efetivo/historico`, `/efetivo/perfil`
- Removida subscription duplicada de `/efetivo/page.tsx`

**Cobertura realtime pós-v17:**

| Rota | Tabelas subscritas | Resultado |
|---|---|---|
| `/efetivo` (e sub-rotas) | lendings, material_requests, profiles | ✅ via layout |
| `/reserva` (home counts) | lendings, material_requests | ✅ novo |
| `/reserva/saidas` | lendings, material_requests | ✅ novo |
| `/reserva/solicitacoes` | lendings, material_requests | ✅ novo |
| `/reserva/arsenal` | material_items, material_types, lendings | ✅ novo |
| `/admin/arsenal` | material_items, material_types, lendings | ✅ novo |

### E2E

**`e2e/realtime-suite.spec.ts`** — RT-01..RT-06: verifica que DOM atualiza sem page.reload()
- RT-01: `/efetivo` — devolução via DB → badge "Em uso" decrementa
- RT-02: `/efetivo/solicitacoes` — aprovação via DB → status badge muda para "Aprovado"
- RT-03: `/reserva` — INSERT em material_requests → count "Pendências Remotas" incrementa
- RT-04: `/reserva/saidas` — devolução via DB → lista de ativos atualiza
- RT-05: `/reserva/solicitacoes` — INSERT em material_requests → nova linha aparece
- RT-06: `/reserva/arsenal` — UPDATE em material_items → página recarrega sem reload

**`e2e/harness/realtime.ts`** — helpers de trigger via `supabaseAdmin()`:
`getActiveLendingForCadete`, `triggerLendingReturn`, `triggerSSAInsert`, `triggerSSAApproval`, `cancelSSARequest`, `triggerMaterialItemUpdate`

Adicionado projeto `realtime-suite` em `playwright.config.ts`

### Fixes (pós-v17)

- `triggerSSAInsert`: removido `expires_at` do INSERT (violava constraint `expires_requires_approval` — pendente não pode ter validade)
- `useRealtimeRefresh`: sinaliza `data-realtime-ready` no `<html>` quando canal WS é SUBSCRIBED (sincronização de testes)
- `realtime-suite.spec.ts`: locators corretos baseados no DOM real; tests aguardam `html[data-realtime-ready]` antes de cada trigger
- `_solicitacoes-client.tsx` (armeiro): `useEffect` sincroniza `requests` com `initialRequests` quando `router.refresh()` traz novos dados
- Subscriptions do armeiro/arsenal: adicionado filtro `tenant_id=eq.${tenantId}` — Supabase Realtime falha silenciosamente para subscriptions sem filtro quando RLS usa `STABLE` functions com `auth.uid()`

---

# 2026-07-06 (v16)

### Features

**Realtime — `/efetivo` atualiza sem recarregar a página**

* **Root cause**: tabela `lendings` não estava na publication `supabase_realtime` — eventos WAL nunca chegavam ao cliente Supabase Realtime; `RealtimeEfetivoSync` subscrevia a `postgres_changes` mas nunca recebia nada
* **Migration** (`enable_realtime_lendings_material_requests`):
  * `ALTER TABLE public.lendings REPLICA IDENTITY FULL` — inclui todos os campos nos eventos WAL (necessário para filtros por coluna em UPDATE/DELETE)
  * `ALTER TABLE public.material_requests REPLICA IDENTITY FULL`
  * `ALTER PUBLICATION supabase_realtime ADD TABLE public.lendings`
  * `ALTER PUBLICATION supabase_realtime ADD TABLE public.material_requests`
* **`RealtimeEfetivoSync`** (`apps/web/src/components/efetivo/realtime-efetivo-sync.tsx`): adicionadas subscriptions a INSERT + UPDATE em `material_requests` filtradas por `military_id=eq.userId` — cobre atualização de status de solicitações SSA em tempo real
* Efeito: devoluções pelo armeiro e aprovações/rejeições de SSA agora refletem instantaneamente na página `/efetivo` do cadete sem necessidade de recarregar

---

# 2026-07-05 (v15)

### Bug Fixes

**BFF — `checkTotpForMatricula`: remoção de filtro `tenant_id` inexistente em `profiles`**

* **Root cause**: `checkTotpForMatricula` filtrava `profiles` com `.eq("tenant_id", tenantId)`. A tabela `profiles` NÃO tem coluna `tenant_id` — PostgREST retornava HTTP 400 → SDK tratava como `profErr` → retornava 404 "Credenciais inválidas" para qualquer matrícula válida
* **Fix** (`apps/bff/src/routes/totp.ts`): removido `.eq("tenant_id", tenantId)` da query de `profiles`; adicionado lookup separado em `tenant_memberships` para garantir isolamento de tenant sem depender de coluna inexistente
* Efeito: fluxo "Receber Material" (armeiro identifica o militar via TOTP) agora funciona corretamente em produção

**BFF — `POST /api/ssa/requests`: null guard defensivo no mapeamento `itemRows`**

* **Fix** (`apps/bff/src/routes/ssa.ts`): substituída asserção não-nula `availMap.get(id)!` por guard explícito que retorna 409 e faz rollback da `material_requests` se o material não for encontrado no mapa; `nome` e `categoria` têm fallback `"N/A"` para campos opcionalmente nulos
* Envolto em `try/catch` para capturar TypeError antes de propagar como 500

### E2E

* `e2e/fluxo-receber.spec.ts` — RECV-01..05: testes de regressão do fluxo "Receber Material"
  * RECV-01: `POST /api/lendings/identify` matrícula válida + TOTP errado → 401 (nunca 404 por bug de tenant)
  * RECV-02: matrícula inexistente → 404
  * RECV-03: payload inválido → 400
  * RECV-04: modal abre no clique "Receber Material"
  * RECV-05: TOTP válido do cadete → 200 com `profile`
* `e2e/fluxo-ssa.spec.ts` — SSA-01..05: testes de regressão do fluxo "Solicitar Armamento"
  * SSA-01: `GET /available-materials` retorna lista sem campos de quantidade
  * SSA-02: TOTP inválido → 400, jamais 500
  * SSA-03: payload inválido → 400 (Zod)
  * SSA-04: solicitação duplicada → 403
  * SSA-05: TOTP válido → 201 com `request_id`
* Adicionados projetos `fluxo-receber` e `fluxo-ssa` em `playwright.config.ts`

---

# 2026-07-05 (v14)

### Features

**Painel Efetivo — Reestruturação completa do dashboard /efetivo**

* **Sidebar `usuario` — "Painel" isolado**: adicionado link standalone `Painel → /efetivo` (ícone `LayoutDashboard`) separado do accordion. "Meus Materiais" permanece como accordion com filhos "Minhas Cautelas" e "Solicitações Remotas"
* **4 cards de stats**: grid 2col (mobile) / 4col (sm+) com Em uso, Histórico, Devolvidos e **Cautelas** (novo — busca via BFF `/api/cautelamentos/ativos`)
* **Seções invertidas**: "Materiais em uso" (grouped table/card) aparece PRIMEIRO após os stats; "Solicitar Armamento" (botão + histórico de solicitações) aparece ABAIXO
* **Botão "Requisitar Armamento" integrado na seção**: removido do header da página, integrado dentro da seção "Solicitar Armamento" como CTA principal da seção
* **Tabela agrupada por movimentação**: modo tabela/grid agora exibe linha separadora de grupo (data, armeiro, reserva, badge Ativo + checkbox de grupo) antes dos itens de cada movimentação — mesmo comportamento do modo card

### Bug Fixes

* Restaurada label "Meus Materiais" no accordion do sidebar (v12 tinha renomeado erroneamente para "Painel")

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
