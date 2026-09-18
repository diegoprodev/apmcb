-- SP9.5 do isolamento por reserva — "canário em prod" (ARCH-v4 MÉD-6). Ver
-- docs/superpowers/specs/2026-09-09-isolamento-reserva-design.md §7/§8 (SP9.5).
--
-- Roda a prova de RLS contra a INFRA REAL de PROD (grants reais, não a
-- réplica staging via pg_dump --no-privileges, que nunca captura grants
-- reais — achado documentado no épico desde SP3) usando um tenant/reservas
-- 100% DESCARTÁVEIS: tudo dentro de BEGIN...ROLLBACK, NUNCA COMMITADO.
--
-- Como rodar (via mcp__supabase__execute_sql ou psql contra prod, nunca
-- staging — o objetivo É testar grants reais):
--   cole o corpo entre BEGIN e ROLLBACK numa única execução. O ROLLBACK no
--   fim desfaz TUDO — inclusive a realocação temporária de profiles reais
--   pro tenant canário (nunca persiste em PMPB).
--
-- Reaproveita 3 profiles REAIS de PROD (não cria auth.users novos — a FK
-- profiles.id -> auth.users exigiria um signup completo só pra isso):
--   ca0cd06b-3924-4ddb-8d05-252aaadf1993 — armeiro real (matrícula 000002)
--   8ceb6522-a5a9-4e3d-a9b5-9afb04dec072 — admin_global real (matrícula 000001)
--   f1671e43-388c-4dc0-9fb0-6fd3c58c917f — usuario real (militar/dono)
-- Se esses IDs mudarem (ex: fixtures E2E recriados), atualizar aqui.
--
-- Executado com sucesso em 2026-09-17: 10/10 provas passaram, 0 resíduo
-- confirmado (tenant canário e default_tenant_id dos 3 profiles voltaram
-- ao estado original — SELECT count(*) FROM tenants WHERE
-- slug='__iso-canary__' = 0 logo após o ROLLBACK).
--
-- Expandido em 2026-09-17 (pedido explícito: cobertura completa de
-- usuário/material/cautelas/livro digital antes do SP10) — provas P11-P23
-- cobrem cautelamentos, material_requests, biometric_challenges e
-- category_requests. Rodado 2x contra PROD em 2026-09-17: (1) ANTES da
-- migration 20260917030000 — 22/23, P23 deu 0 em vez de 2 (reproduziu ao
-- vivo o bug do JOIN reserves+profiles: admin_global reassinado pro tenant
-- canário não tem tenant_memberships PARA O TENANT CANÁRIO, só pro tenant
-- real, então o JOIN em `reserves r` falha a própria RLS de `reserves`
-- pras duas linhas); (2) DEPOIS de aplicar a migration — 23/23, P23 = 2.
-- 0 resíduo confirmado pós-ROLLBACK nas duas rodadas.

BEGIN;

-- ── setup do canário ─────────────────────────────────────────────────
INSERT INTO tenants (id, nome, slug, tipo_orgao, max_reserves, reserve_isolation_enabled)
VALUES ('00000000-0000-0000-0000-00000000ca01', '__ISO_CANARY__', '__iso-canary__', 'pm', 5, true);

INSERT INTO reserves (id, tenant_id, nome, acronym, status)
VALUES
  ('00000000-0000-0000-0000-00000000ca0a', '00000000-0000-0000-0000-00000000ca01', 'Canário A', 'CANA', 'ativa'),
  ('00000000-0000-0000-0000-00000000ca0b', '00000000-0000-0000-0000-00000000ca01', 'Canário B', 'CANB', 'ativa');

-- Realoca temporariamente 3 profiles reais pro tenant canário.
UPDATE profiles SET default_tenant_id = '00000000-0000-0000-0000-00000000ca01'
  WHERE id IN ('ca0cd06b-3924-4ddb-8d05-252aaadf1993','8ceb6522-a5a9-4e3d-a9b5-9afb04dec072','f1671e43-388c-4dc0-9fb0-6fd3c58c917f');

-- armeiro membro só de A; "dono" militar membro das DUAS (A e B) — prova
-- SEC-MED-3 (dono vê o que é dele em qualquer reserva onde tem vínculo).
INSERT INTO reserve_memberships (user_id, reserve_id, role)
VALUES
  ('ca0cd06b-3924-4ddb-8d05-252aaadf1993', '00000000-0000-0000-0000-00000000ca0a', 'armeiro'),
  ('f1671e43-388c-4dc0-9fb0-6fd3c58c917f', '00000000-0000-0000-0000-00000000ca0a', 'usuario'),
  ('f1671e43-388c-4dc0-9fb0-6fd3c58c917f', '00000000-0000-0000-0000-00000000ca0b', 'usuario');

-- Só depois da membership existir (trigger profiles_validate_active_reserve
-- exige o vínculo antes de aceitar active_reserve_id).
UPDATE profiles SET active_reserve_id = '00000000-0000-0000-0000-00000000ca0a'
  WHERE id IN ('ca0cd06b-3924-4ddb-8d05-252aaadf1993','f1671e43-388c-4dc0-9fb0-6fd3c58c917f');

-- Linhas canário — grupo A (materiais)
INSERT INTO material_types (id, tenant_id, reserve_id, nome, quantidade_total, categoria)
VALUES
  ('00000000-0000-0000-0000-00000000da0a', '00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-00000000ca0a', 'Canário MT A', 5, 'equipamento'),
  ('00000000-0000-0000-0000-00000000da0b', '00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-00000000ca0b', 'Canário MT B', 5, 'equipamento');

-- Linhas canário — grupo B (movimento, padrão SELECT-dono)
INSERT INTO lendings (id, tenant_id, reserve_id, material_type_id, military_id, master_id, quantidade, auth_mode, status_legacy)
VALUES
  ('00000000-0000-0000-0000-000000001a0a', '00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-00000000ca0a', '00000000-0000-0000-0000-00000000da0a', 'f1671e43-388c-4dc0-9fb0-6fd3c58c917f', 'ca0cd06b-3924-4ddb-8d05-252aaadf1993', 1, 'totp', 'ativo'),
  ('00000000-0000-0000-0000-000000001a0b', '00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-00000000ca0b', '00000000-0000-0000-0000-00000000da0a', 'f1671e43-388c-4dc0-9fb0-6fd3c58c917f', 'ca0cd06b-3924-4ddb-8d05-252aaadf1993', 1, 'totp', 'ativo');

-- Linhas canário — grupo C (serviço)
INSERT INTO service_shifts (id, tenant_id, reserve_id, armeiro_id, status)
VALUES
  ('00000000-0000-0000-0000-0000000050aa', '00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-00000000ca0a', 'ca0cd06b-3924-4ddb-8d05-252aaadf1993', 'encerrado'),
  ('00000000-0000-0000-0000-0000000050ab', '00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-00000000ca0b', '8ceb6522-a5a9-4e3d-a9b5-9afb04dec072', 'encerrado');

-- Linhas canário — grupo D (cautelamentos; exige material_items, que deriva
-- reserve_id de current_unit_id via trigger derive_child_reserve_id)
INSERT INTO material_items (id, tenant_id, material_type_id, tipo_identificador, identificador_principal, current_unit_id)
VALUES
  ('00000000-0000-0000-0000-0000000060aa', '00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-00000000da0a', 'patrimonio', 'CANARY-ITEM-A', '00000000-0000-0000-0000-00000000ca0a'),
  ('00000000-0000-0000-0000-0000000060ab', '00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-00000000da0b', 'patrimonio', 'CANARY-ITEM-B', '00000000-0000-0000-0000-00000000ca0b');

INSERT INTO cautelamentos (id, tenant_id, reserve_id, item_id, militar_id, armeiro_id, condicao_emissao, motivo_emissao, data_emissao, status, document_hash)
VALUES
  ('00000000-0000-0000-0000-0000000070aa', '00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-00000000ca0a', '00000000-0000-0000-0000-0000000060aa', 'f1671e43-388c-4dc0-9fb0-6fd3c58c917f', 'ca0cd06b-3924-4ddb-8d05-252aaadf1993', 'bom', 'canario', now(), 'ativa', 'canary-hash-a'),
  ('00000000-0000-0000-0000-0000000070ab', '00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-00000000ca0b', '00000000-0000-0000-0000-0000000060ab', 'f1671e43-388c-4dc0-9fb0-6fd3c58c917f', 'ca0cd06b-3924-4ddb-8d05-252aaadf1993', 'bom', 'canario', now(), 'ativa', 'canary-hash-b');

-- Linhas canário — grupo E (material_requests, SSA)
INSERT INTO material_requests (id, tenant_id, reserve_id, military_id, status, totp_validated, requested_at)
VALUES
  ('00000000-0000-0000-0000-0000000080aa', '00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-00000000ca0a', 'f1671e43-388c-4dc0-9fb0-6fd3c58c917f', 'pendente', false, now()),
  ('00000000-0000-0000-0000-0000000080ab', '00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-00000000ca0b', 'f1671e43-388c-4dc0-9fb0-6fd3c58c917f', 'pendente', false, now());

-- Linhas canário — grupo F (biometric_challenges; sem policy de INSERT pra
-- authenticated — inserido aqui como owner/postgres, bypassa RLS, igual as
-- demais linhas de setup acima)
INSERT INTO biometric_challenges (id, tenant_id, reserve_id, actor_id, purpose, status, expires_at)
VALUES
  ('00000000-0000-0000-0000-0000000090aa', '00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-00000000ca0a', 'ca0cd06b-3924-4ddb-8d05-252aaadf1993', 'sign_cautela_armeiro', 'pending', now() + interval '5 minutes'),
  ('00000000-0000-0000-0000-0000000090ab', '00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-00000000ca0b', '8ceb6522-a5a9-4e3d-a9b5-9afb04dec072', 'sign_cautela_armeiro', 'pending', now() + interval '5 minutes');

-- Linhas canário — grupo G (category_requests; requested_by = "dono", que
-- É membro de A e B, pra isolar a prova de matriz de qualquer bypass via
-- requested_by=self do armeiro/admin_global sendo testados)
INSERT INTO category_requests (id, reserve_id, requested_by, nome, slug, type, status)
VALUES
  ('00000000-0000-0000-0000-0000000a00aa', '00000000-0000-0000-0000-00000000ca0a', 'f1671e43-388c-4dc0-9fb0-6fd3c58c917f', 'Canario CR A', 'canario-cr-a', 'create', 'pendente'),
  ('00000000-0000-0000-0000-0000000a00ab', '00000000-0000-0000-0000-00000000ca0b', 'f1671e43-388c-4dc0-9fb0-6fd3c58c917f', 'Canario CR B', 'canario-cr-b', 'create', 'pendente');

CREATE TEMP TABLE canary_results (teste text, resultado bigint);
GRANT ALL ON canary_results TO authenticated;

-- ── PROVAS 1-3: armeiro (staff, active=A) ───────────────────────────
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"ca0cd06b-3924-4ddb-8d05-252aaadf1993","role":"authenticated"}';
INSERT INTO canary_results SELECT 'P1 armeiro ve a si mesmo (espera 1)', count(*) FROM profiles WHERE id = 'ca0cd06b-3924-4ddb-8d05-252aaadf1993';
INSERT INTO canary_results SELECT 'P2 armeiro ve material da PROPRIA reserva A (espera 1)', count(*) FROM material_types WHERE id = '00000000-0000-0000-0000-00000000da0a';
INSERT INTO canary_results SELECT 'P3 armeiro NAO ve material de OUTRA reserva B (espera 0)', count(*) FROM material_types WHERE id = '00000000-0000-0000-0000-00000000da0b';
INSERT INTO canary_results SELECT 'P7 armeiro staff (active=A) ve lending A (espera 1)', count(*) FROM lendings WHERE id = '00000000-0000-0000-0000-000000001a0a';
INSERT INTO canary_results SELECT 'P8 armeiro staff (active=A) NAO ve lending B via staff (espera 0)', count(*) FROM lendings WHERE id = '00000000-0000-0000-0000-000000001a0b';
INSERT INTO canary_results SELECT 'P9 armeiro ve o proprio service_shift na reserva A (espera 1)', count(*) FROM service_shifts WHERE id = '00000000-0000-0000-0000-0000000050aa';
INSERT INTO canary_results SELECT 'P10 armeiro NAO ve service_shift da reserva B (espera 0)', count(*) FROM service_shifts WHERE id = '00000000-0000-0000-0000-0000000050ab';
INSERT INTO canary_results SELECT 'P11 armeiro ve cautelamento da PROPRIA reserva A (espera 1)', count(*) FROM cautelamentos WHERE id = '00000000-0000-0000-0000-0000000070aa';
INSERT INTO canary_results SELECT 'P12 armeiro NAO ve cautelamento da reserva B (espera 0)', count(*) FROM cautelamentos WHERE id = '00000000-0000-0000-0000-0000000070ab';
INSERT INTO canary_results SELECT 'P15 armeiro ve material_request da PROPRIA reserva A (espera 1)', count(*) FROM material_requests WHERE id = '00000000-0000-0000-0000-0000000080aa';
INSERT INTO canary_results SELECT 'P16 armeiro NAO ve material_request da reserva B (espera 0)', count(*) FROM material_requests WHERE id = '00000000-0000-0000-0000-0000000080ab';
INSERT INTO canary_results SELECT 'P19 armeiro ve biometric_challenge da PROPRIA reserva A (espera 1)', count(*) FROM biometric_challenges WHERE id = '00000000-0000-0000-0000-0000000090aa';
INSERT INTO canary_results SELECT 'P20 armeiro NAO ve biometric_challenge da reserva B (espera 0)', count(*) FROM biometric_challenges WHERE id = '00000000-0000-0000-0000-0000000090ab';
INSERT INTO canary_results SELECT 'P22 armeiro (nao-admin) NAO ve category_request de outrem nem na propria reserva A (espera 0)', count(*) FROM category_requests WHERE id = '00000000-0000-0000-0000-0000000a00aa';
RESET role;

-- ── PROVAS 4-5: admin_global matriz (active_reserve_id NULL) ────────
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"8ceb6522-a5a9-4e3d-a9b5-9afb04dec072","role":"authenticated"}';
INSERT INTO canary_results SELECT 'P4 admin_global matriz ve AS DUAS reservas (espera 2)', count(*) FROM material_types WHERE id IN ('00000000-0000-0000-0000-00000000da0a','00000000-0000-0000-0000-00000000da0b');
INSERT INTO canary_results SELECT 'P5 admin_global matriz ve profiles do tenant canario (espera 3)', count(*) FROM profiles WHERE default_tenant_id = '00000000-0000-0000-0000-00000000ca01';
INSERT INTO canary_results SELECT 'P14 admin_global matriz ve OS DOIS cautelamentos (espera 2)', count(*) FROM cautelamentos WHERE id IN ('00000000-0000-0000-0000-0000000070aa','00000000-0000-0000-0000-0000000070ab');
INSERT INTO canary_results SELECT 'P18 admin_global matriz ve AS DUAS material_requests (espera 2)', count(*) FROM material_requests WHERE id IN ('00000000-0000-0000-0000-0000000080aa','00000000-0000-0000-0000-0000000080ab');
INSERT INTO canary_results SELECT 'P21 admin_global matriz ve AS DUAS biometric_challenges (espera 2)', count(*) FROM biometric_challenges WHERE id IN ('00000000-0000-0000-0000-0000000090aa','00000000-0000-0000-0000-0000000090ab');
INSERT INTO canary_results SELECT 'P23 admin_global matriz ve AS DUAS category_requests (espera 2 SO' || ' com o fix 20260917030000 aplicado; policy antiga = 1, bug real)', count(*) FROM category_requests WHERE id IN ('00000000-0000-0000-0000-0000000a00aa','00000000-0000-0000-0000-0000000a00ab');
RESET role;

-- ── PROVA 6: dono (military_id), membro de A e B, active=A ──────────
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"f1671e43-388c-4dc0-9fb0-6fd3c58c917f","role":"authenticated"}';
INSERT INTO canary_results SELECT 'P6 dono ve SUAS lendings nas DUAS reservas onde tem membership (espera 2, SEC-MED-3)', count(*) FROM lendings WHERE id IN ('00000000-0000-0000-0000-000000001a0a','00000000-0000-0000-0000-000000001a0b');
INSERT INTO canary_results SELECT 'P13 dono ve SEU cautelamento nas DUAS reservas onde tem membership (espera 2)', count(*) FROM cautelamentos WHERE id IN ('00000000-0000-0000-0000-0000000070aa','00000000-0000-0000-0000-0000000070ab');
INSERT INTO canary_results SELECT 'P17 dono ve SUAS material_requests nas DUAS reservas onde tem membership (espera 2)', count(*) FROM material_requests WHERE id IN ('00000000-0000-0000-0000-0000000080aa','00000000-0000-0000-0000-0000000080ab');
RESET role;

SELECT * FROM canary_results ORDER BY teste;

-- Confirmação de zero resíduo (roda ANTES do ROLLBACK, só documenta a
-- expectativa — depois do ROLLBACK, tenants/profiles voltam ao estado real):
-- SELECT count(*) FROM tenants WHERE slug='__iso-canary__'; -- vira 0 pós-ROLLBACK

ROLLBACK;
