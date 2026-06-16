DO $$
DECLARE
  admin_id UUID := '00000000-0000-0000-0000-000000000001';
  master_id UUID := '00000000-0000-0000-0000-000000000002';
  mil_id UUID := '00000000-0000-0000-0000-000000000003';
BEGIN
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (admin_id, 'admin@apmcb.dev', crypt('Admin@123', gen_salt('bf')), NOW(), NOW(), NOW())
  ON CONFLICT DO NOTHING;

  INSERT INTO profiles (id, matricula, nome_completo, posto, role, registration_status)
  VALUES (admin_id, 'ADM001', 'Administrador APMCB', 'coronel', 'admin', 'complete')
  ON CONFLICT DO NOTHING;

  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (master_id, 'armeiro@apmcb.dev', crypt('Armeiro@123', gen_salt('bf')), NOW(), NOW(), NOW())
  ON CONFLICT DO NOTHING;

  INSERT INTO profiles (id, matricula, nome_completo, posto, role, registration_status, created_by)
  VALUES (master_id, 'ARM001', 'Sgt. Silva', 'segundo_tenente', 'master', 'complete', admin_id)
  ON CONFLICT DO NOTHING;

  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (mil_id, 'cadete@apmcb.dev', crypt('Cadete@123', gen_salt('bf')), NOW(), NOW(), NOW())
  ON CONFLICT DO NOTHING;

  INSERT INTO profiles (id, matricula, nome_completo, posto, turma, role, registration_status, created_by)
  VALUES (mil_id, '2026001', 'Cd. João Pereira', 'cadete', '2026-A', 'usuario', 'pending_biometric', admin_id)
  ON CONFLICT DO NOTHING;
END $$;

INSERT INTO material_types (nome, categoria, quantidade_total, descricao)
VALUES
  ('Espadim', 'arma', 20, 'Espadim de cerimônia padrão PMBA'),
  ('Túnica de Gala Nº1', 'farda', 30, 'Farda de gala completa número 1'),
  ('Túnica de Gala Nº2', 'farda', 25, 'Farda de gala completa número 2'),
  ('Quepe de Cerimônia', 'acessorio', 40, 'Quepe padrão cerimônia'),
  ('Cinto Branco', 'acessorio', 50, 'Cinto branco de cerimônia'),
  ('Luvas Brancas', 'acessorio', 60, 'Luvas brancas par'),
  ('Dragonas', 'acessorio', 35, 'Dragonas de posto')
ON CONFLICT DO NOTHING;
