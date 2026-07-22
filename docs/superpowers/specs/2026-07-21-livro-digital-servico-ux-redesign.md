# Livro Digital de Serviço — Redesign de Navegação e Experiência (Armeiro + Admin)

> **Status:** proposta para revisão — NENHUM código de produção foi alterado nesta sessão. Fase de exploração/spec.
> **Data:** 2026-07-21
> **Autor:** exploração dedicada (PO/PM sênior), a pedido do dono do produto
> **Pedido original (voz do usuário):** "vi que tem botão lateral de historico e turno atual isso ta hoirrivel. [...] quero uma reimaginação completa desse livro de serviço [...] o mais prático funcional e interativo e intuitivo possível visualmente em todos sentidos para armeiro e admin da reserva e global"
> **Meta de qualidade:** nota 9.5/10 no padrão já estabelecido no projeto (ver `docs/superpowers/specs/2026-07-17-pwa-native-boot-experience-design.md` e `2026-07-14-biometric-bridge-phase1a-armeiro-ux-design.md` como referência de rigor)
> **Escopo confirmado:** 100% apresentação (Next.js client-side), com **uma única exceção pontual e explicitamente justificada** na seção 8 (query BFF, não migração nem endpoint novo)

---

## 0. Veredito

O problema relatado ("botão lateral de histórico e turno atual") **não é** que as abas estejam empilhadas verticalmente — isso já foi corrigido numa sessão anterior (ver `LDS43` em `apps/web/e2e/livro-digital.spec.ts:918-938`, que trava especificamente que as duas abas ficam lado a lado). O problema real, confirmado lendo o código, é **estrutural de hierarquia visual**: as abas `Tabs`/`TabsList` (`_livro-client.tsx:273-283`) são o **primeiro elemento navegável da página**, um grupo de pills pequeno (`max-w-xs`, ~320px) flutuando sozinho logo abaixo do `<h1>`, sem nenhuma relação visual com o status do turno — que só aparece **depois**, escondido dentro do conteúdo da aba "Turno Atual". Resultado: ao entrar na página, o usuário vê um seletor genérico antes de ver qualquer informação operacional. E ao trocar para "Histórico", ele **perde de vista** se está com turno ativo, há quanto tempo, e quantas pendências tem — informação crítica para quem "baixa paciência, precisa operar rápido".

A causa raiz não é o componente `Tabs` em si — é a **ordem de prioridade visual**: o seletor de navegação está antes do status operacional, quando deveria ser o oposto. Esta proposta resolve isso invertendo a hierarquia (status sempre visível e dominante; navegação subordinada e sempre presente), sem descartar o padrão de abas já validado (evita reescrever rotas, quebrar ARIA `role="tab"`, ou os testes `LDS28`/`LDS43` que dependem dele) — mas expande a "reimaginação" além da queixa literal, porque o pedido explícito foi por uma experiência completa, não um patch cosmético: cards de atalho hoje são decorativos e não clicáveis (violação direta do princípio do CLAUDE.md), o filtro por tipo de evento é implementado de duas formas diferentes e incompatíveis no armeiro vs. admin, a página de detalhe do admin duplica (e diverge) a configuração visual de eventos, e o dashboard admin não tem nenhum indicador confiável de "quem está de plantão agora" — que é literalmente o motivo de existir desta fase, segundo o próprio spec original (`docs/enterprise/phases/phase-6b-livro-digital-servico.md:44`: *"O comandante não sabe quem está de serviço agora"*).

---

## 1. Diagnóstico do Estado Atual

### 1.1 Navegação interna do armeiro — a queixa literal

**Arquivo:** `apps/web/src/app/(dashboard)/reserva/livro/_livro-client.tsx:271-283`

```tsx
<div className="space-y-4" data-testid="livro-ready">
  <Tabs defaultValue="turno">
    <TabsList className="grid w-full grid-cols-2 max-w-xs">
      <TabsTrigger value="turno">...Turno Atual</TabsTrigger>
      <TabsTrigger value="historico">...Histórico</TabsTrigger>
    </TabsList>
    <TabsContent value="turno" className="space-y-4 mt-4">
      {/* status do turno, stats, timeline — TUDO aqui dentro */}
```

Problemas concretos:

1. **Ordem invertida de prioridade.** O seletor de navegação (abas) vem antes do status operacional (badge "Turno Ativo", duração, pendências — linhas 288-354). Para um console operacional, isso é ao contrário: o estado "agora" deveria ser a primeira coisa vista, sempre, independente de qual aba está selecionada.
2. **Status "desaparece" ao trocar de aba.** Como o bloco de status (badge + stats) vive dentro de `<TabsContent value="turno">`, ele só existe quando a aba "Turno Atual" está ativa. Ao clicar em "Histórico", o armeiro perde toda visibilidade do turno em andamento — precisa voltar para checar se ainda está tudo bem.
3. **Navegação duplicada e morta.** `apps/web/src/app/(dashboard)/reserva/livro/historico/_historico-client.tsx:197-204` tem um link "← Turno atual" que navega para `/reserva/livro` via `<Link>` — mas a UI principal **não usa mais navegação por rota** para isso, usa troca de estado das `Tabs` (comentário no próprio código de teste confirma, `e2e/livro-digital.spec.ts:283-284`: *"Fase D substituiu o link de navegação por abas [...] a UI padrão agora troca de aba sem navegar"*). Ou seja: existem **dois mecanismos concorrentes** para o mesmo destino (o link morto da Fase C e as abas da Fase D), e a rota `/reserva/livro/historico` como página standalone (`historico/page.tsx`, com seu próprio `<h1>Histórico de Turnos</h1>`) continua existindo em paralelo ao conteúdo idêntico renderizado dentro da aba — duas superfícies visuais diferentes (com títulos diferentes!) para o mesmo dado, violação direta de SSOT.
4. **Não é deep-linkável.** `defaultValue="turno"` é fixo — recarregar a página, ou compartilhar a URL `/reserva/livro`, sempre volta para "Turno Atual", mesmo que o usuário estivesse no histórico.

### 1.2 Cards de atalho são decorativos, não atalhos

**Arquivo:** `_livro-client.tsx:334-354` — os três cards (Eventos / Pendências / Cautelas) são `<div>` estáticos, sem `onClick`, sem hover state, sem nenhuma ação. O CLAUDE.md deste projeto declara como princípio canônico: *"Cards de atalho: contagens em tempo real nos cards de painel eliminam navegação desnecessária"*. Hoje, clicar no card "2 Pendências" não faz nada — o armeiro ainda precisa rolar manualmente a timeline procurando os itens marcados como pendentes. É uma violação direta e literal do princípio já documentado como autoridade do projeto.

### 1.3 Filtro por tipo de evento — duas implementações incompatíveis

- **Armeiro** (`_livro-client.tsx:359-370`): só busca por texto livre (`Input` + `Search`), que faz `.includes()` client-side em descrição/tipo/nome/matrícula. Não existe filtro estruturado por tipo de evento.
- **Admin detalhe** (`_shift-detail-client.tsx:220-231`): filtro por **botões de tipo**, mas com uma lista hardcoded de apenas 4 dos 11 tipos existentes (`["", "cautela_emitida", "saida_autorizada", "ocorrencia_registrada", "evento_manual"]`) — faltam `cautela_devolvida`, `saida_devolvida`, `solicitacao_aprovada`, `solicitacao_negada`, `inventario_divergencia`, `turno_encerrado`. E não existe busca por texto ali.

Dois paradigmas de filtro diferentes para a mesma tarefa conceitual ("navegar uma linha do tempo de eventos"), dependendo só de quem está logado. Isso é inconsistência de UX e duplicação de lógica — o BFF já suporta os dois eixos nativamente (`apps/bff/src/routes/shifts.ts:207,232-235`: `GET /:id/events?type=&pending_only=`), mas **nenhuma das duas telas usa esses parâmetros** — ambas buscam todos os eventos e filtram 100% no client, com implementações diferentes e incompletas.

### 1.4 Configuração visual de eventos duplicada e divergente

Existem **três** cópias independentes do mapeamento tipo-de-evento → label/cor:

| Arquivo | Linhas | Tem ícone? | Label de `solicitacao_aprovada` |
|---|---|---|---|
| `_livro-client.tsx` | 37-49 | Sim (emoji) | "Solicitação Aprovada" |
| `_historico-client.tsx` | 27-39 | Não | "Solicitação Aprovada" |
| `_shift-detail-client.tsx` (admin) | 25-37 | Não | "Sol. Aprovada" |

A terceira já divergiu da primeira (label abreviado, sem ícone) — prova concreta de que a duplicação já causou drift, não é um risco teórico. Qualquer novo tipo de evento (ou mudança de cor/label) precisa ser replicado manualmente em 3 lugares, com alto risco de esquecer um.

### 1.5 Pendências: sinal fraco no armeiro, sinal morto no admin

- No armeiro, uma pendência aberta é só um badge laranja pequeno (`AlertTriangle` + "Pendente") dentro do card do evento na timeline (`_livro-client.tsx:442-447`) — não tem destaque próprio, é preciso rolar a timeline inteira para achar todas.
- No admin (`_admin-livros-client.tsx:180-185`), o card de cada turno mostra `shift.pending_count` — mas essa coluna (`service_shifts.pending_count`, `supabase/migrations/20260628000002_service_shifts_livro_digital.sql:19`) **nunca é atualizada em nenhum lugar do código**. Busquei `pending_count` em todo `apps/bff/src` e nas migrations: a única ocorrência fora da migration original é a leitura em `shifts.ts:400` — não existe nenhum `UPDATE`, trigger ou incremento. **O badge de pendências no dashboard admin está sempre mostrando 0** (ou o valor de inserção original, que também é sempre 0 por default) — é uma funcionalidade que parece existir na tela mas está morta desde que foi implementada.
- **Achado adicional, funcional (não só visual):** busquei em todo `apps/bff/src` e nas migrations por qualquer código que escreva em `service_log_events.resolved_at`. Não existe nenhum. A coluna é lida (`shifts.ts:226,234,272`) mas **nunca escrita** — não existe, em nenhum lugar do produto hoje, uma ação de "marcar pendência como resolvida". Uma vez criada, uma pendência permanece pendente para sempre. Isso não é uma queixa de UX, é um gap funcional real no loop de auditoria que esta fase existe para garantir ("prova imutável de responsabilidade" — se pendências nunca fecham, o sinal perde valor com o tempo). Tratado como achado separado na seção 8 (fora do escopo desta reforma de apresentação, mas registrado como recomendação de follow-up).

### 1.6 Admin `/admin/livros` — sem separação entre "agora" e "arquivo"

**Arquivo:** `_admin-livros-client.tsx` — a lista mistura, com o mesmo peso visual, turnos ativos agora e turnos encerrados há meses, ordenados só por `started_at desc` (`shifts.ts:406`). O próprio spec original desta fase (`docs/enterprise/phases/phase-6b-livro-digital-servico.md:404-409`) já pedia um "Grid de cards: um por armeiro com turno ativo" no topo, separado do histórico — isso nunca foi implementado dessa forma; o que existe é uma lista plana com filtro `status=ativo` que o admin precisa aplicar manualmente. Para o público desta tela (oversight — "quem está de plantão agora, em qualquer reserva"), isso é a lacuna de IA mais cara: a pergunta mais frequente do admin não tem uma resposta de 1 clique.

### 1.7 Admin não tem paridade de tempo real

O armeiro tem sincronização via SSE (`_livro-client.tsx:143-165`, `useSSERefresh`) — novo evento aparece na timeline sem recarregar. O admin (`_admin-livros-client.tsx`) **não tem nenhuma inscrição realtime** — só atualiza com o clique manual em "Atualizar". Um console de oversight que não atualiza sozinho contradiz o próprio propósito da tela.

### 1.8 Detalhe admin — sem breadcrumb, sem busca, timeline duplicada

`_shift-detail-client.tsx` reimplementa a renderização da timeline (cards com badge, hash tooltip, etc.) de forma quase idêntica à do armeiro, mas com o `EVENT_CONFIG` divergente já citado (1.4), sem campo de busca (existe no armeiro, não aqui), e sem breadcrumb (o spec original pedia `Livros de Serviço → [Nome Armeiro] → Turno [data]`, hoje existe só um link genérico "← Todos os livros", `_shift-detail-client.tsx:144-150`).

### 1.9 O que **não** é o problema (verificado, não é o "botão lateral")

- **Sidebar principal** (`apps/web/src/components/layout/sidebar.tsx:57,76`) — "Livro de Serviço" (armeiro) e "Livros de Serviço" (admin) são itens de menu vertical padrão, iguais a todos os outros itens do app (Arsenal, Saídas, etc.), renderizados pelo mesmo `linkClass()`/`isActive()` reutilizado em todo o sistema. Não há nada de especial ou quebrado aqui — investigado e descartado como causa da queixa.
- **Tema claro/escuro** — o guia `docs/enterprise/03-ui-design-system-guardrails.md:23` afirma "Dark como padrão único — sem toggle de tema claro", mas o código real (`apps/web/src/components/providers.tsx:407`, `next-themes` com `defaultTheme="system"`) e os tokens em `globals.css` (bloco `:root` claro nas linhas 39-63, bloco escuro nas linhas 117-137) mostram que o produto **tem, sim, os dois temas**. O guia está desatualizado nesse ponto — não é bloqueante para este spec, mas registro aqui porque todo wireframe abaixo precisa funcionar nos dois temas (ver seção 7).

---

## 2. Personas e Objetivo

| | Armeiro (`/reserva/livro`) | Admin reserva/global (`/admin/livros`) |
|---|---|---|
| Tarefa dominante | Operar o turno **agora**: registrar evento, ver o que já aconteceu, resolver pendência | **Oversight** entre múltiplos turnos/armeiros/reservas: quem está de plantão, investigar incidente, exportar |
| Paciência | Baixa — precisa da ação em ≤ 2 cliques | Média — aceita navegação em 2 níveis (lista → detalhe) desde que a lista responda a pergunta certa |
| Pergunta mais frequente | "O que já aconteceu no meu turno? Preciso registrar algo." | "Quem está de plantão agora, em qualquer reserva, e há alguma pendência preocupante?" |
| Hoje resolve em | Rolar timeline manualmente | Aplicar filtro `status=ativo` manualmente numa lista misturada |

**Objetivo desta proposta:** inverter a hierarquia visual em ambas as telas para que a pergunta dominante de cada persona tenha resposta imediata, sem navegação — e eliminar as três formas de duplicação encontradas (config de eventos, filtro de tipo, timeline) com componentes compartilhados.

---

## 3. Proposta — Armeiro (`/reserva/livro` + `/reserva/livro/historico`)

### 3.1 Decisão de arquitetura: manter `Tabs`, inverter a hierarquia (não trocar por rotas)

Duas abordagens foram consideradas:

**A. Manter `Tabs` (base-ui) com troca de estado client-side, mas mover o status do turno para FORA de `TabsContent`** — o bloco de status/pendências/atalhos passa a viver acima das `Tabs`, e as próprias `Tabs` (agora só "Turno Atual" vs "Histórico") tornam-se um sub-componente visualmente subordinado, não a primeira coisa da página.

**B. Substituir `Tabs` por rotas reais** (`/reserva/livro` e `/reserva/livro/historico` como páginas irmãs sob um `layout.tsx` compartilhado, navegação por `<Link>`), ganhando deep-link real e paridade de URL com o estado visível.

**Escolhida: A.** Motivo: a queixa do usuário é sobre **hierarquia e peso visual**, não sobre a URL não mudar — hoje `defaultValue="turno"` já não é deep-linkável mesmo sendo `Tabs`, então essa lacuna não é nova nem piora com a opção A. A opção B exigiria: (1) um `layout.tsx` novo em `reserva/livro/`, (2) trocar a semântica ARIA de `role="tab"` para `role="link"` — quebrando os testes `LDS28` (`e2e/livro-digital.spec.ts:561-568`, que faz `getByRole("tab", ...)`) e `LDS43` (linhas 918-938, mesma base) e os helpers `switchToHistoricoTab`/`switchToTurnoTab` (`e2e/harness/livro.ts:37-43`), (3) risco de regressão maior para um ganho (deep-link de histórico) que ninguém pediu e que hoje não é possível de qualquer forma. **KISS/YAGNI**: resolver o problema relatado com a menor mudança estrutural possível. Se no futuro deep-linking de um turno específico do histórico virar requisito real (ex: link direto para auditoria externa), a opção B fica documentada aqui como caminho de evolução — não descartada, só não justificada agora.

### 3.2 Nova estrutura de `_livro-client.tsx`

```
<LivroShell>                                    ← NOVO wrapper, sempre visível
  <ShiftStatusBar />                             ← status do turno, SEMPRE no topo
  {shift && <PendingRail />}                     ← pendências em destaque, condicional
  <Tabs defaultValue="turno">
    <TabsList variant="underline">               ← estilo sublinhado, não pill — ver 3.6
      <TabsTrigger value="turno">Turno Atual</TabsTrigger>
      <TabsTrigger value="historico">Histórico</TabsTrigger>
    </TabsList>
    <TabsContent value="turno">
      <ShortcutStatCards clickable />             ← cards viram atalhos reais
      <EventTypeFilterChips />                    ← NOVO, substitui só a busca de texto
      <SearchInput />                             ← mantido, complementar aos chips
      <ShiftTimeline />                           ← usa componente compartilhado (3.5)
    </TabsContent>
    <TabsContent value="historico">
      <HistoricoContent />                        ← lazy, mantido; remove link morto (3.3)
    </TabsContent>
  </Tabs>
</LivroShell>
```

### 3.3 `ShiftStatusBar` (novo componente, `components/livro/shift-status-bar.tsx`)

Substitui o bloco de cabeçalho hoje em `_livro-client.tsx:288-332`. Fica **fora** de `TabsContent` — visível em "Turno Atual" e em "Histórico" igualmente. Conteúdo:

- Esquerda: pill de status (bolinha pulsante verde + "Turno Ativo" / cinza + "Sem turno ativo") + nome da reserva + **duração ao vivo** ("há 6h 42min", atualiza a cada 60s via `setInterval`, tooltip no hover mostra o horário absoluto de início). Hoje só existe o horário absoluto fixo (`_livro-client.tsx:302-306`) — a duração viva foi pedida no spec original (`phase-6b...md:376`, `"⏱ 6h 42min em serviço"`) e nunca implementada.
- Centro/direita: badge de pendências, só quando `count > 0`, com **cor escalando por idade** da pendência mais antiga não resolvida (verde/ausente → laranja se houver alguma pendência aberta → vermelho se a mais antiga tem mais de 2h) — clicável, rola até `PendingRail`.
- Direita: ações primárias — **as mesmas de hoje** (`Registrar`, `Encerrar Turno` / `Assumir Turno`), sem mudança de comportamento ou de autenticação (TOTP/biometria via `ShiftAuthDialog`, inalterado).

Consequência direta: o link morto "← Turno atual" em `_historico-client.tsx:197-204` é **removido** — agora redundante, porque o `ShiftStatusBar` já mostra o turno atual permanentemente, e a aba "Turno Atual" está a um clique, sempre visível ao lado de "Histórico".

### 3.4 `PendingRail` (novo componente, `components/livro/pending-rail.tsx`)

Painel compacto, renderizado logo abaixo do `ShiftStatusBar`, só quando existe turno ativo:

- Se `pendingCount === 0`: uma linha fina, discreta, "Nenhuma pendência aberta" com ícone de check — confirma o estado positivo sem ocupar espaço (feedback visual imediato também vale para "está tudo bem", não só para alertas).
- Se `pendingCount > 0`: expandido por padrão, lista cada pendência (ícone do tipo, descrição truncada em 1 linha, "há Xh Ym"), cada linha clicável — rola a timeline até o evento e aplica destaque temporário (ring/highlight de 2s).

Isso resolve 1.5: hoje a única forma de achar todas as pendências é rolar a timeline inteira lendo badge por badge.

### 3.5 `ShortcutStatCards` — cards de atalho de verdade

Mesmos 3 cards de hoje (Eventos / Pendências / Cautelas), mas agora com `onClick`: cada card seta um filtro ativo (`"all" | "pending" | "cautela"`) que filtra a timeline abaixo — reaproveitando os parâmetros que o BFF já aceita e nunca são usados (`?pending_only=true`, `?type=cautela_emitida`) em vez de só filtrar client-side. O card ativo ganha um `ring-2 ring-primary` para indicar estado selecionado. Isso implementa literalmente o princípio do CLAUDE.md hoje violado (1.2).

### 3.6 `EventTypeFilterChips` (novo componente compartilhado, `components/livro/event-type-filter-chips.tsx`)

Usado **tanto no armeiro quanto no detalhe admin** (seção 4.4) — elimina a duplicação de 1.3. Cobre os 11 tipos reais. Respeita a regra do guia de design system (`03-ui-design-system-guardrails.md:497`: "nunca mais de 4 filtros visíveis"): mostra os 4-5 tipos mais frequentes como chips diretos (`Cautela Emitida`, `Cautela Devolvida`, `Saída Autorizada`, `Ocorrência`) + um chip "Mais tipos" que abre um popover com os demais. Import único do mapa de configuração (3.7) — trocar um label/cor não exige mais tocar 3 arquivos.

### 3.7 `event-type-config.ts` (novo módulo, não componente — `lib/livro/event-type-config.ts`)

Fonte única de verdade: `{ [EventType]: { label, color, icon } }`, com os 11 tipos, ícone `lucide-react` (não emoji — o guia de design system, seção 19, proíbe emoji em texto de UI; os emojis atuais em `_livro-client.tsx:37-49` já violam essa regra própria do projeto). Consumido por `ShiftStatusBar`, `PendingRail`, `EventTypeFilterChips`, `ShiftTimeline`/`ShiftEventCard` e pela página de detalhe do admin — resolve 1.4 definitivamente.

### 3.8 `TabsList variant="underline"`

Não é um novo componente do design system — apenas uma variação de estilo no uso local do `Tabs` já existente: trocar o fundo tipo "pill" atual (`grid-cols-2 max-w-xs` com bordas visíveis) por um estilo de sub-navegação sublinhada (texto + indicador de borda inferior no item ativo, sem card/pill em volta), visualmente mais leve — reduz o peso do seletor de aba para que ele leia como "sub-navegação do console", não como "um menu lateral disfarçado de horizontal", que é a sensação relatada.

---

## 4. Proposta — Admin (`/admin/livros` + `/admin/livros/[shift_id]`)

### 4.1 `/admin/livros` — separar "Em Serviço Agora" de "Arquivo"

Nova estrutura de `_admin-livros-client.tsx`:

```
┌─ EM SERVIÇO AGORA ──────────────────────────────────────────┐
│  (grid de ActiveShiftCard, 1 por turno com status=ativo,     │
│   em TODAS as reservas visíveis pro admin — atualiza via SSE)│
│                                                                │
│  Se count === 0: "Nenhum armeiro de plantão no momento"      │
└────────────────────────────────────────────────────────────┘

┌─ ARQUIVO ──────────────────────────────────────────────────┐
│  (lista atual, filtros de busca/status/período mantidos,     │
│   default status=encerrado — "agora" já está na grid acima)  │
└────────────────────────────────────────────────────────────┘
```

`ActiveShiftCard` (novo, `components/livro/active-shift-card.tsx`): armeiro (posto+nome+matrícula), reserva, duração ao vivo (mesmo componente de 3.3), contagem de eventos, contagem de pendências reais com cor por idade (depende do fix de 4.3), botão "Ver Livro" → `/admin/livros/[shift_id]`. Clique no card inteiro também navega (Fitts — alvo grande).

### 4.2 Paridade de tempo real (fecha 1.7)

`_admin-livros-client.tsx` passa a usar o mesmo `useSSERefresh` já usado pelo armeiro (`_livro-client.tsx:143-165`) — mesmo canal tenant-wide, mesmo padrão de filtro client-side por tabela (`service_shifts`/`service_log_events`), sem nenhuma mudança de infraestrutura de realtime, só reaproveitando o hook existente. A grid "Em Serviço Agora" atualiza sozinha quando um turno abre/fecha ou uma pendência é criada, sem precisar do clique manual em "Atualizar".

### 4.3 Sinal de pendência confiável — única exceção de escopo

Hoje `shift.pending_count` é lido de uma coluna morta (achado 1.5). Para a grid "Em Serviço Agora" ter algum valor real (o motivo inteiro desta fase existir), o admin precisa de um número de pendências **correto**. Duas opções, apresentadas para decisão do usuário — nenhuma foi implementada:

- **Opção 1 (recomendada):** trocar, na query já existente de `GET /api/shifts` (`apps/bff/src/routes/shifts.ts:397-410`), o embed `service_log_events(count)` por dois embeds com alias — um para o total (já existe) e um novo `pending_events:service_log_events!inner(count)` com filtro `is_pending.eq.true,resolved_at.is.null`. É uma mudança de **query**, não de schema nem endpoint novo — o contrato de resposta ganha um campo `pending_count` calculado ao vivo (substituindo o campo hoje morto, sem quebrar consumidores). Baixo risco, mas ainda é uma mudança em `apps/bff`, por isso citada aqui explicitamente em vez de assumida em silêncio.
- **Opção 2:** não mexer no BFF nesta fase — a grid "Em Serviço Agora" nasce sem contagem de pendências (só duração + eventos), e o card mostra "Ver detalhes para conferir pendências" em vez de um número. Escopo 100% client-side, mas entrega um valor menor da funcionalidade mais pedida pelo admin.

Este spec não decide por qual seguir — fica registrado como decisão pendente do usuário antes da implementação (ver seção 8).

### 4.4 `/admin/livros/[shift_id]` — reaproveitar componentes, adicionar breadcrumb e busca

- Timeline: passa a usar o mesmo componente compartilhado do armeiro (`ShiftEventCard`, ver 3.7) em vez da cópia divergente de `_shift-detail-client.tsx:25-37` — fecha 1.4 e 1.8 ao mesmo tempo.
- Filtro de tipo: troca os 5 botões hardcoded (`_shift-detail-client.tsx:220-231`) pelo `EventTypeFilterChips` compartilhado (3.6) — agora cobre os 11 tipos, não 4.
- Adiciona campo de busca por texto (paridade com o armeiro, hoje ausente aqui).
- Breadcrumb: `Livros de Serviço → [Posto + Nome do Armeiro] → Turno de [data]`, substituindo o link genérico "← Todos os livros" — implementa o que o spec original já pedia (`phase-6b...md:415`) e nunca foi construído.

---

## 5. Como a Proposta Atende aos Princípios de UX do CLAUDE.md

| Princípio (CLAUDE.md) | Estado atual | Como esta proposta atende |
|---|---|---|
| **Mínimo de fricção (≤2 cliques)** | Ver todas as pendências = rolar timeline inteira manualmente; ver "quem está de plantão" no admin = aplicar filtro `status=ativo` manualmente | `PendingRail` = 1 clique até o evento; grid "Em Serviço Agora" = a pergunta já é a primeira coisa vista, 0 cliques de filtro; `ShortcutStatCards` clicáveis = 1 clique até a visão filtrada |
| **Feedback visual imediato** | Pendência é só um badge pequeno inline; admin sem indicação de "ao vivo" | Cor escalando por idade da pendência (verde/laranja/vermelho); duração ao vivo ticking; SSE no admin mostra mudança sem ação do usuário; `PendingRail` confirma "tudo ok" mesmo quando não há problema |
| **Defaults inteligentes** | Já razoável hoje (histórico limita a 10, filtros default "todos") | Mantido; grid "Em Serviço Agora" não precisa de nenhum filtro para responder a pergunta mais comum — é o próprio default da tela |
| **Cards de atalho com contagens em tempo real** | Cards existem mas são 100% decorativos (`onClick` ausente) — violação direta e citada do princípio | `ShortcutStatCards` ganham `onClick` real, filtram a timeline, estado ativo visualmente marcado |
| **Confirmação contextual só para ações destrutivas/irreversíveis** | Já correto hoje (`ShiftAuthDialog` só em abrir/fechar turno) | Mantido sem alteração — nenhuma confirmação nova é introduzida para navegação/filtro, que não são destrutivos |

---

## 6. Wireframes

### 6.1 `/reserva/livro` — Turno Atual (com turno ativo, pendências abertas)

```
┌───────────────────────────────────────────────────────────────────────┐
│ Livro Digital de Serviço                                               │
│ Linha do tempo do seu turno — todos os eventos com hash verificável    │
├───────────────────────────────────────────────────────────────────────┤
│ ● Turno Ativo — Academia de Polícia Militar        [Atualizar]         │
│   há 6h 42min (desde 08:00)      ⚠ 2 pendências    [Registrar] [Encerrar Turno]│
├───────────────────────────────────────────────────────────────────────┤
│ ⚠ PENDÊNCIAS ABERTAS (2)                                          [▾]  │
│  • Ocorrência: fuzil com trava travada — há 3h12min            →       │
│  • Divergência inventário: item #003 não localizado — há 40min →       │
├───────────────────────────────────────────────────────────────────────┤
│  Turno Atual │ Histórico                                               │  ← sublinhado, leve
│ ─────────────                                                          │
│                                                                         │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐                            │
│  │     14    │ │     2 ⚠   │ │     5     │   ← clicáveis, ring ativo  │
│  │  Eventos  │ │Pendências │ │ Cautelas  │                            │
│  └───────────┘ └───────────┘ └───────────┘                            │
│                                                                         │
│  [Cautela ] [Devolução] [Saída] [Ocorrência] [Mais tipos ▾]  🔍 Buscar│
│                                                                         │
│  08:00 ▶ Turno Assumido — Ten. Silva                              (i) │
│  08:45 📋 Cautela Emitida: PT-0042 → Cb. João                     (i) │
│  11:00 ⚠ Ocorrência: Fuzil com trava — PENDENTE                   (i) │
│  ...                                                                    │
└───────────────────────────────────────────────────────────────────────┘
```

### 6.2 `/reserva/livro` — Histórico (aba trocada, status permanece visível)

```
┌───────────────────────────────────────────────────────────────────────┐
│ Livro Digital de Serviço                                               │
├───────────────────────────────────────────────────────────────────────┤
│ ● Turno Ativo — Academia de Polícia Militar        [Atualizar]         │  ← NÃO some
│   há 6h 43min (desde 08:00)      ⚠ 2 pendências    [Registrar] [Encerrar Turno]│
├───────────────────────────────────────────────────────────────────────┤
│  Turno Atual │ Histórico                                               │
│              ─────────                                                 │
│                                                                         │
│  Status: [Todos ▾]  Período: [__/__] a [__/__]         [Atualizar]     │
│                                                                         │
│  ▸ Ativo    APMCB · 21/07 08:00 · 6h43m · 14 eventos                   │
│  ▸ Encerrado APMCB · 20/07 08:00→16:00 · 8h · 22 eventos  [PDF][CSV]   │
│  ▸ Encerrado APMCB · 19/07 08:00→16:00 · 8h · 18 eventos  [PDF][CSV]   │
│                                                    [Ver mais ▾]         │
└───────────────────────────────────────────────────────────────────────┘
```

### 6.3 `/admin/livros` — Em Serviço Agora + Arquivo

```
┌───────────────────────────────────────────────────────────────────────┐
│ Livros Digitais de Serviço                                             │
│ Histórico de todos os turnos — armeiros, reservas, eventos e pendências│
├───────────────────────────────────────────────────────────────────────┤
│ ● EM SERVIÇO AGORA (3)                                     🔄 ao vivo  │
│ ┌─────────────────────┐ ┌─────────────────────┐ ┌─────────────────┐  │
│ │ Ten. Silva           │ │ Sgt. Costa           │ │ Cb. Rocha        │  │
│ │ APMCB · há 6h43m      │ │ 2º BPM · há 1h05m     │ │ CIPE · há 15min  │  │
│ │ 14 eventos · ⚠ 2 pend.│ │ 6 eventos · 0 pend.   │ │ 1 evento          │  │
│ │        [Ver Livro →] │ │        [Ver Livro →] │ │   [Ver Livro →]  │  │
│ └─────────────────────┘ └─────────────────────┘ └─────────────────┘  │
├───────────────────────────────────────────────────────────────────────┤
│ ARQUIVO                                                                 │
│ 🔍 [Buscar armeiro/reserva]  Status:[Encerrados ▾] Período:[__][__]    │
│                                                                          │
│  Encerrado  Sgt. Pereira · APMCB · 20/07 · 8h · 22 eventos  [Ver Livro]│
│  Encerrado  Cb. Alves    · 2º BPM · 19/07 · 8h · 18 eventos [Ver Livro]│
└───────────────────────────────────────────────────────────────────────┘
```

### 6.4 `/admin/livros/[shift_id]` — Detalhe com breadcrumb

```
┌───────────────────────────────────────────────────────────────────────┐
│ Livros de Serviço → Ten. Silva → Turno de 21/07                        │
├───────────────────────────────────────────────────────────────────────┤
│ ● Ativo  ⚠ 2 pendências         Ten. Silva · mat. 000002 · APMCB       │
│ Início: 21/07 08:00                              [PDF][CSV][JSON]      │
│ ┌──────────────────────────────┐                                       │
│ │ 127 itens │ 3 cautelas ativas │ 0 saídas abertas                    │
│ └──────────────────────────────┘                                       │
├───────────────────────────────────────────────────────────────────────┤
│ [Cautela] [Devolução] [Saída] [Ocorrência] [Mais tipos ▾]  🔍 Buscar   │
│                                                                          │
│  08:00 ▶ Turno Assumido                                            (i) │
│  08:45 📋 Cautela Emitida: PT-0042 → Cb. João                      (i) │
│  ...                                                                    │
└───────────────────────────────────────────────────────────────────────┘
```

---

## 7. Contratos de Componentes Novos (suficiente para implementação)

```ts
// lib/livro/event-type-config.ts — fonte única de verdade (fecha achado 1.4)
export const EVENT_TYPE_CONFIG: Record<EventType, {
  label: string; colorClass: string; Icon: LucideIcon;
}>;

// components/livro/shift-status-bar.tsx
interface ShiftStatusBarProps {
  shift: Shift | null;
  pendingCount: number;
  oldestPendingAgeMinutes: number | null; // p/ cor escalonada
  onAssumir: () => void;
  onEncerrar: () => void;
  onRegistrar: () => void;
  refreshing: boolean;
  onRefresh: () => void;
}

// components/livro/pending-rail.tsx
interface PendingRailProps {
  pendingEvents: LogEvent[];
  onJumpTo: (eventId: string) => void;
}

// components/livro/shortcut-stat-cards.tsx
interface ShortcutStatCardsProps {
  eventos: number; pendencias: number; cautelas: number;
  activeFilter: "all" | "pending" | "cautela";
  onSelect: (filter: "all" | "pending" | "cautela") => void;
}

// components/livro/event-type-filter-chips.tsx (compartilhado armeiro+admin)
interface EventTypeFilterChipsProps {
  value: EventType | "";
  onChange: (v: EventType | "") => void;
  visibleTypes?: EventType[]; // default: 4 mais frequentes + "Mais tipos"
}

// components/livro/shift-event-card.tsx + shift-event-row.tsx (timeline/list — compartilhado)
interface ShiftEventProps {
  event: LogEvent;
  variant: "timeline" | "row";
  highlighted?: boolean; // usado pelo PendingRail.onJumpTo
}

// components/livro/active-shift-card.tsx (admin — grid "Em Serviço Agora")
interface ActiveShiftCardProps {
  shift: Shift & { armeiro: Armeiro; pending_count: number };
  onOpen: () => void;
}

// hooks/livro/use-live-duration.ts
function useLiveDuration(startedAt: string, endedAt?: string | null): string; // "há 6h 42min"
```

---

## 8. Escopo e Fora de Escopo

**Dentro do escopo desta proposta (100% apresentação):**
- Todos os componentes novos da seção 7.
- Reorganização de `_livro-client.tsx`, `_historico-client.tsx`, `_admin-livros-client.tsx`, `_shift-detail-client.tsx`.
- Uso dos parâmetros `?type=` e `?pending_only=` que o BFF **já aceita** (`shifts.ts:207,232-235`) — nenhuma mudança de contrato, só passar a consumir o que já existe.
- Consolidação do `EVENT_CONFIG` em módulo único.

**Única exceção, explicitamente sinalizada (não decidida por este spec):** o fix do sinal de pendência no dashboard admin (seção 4.3) exige uma mudança de **query** em `GET /api/shifts` no BFF — não é migração, não é endpoint novo, mas é uma mudança fora de `apps/web`. Fica registrada como decisão pendente: seguir com a Opção 1 (fix completo) ou Opção 2 (grid nasce sem contagem de pendências, escopo 100% front-end).

**Fora de escopo, registrado como achado para follow-up separado:**
- Ação de "marcar pendência como resolvida" (achado 1.5, `resolved_at` nunca escrito em lugar nenhum) — exige endpoint BFF novo (`PATCH /api/shifts/:id/events/:event_id/resolve`, `roleGuard("armeiro")`, log de evento de resolução) + migração de policy se necessário. Não pedido pelo usuário nesta rodada; registrado porque foi encontrado durante a exploração e é um gap funcional real, não cosmético.
- Página pública de verificação de hash chain de turno (hoje só existe a API crua `GET /api/public/shifts/:id/verify`, testada em `LDS35`, sem UI — ao contrário de `/v/[document_id]` que já tem página pública para documentos assinados). Ideia de melhoria futura para reforçar o "argumento de governança" do PDF exportado (ex: QR code no PDF apontando para uma página de verificação), não solicitada, não incluída aqui.

---

## 9. Critérios de Aceite Mensuráveis

| # | Critério | Como verificar |
|---|---|---|
| A1 | `ShiftStatusBar` permanece visível e com os mesmos dados ao trocar para a aba "Histórico" | Teste E2E: navegar para `/reserva/livro` com turno ativo, clicar aba Histórico, `expect` badge "Turno Ativo" continua visível |
| A2 | Clicar no card "Pendências" filtra a timeline para mostrar só eventos `is_pending && !resolved_at` | E2E: contar cards da timeline antes/depois do clique, comparar com contagem de pendências |
| A3 | `PendingRail` lista exatamente os eventos pendentes não resolvidos do turno ativo | E2E: comparar contagem do rail com `events.filter(e => e.is_pending && !e.resolved_at).length` |
| A4 | `EventTypeFilterChips` cobre os 11 tipos de evento (visíveis + "Mais tipos") | Teste estático/unitário: `Object.keys(EVENT_TYPE_CONFIG).length === 11`, todos alcançáveis via chip direto ou popover |
| A5 | Nenhum arquivo além de `lib/livro/event-type-config.ts` declara um mapa `EVENT_CONFIG`/`EVENT_LABEL` próprio | Busca estática (`grep`) no harness/CI: 0 ocorrências de declaração duplicada |
| A6 | `/admin/livros` mostra grid "Em Serviço Agora" com todos os turnos `status=ativo` do tenant, antes da lista "Arquivo" | E2E: seed de 2 turnos ativos + 1 encerrado, verificar ordem/posição visual |
| A7 | Grid "Em Serviço Agora" atualiza sem reload quando um novo turno é aberto (SSE) | E2E: abrir turno via API em paralelo, esperar card aparecer sem `page.reload()` |
| A8 | Abas "Turno Atual"/"Histórico" continuam com `role="tab"` e lado a lado (não regride LDS28/LDS43) | Suite `livro-suite` existente passa sem alteração de seletor |
| A9 | Duração ao vivo no `ShiftStatusBar` e no `ActiveShiftCard` atualiza pelo menos 1x/min sem ação do usuário | E2E com `page.clock` ou espera real de 60s+ε, `expect` texto de duração mudou |
| A10 | Todos os componentes novos renderizam corretamente em tema claro e escuro (sem hardcoded hex, só tokens Tailwind) | Checklist visual manual (seção 24 do guia de design system) nos dois temas |
| A11 | Nenhuma ação nova de navegação/filtro dispara `Dialog` de confirmação (só abrir/fechar turno mantém `ShiftAuthDialog`) | Revisão de código — nenhum novo `Dialog`/`confirm` fora dos já existentes |

---

## 10. Riscos e Trade-offs

| Risco | Mitigação |
|---|---|
| Usuário acostumado com a posição atual dos cards/busca pode estranhar a nova ordem | Mudança é presença de novos elementos (status bar, pending rail) + reposicionamento, não remoção de funcionalidade — tudo que existe hoje continua existindo |
| `PendingRail` some/aparece dinamicamente pode causar layout shift perceptível | Reservar altura mínima (linha "Nenhuma pendência aberta" sempre ocupa o espaço, não colapsa a zero) |
| Grid "Em Serviço Agora" pode ficar vazia/estranha em tenants pequenos (1 reserva, 1 armeiro) | Estado vazio explícito ("Nenhum armeiro de plantão no momento"), consistente com o padrão de empty-state do guia de design system |
| SSE tenant-wide já usado pelo armeiro passa a ter mais um consumidor (admin) por sessão aberta | Mesmo padrão de fan-out já existente (cada armeiro logado já assina o canal) — não é um padrão novo de infraestrutura, só mais um assinante do mesmo tipo |
| Mobile: `ShiftStatusBar` com muita informação (status + duração + pendências + 2-3 botões) pode não caber em 375px | Empilhar em coluna única abaixo de `md:` breakpoint (mesmo padrão mobile-first do guia, seção 17); botões secundários (`Atualizar`) viram ícone-only em mobile |
| Fix da coluna `pending_count` morta (seção 4.3, Opção 1) é a única mudança fora de `apps/web` | Isolada, pequena, sem migração — mas precisa de code review dedicado e não deve ser bundled silenciosamente com o resto; se o usuário preferir zero risco de backend, Opção 2 entrega o resto da proposta sem essa peça |
| Consolidar `EVENT_CONFIG` em um módulo único é uma mudança "invisível" (refactor) misturada com mudança visual — pode dificultar revisão do diff | Recomendação de implementação: fazer a consolidação do `event-type-config.ts` como o PRIMEIRO commit da série (puro refactor, sem mudança de comportamento), separado dos commits de reorganização visual |
| Acessibilidade: `PendingRail` e cards clicáveis precisam de `aria-label`/foco de teclado coerente | Seguir os mesmos padrões já usados no projeto (`aria-label` em botões ícone-only, `tabIndex` em cards clicáveis — ver seção 18 do guia de design system) |

---

## 11. Ordem de Implementação Recomendada (fases pequenas, com validação a cada uma)

1. **Fase 1 — Refactor puro, zero mudança visual:** extrair `event-type-config.ts`, migrar os 3 arquivos para consumi-lo, sem alterar nenhum pixel. Valida: screenshots antes/depois idênticos.
2. **Fase 2 — Armeiro:** `ShiftStatusBar` + `PendingRail` + `ShortcutStatCards` clicáveis + `EventTypeFilterChips`. Resolve diretamente a queixa original.
3. **Fase 3 — Admin:** grid "Em Serviço Agora" + `ActiveShiftCard` + SSE + breadcrumb + reaproveitamento dos componentes de timeline da Fase 2. Decisão prévia necessária: Opção 1 ou 2 da seção 4.3.
4. **Fase 4 (opcional, fora deste spec):** endpoint de resolução de pendência.

Cada fase: `pnpm typecheck`, suite `livro-suite` (`LDS01-LDS48`) sem regressão, code review sênior obrigatório (mudança em `.tsx`/`.ts` de produção), screenshot manual nos dois temas antes de avançar.

---

## 12. Resumo para Decisão

Proposta pronta para revisão do usuário antes de qualquer implementação. Nenhum arquivo de produção foi alterado.
