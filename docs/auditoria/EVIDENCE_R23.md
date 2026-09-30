# EVIDENCE — R-23: reconciliação forense do histórico de migrations

## Estado inicial
| Campo | Valor |
|---|---|
| Branch | `claude/bold-planck-6xy9fc` |
| HEAD | `39f26155eb06e092524c559f21edf0700a35f40a` (R-22); R-01 em `9b5dfa7`/`d5a04db` |
| `main` | `5f91635` — ancestral de HEAD, sem commits novos |
| Working tree | limpo |

## Histórico local (janela 2026-09-22 → 2026-09-30)
| Versão | Arquivo | SHA-256 (16) | Objetos |
|---|---|---|---|
| 20260923022949 | `cautela_lending_devolucao_rastreavel` | `21951186159b7028` | colunas `devolucao_processada_por`/`returned_by`/`shift_id_*` em `cautelamentos` e `lendings`; 6 índices (2 de "quem devolveu" + **4 de shift_id**) |
| 20260923023207 | `lending_rpcs_devolucao_rastreavel` | `c8cbfdb3e43395f1` | overloads de `record_lending_batch`/`record_lending_returns` |
| 20260923120000 | `usuarios_onprem` | `839076cce96a4858` | tabela `public.usuarios` (FK `auth.users`), índice único `lower(email)`, RLS sem policy |
| **20260923123502** | `add_shift_id_indexes_devolucao_rastreavel` | `b0d02d24f9e5c538` | **restaurado nesta sessão**: 4 índices parciais de shift_id |
| 20260924001500 | `lending_rpcs_liveness_null_allowed` | `d3585126ae3a5365` | reescreve a condição de liveness nas 6 sobrecargas |
| 20260930120000 | `reconcile_reserve_memberships_role_check` | `a0034fbf72ad1b4b` | R-22 |

## Histórico remoto (somente SELECT em `supabase_migrations.schema_migrations`)
| Versão | Registro remoto |
|---|---|
| 20260923022949 | 5 statements, `created_by` NULL (CLI) — **sem** os 4 índices de shift_id |
| 20260923023207 | 2 statements, `created_by` NULL |
| 20260923120000 | **ausente** |
| 20260923123502 | 1 statement (574 bytes), `created_by` = conta do dono (aplicada pelo dashboard/MCP) |
| 20260924001500 | registrada com `statements = NULL` (conteúdo não guardado); efeito presente: 6/6 sobrecargas com a condição nova, 0 com a antiga |
| 20260930120000 | ausente (R-22 ainda não aplicada — esperado) |

## 20260923123502 — classificação: **A. ORIGINAL_RECOVERED**
- **Não existe em nenhuma ref do Git** (`git log --all -S "20260923123502"` só acha a documentação desta auditoria; nenhum arquivo com essa versão em nenhuma branch, inclusive as 28 da linhagem pré-reescrita).
- **Fonte primária**: `supabase_migrations.schema_migrations.statements[1]` de produção — o texto exato executado. Extraído em base64, gravado byte a byte: SHA-256 `b0d02d24f9e5c5382908f7fa3a06de53d624240613f7d1fd6cea74d7ba5eaf65`, 574 bytes, **sem newline final** (mantido assim de propósito; o teste compara o hash).
- **Objetos** (`pg_get_indexdef` em produção): `idx_cautelamentos_shift_id_emissao`, `idx_cautelamentos_shift_id_devolucao`, `idx_lendings_shift_id_emissao`, `idx_lendings_shift_id_devolucao` — `btree`, não únicos, válidos, predicado `WHERE (<col> IS NOT NULL)`.

### O que aconteceu (linha do tempo reconstruída)
1. 2026-09-23 02:29 UTC — `20260923022949` aplicada pelo CLI **sem** os índices de shift_id (texto aplicado preservado no remoto).
2. Um review ("Achado MÉDIO de review (2026-09-23)", comentário no arquivo) pediu os 4 índices.
3. 12:35:02 UTC — índices aplicados em produção como migration separada `20260923123502` (dashboard/MCP), **sem criar o arquivo no repo**.
4. 12:38 UTC — commit `23170b6` adicionou `022949` ao Git **já com os 4 índices embutidos**. A versão sem índices nunca esteve no Git.

Prova: diff do texto aplicado (`supabase/tests/fixtures/20260923022949.applied-in-production.sql`, SHA-256 `ade7843f…a217` = `sha256(array_to_string(statements, ';\n'))` remoto) contra o arquivo local → a **única** diferença são os 4 `CREATE INDEX` e as linhas de comentário correspondentes. O texto dos 4 `CREATE INDEX` do arquivo local é idêntico ao da `123502`.

### Consequência
- Repositório: `022949` local continua divergente em conteúdo do aplicado (não editado — migration histórica). Como os índices usam `IF NOT EXISTS` e têm definição idêntica, `123502` é no-op em ambiente montado do repo e o schema final é o mesmo nos dois caminhos (testado).
- `supabase migration list` compara só versões: com o arquivo restaurado, **toda versão remota passa a existir localmente**.

## 20260923120000_usuarios_onprem — classificação: **C. SHARED_MIGRATION_NOT_YET_DEPLOYED**
- Criada em `e012550` (2026-09-23 10:38 BRT), frente WIP_INFRA_HIBRIDA (Auth Provider Abstraction), mergeada em `main` via `39c5c2d`.
- **Na cadeia comum por desenho**: o cabeçalho diz "Em modo SUPABASE fica presente mas nunca é escrita nem lida — a mesma pasta de migrations é a fonte única de verdade pros dois ambientes"; o plano `2026-09-23-auth-provider-abstraction.md` lista o arquivo em `supabase/migrations/` como entregável (Task, linha 477); `MIGRATION_SPEC.md §4.4` define a pasta como fonte única dos dois ambientes.
- Tensão registrada (não resolvida aqui): o mesmo plano, linha 18, diz "nada específico de um ambiente entra nessa pasta". A tabela só é usada em ON_PREMISE, mas foi desenhada para ser inerte no Cloud.
- Dependências: FK para `auth.users` (existe no Cloud; no on-prem vem do shim `onprem-bootstrap/000_auth_shim.sql`). Nenhuma migration posterior depende dela. Código: só `lib/local-auth-provider.ts` e `scripts/provision-local-user.ts`, ambos exclusivos de `AMBIENTE_INFRA=ON_PREMISE`.
- Efeito se aplicada no Cloud: tabela vazia com RLS ligado e sem policy (anon/authenticated negados) + índice. Não perigosa; também não necessária.
- **Por que está ausente no remoto**: produção recebe migrations de forma seletiva (a `123502` pelo dashboard; a `20260924001500`, posterior, foi aplicada com `statements` NULL), não por `db push` da pasta inteira; a `120000` nunca foi escolhida. Está **fora de ordem** (anterior a versões remotas já aplicadas), então um `db push` a recusaria sem `--include-all`.
- Removê-la/renomeá-la quebraria o desenho on-prem → **não alterada** (WIP_INFRA_HIBRIDA).

## Decisão
**Alterado**
- `supabase/migrations/20260923123502_add_shift_id_indexes_devolucao_rastreavel.sql` — restaurado byte a byte do registro de produção.
- `supabase/tests/fixtures/20260923022949.applied-in-production.sql` — texto aplicado em produção de `022949` (fixture de teste).
- `supabase/tests/r23_shift_id_indexes_history.sh` — teste.
- `docs/auditoria/R-02_SUPABASE_READONLY.md` — corrigida afirmação errada: ambientes montados do repo **têm** os índices de shift_id (via `022949` local).

**Deliberadamente NÃO alterado**: `20260923022949` (histórica), `20260923120000` (WIP_INFRA), `20260924001500`, qualquer arquivo de WIP, produção.

## Produção
Consultas: `schema_migrations` (versões, `statements`, `created_by`, hashes), `pg_index`/`pg_get_indexdef`, `pg_proc.prosrc` (presença da condição de liveness). **Somente SELECT. Zero mutations. Nenhum `migration repair`. Nenhum `db push`.**

## Testes
| Comando | Resultado |
|---|---|
| `bash supabase/tests/r23_shift_id_indexes_history.sh` | 11/11 PASS (PG 16.13 local; produção 17.6 — `pg_get_indexdef` idêntico) |
| Mutação: remover `WHERE` de um índice | 3 FAIL (detectada) |
| Mutação: newline final no arquivo restaurado | 1 FAIL (proveniência) |
| `bash supabase/tests/r22_reserve_memberships_role_check.sh` | 31/31 (sem regressão) |
| BFF unit (env CI) | 690/690 |

## Reviews
- code-review: 9 achados. Corrigidos: evidência ausente; fixture derivado por awk → texto literal de produção com hash; sem checagem de hash do arquivo restaurado; fingerprint fraco (agora inclui constraints, funções, triggers não internos, policies, tipos, ACL); `grep -c` sob `set -e`; versão do servidor não registrada; afirmação errada em R-02. Não corrigidos (fora de escopo): conteúdo de `022949` ≠ aplicado (histórica); `usuarios_onprem` (decisão INFRA); CI/duplicação de harness (R-26).
- security-review: nenhuma vulnerabilidade com confiança ≥ 8.

## Drift restante
1. `20260923120000_usuarios_onprem`: local, não aplicada, fora de ordem — aguarda decisão da frente INFRA (aplicar no Cloud ou não).
2. `20260930120000` (R-22): local, não aplicada — esperado; em produção seria no-op.
3. `20260923022949`: conteúdo local = aplicado + 4 índices (inofensivo; não editável).
4. `20260924001500`: registro remoto sem `statements` (efeito confirmado presente).

## Pré-condições para um futuro `db push`
1. Decisão explícita sobre `20260923120000` (dono: WIP_INFRA_HIBRIDA). Se for aplicar no Cloud: exige `--include-all`. Se não: ela não pode ficar na pasta lida pelo `db push` do Cloud sem um mecanismo acordado — decisão de arquitetura, não de CLI.
2. Rodar `supabase migration list` (read-only) com credenciais e confirmar que as únicas versões só-locais são as previstas.
3. Revisar o dry-run (`db push --dry-run`) antes de qualquer push.
4. **`migration repair` não é necessário**: toda versão remota agora tem arquivo local; nenhuma versão precisa ser marcada.

## Status
**R-23: DONE_VERIFIED** para a divergência de histórico (migration remota sem arquivo): recuperada da fonte primária, testada, sem editar histórico. A ausência remota de `20260923120000` foi classificada como deploy pendente por desenho (não drift de histórico) e **bloqueia `db push`** até decisão da frente INFRA.
