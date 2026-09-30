# EVIDENCE — R-34 / R-37, lote 3 da C_HYBRID: `/reserva/saidas`

## Estado inicial e decisão
| Campo | Valor |
|---|---|
| Branch | `claude/bold-planck-6xy9fc` |
| HEAD inicial | `13eb82b` (lote 2) |
| `origin/main` | `f1b0795` (PR #56; nenhum arquivo deste lote; não mesclado) |
| Migration R-35 | sha256 `d63f4b5e…551b5b`, intacta |
| Migration criada | nenhuma |
| WIP_BIOMETRIA / WIP_INFRA_HIBRIDA | não tocadas (`routes/saidas.ts` do BFF, que a WIP_BIOMETRIA sobrepõe, não foi alterado) |
| **BATCH3_DECISION** | **GO**: bypass real; endpoint BFF adequado existe (`GET /api/lendings`, com extensão pequena); sem migration; sem colisão de WIP |

## Fluxo antigo (bypass)
A página autorizava por `profiles.role` e lia `lendings` (RLS `lendings_select` via `auth_role()`/`my_active_reserve_id()`) e `reserve_memberships`/`reserves` direto com o JWT do usuário. O Modo Usuário (D-02) não era considerado.

## Semântica
- `lendings`: `tenant_id` e `reserve_id` NOT NULL; `military_id`, `master_id`, `status_legacy` ∈ {ativo, devolvido}, `issued_at`/`returned_at`, `movement_id`.
- `reserve_memberships` (D-01): na página serve para apresentação (nome/logo da reserva) e para habilitar o `reserveId` usado na devolução biométrica. Preservado: admin_global em filial sem membership recebe `null` (captura desabilitada, como antes).
- Devolução biométrica (escrita) já passa pelo BFF e não foi alterada.

## Prova BEFORE
`page.test.tsx` (15) contra a página antiga: **13 falham**.
- BEFORE_STAFF: renderiza saídas lidas direto do Supabase.
- BEFORE_MODE_USER: o mesmo staff com papel efetivo `usuario` também recebe a página com dados de staff.
- BEFORE_USUARIO / TENANT / RESERVE: dependiam só do RLS por `profiles.role`.

## Implementação
```
SSR → resolveWebSessionRole (papel EFETIVO, fail-closed, confere identidade)
    → GET /api/lendings?limit=&status=   (cookie da sessão)
    → GET /api/reserves/active           (cookie da sessão)
    → BFF: authMiddleware → tenant+reserva da sessão no banco, antes do limit → service role
```
| Arquivo | Mudança |
|---|---|
| `apps/bff/src/routes/lendings.ts` (`GET /`) | `limit` opcional (inteiro 1..100, 400 com log), aplicado depois de tenant/reserva/status; desempate `order(id desc)`; embeds com `military.id/foto_url`, `master.matricula`; falha 500 agora genérica + `logFailure` |
| `apps/bff/src/routes/reserves.ts` | novo `GET /api/reserves/active` (roleGuard staff; reserva só da sessão; exige membership do par usuário+reserva; `reserves` filtrada por id+tenant; erros 500 genéricos com log) |
| `apps/web/.../reserva/saidas/page.tsx` | sem Supabase direto; papel efetivo; 401→login, 403→`/`, 5xx/rede→lista vazia com log; `limit+1` para `hasMore`; só os campos de `LendingRow` |
| `page.test.tsx` (15), `lendings-list-scope.test.ts` (20) | novos |

## Comportamento AFTER
| Cenário | Resultado |
|---|---|
| Staff normal | vê as saídas da própria reserva |
| Mesmo staff em Modo Usuário | página redireciona; endpoint 403 |
| Usuário comum | redireciona; 403 |
| Outro tenant | nunca aparece, nem com o mesmo `reserve_id` de outro tenant |
| Outra reserva do mesmo tenant | nunca aparece, mesmo com 60 mais recentes dela (filtro antes do limite) |
| Matriz (admin_global/auditor sem reserva) | tenant inteiro, limite respeitado; admin_global em filial fica confinado |
| Sem reserva ativa (não-matriz) | lista vazia |
| Sem sessão / identidade diferente / sem tenant | redirect / 400 (fail-closed) |
| `limit` inválido (0, abc, 1.5, 101, -3) | 400 com log |

## Multi-sessão e Bearer (R-28)
Não repetido aqui: as rotas estão atrás do mesmo `authMiddleware` (`index.ts`), provado por `mode-user-auth-paths` (12/12): sessões independentes (Mode User só na sua), Bearer limitado a `usuario`, identidade divergente falha fechado.

## Mutações (arquivos restaurados e conferidos com `cmp`)
Detectadas: remoção de `.eq(tenant)`, de `.in(reserve)`, do roleGuard, do guard de limit; membership removida em `/active` (2 falhas, após refazer o padrão único); filtro de tenant na reserva; na página: autorização por papel, redirect 401/403, limit+1, leitura direta. Mutação equivalente justificada: a ordem das chamadas do builder (`limit` antes/depois de `.eq`) não muda a consulta PostgREST, então não há garantia a proteger. O desempate por `id` é coberto por asserção estática.

## Regressão (após as correções da revisão)
BFF unit 695/695 · integração 188/188 (inclui R-06 20, R-28 12, lote 1 15, lote 2 7, R-39 10, R-35 13) · web 327/327 · `tsc` BFF, `lint:logs`, `git diff --check` OK · hash da migration R-35 intacto. E2E: BLOQUEADO_AMBIENTE (aponta para produção).

## Reviews
- **Security:** nenhum achado com confiança ≥ 8 (sem bypass de Modo Usuário, Bearer, IDOR ou fail-open; campos adicionados ficam nos mesmos papéis/escopo).
- **Code review:** 0 CRÍTICO, 0 ALTO. MÉDIO 1 (ordenação sem desempate) e MÉDIO 2 (500 sem log e com `error.message`): **corrigidos**. BAIXOS: comentário do teste L/T reconhece que é só guarda de fiação; 401/403/5xx triplicados entre lotes 1–3 e `STAFF_ROLES` (helper `bffFetchJson` fica para depois); superadmin removido registrado abaixo; latência de 2 saltos aceita.

## Mudanças de comportamento
- `superadmin` deixa de acessar a página (o BFF nunca lhe deu dados de tenant).
- O BFF sempre confina por reserva (mais estrito que o RLS quando o isolamento por tenant está desligado).
- O `role` passado ao cliente é o efetivo.

## Limitações
- `fake-postgrest` não ordena, não projeta colunas nem resolve embeds: ordem e formato dos embeds só têm guarda estática e fixtures da página.
- Prova do endpoint com banco em memória e contexto de sessão injetado.

## Status
**Lote 3: DONE_VERIFIED** (repositório; produção só após deploy). **R-34 e R-37: PARTIAL_IMPLEMENTATION**; faltam 14 páginas (ver ledger).
