# EVIDENCE — R-39: notificação de nova ocorrência escopada por tenant e reserva

## Estado inicial
| Campo | Valor |
|---|---|
| Branch | `claude/bold-planck-6xy9fc` |
| HEAD | `cca1d51` (R-37 lote 1) |
| Working tree | limpo |
| Migration R-35 | intacta (`d63f4b5e…`) |
| WIP_INFRA_HIBRIDA / WIP_BIOMETRIA | não tocadas |

## Defeito
`POST /api/ocorrencias` (`apps/bff/src/routes/ocorrencias.ts`, service role) tinha dois problemas:
- **Destinatários da plataforma inteira:** depois de gravar a ocorrência, notificava **todo** o staff da plataforma (`profiles.role in [armeiro, admin_global, admin_reserva]`, sem tenant nem reserva). A notificação levava título, material e `military_id` a staff de outros tenants.
- **Referências sem validação:** `lending_id` e `material_type_id` vinham do cliente sem nenhuma checagem.

## Prova BEFORE
Teste `ocorrencias-create-notify-scope.test.ts` (handler real da rota, contexto de sessão injetado, banco em memória) contra o POST de `cca1d51`: **0 de 10 passam**. A notificação chega ao staff do tenant B e de outras reservas, e referências de outro tenant ou de outro militar são aceitas.

## Correção
1. **Referências do cliente:** `lending_id` só é aceito se for do tenant da sessão **e** do próprio militar; `material_type_id`, se for do tenant da sessão.
   - Caso contrário: 400 com o mesmo texto para "não existe" e "é de outro tenant" (sem enumeração), mais log (`ocorrencias.create.lending_out_of_scope` / `material_type_out_of_scope`).
   - Erro de busca: 500 com mensagem genérica, mais log.
2. **Destinatários = quem pode ver a ocorrência pela regra do GET da mesma rota:**
   - reserva derivada: a da lending, senão a do material_type;
   - staff (armeiro, admin_reserva, admin_global) com `active_reserve_id` igual à reserva derivada;
   - mais admin_global em matriz (`active_reserve_id` nulo);
   - sem reserva derivável: só a matriz;
   - sem tenant na sessão: ninguém, com log (`notify_skipped_no_tenant`).
3. **Pertencer ao tenant** exige a linha em `tenant_memberships` (fonte de autorização) **e** `default_tenant_id` igual (cache). Um cache desatualizado nos dois sentidos nunca alcança outro tenant. Só cadastros `complete`.
4. **O próprio autor não é notificado.** Isso cobre o staff em Modo Usuário reportando.
5. **O aviso é best-effort:** usa o helper `insertNotifications`, dentro de try/catch. Uma falha no aviso gera log e nunca vira 500 depois da ocorrência gravada, o que evitaria reenvio e ocorrência duplicada.

O fluxo legítimo não muda. O web (`reportar-ocorrencia-sheet` via `materiais-table`) só envia `lending_id` das saídas do próprio militar. `lendings.tenant_id` é `NOT NULL` desde `20260915210000`.

## Testes
`apps/bff/src/__tests__/integration/ocorrencias-create-notify-scope.test.ts`: 10 casos, todos PASS.

| Caso | Esperado |
|---|---|
| Lending própria em A1 | notifica exatamente o staff ativo em A1 e o admin_global em matriz de A |
| Armadilhas | nunca notifica tenant B, outra reserva, admin_global em filial alheia, cadastro pendente, cache de tenant desatualizado (nos dois sentidos) |
| material_type de A2 | staff de A2 e matriz de A |
| Sem referência | só a matriz |
| Lending de outro militar, lending de outro tenant, material de outro tenant, lending inexistente | 400, nada gravado, ninguém notificado |
| Sem tenant na sessão | ocorrência gravada, ninguém notificado |
| Staff em Modo Usuário reportando | não notifica a si mesmo |

O helper `fake-postgrest` ganhou suporte mínimo a `insert()`.

## Contraprova
| Variante | Resultado |
|---|---|
| POST antigo | 0/10 |
| Sem filtro por `tenant_memberships` | 3 falhas |
| Sem filtro por `default_tenant_id` | 3 falhas |
| Sem filtro de reserva | 4 falhas |
| Sem excluir o autor | 1 falha |
| Aceita lending de outro militar | 1 falha |
| Aceita lending de outro tenant | 1 falha |
| Aceita material de outro tenant | 1 falha |
| Corrigido | 10/10 |

Todas as mutações foram revertidas; o hash do arquivo final foi conferido.

## Regressão
| Comando | Resultado |
|---|---|
| BFF unit (env CI) | 695/695 |
| BFF integração (env CI) | 161/161 |
| Web vitest | 296/296 |
| `tsc` BFF, `lint:logs`, `git diff --check` | OK |

A revisão de código viu falhas ao rodar a suíte **sem** as variáveis de ambiente do CI (`SUPABASE_URL`, `EMAIL_CHANGE_TOKEN_SECRET`, …). Com o ambiente de CI, a suíte fica 100% verde. Não há falha de código.

## Reviews
- **Security-review:** nenhum achado com confiança ≥ 8.
  - O tenant vem só da sessão.
  - As referências do cliente não abrem acesso a outro tenant.
  - Os destinatários ficam no tenant e coincidem com quem já vê a ocorrência pelo GET.
  - Não há injeção de filtro.
- **Code-review:** passou, 0 CRÍTICO, 0 ALTO.
  - **Corrigidos depois da revisão:**
    - M1: destinatários também por `tenant_memberships`;
    - M3: `insertNotifications` com try/catch;
    - B2: autonotificação;
    - B3: log e mensagem genérica em erro de busca;
    - B4: casos extras e remoção de código morto;
    - B5: `id` no `insert()` do fake.
  - **Registrados, não corrigidos:**
    - M2 (decisão de produto): só quem está com a reserva ativa é notificado, e não todo membro da reserva. É igual à visibilidade atual do GET; notificar membros de reservas inativas mudaria o modelo.
    - B1: `material_type_id` aceita qualquer reserva do tenant. Nenhum cliente envia esse campo; o GET já mostra a ocorrência à reserva do material.
    - B6: o texto do toast "A Reserva de Armamento foi notificada".

## Produção
Não acessada. Sem deploy, migration ou `db push`.

## Status
**DONE_VERIFIED_REPO_PENDING_DEPLOY**: correção verificada no repositório. Em produção, a notificação continua indo para a plataforma inteira até o deploy do BFF.
