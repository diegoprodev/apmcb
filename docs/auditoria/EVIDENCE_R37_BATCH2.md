# EVIDENCE — R-34 / R-37, lote 2 da C_HYBRID: `/reserva/solicitacoes`

## Estado inicial
| Campo | Valor |
|---|---|
| Branch | `claude/bold-planck-6xy9fc` |
| HEAD | `9dde70b` (R-39); `cca1d51` (lote 1) presente |
| `origin/main` | `f1b0795` (avançou desde `5f91635`: PR #56, confinamento de perfil/convite/assinaturas por reserva; nenhum arquivo deste lote) |
| Working tree | limpo |
| Migration R-35 | sha256 `d63f4b5e…551b5b`, intacta |
| WIP_INFRA_HIBRIDA / WIP_BIOMETRIA | não tocadas |
| Migration criada neste lote | nenhuma |

## Fluxo antigo
`apps/web/src/app/(dashboard)/reserva/solicitacoes/page.tsx` (SSR de staff) autorizava por `profiles.role` (via `getSessionProfile`) e fazia **três** leituras diretas do Supabase com o JWT do usuário, pelo RLS:
1. `material_requests` (com joins em `profiles` ×2 e `material_request_items`), `order(requested_at desc)`, `limit(limit+1)`, filtrado por `default_tenant_id`;
2. a mesma leitura pontual por `id` para o deep-link `?highlight=`;
3. nenhuma outra tabela (o `RealtimeArmeiroSync` só recebe o tenant).

Nenhum filtro de reserva: o escopo de reserva vinha só do RLS, que decide por papel do perfil e ignora o Modo Usuário (D-02).

## Semântica de `material_requests` (confirmada no código, sem copiar regras de ocorrências)
- **Quem cria:** `usuario` (`POST /api/ssa/requests`, `roleGuard("usuario")`).
- **Quem lista:** `GET /api/ssa/requests` (`routes/ssa.ts`). Papel efetivo `usuario` → só as próprias (`military_id`, limite 20). Demais papéis → `scopedReserveIds(role, reserveId, tenantId)` + `tenant_id` da sessão, **no banco, antes de `.limit(50)`**; staff não-matriz sem reserva ativa → `[]`.
- **Vínculos:** `military_id` (dono), `tenant_id`, `reserve_id` (a reserva é coluna própria — diferente de ocorrências, que derivam a reserva de lending/material).
- **Ações de staff:** approve/reject/deliver com `roleGuard("armeiro","admin_global","admin_reserva")`, já via BFF com cookie.
- **Visão em Modo Usuário:** a de `usuario` (as próprias), porque o endpoint usa o papel efetivo da sessão.
- Nenhuma ambiguidade que altere autorização: o endpoint existente já tem a semântica correta, então não foi necessário criar nem alterar endpoint.

## Prova BEFORE
`page.test.tsx` (handler real da página, borda mockada) contra a página de `9dde70b`: **10 de 12 falham**.
- **BEFORE_STAFF:** a página renderiza as solicitações lidas direto do Supabase.
- **BEFORE_MODE_USER:** o mesmo staff com papel efetivo `usuario` também recebe a página com dados de staff, em vez de redirecionar.
- **BEFORE_USUARIO / TENANT / RESERVE:** o escopo de usuário, tenant e reserva dependia só do RLS por `profiles.role`.

## Arquitetura aplicada
```
SSR staff → papel efetivo da sessão do BFF (resolveWebSessionRole: fail-closed, confere identidade)
          → GET /api/ssa/requests com o cookie da sessão (bffSessionHeaders)
          → BFF: authMiddleware (Modo Usuário → usuario; Bearer sem sessão → teto usuario)
          → tenant + reserva da sessão, filtro no banco antes do limite → service role no BFF
```
A página não usa mais cliente Supabase nem consulta tabelas. `getSessionProfile` continua só para o `tenantId` do `RealtimeArmeiroSync` (canal de realtime; não autoriza nada e só é alcançado depois do redirect de quem não é staff).

## Arquivos
| Arquivo | Mudança |
|---|---|
| `apps/web/src/app/(dashboard)/reserva/solicitacoes/page.tsx` | autorização pelo papel efetivo; dados do BFF; timeout 5 s; 401 → login; 403/500/rede → banner de erro que já existia, lista vazia e log; só os campos que a página já entregava; `highlight` procurado no que o BFF devolveu; limite máx. 49 (o BFF devolve até 50, então `hasMore` fica exato) |
| `apps/bff/src/routes/ssa.ts` | **não alterado** |
| `apps/web/src/app/(dashboard)/reserva/solicitacoes/page.test.tsx` | novo, 12 casos |
| `apps/bff/src/__tests__/integration/ssa-requests-list-scope.test.ts` | novo, 7 casos |

## Comportamento AFTER
| Cenário | Resultado |
|---|---|
| Staff em sessão normal | vê as solicitações da própria reserva, do tenant (matriz: do tenant, até 50) |
| Mesmo staff em Modo Usuário | a página redireciona; no endpoint, só as próprias |
| Usuário comum | a página redireciona; no endpoint, só as próprias (de qualquer reserva) |
| Outro tenant | nunca aparece, nem com a reserva certa e o tenant trocado |
| Outra reserva | nunca aparece, nem com 60 mais recentes dela (filtro antes do limite) |
| Outro usuário do mesmo tenant | não aparece para `usuario` |
| Sem reserva ativa (não-matriz) | lista vazia, nunca o tenant inteiro |
| Sem sessão, identidade diferente | redirect (fail-closed) |
| 401 / 403 / 500 / BFF fora do ar | 401 → login; os demais → banner de erro, lista vazia, log; nunca dado direto |

## Testes
- **Página** (16): staff normal com cookie; Modo Usuário; usuário comum; identidade diferente; sem sessão; 401; 403/500/rede; limite e `hasMore`; deep-link `highlight`; campos repassados; nenhuma leitura direta; guarda estática (a página não importa cliente Supabase nem chama `.from`).
- **Endpoint** (7, contexto de sessão injetado): reserva A1 com 60 mais recentes da A2; Modo Usuário; usuário comum; tenant B; tenant trocado com reserva certa; matriz limitada a 50; sem reserva ativa. A resolução da sessão em si (Modo Usuário, Bearer, identidade mista, duas sessões) já é coberta por `mode-user-auth-paths` (12) e `ocorrencias-scope-real-handler` (12); o endpoint usa o mesmo `authMiddleware`.

## Contraprova
Página antiga contra os testes novos: 10/12 falham. Mutações temporárias em `routes/ssa.ts` (revertidas; hash conferido: o arquivo ficou intacto):

| Mutação | Resultado |
|---|---|
| Sem filtro de reserva | 2 falhas |
| Sem filtro de tenant | 2 falhas |
| `usuario` sem filtro de dono | 2 falhas |
| Ignorar o papel efetivo `usuario` (Modo Usuário) | 2 falhas |
| Filtro de reserva **depois** do limite | 1 falha (só detectada depois de reordenar a fixture: as 60 mais recentes vêm primeiro, como o `order desc` real) |

**Mutação equivalente (não detectada, e está certo):** remover o `if (reserveIds.length === 0) return c.json([])` deixou os 7 testes verdes. Não é garantia sem teste: com lista vazia, `.in("reserve_id", [])` já não devolve linha nenhuma (no fake e no PostgREST, `in.()`), então o comportamento é o mesmo. O `return []` é só um atalho que evita a consulta. O caso "sem reserva ativa → lista vazia" continua protegendo o resultado.

**Limite:** a prova de multi-sessão (A staff / B Modo Usuário) é a do `authMiddleware` compartilhado (`mode-user-auth-paths`), não repetida neste arquivo.

## Regressão
| Comando | Resultado |
|---|---|
| BFF unit (env CI) | 695/695 |
| BFF integração (env CI) | 168/168 |
| R-06 (`dashboard-scope-real-handler`) | 20/20 |
| R-28 (`mode-user-auth-paths`) | 12/12 |
| Lote 1 (`ocorrencias-scope-real-handler` + `staff-limit`) | 15/15 |
| R-39 (`ocorrencias-create-notify-scope`) | 10/10 |
| R-35 signed URL (`profile-photo-routes`) | 13/13 |
| Web vitest | 312/312 (41 arquivos) |
| `tsc` BFF e web, `lint:logs`, eslint dos arquivos do lote, `git diff --check` | OK |
| E2E | não executado (aponta para produção; BLOQUEADO_AMBIENTE) |

## Reviews
- **Security-review:** nenhum achado com confiança ≥ 8. (A revisão foi feita antes das correções acima, que só restringem: 403 passa a redirecionar, linhas nulas são ignoradas e há mais log.) Confirmou: sem bypass de Modo Usuário; `profiles.role` deixou de ser autoridade; Bearer não restaura privilégio; erro nunca vira dado; `highlight` não constrói consulta (só `find` sobre linhas já escopadas); tenant e reserva filtrados antes do limite; nenhuma leitura direta residual na página.
- **Code-review:** a primeira execução caiu por limite de sessão do serviço; a segunda **passou: 0 CRÍTICO, 0 ALTO**.
  - MÉDIO 2 (banner "falha de conexão com o banco" para 403): **corrigido**. 403 é negação (o papel caiu entre as chamadas): redireciona para `/` com log.
  - MÉDIO 1 (deep-link `?highlight=` fora das 50 mais recentes): **não corrigido, registrado como limitação**. A correção de verdade seria estender `GET /api/ssa/requests` com `?id=`, o que amplia o escopo do lote. Agora o destaque fora da janela gera log.
  - BAIXOS tratados: linhas nulas na resposta ignoradas; teste de log por caso de falha; teste de `limit=50` → 49 e de 50 linhas com `hasMore=true`; teste do highlight fora da janela.
  - BAIXOS registrados: `expire_material_requests` a cada listagem (UPDATE global; índice parcial `(expires_at) WHERE status='aprovado'` a avaliar); extrair helper `STAFF_ROLES`/`bffGetJson` no 3º lote; `getSessionProfile` em paralelo; falta E2E com dados reais.
  - Conferido à mão: o cliente só renderiza `posto` e `nome_completo` (`foto_url` é opcional e nunca exibido), e os botões de limite são só 20 e 30.

## Mudanças de comportamento registradas
- `superadmin` deixa de acessar `/reserva/solicitacoes` (o BFF nunca lhe deu dados de tenant nessa rota; papel só do Nexus).
- `?highlight=` só encontra solicitações entre as até 50 que o BFF devolve; a leitura pontual fora dessa janela foi removida (era leitura direta) e agora só deixa log. É uma regressão funcional conhecida; o `?id=` no BFF fica como decisão para um lote futuro.
- 403 do BFF na listagem passa a redirecionar para `/` em vez de mostrar o banner de erro.
- `GET /api/ssa/requests` chama `expire_material_requests` a cada listagem (efeito já existente do endpoint, que a página antiga não disparava).

## Limitações
- A prova do endpoint usa banco em memória (`fake-postgrest`), não o PostgREST real.
- O teste do endpoint injeta o contexto de sessão; a resolução da sessão é provada por `mode-user-auth-paths` e pelo lote 1.
- Fora do lote e não corrigido: fallback de `NEXT_PUBLIC_BFF_URL`, UX de erros de `/reserva/ocorrencias`, decisão M2 do R-39.

## Status
**Lote 2: DONE_VERIFIED** (no repositório; produção não corrigida até o deploy do BFF e do web).
**R-34 e R-37: PARTIAL_IMPLEMENTATION.** Páginas de staff diretas restantes: 15 (ver ledger).
