# Lentidão na Troca de Página (Navegação do Dashboard) — Enterprise Spec

## 1. Contexto e Motivação

Relato do usuário: ao clicar para ir para a página de Almoxarifado, o
spinner de navegação aparece após ~5s, some, e só depois de mais ~5s a
página de fato troca — "algo não tá enterprise, parece erro, tá uma
merda". Pedido explícito: revisar toda troca de página do sistema com um
sub-agente de investigação, depois produzir uma spec enterprise (este
documento) cobrindo TODOS os achados, com nota mínima de code review de
9.5/10 tanto para a spec quanto para a correção.

Um agente de investigação (só leitura, sem mudanças) auditou o caminho
completo de uma navegação no dashboard — `middleware.ts` →
`(dashboard)/layout.tsx` → `page.tsx` de destino → componentes de
apresentação — e confirmou que a lentidão é real e sistêmica, não um bug
isolado de UI. Os 9 testes de `crud-arsenal.spec.ts` que falharam por
timeout no PRÓPRIO login (não em nenhuma asserção do teste, antes deste
trabalho começar) são sintoma do mesmo problema, não flakiness de teste.

## 2. Diagnóstico — cadeia de round-trips por navegação

Cada troca de página sob `/admin`, `/reserva`, `/efetivo`, `/perfil`,
`/suporte` hoje soma, no mínimo:

1. **`middleware.ts`** (roda em toda request que casa o matcher, inclusive
   RSC payload fetch de navegação client-side): `resolveVerifiedUserId` →
   `fetchVerifiedUserId` → 1 round-trip de rede real ao BFF (Hetzner VPS)
   com timeout de 3s, **sem nenhum cache** — repetido do zero em toda
   navegação, mesmo para o mesmo usuário/sessão poucos segundos depois.
2. **`(dashboard)/layout.tsx`**: `supabase.auth.getUser()` (round-trip ao
   Supabase Auth) + query em `profiles` — refeitos em TODA navegação,
   mesmo a árvore de layout já tendo resolvido a mesma identidade na
   navegação anterior.
3. **`page.tsx` de destino** (ex. `reserva/arsenal/page.tsx`): chama
   `supabase.auth.getUser()` **de novo** — a maioria também refaz a query
   em `profiles` **de novo** (com seleção de colunas diferente da do
   layout, o que impede a deduplicação automática de fetch do Next.js —
   chave de cache é por função+argumentos, não por tabela); um subconjunto
   pequeno chama só `getUser()` sem repetir `profiles`. Confirmado por
   `grep` direto (não estimativa, comando reproduzível na §6): 26 arquivos
   `page.tsx` sob `(dashboard)/` chamam `getUser()` de forma independente,
   mais um LAYOUT ANINHADO (`efetivo/layout.tsx:8`) que faz o mesmo —
   28 pontos ao todo (26 `page.tsx` + 2 layouts, contando o
   `(dashboard)/layout.tsx` raiz). Lista completa na §6 (PERF-02).
4. **`withMaterialPhotoDisplayUrls`** (`apps/web/src/lib/storage.ts`):
   fan-out de 1 `createSignedUrl` por material fotografado via
   `Promise.all` — N round-trips concorrentes ao Storage, crescendo
   linearmente com o tamanho do arsenal, sem paginação.
5. **BFF `GET /api/auth/me`** (chamado no passo 1): roda a checagem de
   `revoked_sessions` e a query de `profiles` **sequencialmente**, apesar
   de serem independentes.

Nenhum desses pontos é, isoladamente, catastrófico — mas empilhados em
série (passos 1→2→3 são sequenciais por dependência real: o passo 3 só
começa depois do 2, que só começa depois do 1 resolver o header) somam a
latência de ~5-10s relatada, especialmente sob a rede real até o VPS na
Hetzner (não localhost).

## 3. Achado colateral (sintoma, não causa) — PERF-05

`NavigationProgress` (`apps/web/src/components/layout/navigation-progress.tsx`)
tem um teto rígido `MAX_VISIBLE_MS = 6_000`: se a navegação não concluir em
6s, a barra é forçada a 100% e escondida mesmo que a página ainda esteja
carregando. Isso faz exatamente o sintoma relatado: "spinner sumiu, mas
depois de um delay a página abriu" — o spinner nunca estava mentindo sobre
ter terminado, só desistia de esperar. Este não é a causa da lentidão, é o
motivo dela parecer um bug de UI em vez de latência de rede.

## 4. Restrições de segurança — não negociáveis

Nenhuma correção deste documento pode enfraquecer:

- **O timeout de 3s de `fetchVerifiedUserId`** (`verified-user.ts`) —
  comentário no próprio arquivo, achado de code review de 2026-08-15,
  proíbe explicitamente reduzi-lo. A checagem de session-mismatch em
  `layout.tsx` só roda dentro do `if (verifiedUserId && ...)`; timeout
  curto demais = mitigação do incidente de session-bleed (2026-07-17)
  desligada sob latência normal.
- **O delay de 300ms no recheck de `layout.tsx:49`** — parte deliberada do
  guard fail-closed de session-mismatch, não é código morto nem gordura.
- **A semântica fail-closed do guard**: uma divergência confirmada
  (`reason: "persistent"`) sempre redireciona pra
  `/auth/session-mismatch`, sem exceção, com ou sem cache de latência.
- **A segunda chamada a `supabase.auth.getUser()` em `layout.tsx:50`
  (o recheck dentro do guard) NUNCA pode passar a usar `getSessionUser()`/
  `cache()` do PERF-02.** Achado CRÍTICO de code review: essa chamada
  existe especificamente para obter uma leitura NOVA e independente da
  primeira (linha 24) — é o que permite `decideSessionMismatch` (três
  desfechos possíveis: `"confirmed-ok"` se a segunda leitura concorda com
  `verifiedUserId`; `"persistent"` se a segunda leitura CONFIRMA a
  divergência; `"inconclusive"` se a segunda leitura falha/timeout, sem
  produzir nenhum resultado pra comparar) distinguir divergência
  transitória de incidente real. Se o recheck reusasse o valor memoizado
  da primeira chamada via
  `cache()`, `recheckedUser?.id` seria sempre igual a `user.id` da
  primeira leitura — que já é, por construção, diferente de
  `verifiedUserId` (é por isso que o guard entrou nesse `if` pra começar)
  — fazendo `decideSessionMismatch` retornar **sempre**
  `{ reason: "persistent" }`, nunca mais `"inconclusive"` nem
  `"confirmed-ok"`. Resultado: todo mismatch transitório (o cenário real
  de PWA iOS documentado nas linhas 75-90 do próprio arquivo) passaria a
  forçar redirect definitivo, regredindo exatamente o incidente que a
  suspensão condicional daquele bloco já existe para absorver. PERF-02
  aplica `cache()` SOMENTE à primeira resolução de identidade (linha 24
  de `layout.tsx`) e a todos os `page.tsx`/layout aninhado — a chamada da
  linha 50 mantém `supabase.auth.getUser()` direto, sem cache, com
  comentário explícito no código apontando pra esta restrição.
- **A correção local de `user` em `layout.tsx:109` (`if (recheckedUser)
  user = recheckedUser`) NUNCA pode ser tratada como suficiente pra
  propagar a identidade corrigida pro resto da árvore sob PERF-02.**
  Achado CRÍTICO de code review (5ª rodada): `React.cache()` não tem API
  de invalidação/`set()` — memoiza pelo valor de retorno da PRIMEIRA
  chamada dentro do request, permanentemente, até o request terminar.
  Reatribuir a variável local `user` dentro do corpo de `DashboardLayout`
  não afeta em nada o que `getSessionUser()` devolve pra QUALQUER outro
  chamador no mesmo request — inclusive `page.tsx` e `efetivo/layout.tsx`,
  que receberiam do cache a 1ª leitura (a mesma que o guard acabou de
  provar estar desatualizada), não a corrigida. Cenário de falha real
  (é literalmente o incidente de PWA iOS documentado nas linhas 75-90 do
  próprio arquivo): guard detecta divergência transitória, recheck
  confirma a identidade certa (`"confirmed-ok"`), `layout.tsx` corrige
  `user` localmente e renderiza o chrome certo — mas `reserva/arsenal/
  page.tsx`, no MESMO request, chama `getSessionUser()` e recebe do cache
  a identidade ERRADA da 1ª leitura, buscando `getSessionProfile()`/RBAC/
  assinatura realtime do usuário errado dentro de uma árvore cujo chrome
  já afirma ser outra pessoa — session-bleed reintroduzido pelo próprio
  mecanismo do PERF-02, sem erro de `tsc`, sem crash. **Fix obrigatório**:
  quando `decision.kind === "confirmed-ok"`, `layout.tsx` chama
  `redirect(pathWithSearch)` (mesma rota, força um request NOVO) em vez de
  só reatribuir `user` localmente e seguir renderizando — no request
  novo, a propagação do lado Supabase já ocorreu (é o que o recheck
  acabou de confirmar), então a 1ª leitura desse novo request já nasce
  correta, sem precisar de correção retroativa que `cache()` não suporta.
  (A cláusula "id corrigido diverge da 1ª leitura" de versões anteriores
  deste documento era redundante — `confirmed-ok` só é retornado quando
  `recheckedUser.id === verifiedUserId`, e a condição de entrada do bloco
  já garante `verifiedUserId !== user.id`; logo a divergência é sempre
  verdadeira nesse ponto, não precisa ser checada de novo.)

  **Achado CRÍTICO de code review (6ª rodada)**: `currentPath` não existe
  em lugar nenhum hoje — `(dashboard)/layout.tsx` é um layout de route
  group (nunca recebe `params`/`searchParams`, limitação do App Router),
  `middleware.ts` calcula `pathname` (linha 127) mas nunca o repassa como
  header, e um `grep` de TODO `redirect(` já existente sob `(dashboard)/`
  (60+ ocorrências) confirma que 100% usam destino hardcoded — não há
  precedente de path dinâmico neste projeto. Fix: `middleware.ts` passa a
  injetar `x-pathname` (valor: `request.nextUrl.pathname +
  request.nextUrl.search`, chamado `pathWithSearch` a partir daqui pra
  não colidir com o nome usado abaixo) no mesmo bloco condicional `if
  (isDashboardPath(pathname))` onde já injeta `x-verified-user-id`
  (linhas 141-144) — adição simétrica de 1 linha num bloco já auditado,
  seguindo o MESMO padrão defensivo que a linha 139 já usa pra
  `x-verified-user-id` (`reqHeaders.delete()` antes do `set()`, "nunca
  confiar em header vindo do cliente") — replicar esse padrão pra
  `x-pathname`, que ainda não existe no arquivo (não confundir com algo
  já implementado: é parte deste fix). `layout.tsx` lê via
  `headers().get("x-pathname")`, com
  fallback pra `"/"` se ausente. **`middleware.ts` entra explicitamente
  no escopo do PERF-02** — ver §6/§7/§9. Padrão já provado em produção:
  é a mesma técnica (`reqHeaders.set` no middleware → `headers()` no
  Server Component) que `x-verified-user-id` já usa hoje.

  **Achado CRÍTICO de code review (7ª rodada) — o teto original (marcador
  na URL) nunca expirava**; **achado CRÍTICO (8ª rodada) — a correção via
  cookie não era implementável a partir de um Server Component**; **achados
  CRÍTICO/ALTO adicionais (9ª rodada) — a versão seguinte (URL + limpeza
  client-side) ainda tinha uma comparação contra um valor de tipo que não
  existe (`decision.kind` nunca é `"inconclusive"` — esse é um valor de
  `reason`, aninhado dentro de `kind: "redirect"`) e concatenação de URL
  inconsistente entre seções do próprio documento, quebrando o caso comum
  (path sem query string). Quatro rodadas seguidas encontraram uma
  variante nova do mesmo problema de fundo no mecanismo de "limitar a 1
  a quantidade de redirects corretivos" — decisão de produto, a pedido do
  usuário: **abandonar o teto por completo**, não mais uma 5ª tentativa
  de consertá-lo.

  **Desenho final, sem teto**: `redirect(pathWithSearch)` dispara
  incondicionalmente sempre que `decision.kind === "confirmed-ok"` —
  mesmo padrão, sem nenhum mecanismo especial de limite, que o branch
  `reason: "persistent"` já usa hoje (linhas 82-84 acima) pra
  `/auth/session-mismatch`, e que nunca precisou de proteção contra loop.
  Risco residual aceito explicitamente: numa hipótese patológica de
  propagação do Supabase genuinamente instável ao longo de várias
  requisições seguidas (o mesmo cenário de PWA iOS já documentado), o
  navegador poderia ver mais de 1 redirect em sequência antes de
  estabilizar — o pior caso absoluto é o próprio navegador cortar com
  `ERR_TOO_MANY_REDIRECTS` (Chromium corta por volta de 20), nunca uma
  renderização com identidade dividida entre camadas. Isso troca uma
  regressão de segurança silenciosa (o que todo o mecanismo de teto
  tentou evitar, e falhou 4 vezes) por, na pior hipótese, uma tela de
  erro de navegador visível e óbvia — falha segura, não silenciosa.
  Nenhuma infraestrutura nova (`middleware.ts`/`x-pathname`) deixa de ser
  necessária — continua valendo pra sustentar o `pathWithSearch` do
  redirect em si, só o mecanismo de contagem/marcador é que sai do
  escopo. Client component de limpeza de URL (`_sc=1`) e a checagem de
  `decision.kind === "inconclusive"` saem do escopo por completo — não
  existe mais nenhum marcador pra limpar. `"inconclusive"` permanece
  exatamente como hoje (nunca redireciona) simplesmente porque o
  `if (decision.kind === "confirmed-ok")` novo nunca entra nesse branch —
  não precisa de exclusão explícita, é consequência direta do tipo real
  (`MismatchDecision`, `session-mismatch.ts:1-3`).

## 5. Decisões de Design

| Ponto | Decisão |
|---|---|
| PERF-01 — round-trip do middleware ao BFF | Cache de curtíssimo prazo (10s) em `verified-user.ts`, `Map` de módulo (por isolate), **chave = valor bruto do cookie de sessão**, **só armazena resultado POSITIVO** (userId resolvido com sucesso). Falha/timeout/null nunca é cacheado — continua revalidando do zero em toda request, preservando exatamente o comportamento fail-open de hoje no caminho de erro. Como a chave é o próprio valor do cookie (não a identidade do isolate), um cookie diferente (o cenário real do incidente de session-bleed) nunca reaproveita o cache de outro — não há reintrodução de risco. Entrada guardada como `{ userId, expiresAt }`, TTL checado de forma lazy-on-read (comparação direta contra `Date.now()`, sem `setInterval` de limpeza — desnecessário e mais uma fonte de bug num isolate de vida curta). Ao ultrapassar 500 entradas: `cache.clear()` completo, não LRU parcial — simplicidade sobre eficiência marginal, já que o TTL de 10s já limita o tamanho útil do `Map` na prática. Comentário de cabeçalho do arquivo (hoje desatualizado — afirma que `fetchVerifiedUserId` é usada também pelo recheck de `layout.tsx`, o que não é verdade: esse recheck usa `supabase.auth.getUser()` direto) é corrigido no mesmo commit. **Achado MÉDIO de code review**: `/api/auth/me` (`apps/bff/src/routes/auth.ts:365-373`, comentário do próprio arquivo o chama de "HEARTBEAT" desenhado pra nunca ter cache) retorna 401 por 3 motivos independentes — `revoked_sessions` (ban/force-logout individual), `sessions_invalidated_at` (invalidação em massa) e `role_changed` (mudança de permissão) — os 3, não só o primeiro, ficam com o sinal `x-verified-user-id` do guard até 10s desatualizado dentro da janela de cache do PERF-01. Trade-off aceito explicitamente pros 3 casos: a autorização real (RBAC, RLS, rotas do BFF) não depende deste cache, só o sinal cruzado do guard de session-mismatch; 10s de defasagem no pior caso é aceitável frente ao ganho de performance, e documentado aqui em vez de implícito. |
| PERF-02 — `getUser()`+`profiles` duplicados entre layout e página | Novo `apps/web/src/lib/session-profile.ts`: `getSessionUser()` e `getSessionProfile(userId: string)` — **sem receber `supabase` como argumento externo**, cada uma chama `createClient()` internamente. Achado CRÍTICO de code review: `React.cache()` compara argumentos por identidade estrita (`Object.is`), e `apps/web/src/lib/supabase/server.ts:createClient()` retorna uma instância NOVA a cada chamada (não é singleton) — se `getSessionUser` recebesse `supabase` como parâmetro, `layout.tsx` e cada `page.tsx` passariam instâncias DIFERENTES (cada um já chama `createClient()` por conta própria pras suas outras queries), e como instâncias diferentes nunca colidem no cache por identidade, a dedução INTEIRA seria um no-op — os dois round-trips de rede continuariam acontecendo, só que agora atrás de uma função com nome de "cache", passando por todo o processo de review/teste sem que nada detectasse que o ganho de performance simplesmente não existe. Design correto: `getSessionUser`/`getSessionProfile` sem parâmetro de client (chamam `createClient()` por dentro, então o cache do React memoiza puramente por "esta função async já rodou neste request?", sem depender de nenhuma identidade de objeto externa); `getSessionProfile(userId)` recebe só a string do id (primitivo — `Object.is` compara primitivos por valor, então duas chamadas com o mesmo id resolvido colidem corretamente no cache, sem o mesmo problema). **Achado CRÍTICO de code review**: a alegação original ("superset de colunas do `layout.tsx`, que é o consumidor mais amplo") era FALSA — auditando com `grep` toda query `profiles...eq("id", user.id)` dos 26+2 arquivos (não só o layout), pelo menos `matricula` (`perfil/page.tsx`, `efetivo/perfil/page.tsx`, `reserva/saidas/nova/page.tsx`), `totp_configured` (`efetivo/page.tsx`, `efetivo/perfil/page.tsx`, `perfil/page.tsx`) e `created_at` (`efetivo/perfil/page.tsx`) NÃO estão no `.select()` de `layout.tsx` mas são consumidas em outras páginas — se `getSessionProfile` fosse implementada só com as colunas do layout, essas 3 páginas perderiam dado real (badge de TOTP, matrícula, data de criação) silenciosamente, sem erro de `tsc` (destructure de chave ausente vira `undefined`, não falha de tipo). `getSessionProfile` seleciona a UNIÃO exaustiva, não uma estimativa: `id, role, nome_completo, foto_url, registration_status, posto, nome_de_guerra, default_tenant_id, matricula, totp_configured, created_at` (11 colunas — união de TODO `.select()` que hoje filtra `profiles` por `id = user.id` nos 26 `page.tsx` + `layout.tsx`, incluindo o `SELECT_COLS` de `reserva/saidas/nova/page.tsx:59`). Páginas que precisam de menos colunas apenas destroturam o que usam, sem custo extra de query. **Critério de aceite verificável (não só "código parece certo")**: teste que conta chamadas de rede reais ao Supabase Auth por navegação completa (layout + page) e confirma queda de 2 para 1 — ver §8. Aplicado em `(dashboard)/layout.tsx`, `efetivo/layout.tsx` (layout ANINHADO que também duplica hoje — achado de code review, fora do escopo inicial "só `page.tsx`") e nos 26 `page.tsx` listados abaixo. **Achado CRÍTICO de code review, incorporado aqui**: este projeto já teve UM incidente real de dado vazando entre requests neste MESMO adaptador (`@cloudflare/next-on-pages`) — o comentário em `(dashboard)/layout.tsx:2-6` documenta que a detecção automática de rota dinâmica do Next.js "se mostrou não confiável no adaptador CF Pages (causa raiz confirmada do incidente de session-bleed)". `cache()` do React é uma primitiva DIFERENTE (memoização em memória por invocação de request, resolvida via o contexto de render de Server Components — não a heurística de "essa rota pode ser servida estática/cacheada no CDN?" que causou o incidente original; `export const dynamic = "force-dynamic"` já elimina esse vetor especificamente, independente do que `cache()` faça). Mas dado o precedente NESTE adaptador específico, a distinção teórica não é aceita sem prova: **PERF-02 só é considerado concluído com o teste de isolamento por request descrito na §8 passando contra o ambiente real (CF Pages, não só `next dev`)** — duas requisições de usuários DIFERENTES (concorrentes E sequenciais, ver §8) nunca podem receber o `profile`/`userId` um do outro. **A chamada de recheck em `layout.tsx:50` fica fora do escopo de `cache()` — ver §4.** **Padrão de uso obrigatório nos 28 pontos** (achado MÉDIO de code review: sem isto, 28 implementações independentes divergem em detalhe): `userId` passado a `getSessionProfile` vem SEMPRE do `.id` resolvido por `getSessionUser()` — nunca de `verifiedUserId` (o header `x-verified-user-id`, que já está em escopo em `layout.tsx:36` mas é semanticamente a identidade verificada pelo BFF, não necessariamente a mesma coisa; usá-lo ali compilaria sem erro mas seria a fonte errada). Duas variantes de uso, conforme o arquivo ainda precisa ou não de um `createClient()` próprio pra outras queries: `page.tsx` típico — `const user = await getSessionUser(); if (!user) redirect("/login"); const profile = await getSessionProfile(user.id);`, sem nenhum `createClient()` local. `(dashboard)/layout.tsx` — mantém seu `const supabase = await createClient()` (necessário pro recheck da linha 50, fora do escopo do cache, e pras ~8 queries de `reserve_memberships`/`tenant_branding`/`tenants`/`reserves` nas linhas 154-206, também fora do escopo), MAS a primeira resolução de identidade (linha 24) e o profile (linha 113-117) passam a vir de `getSessionUser()`/`getSessionProfile()`, não mais de `supabase.auth.getUser()`/`.from("profiles")` direto. `efetivo/layout.tsx` — hoje só usa seu `createClient()` local pra essa única chamada; depois da migração, o `createClient()` local fica sem nenhum outro uso e deve ser removido do arquivo, não deixado morto. |
| PERF-03 — `/api/auth/me` sequencial | `revoked_sessions` e `profiles` são lidos independentemente — não há motivo real pra série. Convertido para `Promise.all`, mantendo a mesma ordem de prioridade nas checagens depois (revoked primeiro, depois role/invalidação). **Achado BAIXO de code review**: hoje, quando `revoked_sessions` já rejeita a sessão (401 cedo, `auth.ts:383-386`), a query de `profiles` nunca roda; com `Promise.all` puro, ela passaria a rodar sempre, mesmo nesse caminho — resposta/status/mensagem continuam idênticos (o requisito de comportamento observável do §7 não é violado), mas é uma query de banco a mais desperdiçada em todo request de sessão revogada. Reconhecido explicitamente aqui; aceitável dado que sessão revogada não é o caminho comum. **Achado de code review (10ª rodada)**: não existe forma de "ter os dois" — uma vez que a query de `profiles` é disparada (mesmo dentro do `Promise.all`), o round-trip ao banco já aconteceu; não aguardá-la (`await`) evita só o bloqueio em JS, não o custo real de banco, e deixaria uma promise sem tratamento de erro se rejeitar (falha silenciosa não capturada). A única forma real de evitar o desperdício seria voltar a sequenciar (perdendo o paralelismo no caminho comum) — não vale a pena; o trade-off aceito acima (sempre paralelo, 1 query a mais só no caminho raro de sessão revogada) é a decisão final, sem alternativa melhor. |
| PERF-04 — fan-out de signed URLs | `withMaterialPhotoDisplayUrls` troca N chamadas de `createSignedUrl` (uma por item, em `Promise.all`) por chamadas a `createSignedUrls` (plural, em lote) — mesmo padrão já implementado e revisado em `apps/bff/src/routes/usuario.ts:124-143` (inclusive o `try/catch`, necessário porque `createSignedUrls` pode lançar em falha de rede do Storage, não só retornar `{error}`). **Achado de code review**: ao contrário de `usuario.ts` (cuja fonte já vem de uma query com `.limit(100)`), a lista de materiais de `reserva/arsenal/page.tsx` não é paginada — sem garantia documentada de teto de lote da API do Storage, `withMaterialPhotoDisplayUrls` processa os paths em **chunks de 100** (mesmo tamanho já usado como referência em `usuario.ts`), com `Promise.all` sobre os chunks — preserva o ganho (1 chamada a cada 100 itens, não 1 por item) sem depender de um limite não confirmado. `resolvePhotosInBulk` (fotos de perfil) não é tocado — está definida mas não é chamada em nenhum lugar hoje, fora do escopo deste documento. |
| PERF-05 — teto do `NavigationProgress` | `MAX_VISIBLE_MS` sobe de 6s pra 20s — deixa de mascarar como "concluída" uma navegação que, mesmo após PERF-01→04, ainda esteja genuinamente lenta (rede ruim, VPS sob carga). Continua sendo só uma rede de segurança pra navegações que nunca disparam o efeito de `routeKey` (ex: `replace` só de searchParams) — não é mais um teto otimista que esconde latência real. **Nota de code review (10ª rodada)**: no cenário patológico já aceito em §4 (múltiplos redirects corretivos em sequência antes de eventualmente resolver, ou de `ERR_TOO_MANY_REDIRECTS`), o tempo total pode em tese ultrapassar os 20s daqui — o spinner voltaria a sumir antes da navegação de fato terminar, ecoando o sintoma original do §3. Consequência conhecida e aceita, não uma lacuna: esse cenário já é, por definição de §4, mais raro que o caso comum que motivou subir o teto de 6s pra 20s. |

## 6. Escopo exato do PERF-02 — arquivos confirmados por `grep`

`middleware.ts` (achado CRÍTICO de code review, 6ª rodada — necessário
pra sustentar o `redirect(pathWithSearch)` de §4): injeta `x-pathname`
(`pathname + search`) no mesmo bloco condicional `if
(isDashboardPath(pathname))` onde já injeta `x-verified-user-id`
(linhas 141-144 do arquivo atual) — 1 linha adicionada a um bloco já
existente, não uma rota nova de mudança.

Layouts (a árvore raiz + o único layout aninhado que duplica o padrão) —
`layout.tsx:50` (recheck do guard) fica FORA do escopo, ver §4:
`(dashboard)/layout.tsx`, `(dashboard)/efetivo/layout.tsx`.

26 `page.tsx` (gerado via `grep -rl "auth.getUser()" --include="page.tsx" apps/web/src/app/\(dashboard\)`,
revalidar no início da implementação — a lista pode ter mudado; nem todos
repetem `profiles` também, alguns só `getUser()` — ver §2):

```
admin/arsenal/manutencao/page.tsx      admin/arsenal/page.tsx
admin/arsenal/solicitacoes/page.tsx    admin/auditoria/page.tsx
admin/page.tsx                         admin/relatorios/page.tsx
admin/saidas/page.tsx                  admin/usuarios/page.tsx
efetivo/historico/page.tsx             efetivo/minhas-cautelas/page.tsx
efetivo/page.tsx                       efetivo/perfil/page.tsx
efetivo/solicitacoes/page.tsx          perfil/page.tsx
reserva/arsenal/manutencao/page.tsx    reserva/arsenal/page.tsx
reserva/biometria/page.tsx             reserva/criar-armeiro/page.tsx
reserva/militares/page.tsx             reserva/ocorrencias/page.tsx
reserva/page.tsx                       reserva/relatorios/page.tsx
reserva/saidas/nova/page.tsx           reserva/saidas/page.tsx
reserva/solicitacoes/page.tsx          suporte/page.tsx
```

Um arquivo que aparecer nesta lista mas não for migrado para
`session-profile.ts` faz o PERF-02 ficar incompleto para aquela rota
específica — a Definition of Done (§9) exige os 28 pontos (2 layouts +
26 páginas), não uma amostra.

## 7. Requisitos (PERF)

- **PERF-01**: cache de 10s por valor de cookie no lookup do BFF em
  `verified-user.ts`, só para resultado positivo; timeout de 3s intocado;
  falha nunca cacheada.
- **PERF-02**: `session-profile.ts` criado e usado por `layout.tsx` +
  todos os `page.tsx` do dashboard que hoje repetem `getUser()`+`profiles`
  — mesma identidade resolvida uma única vez por navegação, não 2+ vezes.
- **PERF-03**: `/api/auth/me` roda as duas queries independentes em
  paralelo; comportamento observável (respostas, códigos, mensagens)
  idêntico ao atual.
- **PERF-04**: `withMaterialPhotoDisplayUrls` usa `createSignedUrls` em
  lote; degrada para "sem foto" (nunca 500) em falha do Storage, igual
  hoje.
- **PERF-05**: `MAX_VISIBLE_MS` em 20_000, comentário atualizado
  explicando que é rede de segurança, não meta de UX.
- **Todas as mensagens de erro, redirects e o guard fail-closed de
  session-mismatch permanecem byte-a-byte idênticos, COM UMA EXCEÇÃO
  nomeada e documentada em §4**: o branch `decision.kind === "confirmed-ok"`
  passa a chamar `redirect(pathWithSearch)` incondicionalmente (hoje não
  redireciona, só reatribui `user` localmente) — mudança de comportamento
  intencional, exigida pelo próprio PERF-02 (sem ela, o CRÍTICO de
  identidade dividida entre camadas descrito em §4 fica sem solução), não
  um efeito colateral não revisado, e sem nenhum mecanismo de limite (4
  rodadas de revisão já provaram que tentar limitar introduz mais bugs do
  que resolve — decisão explícita do usuário de aceitar o risco residual
  ao invés de continuar complicando o mecanismo, ver §4). `decision.kind
  === "inconclusive"` (o outro valor possível de `kind: "redirect"`)
  permanece INALTERADO — o `if` novo só entra no branch
  `"confirmed-ok"`, `inconclusive` nunca passa por ele, sem precisar de
  exclusão explícita. Achado ALTO de code review (7ª rodada): esta
  exceção precisa estar explícita AQUI, não só em §4 — um review isolado
  desta frase, sem cruzar com §4, rejeitaria incorretamente o fix, ou um
  implementador que lesse só esta frase deixaria de implementá-la. Fora
  essa única exceção nomeada, nenhuma outra mudança de comportamento de
  segurança ou de contrato de API é aceitável.

## 8. Testes

Todo item abaixo marcado **(mandatório)** é obrigatório para a DoD (§9)
— não contar posição na lista (achado de code review: contagem por
posição já divergiu do conteúdo real duas vezes nas rodadas anteriores
deste documento; a marcação inline em cada item é a fonte de verdade).
Sem eles, exatamente o tipo de bug que este documento existe para evitar
passaria por `tsc`, pela suíte E2E e pelo review humano sem ser
detectado.

- **Teste de isolamento por request do PERF-02 (mandatório), duas
  variantes**: (a) **concorrente** — duas requisições simultâneas de
  usuários DIFERENTES; (b) **sequencial** — a mesma checagem, mas
  disparando repetidas requisições de usuários diferentes EM SEQUÊNCIA
  (não simultâneas) contra o mesmo ambiente, repetido o suficiente pra
  aumentar a chance de reuso de isolate — achado de code review: o modo
  de falha mais próximo do precedente citado em §4
  (`(dashboard)/layout.tsx:2-6`) é isolate morno reaproveitado entre
  requests sequenciais de usuários diferentes, não disputa de
  concorrência pura; um teste só-concorrente pode passar mesmo com esse
  bug presente. **Ambas as variantes rodam contra `reserva/arsenal/page.tsx`
  especificamente** (a rota real do relato original do usuário, não uma
  rota sintética) — achado de code review: um teste genérico contra
  "uma rota que usa `getSessionUser`" pode passar migrando só 1-2 das 28
  páginas, sem provar nada sobre a cobertura real; nomear a rota do bug
  original ancora o teste a um caso concreto e verificável. Ambas rodam
  contra o ambiente real do adaptador (deploy de preview do Cloudflare
  Pages ou staging, não só `next dev`) — confirmando que a resposta de
  cada uma contém SÓ os dados do próprio usuário, nunca do outro.
  Natureza probabilística reconhecida: a variante (b) não tem como forçar
  reuso de isolate via API pública da plataforma — um "passou" no CI é
  evidência, não prova formal de ausência do bug. Mitigação complementar
  obrigatória: monitoramento/log estruturado em produção nos primeiros 7
  dias pós-deploy comparando `userId` resolvido por `getSessionUser()`
  contra `x-verified-user-id` do header em toda request (mesmo padrão de
  log já usado no guard de `session-mismatch`), alertando em qualquer
  divergência inesperada. Critério de bloqueio: PERF-02 não é
  considerado concluído sem as duas variantes automatizadas passando no
  ambiente real E o monitoramento de produção configurado.
- **Teste de contagem de chamadas de rede do PERF-02 (mandatório)**:
  achado CRÍTICO de code review — `getSessionUser`/`getSessionProfile`
  só entregam ganho real se `createClient()` NÃO virar o argumento
  externo que quebra a deduplicação (ver §5); "o código parece certo" não
  é evidência suficiente. Teste de integração (mock de
  `@/lib/supabase/server`, mesmo padrão já usado em
  `apps/web/src/app/auth/callback/route.test.ts`) que envolve
  `supabase.auth.getUser()` com um contador de chamadas, renderiza
  `DashboardLayout` seguido especificamente de `reserva/arsenal/page.tsx`
  (mesma rota nomeada acima, não sintética) dentro do MESMO request
  simulado, e afirma que o contador soma **1** (não 2) para `getUser()` e
  **1** (não 2) para a query em `profiles`. Sem este teste passando,
  PERF-02 não é considerado concluído — é a única forma automatizada de
  provar que a dedução acontece de verdade entre layout e página, não só
  dentro de um único arquivo.
- **Teste estático de cobertura completa do PERF-02 (mandatório)**:
  achado CRÍTICO de code review — nenhum dos dois testes acima garante
  que TODOS os 28 pontos da §6 foram migrados, só que a rota nomeada
  funciona; um implementador poderia migrar 3 páginas, ver os dois testes
  acima passarem, e marcar a DoD como completa deixando 25 rotas
  intocadas, sem que `tsc` acuse nada (chamar `supabase.auth.getUser()`
  direto continua compilando, é só uma escolha de design pior). Script/
  teste que itera programaticamente os arquivos listados na §6 e conta
  ocorrências de `supabase.auth.getUser()` direto — **contagem, não
  posição de linha** (achado MÉDIO de code review: checar "fora da linha
  50" é frágil — qualquer edição futura em `layout.tsx` antes do recheck
  desloca a linha e gera falso positivo, treinando o time a relaxar a
  checagem exatamente pro caso que ela existe pra pegar): `session-
  profile.ts` pode ter a chamada (é onde ela deve morar);
  `(dashboard)/layout.tsx` deve ter **exatamente 1** ocorrência direta
  (o recheck, único e insubstituível — ver §4); todos os outros 27
  arquivos (`efetivo/layout.tsx` + os 26 `page.tsx`) devem ter
  **exatamente 0**. Roda como parte do `tsc`/lint do CI, não só
  manualmente.
- **Teste de regressão dedicado ao recheck de `layout.tsx:50`
  (mandatório)**: teste de integração (mesmo padrão de mock de
  `@/lib/supabase/server` do item anterior, reaproveitando o mock — NÃO
  satisfeito por um teste unitário isolado de `decideSessionMismatch`
  com argumentos hardcoded, como `session-mismatch.test.ts` já tem hoje,
  porque isso nunca exercita o código real do recheck nem detectaria se
  alguém no futuro trocar a chamada da linha 50 por `getSessionUser()`
  por engano) que configura o mock de `auth.getUser()` pra retornar
  DOIS valores DIFERENTES em chamadas sequenciais dentro do mesmo
  render (simulando uma leitura genuinamente nova no recheck), renderiza
  `DashboardLayout` com um `x-verified-user-id` que diverge da primeira
  leitura, e confirma que o resultado de `decideSessionMismatch` reflete
  o SEGUNDO valor mockado (não o primeiro, memoizado) — provando que o
  recheck continua sendo uma leitura independente após PERF-02. Este
  teste é a única rede de segurança automatizada contra a regressão
  descrita em §4 (recheck acidentalmente memoizado) — não é coberto pelo
  teste de isolamento cross-user acima, que testa usuários DIFERENTES,
  não duas leituras do MESMO usuário dentro do mesmo request.
- **Teste de consistência de identidade entre camadas após correção
  transitória (mandatório)**: achado CRÍTICO de code review (5ª/6ª
  rodadas) — a correção local `user = recheckedUser` em `layout.tsx:109`
  não propaga pro cache de `getSessionUser()` (sem API de invalidação),
  então um `page.tsx` renderizado no MESMO request receberia a
  identidade ERRADA da 1ª leitura mesmo depois do guard já ter corrigido
  o chrome do layout — ver a restrição correspondente em §4 (fix:
  `redirect(pathWithSearch)` incondicional quando `"confirmed-ok"`, sem
  mecanismo de limite — ver §4 pro histórico de por que um teto foi
  tentado e abandonado). Teste de integração: mock de `auth.getUser()`
  retornando um valor na 1ª chamada e um valor DIFERENTE no recheck, mock
  de `headers()` fornecendo `x-pathname` (simulando o header que
  `middleware.ts` passa a injetar — ver §6), **mock de `redirect()` de
  `next/navigation` que LANÇA uma exceção** (não um `vi.fn()` mudo) —
  achado MÉDIO de code review: um mock que só registra a chamada sem
  lançar deixaria código depois do `redirect()` (ex: a query de
  `profiles` da linha 113, com o id da 1ª leitura, stale) continuar
  executando no teste, mascarando exatamente o bug que o fix resolve;
  renderiza `DashboardLayout` e confirma (a) que `redirect()` é chamado
  com o path+search do `x-pathname` mockado, E (b) que a execução para
  ali — nenhum código depois roda. Não é satisfeito pelo teste do item
  anterior (que verifica o resultado de `decideSessionMismatch`, não o
  que acontece DEPOIS que `"confirmed-ok"` é decidido).
- **Teste de que `"inconclusive"` nunca redireciona (mandatório)**:
  mock de `decision.kind === "redirect"`/`decision.reason ===
  "inconclusive"` (tipo real de `MismatchDecision`,
  `session-mismatch.ts:1-3` — não `decision.kind === "inconclusive"`,
  que não existe nesse tipo) e confirma que `redirect()` NUNCA é chamado
  — garante que o `if (decision.kind === "confirmed-ok")` do PERF-02 não
  vaza pro branch suspenso desde o incidente de PWA iOS de 2026-07-17.
- **Teste unitário do cache do PERF-01 (mandatório)**, em
  `verified-user.ts`: (a) duas chamadas com o MESMO valor de cookie
  dentro da janela de 10s fazem 1 única chamada de rede ao BFF; (b)
  chamadas com valores de cookie DIFERENTES nunca compartilham entrada
  de cache; (c) um resultado `null`/erro nunca é servido do cache — cada
  chamada subsequente refaz o fetch do zero; (d) ao ultrapassar 500
  entradas, o `Map` é limpo por completo e a próxima chamada pra
  qualquer chave faz fetch de novo.
- **Teste de integração para `/api/auth/me` (mandatório — não
  condicional a "se existir suíte")**: cobrir os 3 desfechos (sessão
  revogada → 401 `session_invalidated`; role divergente → 401
  `role_changed`; sessão válida → 200 com `user`), comparando shape/
  status/mensagem antes e depois da paralelização (PERF-03) — endpoint
  decide se uma sessão é destruída, não pode ficar sem cobertura.
- `apps/web/e2e/crud-arsenal.spec.ts`: suíte completa deve voltar a
  passar sem timeout no login (hoje 9/15 falhando por esse motivo) —
  critério de aceite direto de que a lentidão sistêmica foi resolvida.
- Novo teste dedicado de navegação (`apps/web/e2e/navigation-perf.spec.ts`
  ou extensão de suíte existente): navegar entre 2+ páginas do dashboard
  autenticado e medir que o tempo até `waitForURL`/conteúdo visível cai
  de forma mensurável em relação à baseline pré-fix.
- Validação manual ao vivo via Playwright contra localhost: login →
  navegar Dashboard → Almoxarifado → outra página → voltar, confirmando
  visualmente que a barra de progresso reflete conclusão real.
- **Teste de regressão do cache do PERF-01 (mandatório)**: achado ALTO de
  code review — o hedge "se existir" reapareceu aqui depois de já ter
  sido corrigido no item do recheck (§8 acima); `session-mismatch.test.ts`
  (o único teste hoje "relacionado" a session-mismatch) testa só
  `decideSessionMismatch` com strings hardcoded, nunca importa
  `fetchVerifiedUserId` nem `middleware.ts` — não cobre o cache novo.
  Teste de integração dedicado: mock do endpoint `/api/auth/me` do BFF
  configurado pra retornar DOIS `userId` diferentes para DOIS valores de
  cookie diferentes; chama `fetchVerifiedUserId` duas vezes com cada
  cookie dentro da janela de 10s e confirma que cada um recebe sempre o
  próprio `userId`, nunca o do outro — mesmo com o cache ativo. Sem este
  teste, a garantia de que o cache do PERF-01 nunca mascara identidade
  divergente fica sem nenhuma verificação automatizada.

## 9. Definition of Done

- [ ] PERF-01 implementado (`verified-user.ts`) e revisado quanto a risco
      de segurança especificamente; teste unitário do cache passando;
      teste de regressão (mock de `/api/auth/me` com 2 cookies/userIds
      diferentes) passando.
- [ ] PERF-02 implementado (`middleware.ts` injetando `x-pathname` no
      bloco `isDashboardPath` existente — ver §6; `session-profile.ts` —
      `getSessionUser()`/`getSessionProfile(userId)` SEM parâmetro
      externo de `supabase`, selecionando a união de 11 colunas auditada
      na §5 — não uma estimativa — aplicado nos 28 pontos listados na §6:
      2 layouts + 26 `page.tsx`, com o padrão de uso da §5 seguido em
      cada um, o `createClient()` local removido onde ficar sem outro
      uso, e o recheck de `layout.tsx:50` explicitamente FORA do escopo —
      ver §4; `redirect(pathWithSearch)` implementado incondicionalmente
      quando `"confirmed-ok"`, sem mecanismo de limite — em vez de só
      reatribuir `user` localmente); teste estático de cobertura completa
      (contagem 1/0, não posição de linha) passando; teste de contagem de
      chamadas de rede confirmando queda de 2→1 passando contra
      `reserva/arsenal/page.tsx`; teste de isolamento por request
      (concorrente + sequencial) passando contra o ambiente real do
      adaptador; teste de regressão do recheck passando; teste de
      consistência de identidade entre camadas após correção transitória
      passando (com mock de `redirect()` que lança); teste de que
      `"inconclusive"` nunca redireciona passando; monitoramento de
      produção configurado (7 dias pós-deploy).
- [ ] PERF-03 implementado (`apps/bff/src/routes/auth.ts`); teste de
      integração de `/api/auth/me` cobrindo os 3 desfechos.
- [ ] PERF-04 implementado (`apps/web/src/lib/storage.ts`), com chunking
      de 100 itens por lote.
- [ ] PERF-05 implementado (`navigation-progress.tsx`).
- [ ] Code review sênior (rubrica `CLAUDE.md`) com nota ≥ 9.5/10 —
      fix-and-re-review até bater a nota.
- [ ] `tsc --noEmit` em `apps/web` e `apps/bff`, 0 erros.
- [ ] `crud-arsenal.spec.ts` completo passando (sem timeout de login).
- [ ] Validação visual ao vivo via Playwright contra localhost.
- [ ] Commit + push.
