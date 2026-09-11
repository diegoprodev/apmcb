# Harness do spike SP0.5 — isolamento por reserva

Artefatos do spike executado em 2026-09-10 contra o projeto Supabase `andromeda-staging`
(`vfkdycqkddgoqnujwbvl`), que é uma réplica de prod (`pg_dump --schema-only --schema=public`
+ `--data-only`). Reusável para desenvolver os grupos de RLS (SP5–SP9).

Docker Desktop não liga no PC do dono (falta virtualização no BIOS) — daí o staging remoto no
lugar de `supabase start`. Binários PostgreSQL 17 standalone em `C:\pgsql\pgsql\bin`.
Conexão (session pooler, senha percent-encoded): ver memória `acesso-vps-supabase`.

## Arquivos

| arquivo | o quê |
|---|---|
| `seed-volume.sql` | 6 usuários de teste (1 por papel), 1000 `material_types`, 3000 `material_items`, 5000 `lendings`, 2000 `cautelamentos` — divididos entre reserva A (APMCB) e B (CFAP). `session_replication_role=replica` p/ bypassar FK/trigger. |
| `rls-prototype-v2.sql` | Protótipo **descartável** das policies §4.2 com os helpers envelopados em `(SELECT helper())` + split das `FOR ALL` + 2 índices `(reserve_id, <ordenação>)` + 400 profiles extra. |
| `rls-explain-harness.sql` | Impersona `authenticated` + `request.jwt.claims` por papel; roda contagem de isolamento + `EXPLAIN (ANALYZE, BUFFERS)` + teste de recursão. |

## Resultado (ver spec §4.2 `[v7]` e §7 SP0.5)

- **Helper nu na policy = reavaliado por linha** (112–279 ms / 1–2k linhas). Em `(SELECT helper())`
  = InitPlan 1×/statement = **1.5–1.7 ms**. Envelopar é obrigatório.
- **`FOR ALL` vaza no SELECT**: `lendings_staff_write` deixou o armeiro A ver 2500 lendings da
  reserva B. Split em INSERT/UPDATE/DELETE zera. Obrigatório nas 27 tabelas.
- **Recursão em `profiles`**: sem estouro (`user_in_reserve` SECURITY DEFINER).
- **Concorrência do switch**: segura por construção (RPC opera sobre `p_reserve_id` do BFF,
  nunca relê `my_active_reserve_id()`).

## Como rodar

```bash
export PATH="/c/pgsql/pgsql/bin:$PATH"
S='postgresql://postgres.vfkdycqkddgoqnujwbvl:<senha-encoded>@aws-0-sa-east-1.pooler.supabase.com:5432/postgres'
psql "$S" -f scripts/spike-reserva/seed-volume.sql
psql "$S" -f scripts/spike-reserva/rls-prototype-v2.sql
psql "$S" -f scripts/spike-reserva/rls-explain-harness.sql
```

**Não aplicar em prod.** Os protótipos de policy são descartáveis; as policies reais entram
pelos planos de SP5–SP9.
