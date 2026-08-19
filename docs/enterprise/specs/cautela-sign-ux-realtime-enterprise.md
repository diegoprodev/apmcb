# Assinatura de Cautela — UX/Segurança do Diálogo + Realtime — Enterprise Spec

## 1. Contexto e Motivação

Reporte do usuário, com screenshot do card de uma cautela em `/reserva/cautelas`
mostrando o botão "Assinar Individual" desabilitado com tooltip "Documento
indisponível: aguardando assinatura do militar.":

> "na cautela ocorrer erro aparece a opção assinar individual, primeiro o
> label ta errado, deveria ser usuario e não individual. e segundo, não deve
> aparecer o totp do armeiro aqui para assinar, e sim mensagem amigável de
> peça o codigo de acesso dinâmico ao usuário, peça para assinar com
> biometria ou pelo app dele. [...] eu ja disse que todo meu sistema apos
> uma mudança no db assinatura cautela saida, deve refletir na hora na ui
> ux. algumas páginas precisam recarregar e isso não é amigável."

Três achados distintos, todos confirmados por leitura do código-fonte real
(não hipóteses):

## 2. Estado Atual — Diagnóstico

### 2.1 Label errado (BAIXO, cosmético)

`apps/web/src/app/(dashboard)/reserva/cautelas/_cautelas-client.tsx:474` —
botão que abre `SignDialog` com `role="militar"` tem o texto "Assinar
Individual". Deve ser "Assinar Usuário".

### 2.2 Achado real de UX/segurança — TOTP da pessoa errada (ALTO)

`components/cautelas/sign-dialog.tsx` usa o mesmo componente `SignDialog`
em dois contextos completamente diferentes:

- **`/efetivo/minhas-cautelas`** (`_minhas-cautelas-client.tsx:396`): o
  próprio militar está logado e assina sua própria pendência. `role="militar"`
  aqui é *self-sign* — `SelfTotpHint` (busca `GET /api/totp/code` da sessão
  atual) mostra corretamente o código do militar, porque o militar É quem
  está logado.
- **`/reserva/cautelas`** (`_cautelas-client.tsx`, botão "Assinar
  Individual"): o **armeiro** está logado e abre o dialog com `role="militar"`
  para *facilitar* a assinatura do militar (que pode nem estar presente
  fisicamente, ou não tem acesso ao sistema na hora). Aqui `role="militar"`
  NÃO é self-sign — mas `SelfTotpHint` continua buscando `GET /api/totp/code`
  da sessão atual, que é a do **armeiro**, não a do militar. O código
  mostrado nunca vai validar a assinatura do militar (o backend valida o
  TOTP contra o secret do `militar_id` da cautela, não do usuário logado) —
  na melhor das hipóteses o armeiro percebe e ignora o hint; na pior, é uma
  fonte de confusão/erro de operação num fluxo de custódia de armamento.

Causa raiz: `SignDialogProps` usa só `role: "armeiro" | "militar"` para
decidir TANTO qual endpoint chamar QUANTO se deve mostrar o hint de
autopreenchimento — são duas decisões independentes que hoje estão
acopladas erradamente.

### 2.3 Achado real — zero realtime em `/reserva/cautelas` (ALTO)

`apps/bff/src/routes/realtime.ts` define os canais SSE existentes
(`armeiro-sync`, `arsenal-sync`, `efetivo-sync`, `livro-sync`, etc.) — cada
um assina um conjunto fixo de tabelas Postgres via Supabase Realtime,
filtradas por `tenant_id`/`user_id`. **Nenhum canal assina a tabela
`cautelamentos`** hoje.

Comparando as duas páginas afetadas:

- `/reserva/saidas/page.tsx` — Server Component que busca `lendings` e
  passa como props; monta `<RealtimeArmeiroSync>`, que já assina
  `lendings` (INSERT/UPDATE/DELETE) no canal `armeiro-sync` — o padrão
  default do hook (`router.refresh()`) já resolve, porque a página É
  server-fetched. **Esta página já funciona corretamente.**
- `/reserva/cautelas/page.tsx` — é uma casca trivial; TODO o fetch de
  dados acontece client-side dentro de `_cautelas-client.tsx` via `load()`.
  **Nenhum componente de realtime é montado aqui.** Resultado: qualquer
  mudança de assinatura/status/devolução feita por OUTRA aba, OUTRO
  usuário, ou até pela própria ação do usuário que não passa pelo caminho
  de reload manual, não aparece sem F5.
- `/efetivo/minhas-cautelas/page.tsx` — também Server Component
  (busca via BFF, passa como prop), e `RealtimeEfetivoSync` já está
  montado globalmente em `efetivo/layout.tsx`. Mas o canal `efetivo-sync`
  também não assina `cautelamentos` — mesmo problema de fundo, só que
  aqui basta estender o canal (o componente de sync já existe).

`cautelamentos.armeiro_signature_id`/`militar_signature_id` são colunas
diretas na própria tabela `cautelamentos` (FK para `document_signatures.id`)
— um `UPDATE` nessas colunas É um evento na própria tabela `cautelamentos`,
então basta assinar `cautelamentos` (não é necessário assinar
`document_signatures` separadamente).

## 3. Requisitos

- **CSU-01**: label "Assinar Individual" → "Assinar Usuário" em
  `_cautelas-client.tsx`.
- **CSU-02**: `SignDialogProps` ganha `selfSign?: boolean` (default `true`,
  preserva o comportamento atual em `/efetivo/minhas-cautelas` sem tocar
  naquele call site). Quando `selfSign === false`: não renderizar
  `SelfTotpHint`; renderizar em seu lugar uma mensagem amigável orientando
  o operador (peça o código dinâmico ao usuário / peça para assinar por
  biometria / ou peça para o usuário assinar pelo próprio app dele, com um
  link/menção a "Minhas Cautelas"). O campo de input TOTP continua visível
  e funcional (o armeiro ainda digita o código que o militar informar
  verbalmente) — só o hint de autopreenchimento incorreto é removido.
- **CSU-03**: `_cautelas-client.tsx` passa `selfSign={false}` no botão
  "Assinar Usuário" (`openSign(c, "militar")`); `selfSign` fica no default
  `true` para "Assinar Armeiro" (`openSign(c, "armeiro")`, que é sempre
  self-sign nesta página).
- **CSU-04**: canal `armeiro-sync` (BFF) ganha subscrição a `cautelamentos`
  (INSERT/UPDATE/DELETE, filtrado por `tenant_id`).
- **CSU-05**: canal `efetivo-sync` (BFF) ganha subscrição a `cautelamentos`
  (INSERT/UPDATE/DELETE, filtrado por `militar_id=eq.${userId}`).
- **CSU-06**: `_cautelas-client.tsx` passa a chamar
  `useSSERefresh("armeiro-sync", onEvent)` com `onEvent` filtrando por
  `payload.table === "cautelamentos"` e chamando o `load(token)` já
  existente — mesmo padrão já usado em `_livro-client.tsx`/
  `_admin-livros-client.tsx` (não o padrão `<RealtimeArmeiroSync>`
  montado em `page.tsx`, que só faz sentido quando a página é
  server-fetched, o que não é o caso aqui).
- **CSU-07**: `/efetivo/minhas-cautelas` não precisa de mudança de
  frontend — `RealtimeEfetivoSync` já está montado e a página já é
  server-fetched; o `router.refresh()` default passa a funcionar assim que
  o canal (CSU-05) existir.

## 4. Fora de Escopo

- Reescrever `SaidasClient`/outras páginas já cobertas por realtime
  funcional — só o gap real (`cautelamentos`) é fechado.
- Um catálogo/mensageria mais rico de "quem está pendente de assinar" —
  a mensagem amigável do CSU-02 é estática, não busca dados adicionais do
  militar (ex: telefone) — YAGNI por ora.

## 5. E2E Test IDs

- `CSU01` — botão exibe "Assinar Usuário", não "Assinar Individual".
- `CSU02` — dialog aberto via `_cautelas-client.tsx` (armeiro, `role="militar"`,
  `selfSign=false`) NÃO renderiza o hint de autopreenchimento; renderiza a
  mensagem amigável.
- `CSU03` — dialog aberto via `/efetivo/minhas-cautelas` (`role="militar"`,
  `selfSign` default) CONTINUA renderizando o hint normalmente (regressão).
- `CSU04` — mudar `cautelamentos.armeiro_signature_id` via Supabase direto
  (simulando outra aba/usuário) reflete na lista de `/reserva/cautelas` sem
  reload manual (poll do evento SSE).

## 6. Ordem de Execução

1. `SignDialog`: prop `selfSign` + mensagem amigável condicional (CSU-02).
2. `_cautelas-client.tsx`: label (CSU-01) + `selfSign={false}` (CSU-03).
3. BFF `realtime.ts`: estender `armeiro-sync` e `efetivo-sync` (CSU-04/05).
4. `_cautelas-client.tsx`: `useSSERefresh` com `onEvent` (CSU-06).
5. E2E + validação visual ao vivo (Playwright, localhost).
6. Code review obrigatório (≥9.5) + CHANGELOG + commit + push.

## 7. Definition of Done

- [ ] `tsc --noEmit` em `apps/bff` e `apps/web` — 0 erros
- [ ] Label correto, hint incorreto removido no contexto do armeiro
- [ ] Mensagem amigável visível e clara no lugar do hint incorreto
- [ ] `/efetivo/minhas-cautelas` não regride (hint continua aparecendo lá)
- [ ] Mudança em `cautelamentos` reflete em `/reserva/cautelas` sem F5
- [ ] Validado ao vivo via Playwright contra localhost
- [ ] Code review sênior ≥9.5/10
