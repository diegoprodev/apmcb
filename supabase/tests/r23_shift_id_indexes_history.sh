#!/usr/bin/env bash
# R-23 — teste da migration restaurada 20260923123502_add_shift_id_indexes_devolucao_rastreavel
# (evidência: docs/auditoria/EVIDENCE_R23.md).
#
# Postgres DESCARTÁVEL (initdb em diretório temporário, só socket Unix). Dois
# caminhos, cada um num banco separado:
#   producao → 20260923022949 no texto que produção DE FATO aplicou
#              (fixtures/20260923022949.applied-in-production.sql, copiado
#              verbatim de supabase_migrations.schema_migrations.statements)
#              + 20260923123502. Os 4 índices de shift_id devem nascer aqui.
#   repo     → 20260923022949 local (que ganhou os 4 índices depois de
#              aplicado) + 20260923123502, que deve ser no-op.
# Nos dois, pg_get_indexdef tem de ser idêntico ao observado em produção.
# Não usa nem acessa Supabase/produção.
#
# Uso: bash supabase/tests/r23_shift_id_indexes_history.sh   (PG_BIN se necessário)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
M022949="$ROOT/supabase/migrations/20260923022949_cautela_lending_devolucao_rastreavel.sql"
M123502="$ROOT/supabase/migrations/20260923123502_add_shift_id_indexes_devolucao_rastreavel.sql"
APPLIED_022949="$ROOT/supabase/tests/fixtures/20260923022949.applied-in-production.sql"
# SHA-256 registrados em produção (read-only, 2026-09-30):
#   123502: sha256(statements[1])                     (1 statement, 574 bytes)
#   022949: sha256(array_to_string(statements, ';\n')) (5 statements)
SHA_123502="b0d02d24f9e5c5382908f7fa3a06de53d624240613f7d1fd6cea74d7ba5eaf65"
SHA_022949_APPLIED="ade7843fba03183a942324fbc986061458be7919cb7e86527fc2834592dba217"
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)}"
if [ -z "$PG_BIN" ] || [ ! -x "$PG_BIN/initdb" ] || [ ! -x "$PG_BIN/psql" ]; then
  echo "R-23: binários do PostgreSQL não encontrados — defina PG_BIN" >&2; exit 2
fi
PORT="${R23_PG_PORT:-55434}"
WORK=""
RUN_AS=()
as_pg() { if [ ${#RUN_AS[@]} -gt 0 ]; then "${RUN_AS[@]}" "$*"; else bash -c "$*"; fi; }
cleanup() {
  [ -n "$WORK" ] || return 0
  as_pg "$PG_BIN/pg_ctl -D $WORK/data -m immediate stop" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
FAIL=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; FAIL=1; }

echo "== Proveniência dos arquivos"
[ "$(sha256sum "$M123502" | cut -d' ' -f1)" = "$SHA_123502" ] \
  && ok "20260923123502 é byte a byte o SQL registrado em produção" || bad "20260923123502 difere do registrado em produção"
[ "$(sha256sum "$APPLIED_022949" | cut -d' ' -f1)" = "$SHA_022949_APPLIED" ] \
  && ok "fixture de 20260923022949 é o texto aplicado em produção" || bad "fixture de 20260923022949 difere de produção"

WORK="$(mktemp -d)"
if [ "$(id -u)" = 0 ]; then chown postgres "$WORK"; RUN_AS=(su postgres -s /bin/bash -c); fi
as_pg "$PG_BIN/initdb -D $WORK/data -U postgres -A trust" >/dev/null
as_pg "$PG_BIN/pg_ctl -D $WORK/data -o '-p $PORT -k $WORK -c listen_addresses=' -l $WORK/log -w start" >/dev/null

psql_db() { "$PG_BIN/psql" -h "$WORK" -p "$PORT" -U postgres -d "$1" -v ON_ERROR_STOP=1 -qAt "${@:2}"; }
echo "servidor: $(psql_db postgres -c 'SHOW server_version') (produção observada: 17.6)"

# Definições observadas em produção (pg_get_indexdef, read-only, 2026-09-30).
EXPECTED="CREATE INDEX idx_cautelamentos_shift_id_devolucao ON public.cautelamentos USING btree (shift_id_devolucao) WHERE (shift_id_devolucao IS NOT NULL)
CREATE INDEX idx_cautelamentos_shift_id_emissao ON public.cautelamentos USING btree (shift_id_emissao) WHERE (shift_id_emissao IS NOT NULL)
CREATE INDEX idx_lendings_shift_id_devolucao ON public.lendings USING btree (shift_id_devolucao) WHERE (shift_id_devolucao IS NOT NULL)
CREATE INDEX idx_lendings_shift_id_emissao ON public.lendings USING btree (shift_id_emissao) WHERE (shift_id_emissao IS NOT NULL)"

setup() { # $1 = banco — tabelas mínimas das quais 20260923022949 depende
  psql_db postgres -c "CREATE DATABASE $1"
  psql_db "$1" -c "CREATE TABLE public.profiles (id uuid PRIMARY KEY);
                   CREATE TABLE public.service_shifts (id uuid PRIMARY KEY);
                   CREATE TABLE public.cautelamentos (id uuid PRIMARY KEY);
                   CREATE TABLE public.lendings (id uuid PRIMARY KEY);"
}
shift_idx() { psql_db "$1" -c "SELECT pg_get_indexdef(indexrelid) FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
  WHERE c.relname ~ '^idx_(cautelamentos|lendings)_shift_id_' ORDER BY c.relname"; }
# Relações, índices, colunas (com tipo/nullable/default), constraints, funções,
# triggers, policies e privilégios de tabela do schema public.
fingerprint() { psql_db "$1" -c "SELECT md5(concat_ws(' || ',
  (SELECT string_agg(c.relname||':'||c.relkind::text||':'||coalesce(pg_get_indexdef(c.oid),'')||':'||coalesce(c.relacl::text,''), ',' ORDER BY c.relname)
     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'),
  (SELECT string_agg(table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,''), ',' ORDER BY table_name, column_name)
     FROM information_schema.columns WHERE table_schema='public'),
  (SELECT string_agg(conname||'='||pg_get_constraintdef(oid), ',' ORDER BY conname) FROM pg_constraint
     WHERE connamespace='public'::regnamespace),
  (SELECT string_agg(proname, ',' ORDER BY proname) FROM pg_proc WHERE pronamespace='public'::regnamespace),
  (SELECT string_agg(tgname, ',' ORDER BY tgname) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
     JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal),
  (SELECT string_agg(policyname, ',' ORDER BY policyname) FROM pg_policies WHERE schemaname='public')))"; }

echo "== Caminho de produção: 022949 aplicado (texto de produção) + 123502"
setup producao
psql_db producao -1 -f "$APPLIED_022949" >/dev/null
[ -z "$(shift_idx producao)" ] && ok "antes de 123502: nenhum índice de shift_id (estado de produção após 022949)" || bad "índices já existiam"
FP_PROD_BEFORE="$(fingerprint producao)"
if OUT="$(psql_db producao -1 -f "$M123502" 2>&1)"; then ok "123502 aplicada"; else bad "123502: $OUT"; fi
[ "$(shift_idx producao)" = "$EXPECTED" ] && ok "4 índices criados, definições idênticas às de produção" || bad "definições divergem: $(shift_idx producao)"
[ "$(fingerprint producao)" != "$FP_PROD_BEFORE" ] && ok "123502 tem efeito neste caminho (os 4 índices)" || bad "123502 sem efeito no caminho de produção"

echo "== Caminho do repositório: 022949 local (com índices) + 123502"
setup repo
psql_db repo -1 -f "$M022949" >/dev/null
FP_BEFORE="$(fingerprint repo)"
if OUT="$(psql_db repo -1 -f "$M123502" 2>&1)"; then ok "123502 aplicada sobre 022949 local"; else bad "123502 sobre local: $OUT"; fi
[ "$(fingerprint repo)" = "$FP_BEFORE" ] && ok "123502 é no-op sobre o 022949 local (catálogo público idêntico)" || bad "123502 alterou o catálogo"
[ "$(shift_idx repo)" = "$EXPECTED" ] && ok "definições idênticas às de produção" || bad "definições divergem: $(shift_idx repo)"

echo "== Equivalência final dos dois caminhos"
[ "$(fingerprint producao)" = "$(fingerprint repo)" ] && ok "schema público final idêntico nos dois caminhos" || bad "schemas finais divergem"

echo
[ "$FAIL" = 0 ] && echo "R-23: TODOS OS TESTES PASSARAM" || { echo "R-23: HÁ FALHAS"; exit 1; }
