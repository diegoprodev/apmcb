# R-02 — Verificação READ-ONLY do Supabase (2026-09-30)

> Projeto `jepitcrkicwmvzrmllpn` ("ANDRÔMEDA", **produção**, Postgres 17.6, sa-east-1),
> acessado pelo conector Supabase da conta (`execute_sql`/`list_migrations`). O MCP
> `supabase` configurado no repositório continua sem conexão (`ERR_PROXY_TUNNEL`).
> Staging `vfkdycqkddgoqnujwbvl` está `INACTIVE` — não consultado.
>
> **Somente `SELECT`** em `pg_catalog`/`information_schema`/`pg_policies`/
> `supabase_migrations.schema_migrations` e contagens agregadas. Nenhum INSERT/UPDATE/DELETE/
> DDL/GRANT/RPC. Nenhum dado pessoal lido (e-mails só em `count(*)` e filtro).

## Resultados

| # | Ponto | Veredito | Evidência |
|---|---|---|---|
| 1 | Estrutura de `reserve_memberships` | CONFIRMADO | `id uuid PK`, `reserve_id uuid NOT NULL FK reserves ON DELETE CASCADE`, `user_id uuid NOT NULL FK profiles ON DELETE CASCADE`, `role text NOT NULL`, `created_at timestamptz` |
| 2 | Constraints implantadas | CONFIRMADO | `UNIQUE (reserve_id, user_id)`; `reserve_memberships_role_check: CHECK (role = ANY (ARRAY['admin_reserva','armeiro','auditor_reserva','usuario']))` |
| 3 | `role='usuario'` aceito | **REFUTADO PELO REMOTO** o achado "CHECK só aceita staff" — o remoto aceita `usuario`, e há **50** linhas `usuario`. **Mas** a migration local `20260620000001` (e a versão *aplicada* dela, lida em `schema_migrations.statements`) define o CHECK **sem** `usuario`, e **nenhuma** migration local nem remota altera essa constraint (busca em `statements` por `reserve_memberships_role_check` → 0 linhas) → alteração feita **fora do histórico de migrations** (drift) |
| 4 | `tenant_memberships` | CONFIRMADO | `UNIQUE (tenant_id,user_id)`, `role role_enum NOT NULL DEFAULT 'usuario'`, FKs com CASCADE |
| 5 | Flag `reserve_isolation_enabled` | CONFIRMADO | `boolean NOT NULL DEFAULT false`. Valores: `pmpb` = **true** (3 reservas, 112 perfis); `gcm-santa-rita` = **false** (1 reserva, 3 perfis) |
| 5b | Leitura do flag | CONFIRMADO | Lido por `assert_actor_in_reserve`, `assert_device_in_reserve` e `my_tenant_isolation_enabled()` (`COALESCE(tenants.reserve_isolation_enabled via profiles.default_tenant_id, false)`), usado em **38 policies / 20 tabelas** |
| 6 | Policies/RLS | CONFIRMADO | 78 policies em `public` (bate com o baseline do CI gate "78 policies"); 48 referenciam reserva; **0 tabelas públicas sem RLS**; 1 policy em `reserve_memberships` |
| 7 | Funções de isolamento | CONFIRMADO | `assert_*_in_reserve`: `SECURITY DEFINER`, **sem** EXECUTE para `anon`/`authenticated`. `my_tenant_id`, `auth_role`, `auth_admin_reserve_ids`: `SECURITY DEFINER`, executáveis por `anon`/`authenticated` (helpers de policy — esperado) |
| 8 | Divergências migrations × remoto | CONFIRMADO | ver seção abaixo |
| 9 | Correção aplicada no remoto sem migration local | CONFIRMADO | (a) CHECK com `usuario` (item 3); (b) `20260923123502_add_shift_id_indexes_devolucao_rastreavel` aplicada no remoto (4 índices `idx_{cautelamentos,lendings}_shift_id_{emissao,devolucao}` existem) **sem arquivo no repo** |
| 10 | Problema da auditoria persiste no remoto | CONFIRMADO / REFUTADO por item | **Persiste**: isolamento por reserva no banco é dormente para `gcm-santa-rita` (flag false; hoje tem 1 reserva só, então sem efeito prático até ter a 2ª). **Contas `@apmcb.dev` existem em produção: 5** (papéis: `admin_global`, `admin_reserva`, `superadmin`, 2× `usuario` — 1 banida); 3 com login nos últimos 30 dias. Os UUIDs do `seed_dev` (`0000…0001–0003`) **não** existem. Senhas **NÃO VERIFICADO** (verificar exigiria tentar login — fora do read-only) |

### R-01 no dado real (contagens)
- `cautelamentos`: **1** linha (criada 2026-09-18), `document_hash` com **14 caracteres** (não é SHA-256); **0** com o hash constante `1a7c0eab…`.
- `document_signatures`: **0** linhas. `inventory_campaigns` com PDF: **0**.
- Consequência: a mudança de algoritmo de R-01 **não afeta nenhum documento existente em produção**.

## Divergências local × remoto

| Item | Local (repo) | Remoto |
|---|---|---|
| `reserve_memberships_role_check` | sem `usuario` | com `usuario` (sem migration) |
| `20260923123502_add_shift_id_indexes_devolucao_rastreavel` | ausente | aplicada |
| `20260923120000_usuarios_onprem` | presente | **não aplicada** (`public.usuarios` não existe) — o arquivo diz "em modo SUPABASE fica presente", o que não é verdade hoje |
| Contagem de migrations | 179 | 179 (178 em comum) |

Impacto: qualquer ambiente recriado a partir do repositório (staging, on-prem, CI futuro)
**rejeita** memberships `usuario` (fluxos SP2: cadastro de militar em reserva).
*Correção (R-23, `EVIDENCE_R23.md`): a afirmação original de que esse ambiente "fica sem os
índices de `shift_id`" estava errada — o arquivo local `20260923022949` já os cria.*

## NÃO VERIFICADO
- Senhas das contas `@apmcb.dev` (exigiria login).
- Equivalência byte a byte entre as funções implantadas e as migrations locais (só presença/
  flags/privilégios e md5 do remoto registrados: `assert_actor_in_reserve` md5
  `10c1de5e1753c3cbd480f4028b0711c9`).
- Comportamento em runtime das policies (exigiria executar como `authenticated`).
