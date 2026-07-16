# Session-mismatch race condition + link morto em /admin/comando

**Data:** 2026-07-16
**Status:** Aprovado para implementação imediata
**Contexto:** Descoberto durante investigação do incidente de CSRF em `/api/lendings/identify` (ver `CHANGELOG.md` 2026-07-16). Um sub-agente rodou jornada E2E completa nos 3 perfis de usuário em produção e encontrou dois problemas adicionais, não relacionados ao CSRF, que esta spec cobre.

---

## 1. Falso-positivo do guard `session_mismatch` no primeiro login

### Evidência

O sub-agente de jornada E2E reproduziu, **3 de 3 vezes**, o seguinte padrão: login limpo (matrícula+senha) → todas as chamadas de rede retornam 200 (`token`, `POST /api/auth/exchange`, `GET /api/auth/upgrade-session`) → mesmo assim, a navegação para o dashboard é redirecionada para `/auth/error?reason=session_mismatch` e a sessão é destruída. Um segundo login imediato, na mesma aba, sempre teve sucesso.

Eu mesmo reproduzi uma variante deste sintoma mais cedo na mesma investigação, mas em condições diferentes: um browser profile com cookies residuais de uma conta de teste anterior. Nesse caso o guard estava correto (havia divergência real e persistente). No caso do sub-agente, o ambiente era limpo — a divergência só existiu no primeiro request e desapareceu no segundo, o que aponta para uma causa distinta: **uma condição de corrida (race), não vazamento real de sessão**.

### Mecanismo (`apps/web/src/app/(dashboard)/layout.tsx:24-45`)

```ts
const { data: { user } } = await supabase.auth.getUser();      // 1
const verifiedUserId = (await headers()).get("x-verified-user-id"); // 2
if (verifiedUserId && verifiedUserId !== user.id) redirect("/auth/session-mismatch");
```

- (1) `supabase.auth.getUser()` valida o JWT dos cookies `sb-*` **contra o servidor de Auth do Supabase** (não é uma decodificação local — é uma chamada de rede).
- (2) `x-verified-user-id` é resolvido por `middleware.ts` → `resolveVerifiedUserId()`, que lê o cookie `apmcb_session` e chama `GET {BFF_URL}/api/auth/me` — outra chamada de rede independente, para um serviço diferente (BFF no Hetzner, não Supabase).

Ambas as chamadas leem cookies **frescos**, escritos há poucos milissegundos por `POST /api/auth/exchange` + `GET /api/auth/upgrade-session` (fluxo de login em `login/page.tsx`/`auth/exchange/page.tsx`). São duas chamadas de rede **independentes, para dois backends diferentes**, disparadas em paralelo pelo Next.js durante a mesma renderização. Não há nenhuma garantia de ordenação ou de que ambas observem o mesmo instante de "verdade" do estado de sessão — uma delas pode legitimamente responder com uma visão ainda não totalmente propagada (ex.: réplica de leitura do Supabase Auth, cold path do BFF) enquanto a outra já reflete o estado atualizado.

Isso explica todos os fatos observados: falha reprodutível apenas no primeiro request pós-login, nunca no segundo (a propagação já terminou), e apenas quando o timing é justo o suficiente para expor a janela.

### Fix

O guard existe para proteger contra vazamento **sustentado** de sessão entre usuários (documentado como mitigação de um incidente real de session-bleed, ver comentários em `layout.tsx` e `upgrade-session/route.ts`). Uma única leitura divergente, no exato instante após login, não é evidência suficiente de um incidente — é exatamente o padrão esperado de uma corrida de propagação. A correção não remove a proteção: adiciona **uma reconfirmação direta antes de declarar o incidente**.

**Revisão de código (1ª rodada) corrigiu o design inicial desta spec em 2 pontos antes do commit:**

1. A reconfirmação deve ser feita no lado que **pode legitimamente variar** entre duas leituras — `supabase.auth.getUser()` (round-trip de rede real contra o Supabase Auth), não no lado do BFF. O BFF resolve a identidade decodificando localmente um cookie iron-session selado — determinístico por cookie, o mesmo valor sempre resolve pro mesmo `user_id`, então reconferir esse lado não tem efeito nenhum sobre a causa suspeita.
2. Falha ao reconfirmar (timeout, erro de rede) **nunca** pode ser tratada como "confirmado OK" — isso criaria uma janela de fail-open exatamente no caso mais perigoso (vazamento real coincidindo com instabilidade transitória de um dos backends).

Design final:

- `apps/web/src/lib/verified-user.ts` — `fetchVerifiedUserId()` extraído de `middleware.ts` (SSOT, ainda usado só por `middleware.ts`).
- `apps/web/src/lib/session-mismatch.ts` — função pura `decideSessionMismatch(bffVerifiedUserId, recheckedSupabaseUserId)`, testável isoladamente (`session-mismatch.test.ts`, 4 casos: concorda / diverge de novo / recheck `null` / recheck `undefined` — os 2 últimos SEMPRE retornam `redirect inconclusive`, nunca "ok").
- Em `layout.tsx`, ao detectar divergência: aguarda ~300ms, chama `supabase.auth.getUser()` uma segunda vez, e passa os dois valores para `decideSessionMismatch`. Só redireciona se a decisão for `redirect` (persistente OU inconclusiva). Se `confirmed-ok`, usa a identidade reconfirmada (`user = recheckedUser`) para o resto do render — não a leitura original, potencialmente stale — e loga como `warn` (não `error`) para acompanhar frequência sem gerar ruído de incidente.
- Isso preserva 100% a proteção contra o caso real (cookies de contas diferentes coexistindo — mesmo JWT errado nas duas leituras de `getUser()`, continua divergindo do BFF, redireciona) e elimina o falso-positivo transitório, sem introduzir fail-open.
- Custo: ~300ms de latência extra, mas **apenas no caminho raro de divergência** — login normal (>99% dos casos) não é afetado.

---

## 2. Links mortos em `/admin/comando` (404)

### Evidência

`GET /admin/cautelamentos?_rsc=... → 404`, disparado automaticamente pelo prefetch do Next.js (`<Link>`) ao carregar `/admin/comando` — achado original do sub-agente de jornada E2E.

### Causa raiz

Auditoria de todos os `href=` em `apps/web/src/app/(dashboard)/admin/comando/_client.tsx` encontrou **2** cards com rota inexistente, não só o relatado:

- Linha 173 — "Cautelas Ativas" → `/admin/cautelamentos` (não existe; existe `/reserva/cautelas` para o armeiro, sem equivalente administrativo).
- Linha 156 — "Passagens em Atraso" → `/admin/passagens?status=vencido` (não existe — achado adicional, não estava no relatório original do sub-agente).

Confirmado via `find apps/web/src/app/(dashboard)/admin -maxdepth 1 -type d`: `arsenal, auditoria, comando, estrutura, inventario, livros, relatorios, saidas, usuarios` — nenhuma das duas rotas está presente.

### Fix

Não é escopo desta spec construir páginas novas de administração (feature nova, fora do que foi pedido). O fix correto e contido: remover os 2 `href` quebrados, deixando os cards informativos — mesmo padrão já usado pelo card irmão "Cautela com Item Vencido" (linhas 177-184 do mesmo arquivo), que nunca teve `href`. `CommandCard` (`apps/web/src/components/admin/command-card.tsx`) já trata `href` ausente corretamente (`href?: string`, só renderiza `<Link>` quando presente). Elimina os 404s sem inventar escopo novo.

---

## Arquivos afetados

| Arquivo | Mudança |
|---|---|
| `apps/web/src/lib/verified-user.ts` | **Novo.** `fetchVerifiedUserId()` extraído de `middleware.ts`. |
| `apps/web/src/lib/session-mismatch.ts` | **Novo.** `decideSessionMismatch()` — função pura, decide redirect vs confirmed-ok. |
| `apps/web/src/lib/session-mismatch.test.ts` | **Novo.** 4 testes unitários (Vitest). |
| `apps/web/src/middleware.ts` | `resolveVerifiedUserId` passa a delegar para o helper compartilhado. |
| `apps/web/src/app/(dashboard)/layout.tsx` | Reconfirmação (via `supabase.auth.getUser()`) antes de declarar `session_mismatch`. |
| `apps/web/src/app/(dashboard)/admin/comando/_client.tsx` | Remove os 2 `href` mortos ("Cautelas Ativas", "Passagens em Atraso"). |

## Verificação

1. `tsc --noEmit` limpo em `apps/web`.
2. Revisão de código sênior obrigatória (CLAUDE.md) antes do commit.
3. Validação visual via Playwright em produção pós-deploy: login limpo nos 3 perfis sem `session_mismatch`; `/admin/comando` sem request 404 para `/admin/cautelamentos`.
4. Confirmar que o caso real de divergência sustentada (cookies de contas diferentes) continua sendo bloqueado — não introduzir regressão de segurança.
