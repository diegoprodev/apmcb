# EVIDENCE — R-28: Modo Usuário no caminho Bearer

## Estado inicial
| Campo | Valor |
|---|---|
| Branch | `claude/bold-planck-6xy9fc` |
| HEAD | `9665c8fc136d60c2a74d744928ad1829c370aa69` (R-06) |
| `main` | `5f91635`, ancestral de HEAD |
| Working tree | limpo (início e fim) |
| WIP | `worktree-biometric-unify-ssa` @ `4b6438d`, `ops/vps-env-storage` @ `0c52df6` — não tocados |

## Fluxos (código real: `apps/bff/src/middleware/auth.ts`)
```
COOKIE (apmcb_session, iron-session selada, HttpOnly, 8h deslizante)
  identity  = session.userId            (gravado no login/exchange)
  guard     = checkSessionValid: revoked_sessions(sessionId) + profiles.role == session.role + sessions_invalidated_at
  role      = session.activeMode==="usuario" ? "usuario" : session.role
  original  = session.originalRole ?? session.role (só em Modo Usuário)
  tenant    = session.tenantId          reserve = session.reserveId
  → o cookie VENCE: se a sessão existe, o Bearer é ignorado

BEARER (Authorization: Bearer <JWT Supabase>), só se NÃO houver sessão
  identity  = AuthProvider.verifyAccessToken (GoTrue /auth/v1/user; ON_PREMISE → 501)
  guard     = nenhum (sem sessionId, sem revogação, sem invalidated_at)
  role      = profiles.role             ← Modo Usuário NÃO é considerado
  tenant    = tenant_memberships ... limit(1)    reserve = profiles.active_reserve_id
```

## Semântica do Modo Usuário (evidência)
- Ativado/desativado por `POST /api/session/mode` (`routes/session.ts`): grava `activeMode`/`originalRole` **só na iron-session** e seta o cookie de UI `apmcb_mode` (HttpOnly, `.pmpb.online`, 8h **fixas**).
- **Não existe estado equivalente no banco** (`profiles` não tem coluna de modo) nem no JWT da Supabase.
- Comentário explícito em `middleware/auth.ts`: "session.activeMode é a única fonte de verdade" → **estado por sessão** (A). Duas sessões/dispositivos do mesmo usuário **podem divergir**.
- O Bearer **não tem informação suficiente** para saber o modo: o token é da identidade, não da sessão.
- Comentários em `middleware/auth.ts` e `apps/web/src/app/api/mode/route.ts` afirmam que o Bearer lê `apmcb_mode` — **o código não faz isso**.
- Voltar ao modo staff não exige reautenticação → o Modo Usuário **não é fronteira de privilégio contra o próprio titular**; o risco é de consistência/segregação de funções (R-04), não escalada.

## Defeito reproduzido (teste de handler REAL: `authMiddleware` + `GET /api/dashboard/command`)
Teste executado nesta sessão (`bun test`, 7/7 verde descrevendo o comportamento atual; não versionado — ver Decisão):

| Caso | Resultado |
|---|---|
| STAFF_COOKIE_NORMAL (admin_global, cookie) | 200 |
| MODE_USER_COOKIE (admin_global, cookie em Modo Usuário) | **403** |
| MODE_USER cookie + Bearer do mesmo usuário | **403** (cookie vence) |
| STAFF_BEARER_NORMAL (só Bearer) | 200 |
| **MODE_USER, só Bearer** (sessão do usuário em Modo Usuário, requisição sem cookie) | **200 — papel admin_global restaurado** |
| USUARIO_COOKIE / USUARIO_BEARER | 403 / 403 |

No produto: `admin/comando/page.tsx` autoriza por `profiles.role` e **não olha o modo**; `_client.tsx` chama o BFF **só com Bearer** (sem `credentials: "include"`); não há `layout.tsx` em `/admin` e o `middleware.ts` do Next não olha `apmcb_mode` → em Modo Usuário, abrir `/admin/comando` pela URL mostra as métricas de staff.

## Consumidores Bearer (web → BFF)
| Tipo | Arquivos | Cookie também? |
|---|---|---|
| Client com `credentials: "include"` (cookie vence; modo respeitado) | admin/saidas, admin/usuarios (2), reserva/cautelas, reserva/ocorrencias, reserva/passagens (2), reserva/saidas (2), reserva/solicitacoes, efetivo/reportar-ocorrencia, reserva/_verify-totp, ssa/solicitar-armamento | sim |
| Client **só Bearer** | `admin/comando/_client.tsx` | **não** |
| **SSR (servidor Next) só Bearer** | admin/arsenal/solicitacoes, admin/livros, admin/saidas (page), efetivo/page, efetivo/minhas-cautelas | **não** (o Next não repassa `apmcb_session`) |
| Proxy | `app/api/mode/route.ts` → `POST /api/session/mode` | cria sessão |

Nenhum consumidor mobile, CLI, integração externa ou bridge usa Bearer de usuário (a bridge usa device-auth Ed25519 em `/api/biometric-bridge/*`). ON_PREMISE não suporta Bearer (501).

## Opções analisadas
| | Segurança | Semântica por sessão | AuthProvider / On-Prem | Frontend | Bearer legítimo | WIP_INFRA |
|---|---|---|---|---|---|---|
| A. Comando com cookie (`credentials: "include"`) + `/admin/layout.tsx` redirecionando | **Parcial**: só esconde a UI; `/api/admin/*` do Next e Bearer direto continuam staff; guard fail-open quando `apmcb_mode` (8h fixas) expira e a sessão (deslizante) não; sessão de um usuário A + token de um usuário B → escopo de A; sessão inválida → 401 sem fallback | preservada | nenhum | 2 arquivos | preservado | nenhum |
| B. Bearer ganha contexto de modo | Só possível com estado **por usuário** (coluna em `profiles`) ou vinculando Bearer à sessão | **muda para por usuário**, ou exige vínculo token↔sessão | muda o middleware (arquivo da frente INFRA/AuthProvider) + migration | — | afetado | **colide** |
| C. Unificar resolução de papel (cookie e Bearer) | Mesmo problema de B: o Bearer não carrega a sessão | idem | idem | — | afetado | **colide** |
| D. Eliminar Bearer das chamadas do navegador e SSR (SSR repassa `apmcb_session`; staff só por sessão) | Fecha o caminho de produto; Bearer direto ainda possível até restringir o middleware | preservada | muda o middleware para restringir Bearer | 6+ arquivos | proxy `/api/mode` | **colide** |

Implementação de A foi feita, testada (web 3/3; BFF 7/7) e **revertida**: o code-review mostrou que ela não é enforcement e introduz riscos novos (identidade sessão≠token, perda de fallback, fail-open por expiração do cookie de UI). Commitá-la como correção faria a resposta à pergunta central parecer "não" quando continua "sim".

## Decisão
**BLOCKED_PRODUCT_DECISION** (com colisão WIP_INFRA para qualquer correção de backend).

A pergunta "um usuário em Modo Usuário consegue recuperar privilégios de staff usando Bearer?" continua **SIM**, e não tem correção segura sem antes decidir:
1. **O Modo Usuário deve ser uma trava efetiva (enforcement) ou um contexto de trabalho?** Hoje ele sai com um clique, sem reautenticação.
2. **Se for trava: por sessão ou por usuário?**
   - *Por usuário*: coluna em `profiles`, lida pelos dois caminhos (migration + middleware). Entrar em Modo Usuário no celular rebaixa o notebook.
   - *Por sessão* (atual): o Bearer precisa sair das chamadas do navegador/SSR (opção D) e o middleware passar a recusar Bearer em rotas de staff — mudança no `middleware/auth.ts`, arquivo compartilhado com o AuthProvider da frente INFRA.

Patch recomendado para quando a decisão existir (não aplicado): D + recusar Bearer em rotas de staff no `authMiddleware`, com o teste de handler desta sessão (cookie/Bearer × modo) como gate.

## Correção
Nenhuma aplicada. Nenhum arquivo de código alterado no commit.

## Testes (executados)
| Comando | Resultado |
|---|---|
| teste de handler real R-28 (bun) | 7/7 — documenta o comportamento atual (inclusive o 200 do Bearer em Modo Usuário) |
| web: teste `ComandoClient` credentials + `AdminLayout` (tentativa A) | antes: FAIL (credentials `undefined`; layout inexistente) · depois: 3/3 — revertido |
| Regressão com A aplicada | web tsc OK, vitest 274/274; BFF unit 690/690, integração 131/131 (inclui R-06 20/20), tsc OK, lint:logs OK |
| Estado final (A revertida) | árvore idêntica a `9665c8f` + docs |

## R-06
Intacto (nenhum código alterado; 20/20 na regressão).

## Reviews
- code-review (sobre a tentativa A): 9 achados — fail-open do guard por expiração do `apmcb_mode`; A é ocultação de UI, não enforcement; correção no nível errado (middleware); sessão A + token B; perda do fallback Bearer; teste que fixa o bypass como esperado; dependência de ordem do mock de `fetch`; redirect sem log; guard duplicado. Conclusão adotada: não commitar A.
- security-review: não executado sobre código, porque nenhum código foi commitado.

## WIP
WIP_INFRA_HIBRIDA e WIP_BIOMETRIA preservados; `middleware/auth.ts`, `routes/session.ts`, AuthProvider não tocados.

## Produção
Não acessada. Nenhuma mutação.

## Riscos residuais / achados
1. Bypass do Modo Usuário via Bearer (este item).
2. `/api/admin/*` (route handlers do Next) autorizam por `profiles.role`, ignorando o modo.
3. Em Modo Usuário, `admin_global` recebe 403 em `/efetivo` (SSR Bearer → papel admin_global, que `/cautelamentos/ativos` não aceita).
4. `apmcb_mode` expira em 8h fixas enquanto a sessão é deslizante → UI e backend divergem após 8h; `session.destroy()` no middleware não apaga `apmcb_mode`.
5. Comentários dizem que o Bearer lê `apmcb_mode`; o código não lê.

## Status R-28
**BLOCKED_PRODUCT_DECISION** — defeito reproduzido no fluxo real; correção de enforcement depende da decisão de semântica do Modo Usuário e toca `middleware/auth.ts` (WIP_INFRA).
