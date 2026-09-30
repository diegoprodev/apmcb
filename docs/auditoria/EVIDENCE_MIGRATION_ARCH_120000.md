# EVIDENCE — destino da migration `20260923120000_usuarios_onprem` (Cloud × On-Prem)

## Estado inicial
| Campo | Valor |
|---|---|
| Branch | `claude/bold-planck-6xy9fc` |
| HEAD | `9deb6caf15b91bb59be7ee8fa331e0b4e5c1bd40` (R-23); `39f2615` (R-22) presente |
| `main` | `5f91635`, ancestral de HEAD, sem avanço |
| Working tree | limpo |
| WIP | `worktree-biometric-unify-ssa` @ `4b6438d` (29/09 21:01); `ops/vps-env-storage` @ `0c52df6`; nenhum arquivo delas tocado |

## Classificação: **D. BLOCKED_ARCHITECTURAL_DECISION**
Recomendação técnica sustentada por evidência: **B (cadeia On-Prem separada via `supabase/onprem-bootstrap/`)** — não implementada porque reverte uma escolha explícita e documentada da frente WIP_INFRA_HIBRIDA e porque os próprios documentos dessa frente se contradizem (ver §Decisão).

## A migration
`public.usuarios (id uuid PK DEFAULT gen_random_uuid() REFERENCES auth.users(id) ON DELETE CASCADE, email text NOT NULL, senha_hash text NOT NULL, criado_em timestamptz NOT NULL DEFAULT now())`
+ `UNIQUE INDEX usuarios_email_lower_idx ON (lower(email))` + `ENABLE ROW LEVEL SECURITY` + `COMMENT`.
Sem policies, grants, funções ou triggers. Única dependência: `auth.users`.

## Consumidores (provado pelo código)
| Consumidor | Quando roda |
|---|---|
| `apps/bff/src/lib/local-auth-provider.ts` — `SELECT … FROM public.usuarios WHERE lower(email)=lower($1)` via `pg.Pool` | só quando `createAuthProvider` recebe `mode === "ON_PREMISE"` (`auth-provider-factory.ts`) |
| `apps/bff/scripts/provision-local-user.ts` — `INSERT INTO public.usuarios` | script manual on-prem (`DATABASE_URL`) |
| `provision-local-user.test.ts` | mock de `Pool`, não toca banco |

- **Cloud depende?** Não. Em `SUPABASE` a factory devolve `SupabaseAuthProvider` (GoTrue); nenhum caminho lê/grava `public.usuarios`. Produção roda sem a tabela hoje (`to_regclass('public.usuarios') = NULL`).
- **Não aplicá-la no Cloud quebra algo?** Não — é o estado atual de produção.
- **On-Prem depende?** Sim: é a tabela de credenciais do login local.

## Bootstrap atual
- **Cloud**: aplicação **manual/seletiva** (MCP/dashboard e CLI). Evidências: `MIGRATION_SPEC.md §4.4` ("hoje nenhum workflow de CI roda `supabase db push` — aplicação é manual via MCP"); `20260923123502` com `created_by` preenchido; `20260924001500` registrada sem `statements`; `120000` nunca escolhida.
- **On-Prem**: **não existe runner, compose, allowlist, denylist nem seleção por ambiente** no repositório. O único mecanismo é o documentado em `MIGRATION_SPEC.md §4.4` e no cabeçalho do shim: `psql -f supabase/onprem-bootstrap/000_auth_shim.sql` e depois `supabase db push --db-url $ON_PREM_DATABASE_URL` sobre a **mesma** pasta `supabase/migrations/`. Hoje a `120000` chegaria ao on-prem por esse `db push`.
- **Limite já conhecido (B-04)**: a cadeia completa não aplica em Postgres puro (quebra em `20260611000003_seed_dev`, depois em `auth.jwt()`/`auth.role()`/storage etc. — declarado no próprio shim). **O on-prem não é reproduzível hoje, independentemente da `120000`.**
- **Tooling**: Supabase CLI 2.117.0 não tem filtro de migrations por ambiente; `--workdir` troca a pasta inteira (exigiria duplicar a cadeia).

## Evidência do CLI (dry-run REAL, contra réplica local — nunca contra produção)
Postgres 16 descartável com `supabase_migrations.schema_migrations` contendo **exatamente as 179 versões de produção** (lidas por SELECT); comando `supabase db push --dry-run --db-url postgresql://postgres@localhost:55440/postgres`. Réplica conferida intacta após as execuções e destruída no fim.

| Cenário | Resultado do CLI |
|---|---|
| Repo atual | **erro** `LegacyDbPushMissingRemoteError: Found local migration files to be inserted before the last migration on remote database` — sugere `--include-all` para `20260923120000_usuarios_onprem.sql` (única) |
| Sim A: `--include-all` (réplica) | aplicaria `20260923120000_usuarios_onprem.sql`, `20260930120000_reconcile_reserve_memberships_role_check.sql` |
| Sim B: cópia temporária sem a `120000` (`--workdir`) | aplicaria **só** `20260930120000_reconcile_reserve_memberships_role_check.sql`, sem flag |

## Alternativas
| | A. Aplicar no Cloud | B. Cadeia On-Prem separada | C. Migration condicional | D. Seleção pelo tooling |
|---|---|---|---|---|
| Correção arquitetural | Contraria o princípio "Cloud não recebe objeto On-Prem sem necessidade" e o invariante do plano (linha 18); coerente com o cabeçalho do arquivo e com `MIGRATION_SPEC §4.4` ("fonte única") | Coerente com o invariante do plano (linha 18) e com o precedente do shim (Review Focus: SQL on-prem-only "precisa viver fora de `supabase/migrations/`") | Postgres não conhece `AMBIENTE_INFRA`; detectar ambiente por heurística (ex.: presença de papéis/schemas da GoTrue) é frágil | Não existe mecanismo no CLI; seria inventado |
| Reprodutibilidade | Cloud: 1 push com `--include-all` e depois linear | Cloud: linear sem flag (sim B). On-Prem: shim → `001_usuarios` → cadeia (a cadeia continua quebrando em seed_dev — B-04) | A versão continua fora de ordem: **não resolve** o bloqueio do CLI | — |
| Risco Cloud | Tabela vazia com `senha_hash` em `public`, RLS ligado sem policy (anon/authenticated negados; service_role acessa). Superfície desnecessária | Nenhum objeto novo | Registro de no-op no histórico; ainda exige `--include-all` | — |
| Risco On-Prem | Nenhum | Qualquer banco on-prem que já tenha registrado `20260923120000` exigiria `migration repair` local. **Nenhum ambiente on-prem conhecido** (nenhum compose/runner no repo), mas não é provável que nenhum dev tenha rodado | Heurística errada → tabela ausente → login quebra | — |
| Complexidade | Baixa (operacional) | Baixa (mover 1 arquivo + 1 linha de doc de bootstrap), **mas** muda o contrato da frente INFRA | Média, frágil | — |
| Compatível com CLI | Sim (`--include-all` é flag oficial) | Sim (comprovado por dry-run) | Não resolve | Não suportado |
| Impacto no WIP_INFRA | Nenhum arquivo; decisão de deploy | Move arquivo da frente INFRA e altera seu desenho documentado (cabeçalho, plano Task 4, `MIGRATION_SPEC`) | Edita migration da frente | — |

Viabilidade de B testada: Postgres descartável, `000_auth_shim.sql` + conteúdo da `120000` → `public.usuarios` criada (RLS `true`, FK para `auth.users`, índice `lower(email)`), e a query exata do `LocalAuthProvider` retorna o registro inserido.

## Decisão
**BLOCKED_ARCHITECTURAL_DECISION.** Motivos objetivos:
1. Os documentos da própria frente INFRA se contradizem: o plano diz "nada específico de um ambiente entra nessa pasta" (linha 18) e manda SQL on-prem-only para fora de `supabase/migrations/` (Review Focus), mas a Task 4 do mesmo plano e o cabeçalho da migration a colocam na pasta comum "presente mas nunca escrita nem lida" no Cloud. Escolher entre os dois é decisão do dono da frente, não da auditoria.
2. B (a recomendada) move um arquivo da frente WIP_INFRA e reverte uma escolha explícita dela — colisão direta com WIP.
3. Não é possível provar que nenhum banco on-prem de desenvolvimento registrou a versão `20260923120000` (staging inativo — `list_migrations` deu timeout; ambientes locais de devs são invisíveis daqui).
4. A (aplicar no Cloud com `--include-all`) é tecnicamente segura, mas introduz objeto On-Prem no Cloud sem necessidade — contraria o objetivo B do pedido; não deve ser escolhida para destravar o CLI.

**Recomendação** (para o dono da frente INFRA decidir): **B** — `git mv supabase/migrations/20260923120000_usuarios_onprem.sql supabase/onprem-bootstrap/001_usuarios.sql` (conteúdo intacto), documentar a ordem `000_auth_shim` → `001_usuarios` → `db push --db-url`, atualizar o cabeçalho/plano. Pré-condição: confirmar com quem roda on-prem que nenhum banco registrou a versão `20260923120000` (ou planejar `migration repair --status reverted 20260923120000` **naquele** banco, nunca no Cloud).

## Implementação
Nenhuma. Nenhum arquivo de migration, bootstrap ou código alterado.

## Testes
| Comando | Resultado | Classificação |
|---|---|---|
| `supabase db push --dry-run --db-url <réplica local>` (repo atual) | erro pedindo `--include-all` só para a `120000` | executado (réplica local) |
| idem `--include-all` (réplica) | `120000` + `20260930120000` | executado (réplica local; simulação de A) |
| idem com `--workdir` cópia sem a `120000` | só `20260930120000` | executado (cópia temporária; simulação de B) |
| shim + `120000` + query do `LocalAuthProvider` em PG descartável | tabela, FK, RLS, índice e lookup OK | executado |
| réplica após dry-runs | 179 versões, máx. `20260924001500` (intacta) | executado |

## Dry-run contra produção
`supabase migration list` / `db push --dry-run` contra produção: **NÃO EXECUTADOS** — sem credenciais do banco no container (nenhuma `SUPABASE_*`/`DATABASE_URL`, sem `supabase/.temp` linkado) e sem necessidade: a réplica reproduz o histórico remoto versão a versão. Classificação: `DRY_RUN_NOT_EXECUTED_NO_CREDENTIALS` (substituído por dry-run real contra réplica).

## R-22
**R22_STILL_BLOCKED** — no repositório atual o CLI recusa o push por causa da `120000`. Evidência de que, resolvida a decisão por B, a R-22 seria a única migration pendente (sim B); por A, viria junto com a `120000`.

## Produção
Somente SELECT: `to_regclass('public.usuarios')` (NULL), contagem/máximo de `schema_migrations` (179, `20260924001500`, sem `20260923120000`). mutation = NÃO · migration repair = NÃO · db push real = NÃO · `--include-all` real = NÃO (só contra réplica local).

## WIP preservado
Nenhum arquivo de WIP_INFRA_HIBRIDA (migration `120000`, `onprem-bootstrap/`, `auth-provider*`, `MIGRATION_SPEC.md`, plano, compose, `.github/`) nem de WIP_BIOMETRIA alterado.

## Novos achados (fatos)
1. `MIGRATION_SPEC.md §4.4` afirma que o on-prem sincroniza com `supabase db push --db-url` sobre a mesma pasta; na prática a cadeia não aplica em Postgres puro (B-04) — o bootstrap on-prem ainda não é executável ponta a ponta.
2. Staging (`vfkdycqkddgoqnujwbvl`) está INACTIVE e não respondeu (`list_migrations` → timeout): não há ambiente não produtivo para validar deploys de migration.
3. O plano `2026-09-23-auth-provider-abstraction.md` contém instruções conflitantes sobre o que pode entrar em `supabase/migrations/` (linha 18 × Task 4).

## Riscos residuais
- Enquanto a decisão não for tomada, qualquer `db push` no Cloud exige `--include-all` e aplicaria a tabela On-Prem no Cloud.
- A decisão B precisa ser coordenada com qualquer banco on-prem existente fora deste repositório.

## Próximo passo
Dono da frente WIP_INFRA_HIBRIDA decidir entre A e B (recomendação: B, com a pré-condição acima).
