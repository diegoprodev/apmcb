-- SP0.5 spike — seed de volume no staging (DESCARTÁVEL)
-- Reserve A = APMCB 9b83b932-5d16-422c-aeb7-512074127154
-- Reserve B = CFAP  a8376271-d7f9-4fa6-9657-9714016e29b0
-- tenant PMPB      = f0edc186-693f-4ab0-a0e8-6c18d65876fa
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL session_replication_role = replica;  -- bypassa FK/trigger p/ seed rapido

-- ── 1. usuarios de teste (auth.users + profiles) ────────────────────────
INSERT INTO auth.users (id, email, aud, role, created_at, updated_at)
VALUES
 ('aaaa0000-0000-0000-0000-000000000001','armeiroA@spike.dev','authenticated','authenticated',now(),now()),
 ('aaaa0000-0000-0000-0000-000000000002','adminreservaA@spike.dev','authenticated','authenticated',now(),now()),
 ('aaaa0000-0000-0000-0000-000000000003','auditor@spike.dev','authenticated','authenticated',now(),now()),
 ('aaaa0000-0000-0000-0000-000000000004','usuarioA@spike.dev','authenticated','authenticated',now(),now()),
 ('aaaa0000-0000-0000-0000-000000000005','usuarioAB@spike.dev','authenticated','authenticated',now(),now()),
 ('aaaa0000-0000-0000-0000-000000000006','armeiroB@spike.dev','authenticated','authenticated',now(),now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, matricula, nome_completo, role, registration_status, default_tenant_id, active_reserve_id, created_at, updated_at)
VALUES
 ('aaaa0000-0000-0000-0000-000000000001','SPK001','Armeiro A','armeiro','complete','f0edc186-693f-4ab0-a0e8-6c18d65876fa','9b83b932-5d16-422c-aeb7-512074127154',now(),now()),
 ('aaaa0000-0000-0000-0000-000000000002','SPK002','Admin Reserva A','admin_reserva','complete','f0edc186-693f-4ab0-a0e8-6c18d65876fa','9b83b932-5d16-422c-aeb7-512074127154',now(),now()),
 ('aaaa0000-0000-0000-0000-000000000003','SPK003','Auditor','auditor','complete','f0edc186-693f-4ab0-a0e8-6c18d65876fa',NULL,now(),now()),
 ('aaaa0000-0000-0000-0000-000000000004','SPK004','Usuario A','usuario','complete','f0edc186-693f-4ab0-a0e8-6c18d65876fa','9b83b932-5d16-422c-aeb7-512074127154',now(),now()),
 ('aaaa0000-0000-0000-0000-000000000005','SPK005','Usuario AB','usuario','complete','f0edc186-693f-4ab0-a0e8-6c18d65876fa','9b83b932-5d16-422c-aeb7-512074127154',now(),now()),
 ('aaaa0000-0000-0000-0000-000000000006','SPK006','Armeiro B','armeiro','complete','f0edc186-693f-4ab0-a0e8-6c18d65876fa','a8376271-d7f9-4fa6-9657-9714016e29b0',now(),now())
ON CONFLICT (id) DO UPDATE SET role=EXCLUDED.role, active_reserve_id=EXCLUDED.active_reserve_id, default_tenant_id=EXCLUDED.default_tenant_id;

INSERT INTO public.reserve_memberships (reserve_id, user_id, role)
VALUES
 ('9b83b932-5d16-422c-aeb7-512074127154','aaaa0000-0000-0000-0000-000000000001','armeiro'),
 ('9b83b932-5d16-422c-aeb7-512074127154','aaaa0000-0000-0000-0000-000000000002','admin_reserva'),
 ('9b83b932-5d16-422c-aeb7-512074127154','aaaa0000-0000-0000-0000-000000000004','usuario'),
 ('9b83b932-5d16-422c-aeb7-512074127154','aaaa0000-0000-0000-0000-000000000005','usuario'),
 ('a8376271-d7f9-4fa6-9657-9714016e29b0','aaaa0000-0000-0000-0000-000000000005','usuario'),
 ('a8376271-d7f9-4fa6-9657-9714016e29b0','aaaa0000-0000-0000-0000-000000000006','armeiro')
ON CONFLICT DO NOTHING;

-- ── 2. material_types: 1000 (500 A / 500 B) ─────────────────────────────
INSERT INTO public.material_types (id, nome, quantidade_total, tenant_id, reserve_id, categoria, ativo)
SELECT gen_random_uuid(),
       'MT '||g||' '||(CASE WHEN g % 2 = 0 THEN 'A' ELSE 'B' END),
       (10 + (g % 40)),
       'f0edc186-693f-4ab0-a0e8-6c18d65876fa',
       (CASE WHEN g % 2 = 0 THEN '9b83b932-5d16-422c-aeb7-512074127154' ELSE 'a8376271-d7f9-4fa6-9657-9714016e29b0' END)::uuid,
       (ARRAY['armamento','municao','equipamento','viatura'])[1 + (g % 4)],
       true
FROM generate_series(1,1000) g;

-- ── 3. material_items: 3000 (metade A / metade B, seguindo o type) ──────
INSERT INTO public.material_items (tenant_id, material_type_id, tipo_identificador, identificador_principal, status_operacional)
SELECT mt.tenant_id, mt.id, 'numero_serie', 'SN-'||substr(mt.id::text,1,8)||'-'||n, 'disponivel'
FROM public.material_types mt
CROSS JOIN generate_series(1,3) n
WHERE mt.nome LIKE 'MT %';

-- ── 4. lendings: 5000 (2500 A / 2500 B) ────────────────────────────────
INSERT INTO public.lendings (material_type_id, military_id, master_id, quantidade, status_legacy, tenant_id, reserve_id, status, issued_at)
SELECT mt.id,
       (CASE WHEN g % 3 = 0 THEN 'aaaa0000-0000-0000-0000-000000000004' ELSE 'aaaa0000-0000-0000-0000-000000000005' END)::uuid,
       (CASE WHEN mt.reserve_id::text = '9b83b932-5d16-422c-aeb7-512074127154' THEN 'aaaa0000-0000-0000-0000-000000000001' ELSE 'aaaa0000-0000-0000-0000-000000000006' END)::uuid,
       1, 'ativo', mt.tenant_id, mt.reserve_id, 'ativa', now() - (g||' hours')::interval
FROM (SELECT id, reserve_id, tenant_id, row_number() OVER () rn FROM public.material_types WHERE nome LIKE 'MT %') mt
CROSS JOIN generate_series(1,5) g
WHERE mt.rn <= 1000
LIMIT 5000;

-- ── 5. cautelamentos: 2000 (1000 A / 1000 B) ───────────────────────────
INSERT INTO public.cautelamentos (tenant_id, reserve_id, item_id, militar_id, armeiro_id, motivo_emissao, document_hash, status, data_emissao)
SELECT mi.tenant_id, mt.reserve_id, mi.id,
       (CASE WHEN row_number() OVER () % 2 = 0 THEN 'aaaa0000-0000-0000-0000-000000000004' ELSE 'aaaa0000-0000-0000-0000-000000000005' END)::uuid,
       (CASE WHEN mt.reserve_id::text = '9b83b932-5d16-422c-aeb7-512074127154' THEN 'aaaa0000-0000-0000-0000-000000000001' ELSE 'aaaa0000-0000-0000-0000-000000000006' END)::uuid,
       'spike', md5(mi.id::text), 'ativa', now() - (row_number() OVER ()||' hours')::interval
FROM public.material_items mi
JOIN public.material_types mt ON mt.id = mi.material_type_id
WHERE mt.nome LIKE 'MT %'
LIMIT 2000;

COMMIT;

-- ANALYZE p/ o planner
ANALYZE public.material_types;
ANALYZE public.material_items;
ANALYZE public.lendings;
ANALYZE public.cautelamentos;
ANALYZE public.profiles;
ANALYZE public.reserve_memberships;

SELECT 'material_types' t, count(*) n FROM public.material_types
UNION ALL SELECT 'material_items', count(*) FROM public.material_items
UNION ALL SELECT 'lendings', count(*) FROM public.lendings
UNION ALL SELECT 'cautelamentos', count(*) FROM public.cautelamentos
UNION ALL SELECT 'memberships', count(*) FROM public.reserve_memberships;
