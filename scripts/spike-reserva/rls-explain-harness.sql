\pset pager off
\echo '###### ISOLAMENTO v2 (leak lendings deve sumir) ######'
BEGIN;
  SET LOCAL role authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"aaaa0000-0000-0000-0000-000000000001","role":"authenticated"}';
  SELECT
    (SELECT count(*) FROM material_types) mt_vis,
    (SELECT count(*) FROM material_types WHERE reserve_id='a8376271-d7f9-4fa6-9657-9714016e29b0') mt_B_LEAK,
    (SELECT count(*) FROM lendings) lend_vis,
    (SELECT count(*) FROM lendings WHERE reserve_id='a8376271-d7f9-4fa6-9657-9714016e29b0') lend_B_LEAK,
    (SELECT count(*) FROM cautelamentos) caut_vis,
    (SELECT count(*) FROM cautelamentos WHERE reserve_id='a8376271-d7f9-4fa6-9657-9714016e29b0') caut_B_LEAK;
ROLLBACK;

\echo '###### EXPLAIN v2 — helpers wrapped em (SELECT ..) ######'
BEGIN;
  SET LOCAL role authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"aaaa0000-0000-0000-0000-000000000001","role":"authenticated"}';
  \echo '=== armeiro A: material_types ==='
  EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM material_types ORDER BY nome LIMIT 50;
  \echo '=== armeiro A: cautelamentos ==='
  EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM cautelamentos ORDER BY data_emissao DESC LIMIT 50;
  \echo '=== armeiro A: lendings ==='
  EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM lendings ORDER BY issued_at DESC LIMIT 50;
  \echo '=== armeiro A: profiles grid (414 rows) ==='
  EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM profiles ORDER BY nome_completo LIMIT 50;
ROLLBACK;
BEGIN;
  SET LOCAL role authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"8ceb6522-a5a9-4e3d-a9b5-9afb04dec072","role":"authenticated"}';
  \echo '=== admin_global matriz: profiles grid ==='
  EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM profiles ORDER BY nome_completo LIMIT 50;
  \echo '=== admin_global matriz: material_types ==='
  EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM material_types ORDER BY nome LIMIT 50;
ROLLBACK;

\echo '###### RECURSÃO v2 — statement_timeout 2s ######'
BEGIN;
  SET LOCAL statement_timeout='2s';
  SET LOCAL role authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"aaaa0000-0000-0000-0000-000000000001","role":"authenticated"}';
  SELECT count(*) profiles_armeiroA FROM profiles;
ROLLBACK;
