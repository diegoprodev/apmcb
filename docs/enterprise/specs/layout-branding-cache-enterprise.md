# Enterprise Spec — Cache de Branding/Reservas em `(dashboard)/layout.tsx` (v3, PAUSADA)

> **STATUS: pausada em 2026-08-29, não implementada.** 5 rodadas de revisão adversarial, 2
> mecanismos de cache inteiros descartados por incompatibilidade com o ambiente real de deploy
> (`unstable_cache`: não suportado por `@cloudflare/next-on-pages`; `fetch()` com
> `next:{revalidate}`: anulado por `export const dynamic = "force-dynamic"` do próprio layout,
> pela documentação oficial do Next.js). Terceiro caminho identificado (Cache API nativa do
> Workers Runtime, `caches.default`, usada diretamente dentro das Route Handlers, ignorando o
> sistema de cache do Next por completo) não foi implementado — sem precedente confirmado neste
> adaptador específico, só verificável testando contra deploy real. Decisão do usuário: registrar
> como débito técnico investigado, não gastar mais rodadas nisso agora. Ver §7 pro histórico
> completo das 5 rodadas. Retomar só se/quando alguém confirmar (via teste real ou precedente
> documentado) que `caches.default` funciona neste adaptador — nesse caso, a estrutura de 2 Route
> Handlers de §2.1/§2.2 já revisada (nota 7/10 nos pontos que não são o mecanismo de cache em si)
> pode ser reaproveitada quase inteira, só trocando a chamada de `fetch()` do §2.3 e adicionando a
> lógica de `caches.default.match()`/`.put()` dentro das 2 rotas.

> **Data:** 2026-08-29 (v3 — v1 reprovada nota 3/10 e descartada por completo; v2 reprovada nota
> 4/10 por reproduzir a mesma classe de bug (snippet não compilável) em outro lugar do documento
> + ignorar um padrão já estabelecido no repo pra ler secrets em runtime CF Pages. Ver §7.)
> **Motivação:** achado real do usuário — "trocar de aba/menu lateral" e "abrir Cautelas" estão
> lentos. As Fases 2-5 do plano anterior de performance já estavam implementadas; o gargalo real
> remanescente é este layout, marcado "fora de escopo" naquela spec por tocar o arquivo mais
> sensível do sistema (2 incidentes reais de segurança documentados nele).
> **Princípios:** SRP, DRY, SSOT, KISS, YAGNI, FailFast, Privilege Ceiling — e, acima de todos
> aqui, **nunca cachear nada que participe da resolução de identidade**.

---

## 0. Por que a v1 foi descartada (não só corrigida)

A v1 propunha `unstable_cache` (Next.js) envolvendo as queries Supabase direto no `layout.tsx`.
Revisão adversarial (nota 3/10) encontrou 4 CRÍTICO: snippet não compilava (variável fantasma),
`createClient()` dentro do escopo cacheado (lê `cookies()`, incompatível com `unstable_cache`),
chave de cache descrita de 3 formas diferentes no documento sem nenhuma bater com o código, e
**o achado mais sério**: este projeto faz deploy via `@cloudflare/next-on-pages` — confirmado na
documentação oficial do próprio adaptador (`cloudflare/next-on-pages` — issue #547, doc
`caching.md`) que **esse adaptador só implementa cache para chamadas `fetch()` (a "suspense
cache"), não para `unstable_cache` de funções arbitrárias**. A v1 inteira, mesmo corrigida nos
outros 3 pontos, não cachearia nada de verdade neste ambiente. Descartada, não remendada.

## 1. Diagnóstico (inalterado da v1, revalidado)

`export const dynamic = "force-dynamic"` (linha 7 de `layout.tsx`) — deliberado, corrigiu um
incidente real de vazamento de sessão. Combinado com `cookies()`/`headers()`, o layout
**re-executa por completo a cada navegação** (inclusive troca de aba na sidebar). Por navegação:

1. `getSessionUser()` — memoizado só dentro do mesmo request (PERF-02).
2. Bloco de recheck de session-mismatch — **fora de escopo, nunca tocado por esta spec**.
3. `getSessionProfile(user.id)` — mesma memoização por-request.
4. Se `profile.default_tenant_id` existe (praticamente sempre): 1 query de `reserve_membership`
   (sequencial, **fora de escopo — nunca cacheada**, é a fonte de verdade de "a que reserva este
   usuário pertence agora") + `Promise.all` de 3 queries: `tenant_branding`, nome da
   reserva/tenant, lista de reservas pro switcher.

## 2. Mecanismo — 2 rotas de API internas (Route Handlers), cacheadas via `fetch()`

Só `fetch()` tem cache real neste adaptador. Solução: mover as 3 queries pra 2 Route Handlers
Next.js (não a BFF — mesma origem, sem round-trip extra de rede entre serviços, e reaproveita
`SUPABASE_SERVICE_ROLE_KEY`, **já provisionado no CF Pages de `apps/web`** — confirmado em uso por
`apps/web/src/app/api/admin/users/route.ts`, nenhuma env var nova precisa ser criada). O layout
chama essas rotas via `fetch()` com `next: { revalidate: 60 }` — a URL completa (com query string)
É a chave de cache; não existe cache-key manual a errar.

**Separação em 2 rotas** (achado MÉDIO da v1, corrigido): das 3 queries, só a lista de reservas
de armeiro/admin_reserva é genuinamente por-usuário (filtra por `reserve_memberships.user_id`);
branding, nome, e a lista de reservas de admin_global (todas as ativas do tenant) são idênticas
pra qualquer staff do mesmo tenant — juntar tudo numa cache key por-usuário desperdiçaria
cache-hit-rate à toa.

### 2.0 — `getServiceRoleKey()` compartilhado (achado CRÍTICO da v2, corrigido)

A v2 lia `process.env.SUPABASE_SERVICE_ROLE_KEY`/`NEXT_PUBLIC_SUPABASE_URL` direto — errado:
`runtime-env.test.ts` já prova, neste repositório, que `process.env` pode vir vazio em runtime no
CF Pages (secrets são injetados no binding `getRequestContext().env`, não em `process.env`) — é
por isso que `admin/users/route.ts` tem seu próprio `getServiceRoleKey()` com fallback
`getRequestContext().env` → `process.env`. Em vez de duplicar essa lógica pela 5ª vez no repo
(SRP/DRY, princípios do cabeçalho desta spec), ela entra em `@/lib/supabase/runtime-env.ts`,
reaproveitando a função privada `getCloudflareEnv()` que já existe nesse arquivo.

**Achado MÉDIO da revisão adversarial (rodada 3), correção de precisão**: `getSupabaseUrl()`/
`getSupabaseAnonKey()`, hoje no mesmo arquivo, checam `process.env` PRIMEIRO e só caem pra
`getCloudflareEnv()` depois — ordem oposta à de `getServiceRoleKey()` abaixo (CF-first). Isso é
deliberado, não inconsistência: URL/anon key checam `process.env.SUPABASE_URL`/`SUPABASE_ANON_KEY`
primeiro, com fallback hardcoded (derivado de `NEXT_PUBLIC_*`, linhas 3-8 do arquivo) se tudo
faltar — nunca ficam vazias, build-time-safe; o service role key é
um secret real, nunca deve ter default hardcoded, e é exatamente o valor que
`runtime-env.test.ts` documenta como "pode faltar em `process.env` no runtime do CF Pages" — por
isso essa função, e só essa, verifica o binding do Workers primeiro. As 2 rotas novas importam de
`@/lib/supabase/runtime-env`, nunca leem `process.env` diretamente:

```ts
// apps/web/src/lib/supabase/runtime-env.ts — ADIÇÃO (arquivo já existe, só ganha 1 função nova)
export function getServiceRoleKey(): string {
  const fromCf = getCloudflareEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (fromCf) return fromCf;
  const fromEnv = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (fromEnv) return fromEnv;
  throw new Error("SUPABASE_SERVICE_ROLE_KEY not configured — adicione nas env vars do CF Pages.");
}
```

(`getCloudflareEnv` já existe no arquivo, privada — reaproveitada sem mudança.)

### 2.1 — `GET /api/internal/dashboard-branding`

Query params: `tenantId` (obrigatório), `currentReserveId` (opcional), `isUsuario` (`"1"|"0"`).
Substitui as 2 primeiras queries do `Promise.all` atual (branding + nome). Roda em `edge`, usa
`createClient(url, serviceRoleKey)` direto (sem `cookies()`, sem `@supabase/ssr`) — nada aqui lê
API dinâmica, response 100% determinístico pelos query params, seguro pra cachear por `fetch()`.

```ts
// apps/web/src/app/api/internal/dashboard-branding/route.ts
export const runtime = "edge";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseUrl, getServiceRoleKey } from "@/lib/supabase/runtime-env";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get("tenantId");
  const currentReserveId = searchParams.get("currentReserveId");
  const isUsuario = searchParams.get("isUsuario") === "1";
  if (!tenantId) return NextResponse.json({ error: "tenantId obrigatório" }, { status: 400 });

  let supabase;
  try {
    // Achado ALTO da revisão adversarial (rodada 4): as 4 outras criações de
    // client com service role no repo (admin/users, admin/almoxarifado,
    // auth/update-password, auth/activate-account), sem exceção, passam
    // esse 3º argumento — sem ele, o GoTrueClient interno tenta inicializar
    // storage/refresh de sessão pra um client que nunca autentica de verdade.
    supabase = createClient(getSupabaseUrl(), getServiceRoleKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 503 });
  }

  const [brandingResult, orgNameResult] = await Promise.all([
    supabase.from("tenant_branding")
      .select("primary_hex, secondary_hex, reserve_logo_url")
      .eq("tenant_id", tenantId).maybeSingle(),
    isUsuario
      ? supabase.from("tenants").select("id, nome, acronym").eq("id", tenantId).maybeSingle()
      : currentReserveId
        ? supabase.from("reserves").select("id, nome, acronym").eq("id", currentReserveId).single()
        : supabase.from("reserves").select("id, nome, acronym")
            .eq("tenant_id", tenantId).eq("status", "ativa").order("nome").limit(1).maybeSingle(),
  ]);

  return NextResponse.json({
    branding: brandingResult.data,
    orgName: orgNameResult.data,
  });
}
```

### 2.2 — `GET /api/internal/dashboard-reserves-list`

Query params: `tenantId`, `isAdminRole` (`"1"|"0"`), `needsMembershipList` (`"1"|"0"`), `userId`
(só relevante quando `needsMembershipList=1`). **Achado ALTO da v2, corrigido**: o código atual
tem 3 ramos, não 2 — `isAdminRole` → todas reservas; `armeiro`/`admin_reserva` → busca por
membership; **qualquer outro papel (inclusive `usuario`/cadete) → nenhuma query, `[]` direto**.
A v2 colapsava em 2 ramos e mandava `userId` sempre que `!isAdminRole`, o que incluía `usuario` —
o papel de maior volume do sistema passaria a bater no Supabase numa tabela onde cadete nunca tem
linha, toda navegação, à toa. `needsMembershipList` replica o 3º ramo explicitamente — só
`layout.tsx` decide o valor (`profile.role === "armeiro" || profile.role === "admin_reserva"`),
a rota não infere nada.

```ts
// apps/web/src/app/api/internal/dashboard-reserves-list/route.ts
export const runtime = "edge";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseUrl, getServiceRoleKey } from "@/lib/supabase/runtime-env";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get("tenantId");
  const isAdminRole = searchParams.get("isAdminRole") === "1";
  const needsMembershipList = searchParams.get("needsMembershipList") === "1";
  const userId = searchParams.get("userId");
  if (!tenantId) return NextResponse.json({ error: "tenantId obrigatório" }, { status: 400 });

  // 3º ramo (nem admin nem armeiro/admin_reserva — ex: usuario/cadete): igual ao
  // código atual, `[]` sem nenhuma query — nunca chega a criar o client.
  if (!isAdminRole && !needsMembershipList) return NextResponse.json({ reserves: [] });

  let supabase;
  try {
    // Achado ALTO da revisão adversarial (rodada 4): as 4 outras criações de
    // client com service role no repo (admin/users, admin/almoxarifado,
    // auth/update-password, auth/activate-account), sem exceção, passam
    // esse 3º argumento — sem ele, o GoTrueClient interno tenta inicializar
    // storage/refresh de sessão pra um client que nunca autentica de verdade.
    supabase = createClient(getSupabaseUrl(), getServiceRoleKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 503 });
  }

  if (isAdminRole) {
    const { data } = await supabase.from("reserves")
      .select("id, nome, acronym").eq("tenant_id", tenantId).eq("status", "ativa").order("nome");
    return NextResponse.json({ reserves: data ?? [] });
  }
  if (!userId) return NextResponse.json({ reserves: [] });
  const { data } = await supabase.from("reserve_memberships")
    .select("reserve:reserves(id, nome, acronym)").eq("user_id", userId);
  type MembershipRow = { reserve: { id: string; nome: string; acronym: string }[] };
  const reserves = ((data ?? []) as unknown as MembershipRow[])
    .flatMap((m) => m.reserve ?? []).filter((r) => r?.id);
  return NextResponse.json({ reserves });
}
```

### 2.3 — Chamada em `layout.tsx`

**Achado CRÍTICO da v2, corrigido**: `DashboardLayout` é uma função de Server Component, não uma
Route Handler — não recebe `request` como parâmetro, `request.url` não existe nesse escopo (a v2
usava isso e só confessava em prosa, 2 parágrafos depois, que não funcionava). Verificado no
repositório: **não existe precedente de resolver a própria origem dentro de um Server Component**
(todo uso de `request.url`/`headers().get("host")` encontrado é dentro de Route Handlers ou do
`middleware.ts`, que recebem `NextRequest` de verdade) — não é "escolher entre 2 padrões
existentes", é decisão nova, resolvida aqui: usar `hdrs` (já lido no topo do arquivo,
`const hdrs = await headers();`, linha ~55 do `layout.tsx` atual) para o host, e `https` sempre em
produção — seguro porque `middleware.ts` (linhas 69-87) já redireciona qualquer host não-canônico
ANTES de qualquer request chegar a este layout, então por aqui `hdrs.get("host")` já É o host
canônico (`apmcb.pmpb.online` ou subdomínio) sempre que `NODE_ENV === "production"`.

Substitui o `Promise.all` das 3 queries atuais por 2 `fetch()` em paralelo, e preserva a
reatribuição de `currentReserveId` a partir do fallback (linha 255 do arquivo atual,
`if (!isUsuario && !currentReserveId && r.id) currentReserveId = r.id;`) — agora lendo de
`orgName.id` (JSON da resposta), não mais de `orgNameResult.data.id`:

```ts
const host = hdrs.get("host");
const protocol = process.env.NODE_ENV === "production" ? "https" : (hdrs.get("x-forwarded-proto") ?? "http");
const origin = `${protocol}://${host}`;

// needsMembershipList replica o 3º ramo original (ver §2.2) — só armeiro/
// admin_reserva consultam reserve_memberships; usuario (cadete) nunca bate
// no Supabase pra isso, igual ao código atual.
const needsMembershipList = profile.role === "armeiro" || profile.role === "admin_reserva";

// Achado ALTO da revisão adversarial (rodada 3): sem try/catch, uma falha
// de rede/DNS no self-fetch (padrão inédito neste repo — nunca testado sob
// carga real) ou um corpo de resposta não-JSON derrubaria a renderização
// do dashboard inteiro pra qualquer usuário autenticado (Server Component
// async sem error boundary ao redor). O código atual (queries diretas)
// nunca lança nessa situação — resolve `{data: null, error}` e degrada
// graciosamente. Preserva a mesma garantia: falha aqui vira "usa os
// defaults", nunca crash.
let branding: { primary_hex: string | null; secondary_hex: string | null; reserve_logo_url: string | null } | null = null;
let orgName: { id?: string; nome: string; acronym?: string } | null = null;
let reservesList: { id: string; nome: string; acronym: string }[] = [];
try {
  const [brandingRes, reservesRes] = await Promise.all([
    fetch(`${origin}/api/internal/dashboard-branding?tenantId=${profile.default_tenant_id}` +
          (currentReserveId ? `&currentReserveId=${currentReserveId}` : "") +
          `&isUsuario=${isUsuario ? "1" : "0"}`,
          { next: { revalidate: 60 } }),
    fetch(`${origin}/api/internal/dashboard-reserves-list?tenantId=${profile.default_tenant_id}` +
          `&isAdminRole=${isAdminRole ? "1" : "0"}` +
          `&needsMembershipList=${needsMembershipList ? "1" : "0"}` +
          (needsMembershipList ? `&userId=${user.id}` : ""),
          { next: { revalidate: 60 } }),
  ]);
  const brandingJson = await brandingRes.json() as { branding: typeof branding; orgName: typeof orgName };
  branding = brandingJson.branding;
  orgName = brandingJson.orgName;
  const reservesJson = await reservesRes.json() as { reserves: typeof reservesList };
  reservesList = reservesJson.reserves;
} catch (err) {
  console.error("[dashboard-layout] falha ao buscar branding/reservas (self-fetch)", err);
}

if (branding) {
  primaryHex = branding.primary_hex ?? primaryHex;
  secondaryHex = branding.secondary_hex ?? secondaryHex;
  reserveLogoUrl = branding.reserve_logo_url ?? null;
}
if (orgName) {
  reserveName = orgName.nome ?? orgName.acronym ?? null;
  if (!isUsuario && !currentReserveId && orgName.id) currentReserveId = orgName.id;
}
reserves = reservesList;
```

## 3. O que NUNCA muda (idêntico à v1)

`getSessionUser()`, o bloco de recheck de session-mismatch inteiro (incluindo o `redirect()`
incondicional), `getSessionProfile()`, e a query de `reserve_membership` que resolve
`currentReserveId` continuam exatamente como estão hoje — nenhuma linha dessas é tocada.

## 4. Decisões e trade-offs assumidos explicitamente

1. **As 2 rotas não exigem autenticação própria** (sem secret, sem cookie) — decisão deliberada,
   não descuido: os dados retornados (cor/logo do tenant, nome, lista de reservas ativas) já são
   visíveis em texto/CSS pra qualquer usuário logado daquele tenant na página renderizada, e a
   query exige um `tenantId` (UUID não-enumerável). **Achado MÉDIO da v2**: isso muda o modelo de
   ameaça de verdade — hoje esse dado só é resolvido pro tenant do PRÓPRIO usuário autenticado
   (`profile.default_tenant_id`, vindo da sessão); sem autenticação nas rotas novas, branding/nome/
   reservas de **qualquer tenant do sistema** passam a ser enumeráveis por request anônima da
   internet, bastando ter/adivinhar um `tenantId` — não é o mesmo nível de exposição que existe
   hoje, mesmo sendo dado não-sensível. Um header "server-to-server" simples **não seria proteção
   real** (um `curl` externo copia o mesmo header, sem segredo nenhum por trás). Decisão: aceitar
   esse trade-off por ora (dado continua não-sensível, e cachear por `fetch()` já absorve
   repetição de request idêntico antes de bater no Supabase de novo) — rate limit por
   `tenantId`+IP nessas 2 rotas, ou uma regra de WAF/Cloudflare restringindo `/api/internal/*` a
   tráfego same-zone, ficam registrados como mitigação real pendente, fora do escopo desta
   entrega pontual de performance.
2. **`currentReserveId` "cacheado por tabela" só nas 2 rotas novas, nunca na query que o produz**
   — pra staff SEM `reserve_membership` explícita, o código atual retroalimenta
   `currentReserveId` com o `id` vindo da query de "primeira reserva ativa do tenant" (dentro da
   rota 2.1 agora). Isso significa que, pra esse subconjunto de usuários, uma reserva desativada/
   criada pelo admin pode demorar até 60s pra refletir na navegação seguinte. Aceito
   explicitamente (mesmo teto já usado pela Fase 4 do plano anterior) — não é vazamento entre
   usuários/tenants, é imprecisão temporária de um dado não-identitário.
3. **`reserve_logo_url` precisa ser confirmado como URL pública/estável** (não signed URL com TTL
   próprio) antes de implementar — **verificar contra o schema/policy do bucket de storage real
   antes de codar**, achado BAIXO pendente da v1 que continua válido aqui.
4. TTL de 60s — mesmo já usado/aceito na Fase 4 do plano de performance anterior
   (`admin/comando`).

## 5. Validação

- `tsc --noEmit` limpo em `apps/web` (agora testável de verdade — não há mais função com
  argumento fantasma).
- Testar as 2 rotas isoladamente via `curl` contra o preview deploy do CF Pages (não só
  `next dev` local) — confirmar que retornam o shape esperado pros 3 papéis (`usuario`,
  `armeiro`/`admin_reserva`, `admin_global`/`superadmin`). **Achado MÉDIO da revisão adversarial
  (rodada 3)**: `middleware.ts` redireciona (307) qualquer host que não seja o canônico sempre que
  `NODE_ENV === "production"` — e um build de Preview do CF Pages também roda com
  `NODE_ENV=production` (não há distinção Production/Preview nessa checagem). Um `curl` direto
  contra a URL de preview (`*.pages.dev`) recebe esse redirect ANTES de chegar nas rotas novas —
  ou testa sem perceber contra produção, se seguir o redirect (`-L`). Usar
  `curl -H "Host: apmcb.pmpb.online" https://<preview>.pages.dev/api/internal/dashboard-branding?...`
  (força o header `Host` esperado pela canonicalização, sem sair do preview deploy real).
- **Confirmar cache hit real no ambiente de deploy**: 2 requisições consecutivas à mesma URL
  (dentro de 60s) — a 2ª não deve gerar nova query no Supabase (checar via log/contador, mesmo
  princípio já usado pelo PERF-02 em `session-profile.ts`). Sem essa confirmação empírica, não
  declarar a spec como "implementada com sucesso" — é exatamente a lacuna que fez a v1 poder
  parecer correta sem nunca cachear nada de verdade.
- **Achado MÉDIO da v2**: `/api/internal/*` não está excluído do `matcher` de `middleware.ts` —
  o self-fetch de `layout.tsx` reatravessa a checagem de canonicalização de host. Em produção isso
  nunca gera redirect (host já é canônico, ver §2.3), mas **confirmar isso no preview deploy
  real**: as 2 chamadas devem retornar `200` direto, nunca `307→200` (um redirect intermediário
  destruiria o ganho de latência que é o objetivo inteiro desta spec).
- Trocar a cor do tenant via admin, confirmar que a mudança aparece em até 60s numa navegação
  subsequente.
- Medir tempo de navegação entre 2 páginas do dashboard antes/depois, autenticado (não dá pra
  testar isso sem sessão real — ping sem auth só mede redirect, não o custo real).

## 6. Arquivos afetados

- `apps/web/src/app/api/internal/dashboard-branding/route.ts` (novo)
- `apps/web/src/app/api/internal/dashboard-reserves-list/route.ts` (novo)
- `apps/web/src/app/(dashboard)/layout.tsx` (troca as 3 queries diretas por 2 `fetch()`)

## 7. Registro de Transparência

**v1** (`unstable_cache` envolvendo queries direto no layout): nota 3/10 na revisão adversarial —
4 CRÍTICO (snippet não compilava; `cookies()` dentro do escopo cacheado; chave de cache descrita
de 3 formas incompatíveis; **mecanismo escolhido não é suportado pelo adaptador de deploy real do
projeto**), 1 ALTO (garantia "nunca cacheia currentReserveId" imprecisa pro caso de fallback),
1 MÉDIO (cache por-usuário desnecessário pra dado compartilhável), 1 BAIXO (signed URL não
verificada). Descartada por completo, não corrigida incrementalmente.

**v2** (esta versão — `fetch()` contra 2 Route Handlers próprios): reescrita do zero. Endereça os
4 CRÍTICO pela raiz (mecanismo de cache trocado inteiramente pro único suportado; sem
`unstable_cache`, sem `cookies()` no caminho cacheado, sem cache-key manual — a URL é a chave) e o
MÉDIO (2 rotas separadas por escopo de compartilhamento). O ALTO da v1 (§4.2) e o BAIXO (§4.3)
persistem como decisões documentadas, não como bugs pendentes. _Pendente: rodada de revisão
adversarial real desta v2 antes de implementar._

**v2** (revisada): nota 4/10 — reprovada por reproduzir a mesma classe de bug da v1 (snippet de
`origin`/`request.url` em §2.3 não compilava, só que confessado em prosa 2 parágrafos depois em
vez de corrigido) mais 1 CRÍTICO novo (as 2 rotas liam `process.env` direto pro service role
key/URL, ignorando o padrão `getRequestContext().env`-first já estabelecido no repo — com teste
automatizado, `runtime-env.test.ts`, provando que `process.env` pode vir vazio em runtime no CF
Pages). 1 ALTO (rota de reservas colapsava 3 papéis em 2, gerando query desnecessária pro
`usuario`/cadete, o papel de maior volume). 2 MÉDIO (exposição cross-tenant sem autenticação
subestimada; self-fetch reatravessa `middleware.ts` sem isso constar na validação) + 1 BAIXO
(reatribuição de `currentReserveId` a partir do fallback não aparecia no snippet final).

**v3** (esta versão): corrige os 2 CRÍTICO pela raiz — `origin` resolvido via `hdrs` (já em
escopo, nunca `request.url` inexistente) com protocolo explícito por ambiente; `getServiceRoleKey()`
extraído para `@/lib/supabase/runtime-env.ts` (mesmo arquivo que já tem `getSupabaseUrl()`/
`getSupabaseAnonKey()` com o padrão CF-env-first), nenhuma rota nova lê `process.env` direto.
Corrige o ALTO com `needsMembershipList` explícito (3 ramos, não 2). Endereça os 2 MÉDIO como
decisões documentadas em §4/§5 (não implementadas nesta entrega — rate limit/WAF ficam como
mitigação pendente registrada, não como bug ignorado). Corrige o BAIXO mostrando a reatribuição
de `currentReserveId` no snippet final de §2.3. _Pendente: rodada de revisão adversarial desta v3
antes de implementar._

**v3** (revisada): nota 6/10 — os 3 achados CRÍTICO/ALTO das rodadas 1-2 confirmados corrigidos
no código publicado (não só na prosa). 1 ALTO novo, introduzido pela própria correção desta
rodada (fetch()/.json() sem try/catch — falha de rede derrubaria o dashboard inteiro, regressão
real vs. o comportamento atual que sempre degrada graciosamente). 2 MÉDIO de precisão (alegação
falsa sobre "mesmo padrão" em §2.0; plano de teste via curl neutralizado pelo redirect de
canonicalização do middleware, que roda em preview também). Corrigidos: try/catch com os mesmos
defaults graciosos já usados hoje; §2.0 corrigida pra explicar (não esconder) a diferença de
ordem entre as funções do arquivo; §5 corrigida com o header `Host` explícito pro teste de
preview. _Pendente: rodada de revisão adversarial 4 antes de implementar._

**v3** (rodada 4): nota 7/10 — os 3 achados da rodada 3 confirmados corrigidos de verdade no
código publicado. 1 ALTO novo: as 2 rotas criavam o client de service role sem
`{ auth: { autoRefreshToken: false, persistSession: false } }` — as 4 outras ocorrências desse
padrão no repo, sem exceção, usam essa opção; divergir sem motivo é regressão de robustez, não
escolha nova. 1 BAIXO de precisão residual em §2.0 (nome exato das env vars checadas). Ambos
corrigidos. _Pendente: rodada de revisão adversarial 5._
