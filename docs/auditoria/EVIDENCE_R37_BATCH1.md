# EVIDENCE — R-34 / R-37, lote 1 da C_HYBRID: `/reserva/ocorrencias`

## Estado inicial
| Campo | Valor |
|---|---|
| Branch | `claude/bold-planck-6xy9fc` |
| HEAD | `043d0af` (R-35) |
| `origin/main` | `5f91635` |
| Working tree | limpo |
| Migration R-35 | sha256 `d63f4b5e…551b5b`, intacta |
| WIP_INFRA_HIBRIDA / WIP_BIOMETRIA | não tocadas |

## Inventário revalidado (R-37)
Páginas SSR de staff que leem dados de staff direto do Supabase com o JWT do usuário (RLS por `profiles.role`) e **não** consideram o Modo Usuário. São 17 páginas:
- `admin/`: `page`, `arsenal`, `arsenal/manutencao`, `auditoria`, `comando`, `relatorios`, `usuarios`;
- `reserva/`: `arsenal`, `biometria`, `militares`, `ocorrencias`, `passagens`, `passagens/[id]`, `relatorios`, `saidas`, `saidas/nova`, `solicitacoes`.

Além delas, `reserva/page.tsx` redireciona em Modo Usuário só pelo cookie de UI `apmcb_mode`, que não é fonte de verdade.

## Lote escolhido
**SELECTED_BATCH = [`/reserva/ocorrencias`]**. Motivos:
- lê uma única tabela;
- a leitura é claramente de staff, e o comportamento em Modo Usuário é claramente diferente;
- o BFF já tinha `GET /api/ocorrencias` autorizado pela sessão (papel efetivo), com tenant e reserva aplicados (R-06/SP9.5), e com o branch `usuario` devolvendo só as próprias ocorrências;
- não precisa de migration;
- não colide com WIP;
- serve de modelo para os próximos lotes (página → BFF com a sessão).

## Prova BEFORE
Teste da página (`page.test.tsx`, handler real da página, borda mockada) contra a versão de `043d0af`: **11 de 13 falham**. O caso principal:
- **BEFORE_STAFF:** a página renderiza as ocorrências lidas direto do Supabase.
- **BEFORE_MODE_USER:** o mesmo staff em Modo Usuário (papel efetivo `usuario` na sessão do BFF) também recebe a página com os dados de staff lidos pelo RLS, em vez de ser redirecionado.

## Arquitetura aplicada (C_HYBRID)
```
SSR staff → papel efetivo da sessão do BFF (resolveWebSessionRole: fail-closed, confere identidade)
          → GET /api/ocorrencias com o cookie da sessão (bffSessionHeaders)
          → BFF: authMiddleware (Modo Usuário → usuario; Bearer sem sessão → teto usuario)
          → tenant + reserva da sessão → service role no BFF
```
A página não usa mais cliente Supabase nem consulta tabelas.

## Arquivos
| Arquivo | Mudança |
|---|---|
| `apps/web/src/app/(dashboard)/reserva/ocorrencias/page.tsx` | autorização pelo papel efetivo; dados do BFF. Também: timeout de 5 s; 401 leva ao login; outras falhas viram lista vazia com log (com `requestId`); só os 7 campos usados vão ao cliente |
| `apps/web/src/lib/web-session.ts` | `BFF_URL` exportado como fonte única |
| `apps/bff/src/routes/ocorrencias.ts` (GET) | staff não-matriz: filtro de reserva **no banco, antes do limite**, em duas consultas disjuntas (via lending; via material_type com `lending_id` nulo), merge ordenado e deduplicado. A matriz e o branch `usuario` não mudaram |
| `apps/bff/src/__tests__/idor-read-scope.test.ts` | a guarda estática olha a rota inteira e exige filtro de tenant em cada consulta de staff |
| testes novos | `page.test.tsx` (13), `ocorrencias-scope-real-handler.test.ts` (12), `ocorrencias-staff-limit.test.ts` (3) |

## Comportamento AFTER
| Cenário | Resultado |
|---|---|
| Staff em sessão normal | vê as ocorrências abertas da própria reserva (matriz: do tenant) |
| Mesmo staff em Modo Usuário | página redireciona; no BFF, só as próprias ocorrências (inclusive com o Bearer do próprio staff) |
| Usuário comum | página redireciona; no BFF, só as próprias |
| Outro tenant ou outra reserva | não aparece (casos A, D, E, I) |
| Identidade diferente entre cookie e Bearer | só a identidade da sessão |
| Sem tenant ou sem sessão | 403 / 401 / redirect |
| Duas sessões do mesmo usuário | sessão X (staff) e sessão Y (Modo Usuário) não se contaminam |

## Verificação
**Validação externa** (outra sessão do Claude Code, commit `f8aff99` na branch `claude/r37-batch1-verification`): **PASS**.
- Hashes da página e do teste conferidos.
- Página nova 9/9; página antiga 8/9 falhas.
- Teste do endpoint real 12/12, sozinho e na suíte completa.
- Mutações detectadas:

| Mutação | Casos que falham |
|---|---|
| Middleware ignora o modo | B, B', MULTI_SESSION |
| Bearer com `profiles.role` | H |
| Sem filtro de reserva | A, E, MULTI_SESSION |
| Sem filtro de tenant | I |

O teste do endpoint (sha256 `74853289…f778a7`) veio dessa validação sem alteração.

**Nesta sessão, depois das revisões:**
- Contraprovas:

| Contraprova | Resultado |
|---|---|
| Página antiga contra os testes novos | 11/13 falham |
| Rota antiga contra o teste de limite | falha |
| Remover `.is("lending_id", null)` | 2/3 falham |
| Remover o filtro de tenant de uma consulta | a guarda estática falha |

- Regressão:

| Comando | Resultado |
|---|---|
| BFF unit | 695/695 |
| BFF integração (inclui R-06 20/20, R-28 12/12, endpoint 12/12 e limite 3/3) | 151/151 |
| Web vitest | 296/296 |
| Link assinado de foto (R-35) | 13/13 |
| `tsc` BFF e web, `lint:logs`, eslint dos arquivos do lote, `git diff --check` | OK |

- Warning pré-existente, não alterado: `currentLimit` sem uso em `_ocorrencias-client.tsx`.
- E2E: não executado (aponta para produção; BLOQUEADO_AMBIENTE).

## Reviews
**Code-review**
- Rodada 1: 1 ALTO.
  - Listas truncadas: o BFF limitava a 100 **antes** do filtro de reserva. Corrigido.
- Mais 4 MÉDIOS:
  - `BFF_URL` divergente: corrigido.
  - falha vira lista vazia: parcial (401 leva ao login, o resto registra log; o estado de erro na UI fica pendente);
  - sem timeout e sem try/catch: corrigido.
  - contagens dos cards divergentes: próximo lote.
- BAIXOS: campos, asserções e cobertura corrigidos. `STAFF_ROLES`, `superadmin` e `highlight` registrados.
- Rodada 2: **passou, 0 CRÍTICO, 0 ALTO**.
  - MÉDIO restante: não havia teste de precedência da lending. Corrigido com teste, mutação e dedup no merge.

**Security-review**
- Rodada 1: nenhum achado com confiança ≥ 8.
- Rodada 2 (com a mudança do endpoint): nenhum achado com confiança ≥ 8. Sem vazamento de reserva ou tenant, sem ocorrência sem reserva para staff, sem aliases internos na resposta e sem regressão no Modo Usuário.

## Mudanças de comportamento registradas
- `superadmin` deixa de acessar `/reserva/ocorrencias`. O `roleGuard` do BFF nunca o aceitou, e ele é só do Nexus.
- Uma lending com `reserve_id` nulo não cai mais no fallback de `material_type`. É mais estrito (fail-closed).
- Sem `NEXT_PUBLIC_BFF_URL`, a página usa o mesmo padrão de `web-session`, que é a URL de produção. Em dev é preciso definir a variável.

## Limitações
- A prova do endpoint usa banco em memória (`fake-postgrest`), não o PostgREST real.
- Os cards de contagem de `reserva/page.tsx` e `admin/page.tsx` ainda leem `ocorrencias` direto: o número pode divergir da lista.
- Erros 403/500 do BFF aparecem como lista vazia, com log.

## Status
- **R-34: PARTIAL_IMPLEMENTATION.** O data plane direto de staff continua nas outras 16 páginas.
- **R-37: PARTIAL_IMPLEMENTATION.** Lote 1 de ~17 concluído.
