#!/usr/bin/env bash
# R-22 — teste da migration 20260930120000_reconcile_reserve_memberships_role_check.
#
# Sobe um Postgres DESCARTÁVEL (initdb em diretório temporário, só socket
# Unix, sem TCP) e, em bancos separados:
#   antigo   → tabela criada pelo CREATE TABLE extraído VERBATIM da migration
#              histórica 20260620000001 (prova o "antes": 'usuario' rejeitado),
#              depois a migration nova (prova o "depois").
#   producao → CHECK já no formato observado em produção (deve ser no-op).
#   drift_*  → estados que a migration deve recusar sem alterar nada.
# A migration é aplicada com `psql -1` (uma transação por arquivo). O Supabase
# CLI aplica por outro cliente; a migration é um único bloco DO, atômico em
# qualquer um dos dois.
# Não usa nem acessa Supabase/produção.
#
# Uso: bash supabase/tests/r22_reserve_memberships_role_check.sh
#      PG_BIN=<dir dos binários do PostgreSQL> se não estiverem em /usr/lib/postgresql/*/bin
#      R22_MIGRATION=<arquivo> testa outro arquivo (usado em teste de mutação)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HIST="$ROOT/supabase/migrations/20260620000001_multitenant_foundation.sql"
NEW="${R22_MIGRATION:-$ROOT/supabase/migrations/20260930120000_reconcile_reserve_memberships_role_check.sql}"
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)}"
if [ -z "$PG_BIN" ] || [ ! -x "$PG_BIN/initdb" ] || [ ! -x "$PG_BIN/psql" ]; then
  echo "R-22: binários do PostgreSQL não encontrados — defina PG_BIN" >&2; exit 2
fi
PORT="${R22_PG_PORT:-55433}"
WORK=""
RUN_AS=()
as_pg() { if [ ${#RUN_AS[@]} -gt 0 ]; then "${RUN_AS[@]}" "$*"; else bash -c "$*"; fi; }
cleanup() {
  [ -n "$WORK" ] || return 0
  as_pg "$PG_BIN/pg_ctl -D $WORK/data -m immediate stop" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
WORK="$(mktemp -d)"
if [ "$(id -u)" = 0 ]; then chown postgres "$WORK"; RUN_AS=(su postgres -s /bin/bash -c); fi

as_pg "$PG_BIN/initdb -D $WORK/data -U postgres -A trust" >/dev/null
as_pg "$PG_BIN/pg_ctl -D $WORK/data -o '-p $PORT -k $WORK -c listen_addresses=' -l $WORK/log -w start" >/dev/null

psql_db() { "$PG_BIN/psql" -h "$WORK" -p "$PORT" -U postgres -d "$1" -v ON_ERROR_STOP=1 -qAt "${@:2}"; }
apply_new() { psql_db "$1" -1 -f "$NEW" 2>&1; }
FAIL=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; FAIL=1; }
expect_ok() { if psql_db "$1" -c "$2" >/dev/null 2>&1; then ok "$3"; else bad "$3"; fi; }
# expect_fail <db> <sql> <regex do erro esperado> <descrição> — só passa se falhar PELO motivo esperado.
expect_fail() {
  local out
  if out="$(psql_db "$1" -c "$2" 2>&1)"; then bad "$4 (não falhou)";
  elif echo "$out" | grep -qE "$3"; then ok "$4";
  else bad "$4 (erro inesperado: $out)"; fi
}
CHECK_ERR='violates check constraint "reserve_memberships_role_check"'
UNIQUE_ERR='duplicate key value violates unique constraint "reserve_memberships_reserve_id_user_id_key"'
FK_ERR='violates foreign key constraint "reserve_memberships_reserve_id_fkey"'

# Bloco CREATE TABLE reserve_memberships exatamente como está no arquivo histórico.
HIST_CREATE="$(awk '/^CREATE TABLE IF NOT EXISTS reserve_memberships \(/{p=1} p{print} p&&/^\);/{exit}' "$HIST")"
[ -n "$HIST_CREATE" ] || { echo "não achei o CREATE TABLE histórico" >&2; exit 2; }

setup_base() { # $1 = banco
  psql_db postgres -c "CREATE DATABASE $1"
  psql_db "$1" -c "CREATE TABLE reserves (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
                   CREATE TABLE profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
                   INSERT INTO reserves DEFAULT VALUES; INSERT INTO profiles SELECT gen_random_uuid() FROM generate_series(1,6);"
  psql_db "$1" -c "$HIST_CREATE"
  # Mesma RLS da migration histórica + 1 policy para detectar alteração.
  psql_db "$1" -c "ALTER TABLE reserve_memberships ENABLE ROW LEVEL SECURITY;
                   CREATE POLICY r22_probe ON reserve_memberships FOR SELECT USING (true);"
}
ins() { echo "INSERT INTO reserve_memberships (reserve_id, user_id, role)
               SELECT (SELECT id FROM reserves LIMIT 1), (SELECT id FROM profiles ORDER BY id OFFSET $2 LIMIT 1), '$1'"; }
snapshot() { psql_db "$1" -c "SELECT count(*)||':'||md5(coalesce(string_agg(id::text||reserve_id||user_id||role||created_at, ',' ORDER BY id), '')) FROM reserve_memberships"; }
# Constraints (exceto o CHECK de role), colunas (tipo/NOT NULL/default), índices e triggers.
schema_fp() { psql_db "$1" -c "
  SELECT md5(concat_ws(' || ',
    (SELECT string_agg(conname||'='||pg_get_constraintdef(oid), ' | ' ORDER BY conname) FROM pg_constraint
      WHERE conrelid='public.reserve_memberships'::regclass AND conname <> 'reserve_memberships_role_check'),
    (SELECT string_agg(column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,''), ' | ' ORDER BY ordinal_position)
       FROM information_schema.columns WHERE table_name='reserve_memberships'),
    (SELECT string_agg(indexdef, ' | ' ORDER BY indexname) FROM pg_indexes WHERE tablename='reserve_memberships'),
    (SELECT string_agg(tgname, ' | ' ORDER BY tgname) FROM pg_trigger WHERE tgrelid='public.reserve_memberships'::regclass)))"; }
fk_list() { psql_db "$1" -c "
  SELECT string_agg(conname||'='||pg_get_constraintdef(oid), ' | ' ORDER BY conname) FROM pg_constraint
   WHERE conrelid='public.reserve_memberships'::regclass AND contype IN ('p','u','f')"; }
# RLS ligado + cada policy com comando, roles, USING e WITH CHECK.
rls_fp() { psql_db "$1" -c "
  SELECT relrowsecurity||':'||relforcerowsecurity||':'||(SELECT md5(string_agg(policyname||cmd||roles::text||coalesce(qual,'')||coalesce(with_check,''), ',' ORDER BY policyname))
    FROM pg_policies WHERE tablename='reserve_memberships')
    FROM pg_class WHERE oid='public.reserve_memberships'::regclass"; }
role_check() { psql_db "$1" -c "SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conrelid='public.reserve_memberships'::regclass AND conname='reserve_memberships_role_check'"; }
role_check_oid() { psql_db "$1" -c "SELECT oid FROM pg_constraint
   WHERE conrelid='public.reserve_memberships'::regclass AND conname='reserve_memberships_role_check'"; }
PROD_DEF="CHECK ((role = ANY (ARRAY['admin_reserva'::text, 'armeiro'::text, 'auditor_reserva'::text, 'usuario'::text])))"

echo "== Cenário antigo (histórico versionado)"
setup_base antigo
expect_fail antigo "$(ins usuario 0)" "$CHECK_ERR" "ANTES: 'usuario' rejeitado pelo CHECK histórico"
psql_db antigo -c "$(ins armeiro 0)"; psql_db antigo -c "$(ins admin_reserva 1)"; psql_db antigo -c "$(ins auditor_reserva 2)"
SNAP_BEFORE="$(snapshot antigo)"; SCHEMA_BEFORE="$(schema_fp antigo)"; RLS_BEFORE="$(rls_fp antigo)"
if OUT="$(apply_new antigo)"; then ok "migration aplicada sobre o estado antigo"; else bad "migration sobre o estado antigo: $OUT"; fi
[ "$(snapshot antigo)" = "$SNAP_BEFORE" ] && ok "linhas existentes intactas ($SNAP_BEFORE)" || bad "linhas existentes intactas"
[ "$(schema_fp antigo)" = "$SCHEMA_BEFORE" ] && ok "PK/UNIQUE/FKs/colunas/índices/triggers inalterados: $(fk_list antigo)" || bad "PK/UNIQUE/FKs/colunas/índices/triggers inalterados"
[ "$(rls_fp antigo)" = "$RLS_BEFORE" ] && ok "RLS e policies inalteradas ($RLS_BEFORE)" || bad "RLS e policies inalteradas"
[ "$(role_check antigo)" = "$PROD_DEF" ] && ok "CHECK final idêntico ao de produção" || bad "CHECK final idêntico ao de produção: $(role_check antigo)"
expect_ok   antigo "$(ins usuario 3)"       "DEPOIS: 'usuario' aceito"
expect_ok   antigo "$(ins admin_reserva 4)" "DEPOIS: 'admin_reserva' aceito"
expect_ok   antigo "BEGIN; $(ins armeiro 5); ROLLBACK;"         "DEPOIS: 'armeiro' aceito"
expect_ok   antigo "BEGIN; $(ins auditor_reserva 5); ROLLBACK;" "DEPOIS: 'auditor_reserva' aceito"
expect_fail antigo "$(ins super_armeiro 5)" "$CHECK_ERR"  "DEPOIS: 'super_armeiro' rejeitado pelo CHECK"
expect_fail antigo "$(ins admin_global 5)"  "$CHECK_ERR"  "DEPOIS: 'admin_global' rejeitado pelo CHECK"
expect_fail antigo "$(ins armeiro 0)"       "$UNIQUE_ERR" "UNIQUE (reserve_id,user_id) continua ativo"
expect_fail antigo "INSERT INTO reserve_memberships (reserve_id,user_id,role) VALUES (gen_random_uuid(), (SELECT id FROM profiles LIMIT 1), 'usuario')" \
  "$FK_ERR" "FK para reserves continua ativa"
SNAP_MID="$(snapshot antigo)"; OID_MID="$(role_check_oid antigo)"
if OUT="$(apply_new antigo)"; then
  if [ "$(snapshot antigo)" = "$SNAP_MID" ] && [ "$(role_check_oid antigo)" = "$OID_MID" ] && echo "$OUT" | grep -q "nada a fazer"; then
    ok "reaplicar é no-op (dados, CHECK e OID inalterados)"; else bad "reaplicar alterou estado: $OUT"; fi
else bad "reaplicar falhou: $OUT"; fi

echo "== Cenário produção (CHECK já correto)"
setup_base producao
psql_db producao -c "ALTER TABLE reserve_memberships DROP CONSTRAINT reserve_memberships_role_check;
                     ALTER TABLE reserve_memberships ADD CONSTRAINT reserve_memberships_role_check $PROD_DEF;"
psql_db producao -c "$(ins usuario 0)"; psql_db producao -c "$(ins armeiro 1)"
SNAP_BEFORE="$(snapshot producao)"; OID_BEFORE="$(role_check_oid producao)"
if OUT="$(apply_new producao)" && echo "$OUT" | grep -q "nada a fazer"; then ok "estado de produção: migration é no-op (sem DROP/ADD, sem lock)"; else bad "estado de produção: $OUT"; fi
[ "$(role_check_oid producao)" = "$OID_BEFORE" ] && ok "constraint de produção não foi recriada (mesmo OID)" || bad "constraint recriada"
[ "$(snapshot producao)" = "$SNAP_BEFORE" ] && ok "dados de produção-equivalente intactos" || bad "dados de produção-equivalente intactos"
[ "$(role_check producao)" = "$PROD_DEF" ] && ok "CHECK permanece idêntico ao de produção" || bad "CHECK permanece idêntico ao de produção"

echo "== Cenário CHECK ausente com dados válidos"
setup_base sem_check
psql_db sem_check -c "ALTER TABLE reserve_memberships DROP CONSTRAINT reserve_memberships_role_check; $(ins usuario 0)"
if OUT="$(apply_new sem_check)"; then ok "migration cria o CHECK quando ausente"; else bad "CHECK ausente: $OUT"; fi
[ "$(role_check sem_check)" = "$PROD_DEF" ] && ok "CHECK criado igual ao de produção" || bad "CHECK criado: $(role_check sem_check)"

echo "== Cenário CHECK mais largo com o mesmo nome"
setup_base largo
psql_db largo -c "ALTER TABLE reserve_memberships DROP CONSTRAINT reserve_memberships_role_check;
                  ALTER TABLE reserve_memberships ADD CONSTRAINT reserve_memberships_role_check
                    CHECK (role IN ('admin_reserva','armeiro','auditor_reserva','usuario','super_armeiro'));"
if OUT="$(apply_new largo)"; then ok "migration aplicada sobre CHECK mais largo"; else bad "CHECK largo: $OUT"; fi
[ "$(role_check largo)" = "$PROD_DEF" ] && ok "CHECK estreitado para o conjunto exato" || bad "CHECK largo não estreitado: $(role_check largo)"
expect_fail largo "$(ins super_armeiro 0)" "$CHECK_ERR" "'super_armeiro' rejeitado após estreitar"

echo "== Cenário lock_timeout (sessão concorrente segurando a tabela)"
setup_base travado
SNAP_BEFORE="$(snapshot travado)"; CHECK_BEFORE="$(role_check travado)"
psql_db travado -c "BEGIN; LOCK TABLE reserve_memberships IN ACCESS SHARE MODE; SELECT pg_sleep(20); COMMIT;" >/dev/null 2>&1 &
HOLDER=$!
sleep 1
START=$(date +%s)
if OUT="$(apply_new travado)"; then bad "migration deveria desistir por lock_timeout"; else
  ELAPSED=$(( $(date +%s) - START ))
  if echo "$OUT" | grep -q "lock timeout" && [ "$ELAPSED" -lt 15 ]; then ok "desiste por lock_timeout em ${ELAPSED}s (não fica pendurada)"; else bad "lock: ${ELAPSED}s $OUT"; fi
fi
kill "$HOLDER" 2>/dev/null || true; wait "$HOLDER" 2>/dev/null || true
[ "$(snapshot travado)" = "$SNAP_BEFORE" ] && [ "$(role_check travado)" = "$CHECK_BEFORE" ] && ok "após timeout: dados e CHECK inalterados (atômico)" || bad "estado alterado após timeout"

echo "== Cenário drift: role fora do conjunto"
setup_base drift_dados
psql_db drift_dados -c "ALTER TABLE reserve_memberships DROP CONSTRAINT reserve_memberships_role_check; $(ins legado_x 0)"
if OUT="$(apply_new drift_dados)"; then bad "migration deveria falhar com role inválida"; else
  echo "$OUT" | grep -q "role fora do conjunto permitido: 'legado_x'" && ok "falha explícita com role fora do conjunto" || bad "mensagem inesperada: $OUT"; fi
[ "$(psql_db drift_dados -c "SELECT role FROM reserve_memberships")" = "legado_x" ] && ok "nenhum dado convertido/apagado" || bad "dado alterado"

echo "== Cenário drift: CHECK sobre role com outro nome"
setup_base drift_nome
psql_db drift_nome -c "ALTER TABLE reserve_memberships ADD CONSTRAINT rm_role_manual CHECK (role <> 'x')"
if OUT="$(apply_new drift_nome)"; then bad "migration deveria falhar com CHECK desconhecido"; else
  echo "$OUT" | grep -q "CHECK inesperado sobre reserve_memberships.role: rm_role_manual" && ok "falha explícita com CHECK de outro nome" || bad "mensagem inesperada: $OUT"; fi
[ "$(psql_db drift_nome -c "SELECT count(*) FROM pg_constraint WHERE conname IN ('rm_role_manual','reserve_memberships_role_check')")" = "2" ] \
  && ok "nenhuma constraint removida no drift" || bad "constraint removida no drift"

echo
[ "$FAIL" = 0 ] && echo "R-22: TODOS OS TESTES PASSARAM" || { echo "R-22: HÁ FALHAS"; exit 1; }
