# EVIDENCE — R-22: reconciliação do CHECK de `reserve_memberships.role`

| Campo | Valor |
|---|---|
| Branch | `claude/bold-planck-6xy9fc` |
| HEAD inicial | `d5a04db1555d04311373e369e700e8590315cd8e` (`main` sem avanço desde `5f91635`) |
| HEAD final | commit desta correção (ver `git log`; hash no relatório da sessão) |
| Data | 2026-09-30 |

## Causa
`20260620000001_multitenant_foundation.sql` criou o CHECK inline (nome gerado pelo Postgres
`reserve_memberships_role_check`) só com `admin_reserva`, `armeiro`, `auditor_reserva`. O SP2
passou a gravar `role='usuario'` (`admin.ts:262`, `profiles.ts:537`), e produção foi alterada
**fora do histórico de migrations**: a versão aplicada de `20260620000001` em
`supabase_migrations.schema_migrations` não contém `usuario`, e nenhuma migration remota ou
local altera essa constraint (busca em `statements` → 0 resultados, `R-02_SUPABASE_READONLY.md`).

## Estado antes (repositório)
```sql
role TEXT NOT NULL CHECK (role IN ('admin_reserva', 'armeiro', 'auditor_reserva'))
```

## Estado remoto observado (read-only, `pg_get_constraintdef`, 2026-09-30)
```
reserve_memberships_role_check = CHECK ((role = ANY (ARRAY['admin_reserva'::text, 'armeiro'::text, 'auditor_reserva'::text, 'usuario'::text])))
```
Demais constraints remotas: `reserve_memberships_pkey` PRIMARY KEY (id);
`reserve_memberships_reserve_id_fkey` FK reserves ON DELETE CASCADE;
`reserve_memberships_reserve_id_user_id_key` UNIQUE (reserve_id, user_id);
`reserve_memberships_user_id_fkey` FK profiles ON DELETE CASCADE. Nenhum outro CHECK sobre `role`.
Distribuição: `admin_reserva` 3, `armeiro` 3, `usuario` 50 (0 fora do conjunto).
Consulta read-only comparando a expressão que a migration monta com a definição remota:
`migration_seria_noop_em_producao = true`.

## Migration
Arquivo: `supabase/migrations/20260930120000_reconcile_reserve_memberships_role_check.sql`
(nenhuma migration histórica editada). Um único bloco `DO` (atômico):
1. `lock_timeout = 5s` (escopo da transação).
2. Se o CHECK já é idêntico ao esperado e não há outro CHECK sobre `role` → `NOTICE` e **não faz nada** (sem lock). É o caminho de produção.
3. Senão: `LOCK TABLE … ACCESS EXCLUSIVE`; sob o lock, **falha** se houver role fora do conjunto (sem UPDATE/DELETE) ou outro CHECK sobre `role` com nome diferente (sem DROP de constraint desconhecida).
4. `ALTER TABLE … DROP CONSTRAINT IF EXISTS reserve_memberships_role_check, ADD CONSTRAINT reserve_memberships_role_check CHECK (role IN ('admin_reserva','armeiro','auditor_reserva','usuario'))` — um só statement.

## Roles
Aceitas: `admin_reserva`, `armeiro`, `auditor_reserva`, `usuario` (conjunto conferido contra o
código: gravações em `admin.ts`, `profiles.ts`, `nexus.ts` z.enum; nenhum valor novo inferido).

## Negative test
`super_armeiro` e `admin_global` → rejeitados com `violates check constraint "reserve_memberships_role_check"` (o teste exige esse erro específico, não qualquer erro).

## Preservação (verificada por teste executado)
| Item | Evidência |
|---|---|
| Dados | contagem + md5 de todas as linhas idênticos antes/depois |
| UNIQUE | insert duplicado falha com `reserve_memberships_reserve_id_user_id_key` |
| FKs | insert com reserve inexistente falha com `reserve_memberships_reserve_id_fkey`; definições idênticas |
| Colunas/índices/triggers | fingerprint md5 idêntico antes/depois |
| RLS / policies | `relrowsecurity`, `relforcerowsecurity` e md5 de nome+cmd+roles+USING+WITH CHECK idênticos |
| `reserve_isolation_enabled` | não referenciado pela migration |

## Testes
Harness: `supabase/tests/r22_reserve_memberships_role_check.sh` — PostgreSQL 16 descartável
(initdb em diretório temporário, só socket Unix), tabela criada pelo `CREATE TABLE` **extraído
verbatim** da migration histórica, migration aplicada com `psql -1`.

| Comando | Resultado |
|---|---|
| `bash supabase/tests/r22_reserve_memberships_role_check.sh` | **31/31 PASS** (EXECUTADO) |
| Mutação: migration sem `'usuario'` (`R22_MIGRATION=…`) | 8 FAIL — mutação detectada (EXECUTADO) |
| Mutação: migration sem `lock_timeout` | 2 FAIL — mutação detectada (EXECUTADO) |
| `pnpm --filter @apmcb/bff test` (env do CI) | 690/690 (EXECUTADO; nenhuma regressão) |
| Comparação expressão da migration × produção | `true` (SELECT read-only) |

Cenários cobertos: estado histórico (antes/depois), reaplicação (no-op, mesmo OID), estado de
produção (no-op, mesmo OID), CHECK ausente com dados válidos, CHECK mais largo com o mesmo nome
(estreitado), `lock_timeout` com sessão concorrente (desiste em 5 s, estado intacto), role fora
do conjunto (falha explícita, dado intacto), CHECK de outro nome sobre `role` (falha explícita,
nada removido).

**Limite**: a cadeia completa de 180 migrations continua não reproduzível em Postgres puro
(falha em `20260611000003_seed_dev`, `auth.users.encrypted_password` — BLOCKERS B-04). O teste
isola a tabela a partir do SQL histórico versionado; não é replay da cadeia inteira.

## Produção
Consultas desta sessão: somente `SELECT` (constraints de `reserve_memberships`, contagem por
role, comparação da expressão). **Nenhuma mutation executada. Nenhuma migration aplicada. Nenhum
`db push`.** Contas `@apmcb.dev` não tocadas.

## WIP
Nenhum arquivo de WIP_BIOMETRIA (`apps/bridge-windows`, `biometric*`, `cautelamentos.ts`,
`shifts.ts`) nem de WIP_INFRA_HIBRIDA (`infra/`, compose, Dockerfile, `.github/`,
`auth-provider*`, `onprem-bootstrap`, `20260923120000_usuarios_onprem.sql`) foi modificado.

## Riscos residuais
1. **Deploy bloqueado por R-23**: o histórico remoto tem `20260923123502` sem arquivo local, e o local tem `20260923120000_usuarios_onprem` não aplicado. `supabase db push` tende a recusar a divergência; resolver R-23 antes de aplicar esta migration em qualquer ambiente Supabase. Em produção ela é no-op.
2. O caminho no-op compara com a forma textual de `pg_get_constraintdef` (confirmada igual em PG 16 local e PG 17 remoto). Se uma versão futura imprimir diferente, a migration apenas recria a mesma constraint (com lock curto e `lock_timeout`), sem mudança semântica.
3. O harness não roda no CI (ligar exige `.github/`, área WIP_INFRA) — ver ledger.
4. Achado fora de escopo (R-25): `POST /api/admin/users/invite` grava `body.role` (`z.string()`) em `reserve_memberships` sem filtrar nem checar erro; papéis como `auditor`/`admin_global` são rejeitados pelo CHECK (antes e depois desta migration) em silêncio.

## Status final R-22
**DONE_VERIFIED** para reprodutibilidade do schema no repositório (testes executados + igualdade
com produção confirmada read-only). Aplicação em ambientes Supabase depende de R-23.
